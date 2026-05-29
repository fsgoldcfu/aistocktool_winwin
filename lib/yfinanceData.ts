// ==================== 數據源對接層 ====================
// 使用 Alpha Vantage API（唔會被 Vercel block）

const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 300 });

const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY || "XQOF0OOC5CFZEBJJ";

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

// ==================== fetchQuote: 獲取實時報價 ====================
async function fetchQuote(symbol: string): Promise<QuoteData> {
  const cacheKey = `quote_${symbol}`;
  const cached = cache.get(cacheKey) as QuoteData | undefined;
  if (cached) return cached;

  // 港股：00700.HK → 0700.HKG（Alpha Vantage 格式）
  // 美股：NVDA → NVDA
  let avSymbol = symbol;
  if (symbol.includes(".HK")) {
    // 移除前導零，加 .HKG
    const num = symbol.replace(".HK", "").replace(/^0+/, "");
    avSymbol = `${num}.HKG`;
  } else if (/^\d+$/.test(symbol)) {
    const num = symbol.replace(/^0+/, "");
    avSymbol = `${num}.HKG`;
  }

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${avSymbol}&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Alpha Vantage HTTP ${response.status}`);
    }

    const data = await response.json();
    const q = data["Global Quote"];

    if (!q || !q["05. price"]) {
      console.error(`[AlphaVantage] No data for ${avSymbol}:`, JSON.stringify(data).slice(0, 200));
      throw new Error(`No price data for ${avSymbol}`);
    }

    const price = parseFloat(q["05. price"]);
    const change = parseFloat(q["09. change"]);
    const changePercent = parseFloat(q["10. change percent"].replace("%", "")) / 100;

    const quote: QuoteData = {
      symbol,
      price,
      change,
      changePercent,
      open: parseFloat(q["02. open"]),
      high: parseFloat(q["03. high"]),
      low: parseFloat(q["04. low"]),
      volume: parseInt(q["06. volume"]),
      timestamp: Date.now(),
      status: "live",
    };

    cache.set(cacheKey, quote, 60);
    console.log(`[AlphaVantage] ✅ ${avSymbol}: $${price}`);
    return quote;

  } catch (error) {
    console.error(`[AlphaVantage] Error for ${avSymbol}:`, error);
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

  let avSymbol = symbol;
  if (symbol.includes(".HK")) {
    const num = symbol.replace(".HK", "").replace(/^0+/, "");
    avSymbol = `${num}.HKG`;
  } else if (/^\d+$/.test(symbol)) {
    const num = symbol.replace(/^0+/, "");
    avSymbol = `${num}.HKG`;
  }

  try {
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${avSymbol}&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Alpha Vantage HTTP ${response.status}`);
    }

    const data = await response.json();
    const timeSeries = data["Time Series (Daily)"];

    if (!timeSeries) {
      console.error(`[AlphaVantage] No historical data for ${avSymbol}`);
      throw new Error(`No historical data for ${avSymbol}`);
    }

    const candles: CandleData[] = Object.entries(timeSeries)
      .map(([date, values]: [string, any]) => ({
        date,
        open: parseFloat(values["1. open"]),
        high: parseFloat(values["2. high"]),
        low: parseFloat(values["3. low"]),
        close: parseFloat(values["4. close"]),
        volume: parseInt(values["5. volume"]),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    cache.set(cacheKey, candles, 300);
    console.log(`[AlphaVantage] ✅ Fetched ${candles.length} candles for ${avSymbol}`);
    return candles;

  } catch (error) {
    console.error(`[AlphaVantage] Historical error for ${avSymbol}:`, error);
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
