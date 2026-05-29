// ==================== 數據源對接層 ====================
// 使用 Twelve Data API（免費版每分鐘 800 次，支援港股）

const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 300 });

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

// ==================== 轉換股票代號 ====================
function convertSymbol(symbol: string): string {
  // 港股：00700.HK → 700.HK（保留 .HK 格式）
  if (symbol.includes(".HK")) {
    const num = symbol.replace(".HK", "").replace(/^0+/, "");
    return `${num}.HK`;
  }
  // 純數字（港股）
  if (/^\d+$/.test(symbol)) {
    const num = symbol.replace(/^0+/, "");
    return `${num}.HK`;
  }
  // 美股直接用原本 symbol
  return symbol;
}

// ==================== fetchQuote: 獲取實時報價 ====================
async function fetchQuote(symbol: string): Promise<QuoteData> {
  const cacheKey = `quote_${symbol}`;
  const cached = cache.get(cacheKey) as QuoteData | undefined;
  if (cached) return cached;

  const tdSymbol = convertSymbol(symbol);

  try {
    const isHK = tdSymbol.includes(".HK");
const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(tdSymbol)}${isHK ? "&exchange=HKEX" : ""}&apikey=${TWELVE_DATA_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Twelve Data HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === "error" || data.code) {
      console.error(`[TwelveData] Error for ${tdSymbol}:`, data.message || JSON.stringify(data));
      throw new Error(`No data for ${tdSymbol}: ${data.message}`);
    }

    const price = parseFloat(data.close);
    const open = parseFloat(data.open);
    const change = price - open;
    const changePercent = open > 0 ? (change / open) : 0;

    const quote: QuoteData = {
      symbol,
      price,
      change,
      changePercent,
      open,
      high: parseFloat(data.high) || price,
      low: parseFloat(data.low) || price,
      volume: parseInt(data.volume) || 0,
      timestamp: Date.now(),
      status: "live",
    };

    cache.set(cacheKey, quote, 60);
    console.log(`[TwelveData] ✅ ${tdSymbol}: $${price}`);
    return quote;

  } catch (error) {
    console.error(`[TwelveData] Error for ${tdSymbol}:`, error);
    throw new Error(`Failed to fetch quote for ${symbol}`);
  }
}

// ==================== fetchHistoricalData: 獲取歷史 K 線 ====================
async function fetchHistoricalData(
  symbol: string,
  period: string = "3mo"
): Promise<CandleData[]> {
  const cacheKey = `history_${symbol}_${period}`;
  const cached = cache.get(cacheKey) as CandleData[] | undefined;
  if (cached) return cached;

  const tdSymbol = convertSymbol(symbol);

  // 將 period 轉換成 outputsize
  const outputsize = period === "1mo" ? 22 : period === "3mo" ? 66 : 130;

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=1day&outputsize=${outputsize}&apikey=${TWELVE_DATA_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Twelve Data HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status === "error" || data.code) {
      console.error(`[TwelveData] Historical error for ${tdSymbol}:`, data.message);
      throw new Error(`No historical data for ${tdSymbol}`);
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
      .reverse(); // Twelve Data 係由新到舊，要反轉

    cache.set(cacheKey, candles, 300);
    console.log(`[TwelveData] ✅ Fetched ${candles.length} candles for ${tdSymbol}`);
    return candles;

  } catch (error) {
    console.error(`[TwelveData] Historical error for ${tdSymbol}:`, error);
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
};
