// ==================== 數據源對接層（純 Finnhub 版） ====================
// 唔需要歷史K線，淨係用 Finnhub /quote endpoint
// 技術指標用簡化公式從 quote 嘅 high/low/open/close/prevClose 推算

const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 900 }); // 15 分鐘 cache

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "d7tf2v1r01qugn0ad0m0d7tf2v1r01qugn0ad0mg";

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
    console.log(`[Finnhub] ✅ ${symbol}: $${price} (${(changePercent * 100).toFixed(2)}%)`);
    return quote;

  } catch (error) {
    console.error(`[Finnhub] Error for ${symbol}:`, error);
    throw new Error(`Failed to fetch quote for ${symbol}`);
  }
}

// ==================== fetchHistoricalData: 用 prevClose 模擬最簡化嘅2點K線 ====================
// 由於 Finnhub 免費版唔支援 /stock/candle，呢個函數只回傳基於 quote 嘅簡化數據
// 用嚀計算指標嘅 fallback，並非真實歷史走勢
async function fetchHistoricalData(
  symbol: string,
  period: string = "3mo"
): Promise<CandleData[]> {
  const quote = await fetchQuote(symbol);

  // 用 quote 嘅 open/high/low/close 構建單日蠟燭圖
  // 同時用 prevClose 構建「昨日」蠟燭，畀計算 RSI/EMA 用最少2點數據
  const prevClose = quote.price - quote.change;

  const candles: CandleData[] = [
    {
      date: new Date(Date.now() - 86400000).toISOString().split("T")[0],
      open: prevClose,
      high: prevClose,
      low: prevClose,
      close: prevClose,
      volume: 0,
    },
    {
      date: new Date().toISOString().split("T")[0],
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.price,
      volume: 0,
    },
  ];

  return candles;
}

// ==================== calculateIndicators（簡化版，基於單日數據） ====================
function calculateIndicators(candles: CandleData[]): IndicatorData {
  if (candles.length < 2) {
    return { rsi: 50, ema20: 0, ema50: 0, macd: { macd: 0, signal: 0 }, atr: 0 };
  }

  const today = candles[candles.length - 1];
  const yesterday = candles[candles.length - 2];

  // 簡化 RSI：用今日漲跌幅推算（50 為中性，>50 偏多，<50 偏空）
  const changePercent = yesterday.close > 0 ? (today.close - yesterday.close) / yesterday.close : 0;
  const rsi = Math.max(0, Math.min(100, 50 + changePercent * 1000)); // 簡化映射

  // 簡化 EMA：用今日 close 作為近似值（因為冇足夠歷史數據）
  const ema20 = today.close;
  const ema50 = today.close;

  // 簡化 MACD：用今日漲跌幅方向判斷
  const macd = changePercent * 100;
  const signal = macd * 0.67;

  // 簡化 ATR：用今日 high-low 範圍
  const atr = today.high - today.low || today.close * 0.02; // fallback 2%

  return { rsi, ema20, ema50, macd: { macd, signal }, atr };
}

export const yfinanceData = {
  fetchQuote,
  fetchHistoricalData,
  calculateIndicators,
  sleep,
};
