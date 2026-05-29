// ==================== 數據源對接層 ====================
// 所有 Mock 數據邏輯已徹底刪除
// yfinance API 失敗時直接拋出錯誤，不生成虛假數據

const NodeCache = require("node-cache");
const cache = new (NodeCache as any)({ stdTTL: 300 });

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

  // 確保符號包含 .HK 後綴
  const normalizedSymbol = symbol.includes(".HK") ? symbol : `${symbol}.HK`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${normalizedSymbol}?modules=price`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://finance.yahoo.com/',
          'Origin': 'https://finance.yahoo.com',
          'Cookie': 'B=; expires=Thu, 01 Jan 2026 00:00:00 GMT',
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(
          `[YFinance] Attempt ${attempt}/3 failed for ${normalizedSymbol}: HTTP ${response.status}`
        );
        continue;
      }

      const data = await response.json();
      const result = data.quoteSummary?.result?.[0]?.price;

      if (!result) {
        console.error(
          `[YFinance] Attempt ${attempt}/3: No price data for ${normalizedSymbol}`
        );
        continue;
      }

      const quote: QuoteData = {
        symbol: normalizedSymbol,
        price: result.regularMarketPrice?.raw || 0,
        change: result.regularMarketChange?.raw || 0,
        changePercent: result.regularMarketChangePercent?.raw || 0,
        open: result.regularMarketOpen?.raw || 0,
        high: result.fiftyTwoWeekHigh?.raw || 0,
        low: result.fiftyTwoWeekLow?.raw || 0,
        volume: result.regularMarketVolume?.raw || 0,
        timestamp: Date.now(),
        status: "live",
      };

      cache.set(cacheKey, quote, 300);
      console.log(`[YFinance] Successfully fetched quote for ${normalizedSymbol}`);
      return quote;
    } catch (error) {
      console.error(
        `[YFinance] Attempt ${attempt}/3 error for ${normalizedSymbol}:`,
        error
      );
    }
  }

  console.error(`[YFinance] Failed to fetch quote for ${normalizedSymbol} after 3 attempts`);
  throw new Error(`[YFinance] Unable to fetch real-time data for ${normalizedSymbol}. Please check network connection and ensure symbol includes .HK suffix (e.g., 9988.HK for Alibaba).`);
}

// ==================== fetchHistoricalData: 獲取歷史 K 線 ====================
async function fetchHistoricalData(
  symbol: string,
  period: string = "3mo"
): Promise<CandleData[]> {
  const cacheKey = `history_${symbol}_${period}`;
  const cached = cache.get(cacheKey) as CandleData[] | undefined;
  if (cached) return cached;

  // 確保符號包含 .HK 後綴
  const normalizedSymbol = symbol.includes(".HK") ? symbol : `${symbol}.HK`;

  try {
    // Use yfinance chart endpoint
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${normalizedSymbol}?interval=1d&range=${period}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com',
        'Cookie': 'B=; expires=Thu, 01 Jan 2026 00:00:00 GMT',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[YFinance] API returned ${response.status} for ${normalizedSymbol}`);
      throw new Error(`[YFinance] API error ${response.status} for ${normalizedSymbol}. Check network and symbol format.`);
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];

    if (!result) {
      console.error(`[YFinance] No chart data for ${normalizedSymbol}`);
      throw new Error(`[YFinance] No historical data available for ${normalizedSymbol}. Symbol may not exist or be delisted.`);
    }

    const timestamps = result.timestamp || [];
    const opens = result.indicators?.quote?.[0]?.open || [];
    const highs = result.indicators?.quote?.[0]?.high || [];
    const lows = result.indicators?.quote?.[0]?.low || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const volumes = result.indicators?.quote?.[0]?.volume || [];

    const candles: CandleData[] = timestamps.map((ts: number, i: number) => ({
      date: new Date(ts * 1000).toISOString().split("T")[0],
      open: opens[i] || 0,
      high: highs[i] || 0,
      low: lows[i] || 0,
      close: closes[i] || 0,
      volume: volumes[i] || 0,
    }));

    cache.set(cacheKey, candles, 300);
    return candles;
  } catch (error) {
    console.error(`[YFinance] Error fetching historical data for ${normalizedSymbol}:`, error);
    throw new Error(`[YFinance] Failed to fetch historical data for ${normalizedSymbol}. ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ==================== calculateIndicators: 計算技術指標 ====================
function calculateIndicators(candles: CandleData[]): IndicatorData {
  if (candles.length < 20) {
    return {
      rsi: 0,
      ema20: 0,
      ema50: 0,
      macd: { macd: 0, signal: 0 },
      atr: 0,
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const rsi = calculateRSI(closes, 14);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const { macd, signal } = calculateMACD(closes);
  const atr = calculateATR(highs, lows, closes, 14);

  return {
    rsi,
    ema20,
    ema50,
    macd: { macd, signal },
    atr,
  };
}

// ==================== 技術指標計算函數 ====================
function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 0;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain > 0 ? 100 : 0;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
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
  const signal = macd * 0.67;
  return { macd, signal };
}

function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number
): number {
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

// ==================== 導出模組 ====================
export const yfinanceData = {
  fetchQuote,
  fetchHistoricalData,
  calculateIndicators,
};
