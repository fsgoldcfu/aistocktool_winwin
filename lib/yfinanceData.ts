// 美股數據層：Finnhub 報價 + Twelve Data split-adjusted 日線。
// 所有金鑰只可由部署環境變數提供，絕不能寫入 repository。

const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 900 });

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_KEY || '';
const HISTORY_CACHE_TTL_SECONDS = 15 * 60;
const HISTORY_STALE_TTL_SECONDS = 6 * 60 * 60;
const HISTORY_WINDOW_MS = 15 * 60 * 1000;
// 預設必須能完成目前 44 隻固定池的一次掃描；過去的 8 個硬性預算會令 36 隻
// 從未被分析，即使 API key 仍可正常使用。序列化間隔及 429 cooldown 仍保護 provider。
const US_FIXED_POOL_HISTORY_REQUEST_FLOOR = 44;
const DEFAULT_TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW = 48;
const TWELVE_DATA_MIN_INTERVAL_MS = Math.max(0, Number(process.env.TWELVE_DATA_MIN_INTERVAL_MS ?? 1_250));
const configuredHistoryRequestBudget = Number(process.env.TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW ?? DEFAULT_TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW);
const TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW = (() => {
  if (!Number.isFinite(configuredHistoryRequestBudget) || configuredHistoryRequestBudget < US_FIXED_POOL_HISTORY_REQUEST_FLOOR) {
    if (process.env.TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW != null) {
      console.warn(`[TwelveData] TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW=${process.env.TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW} cannot cover the ${US_FIXED_POOL_HISTORY_REQUEST_FLOOR}-stock US pool; enforcing ${DEFAULT_TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW}.`);
    }
    return DEFAULT_TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW;
  }
  return Math.floor(configuredHistoryRequestBudget);
})();
const TWELVE_DATA_429_COOLDOWN_MS = Math.max(60_000, Number(process.env.TWELVE_DATA_429_COOLDOWN_MS ?? HISTORY_WINDOW_MS));

let nextTwelveDataRequestAt = 0;
let twelveDataCooldownUntil = 0;
let historyWindowStartedAt = Date.now();
let historyRequestsInWindow = 0;
const historyInFlight = new Map<string, Promise<HistoricalDataResult>>();

export interface QuoteData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  timestamp: number;
  status: 'live';
}

export interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type HistoricalDataSource = 'fresh-cache' | 'network' | 'stale-cache' | 'cooldown' | 'budget-exhausted' | 'error';

export interface HistoricalDataResult {
  candles: CandleData[];
  source: HistoricalDataSource;
  error?: string;
  cachedAt?: number;
}

export interface IndicatorData {
  rsi: number;
  ema20: number;
  ema50: number;
  macd: { macd: number; signal: number };
  atr: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredKey(key: string, name: string) {
  if (!key) throw new Error(`${name} 未設定，掃描服務已停止以避免使用不明或過期資料。`);
  return key;
}

function assertFinitePositive(value: number, field: string, date: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`日線資料無效：${date} 的 ${field} 不是有效正數`);
}

function normalizeCandles(values: unknown): CandleData[] {
  if (!Array.isArray(values) || values.length === 0) throw new Error('Twelve Data 沒有返回日線資料');
  const seen = new Set<string>();
  const candles = values.map((raw: any): CandleData => {
    const date = String(raw.datetime ?? raw.date ?? '');
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    const volume = raw.volume == null || raw.volume === '' ? 0 : Number(raw.volume);
    if (!date || seen.has(date)) throw new Error(`日線日期重複或缺失：${date || 'unknown'}`);
    seen.add(date);
    assertFinitePositive(open, 'open', date);
    assertFinitePositive(high, 'high', date);
    assertFinitePositive(low, 'low', date);
    assertFinitePositive(close, 'close', date);
    if (!Number.isFinite(volume) || volume < 0 || high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      throw new Error(`日線 OHLCV 無效：${date}`);
    }
    return { date, open, high, low, close, volume };
  });
  return candles.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchQuote(symbol: string): Promise<QuoteData> {
  const cacheKey = `quote_${symbol}`;
  const cached = cache.get(cacheKey) as QuoteData | undefined;
  if (cached) return cached;

  const token = requiredKey(FINNHUB_KEY, 'FINNHUB_API_KEY');
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Finnhub HTTP ${response.status}`);
  const data = await response.json();
  const price = Number(data.c);
  const previousClose = Number(data.pc);
  const open = Number(data.o);
  const high = Number(data.h);
  const low = Number(data.l);

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(previousClose) || previousClose <= 0) {
    throw new Error(`Finnhub 未返回 ${symbol} 的有效現價／前收市價`);
  }

  const quote: QuoteData = {
    symbol,
    price,
    change: price - previousClose,
    changePercent: (price - previousClose) / previousClose,
    open: Number.isFinite(open) && open > 0 ? open : price,
    high: Number.isFinite(high) && high > 0 ? high : price,
    low: Number.isFinite(low) && low > 0 ? low : price,
    volume: 0,
    timestamp: Date.now(),
    status: 'live',
  };
  cache.set(cacheKey, quote, 900);
  return quote;
}

function historyCacheKey(symbol: string, period: string) {
  return `history_${symbol.toUpperCase()}_${period}`;
}

function readStaleHistory(symbol: string, period: string): CandleData[] | undefined {
  return cache.get(`history_stale_${symbol.toUpperCase()}_${period}`) as CandleData[] | undefined;
}

function resetHistoryWindowIfNeeded(now = Date.now()) {
  if (now - historyWindowStartedAt >= HISTORY_WINDOW_MS) {
    historyWindowStartedAt = now;
    historyRequestsInWindow = 0;
  }
}

async function scheduleTwelveDataHistoryRequest() {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextTwelveDataRequestAt);
  nextTwelveDataRequestAt = scheduledAt + TWELVE_DATA_MIN_INTERVAL_MS;
  if (scheduledAt > now) await sleep(scheduledAt - now);
}

/**
 * 只讓未快取的日線請求進入序列化佇列；同一 symbol/period 的 in-flight request 會共用。
 * 預設預算覆蓋整個 44 隻固定池；收到 429 後立即啟用 cooldown，並在可用時退回最後一份有效日線。
 */
async function fetchHistoricalDataWithMeta(symbol: string, period: string = '3mo'): Promise<HistoricalDataResult> {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = historyCacheKey(normalizedSymbol, period);
  const cached = cache.get(cacheKey) as CandleData[] | undefined;
  if (cached) return { candles: cached, source: 'fresh-cache' };

  const inFlight = historyInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<HistoricalDataResult> => {
    const stale = readStaleHistory(normalizedSymbol, period);
    const now = Date.now();
    resetHistoryWindowIfNeeded(now);
    if (now < twelveDataCooldownUntil) {
      return stale
        ? { candles: stale, source: 'stale-cache', error: 'Twelve Data 429 cooldown active; using last valid daily history.' }
        : { candles: [], source: 'cooldown', error: 'Twelve Data 429 cooldown active.' };
    }
    if (historyRequestsInWindow >= TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW) {
      return stale
        ? { candles: stale, source: 'stale-cache', error: 'Twelve Data history request budget reached; using last valid daily history.' }
        : { candles: [], source: 'budget-exhausted', error: 'Twelve Data history request budget reached for this 15-minute window.' };
    }

    try {
      const apiKey = requiredKey(TWELVE_DATA_KEY, 'TWELVE_DATA_API_KEY');
      historyRequestsInWindow += 1;
      await scheduleTwelveDataHistoryRequest();
      const outputsize = period === '1mo' ? 22 : period === '3mo' ? 66 : period === '6mo' ? 132 : 260;
      const params = new URLSearchParams({
        symbol: normalizedSymbol,
        interval: '1day',
        outputsize: String(outputsize),
        order: 'asc',
        adjust: 'splits',
        apikey: apiKey,
      });
      const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 429) {
        twelveDataCooldownUntil = Date.now() + TWELVE_DATA_429_COOLDOWN_MS;
        return stale
          ? { candles: stale, source: 'stale-cache', error: 'Twelve Data HTTP 429; using last valid daily history.' }
          : { candles: [], source: 'cooldown', error: 'Twelve Data HTTP 429; cooldown started.' };
      }
      if (!response.ok) throw new Error(`Twelve Data HTTP ${response.status}`);
      const data = await response.json();
      if (data.status === 'error' || data.code || !data.values) {
        throw new Error(`Twelve Data 日線錯誤：${data.message || 'unknown'}`);
      }
      const candles = normalizeCandles(data.values);
      cache.set(cacheKey, candles, HISTORY_CACHE_TTL_SECONDS);
      cache.set(`history_stale_${normalizedSymbol}_${period}`, candles, HISTORY_STALE_TTL_SECONDS);
      return { candles, source: 'network' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown historical data error';
      return stale
        ? { candles: stale, source: 'stale-cache', error: message }
        : { candles: [], source: 'error', error: message };
    }
  })();

  historyInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    historyInFlight.delete(cacheKey);
  }
}

async function fetchHistoricalData(symbol: string, period: string = '3mo'): Promise<CandleData[]> {
  const result = await fetchHistoricalDataWithMeta(symbol, period);
  if (!result.candles.length) throw new Error(result.error || `Twelve Data 日線資料不可用：${symbol}`);
  return result.candles;
}

function emaSeries(values: number[], period: number): (number | null)[] {
  const series: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return series;
  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  series[period - 1] = ema;
  for (let index = period; index < values.length; index++) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
    series[index] = ema;
  }
  return series;
}

function calculateEMA(prices: number[], period: number): number {
  const series = emaSeries(prices, period);
  return series[series.length - 1] ?? 0;
}

function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let index = 1; index < prices.length; index++) {
    const change = prices[index] - prices[index - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  let averageGain = gains.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;
  let averageLoss = losses.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period + 1; index < prices.length; index++) {
    averageGain = (averageGain * (period - 1) + gains[index]) / period;
    averageLoss = (averageLoss * (period - 1) + losses[index]) / period;
  }
  if (averageLoss === 0) return averageGain > 0 ? 100 : 50;
  return 100 - 100 / (1 + averageGain / averageLoss);
}

function calculateMACD(prices: number[]): { macd: number; signal: number } {
  const fast = emaSeries(prices, 12);
  const slow = emaSeries(prices, 26);
  const macdValues = fast.map((value, index) => value != null && slow[index] != null ? value - (slow[index] as number) : null);
  const validMacd = macdValues.filter((value): value is number => value != null);
  if (!validMacd.length) return { macd: 0, signal: 0 };
  const signalValues = emaSeries(validMacd, 9);
  return { macd: validMacd[validMacd.length - 1], signal: signalValues[signalValues.length - 1] ?? 0 };
}

function calculateATR(candles: CandleData[], period: number): number {
  if (candles.length < period + 1) return 0;
  const ranges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < ranges.length; index++) atr = (atr * (period - 1) + ranges[index]) / period;
  return atr;
}

function calculateIndicators(candles: CandleData[]): IndicatorData {
  if (candles.length < 26) return { rsi: 50, ema20: 0, ema50: 0, macd: { macd: 0, signal: 0 }, atr: 0 };
  const closes = candles.map((candle) => candle.close);
  return {
    rsi: calculateRSI(closes, 14),
    ema20: calculateEMA(closes, 20),
    ema50: calculateEMA(closes, 50),
    macd: calculateMACD(closes),
    atr: calculateATR(candles, 14),
  };
}

export function getHistoricalCacheStatus(symbol: string, period: string = '3mo') {
  const normalizedSymbol = symbol.toUpperCase();
  return {
    fresh: Boolean(cache.get(historyCacheKey(normalizedSymbol, period))),
    stale: Boolean(readStaleHistory(normalizedSymbol, period)),
  };
}

export function getTwelveDataHistoryHealth() {
  resetHistoryWindowIfNeeded();
  return {
    windowRequestsUsed: historyRequestsInWindow,
    windowRequestBudget: TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW,
    cooldownRemainingMs: Math.max(0, twelveDataCooldownUntil - Date.now()),
    cacheTtlSeconds: HISTORY_CACHE_TTL_SECONDS,
  };
}

export const yfinanceData = { fetchQuote, fetchHistoricalData, fetchHistoricalDataWithMeta, calculateIndicators, sleep, getHistoricalCacheStatus, getTwelveDataHistoryHealth };
