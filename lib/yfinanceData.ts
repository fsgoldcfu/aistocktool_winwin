// ==================== 數據源對接層（美股版 - 混合方案） ====================
// fetchQuote: 用 Finnhub（即時報價，免費版支援）
// fetchHistoricalData: 用 Twelve Data（歷史K線，Finnhub免費版已不支援）

const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 900 }); // 15 分鐘 cache

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "d7tf2v1r01qugn0ad0m0d7tf2v1r01qugn0ad0mg";
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_KEY || "649e2910371546de92d4cf65b78895de";

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
  status: string;
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

// ==================== sleep helper（節流用） ====================
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== fetchQuote: 用 Finnhub 獲取實時報價 ====================
async function fetchQuote(symbol: string): Promise<QuoteData> {
  const cacheKey = `quote_${symbol}`;
  const cached = cache.get(cacheKey) as QuoteData | undefined;
  if (cached) return cached;

  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Finnhub HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.c === undefined || data.c === 0) {
      console.error(`[Finnhub] No data for ${symbol}:`, JSON.stringify(data));
      throw new Error(`No price data for ${symbol}`);
    }

    const price = data.c;
    const prevClose = data.pc || price;
    const change = price - prevClose;
    const changePercent = prevClose > 0 ? change / prevClose : 0;

    const quote: QuoteData = {
      symbol,
      price,
      change,
      changePercent,
      open: data.o || price,
      high: data.h || price,
      low: data.l || price,
      volume: 0,
      timestamp: Date.now(),
      status: "live",
    };

    cache.set(cacheKey, quote, 900);
    console.log(`[Finnhub] ✅ ${symbol}: $${price}`);
    return quote;

  } catch (error) {
    console.error(`[Finnhub] Error for ${symbol}:`, error);
    throw new Error(`Failed to fetch quote for ${symbol}`);
  }
}

// ==================== fetchHistoricalData: 用 Twelve Data 獲取歷史 K 線 ====================
async function fetchHistoricalData(
  symbol: string,
  period: string = "3mo"
): Promise<CandleData[]> {
  const cacheKey = `history_${symbol}_${period}`;
  const cached = cache.get(cacheKey) as CandleData[] | undefined;
  if (cached) return cached;

  const outputsize = period === "1mo" ? 22 : period === "3mo" ? 66 : 130;

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&apikey=${TWELVE_DATA_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`TwelveData HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === "error" || data.code) {
      console.error(`[TwelveData] Error for ${symbol}:`, data.message);
      throw new Error(`No historical data for ${symbol}: ${data.message}`);
    }

    const values = data.values || [];
    const candles: CandleData[] = values
      .map((v: any) => ({
        date: v.datetime,
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: parseInt(v.volume) || 0,
      }))
      .reverse(); // Twelve Data 由新到舊，要反轉成由舊到新

    cache.set(cacheKey, candles, 900);
    console.log(`[TwelveData] ✅ Fetched ${candles.length} candles for ${symbol}`);
    return candles;

  } catch (error) {
    console.error(`[TwelveData] Historical error for ${symbol}:`, error);
    throw new Error(`Failed to fetch historical data for ${symbol}`);
  }
}

// ==================== calculateIndicators ====================
function calculateIndicators(candles: CandleData[]): IndicatorData {
  if (candles.length < 20) {
    return { rsi: 50, ema20: 0, ema50: 0, macd: { macd: 0, signal: 0 }, atr: 0 };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const rsi = calculateRSI(closes, 14);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const { macd, signal } = calculateMACD(closes);
  const atr = calculateATR(highs, lows, closes, 14);

  return { rsi, ema20, ema50, macd: { macd, signal }, atr };
}

function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain > 0 ? 100 : 50;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  return ema;
}

function calculateMACD(prices: number[]): { macd: number; signal: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  return { macd, signal: macd * 0.67 };
}

function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
  if (highs.length < period) return 0;
  let trSum = 0;
  for (let i = Math.max(1, highs.length - period); i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trSum += tr;
  }
  return trSum / period;
}

export const yfinanceData = {
  fetchQuote,
  fetchHistoricalData,
  calculateIndicators,
  sleep,
};
