// 美股數據層：Finnhub 報價 + Twelve Data split-adjusted 日線。
// 所有金鑰只可由部署環境變數提供，絕不能寫入 repository。

const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 900 });

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_KEY || '';

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

async function fetchHistoricalData(symbol: string, period: string = '3mo'): Promise<CandleData[]> {
  const cacheKey = `history_${symbol}_${period}`;
  const cached = cache.get(cacheKey) as CandleData[] | undefined;
  if (cached) return cached;

  const apiKey = requiredKey(TWELVE_DATA_KEY, 'TWELVE_DATA_API_KEY');
  const outputsize = period === '1mo' ? 22 : period === '3mo' ? 66 : period === '6mo' ? 132 : 260;
  const params = new URLSearchParams({
    symbol,
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
  if (!response.ok) throw new Error(`Twelve Data HTTP ${response.status}`);
  const data = await response.json();
  if (data.status === 'error' || data.code || !data.values) {
    throw new Error(`Twelve Data 日線錯誤：${data.message || 'unknown'}`);
  }
  const candles = normalizeCandles(data.values);
  cache.set(cacheKey, candles, 900);
  return candles;
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

export const yfinanceData = { fetchQuote, fetchHistoricalData, calculateIndicators, sleep };
