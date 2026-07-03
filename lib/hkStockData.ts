/**
 * HK Stock Data Layer - iTick API Integration
 *
 * 修正重點（解決 429 Rate Limit 問題）：
 * iTick 免費版限制 5次/分鐘，非常緊張。原本逐隻股票分別call
 * fetchQuote + fetchHistoricalData，25隻股票會變成50次call，
 * 完全唔夠用。而家改用：
 *
 * 1. 全局節流隊列：確保任何call之間至少相隔 13秒（每分鐘<5次，留buffer）
 * 2. 批量報價 fetchBatchQuotes：一次過攞晒全部股票報價（1次call）
 * 3. 批量歷史K線 fetchBatchHistoricalData：一次過攞晒全部股票嘅K線（1次call）
 */

const ITICK_BASE_URL = "https://api.itick.org";
const ITICK_REGION = "HK";

interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Quote {
  price: number;
  change: number;
  changePercent: number;
}

interface Indicators {
  ema20: number;
  rsi: number;
  atr: number;
  macd: number;
  macdSignal: number;
}

const K_TYPE_MAP: Record<string, number> = {
  "1min": 1, "5min": 2, "15min": 3, "30min": 4, "60min": 5,
  "2h": 6, "4h": 7, "1day": 8, "1week": 9, "1month": 10,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== iTick 全局節流隊列 ====================
// 免費版 5次/分鐘，保守設定每次call之間至少間隔 13秒
const ITICK_MIN_INTERVAL_MS = 13000;
let lastITickCallTime = 0;
let itickQueue: Promise<void> = Promise.resolve();

function scheduleITickCall<T>(fn: () => Promise<T>): Promise<T> {
  const runWithThrottle = async (): Promise<T> => {
    const now = Date.now();
    const elapsed = now - lastITickCallTime;
    if (elapsed < ITICK_MIN_INTERVAL_MS) {
      await sleep(ITICK_MIN_INTERVAL_MS - elapsed);
    }
    lastITickCallTime = Date.now();
    return fn();
  };
  const resultPromise = itickQueue.then(runWithThrottle);
  itickQueue = resultPromise.then(() => undefined, () => undefined);
  return resultPromise;
}

async function fetchWithRetry429ITick(url: string, headers: Record<string, string>, timeoutMs: number, maxRetries: number = 1): Promise<Response> {
  let attempt = 0;
  while (true) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 429 || attempt >= maxRetries) return response;
    attempt++;
    const backoffMs = ITICK_MIN_INTERVAL_MS * 2;
    console.warn(`[HK Stock Data] ⚠️ 429 Rate Limited，第${attempt}次重試，等待${backoffMs}ms`);
    await sleep(backoffMs);
  }
}

// ==================== Cache ====================
const quoteCache = new Map<string, { data: Quote; timestamp: number }>();
const QUOTE_CACHE_TTL_MS = 60 * 1000;

const historicalCache = new Map<string, { data: Candle[]; timestamp: number }>();
const HISTORICAL_CACHE_TTL_MS = 10 * 60 * 1000;

class HKStockData {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ITICK_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[HK Stock Data] ⚠️ ITICK_API_KEY 未設定，港股數據將無法獲取");
    }
  }

  private getHeaders() {
    return { accept: "application/json", token: this.apiKey };
  }

  private normalizeSymbol(symbol: string): string {
    const stripped = symbol.replace(/\.HK$/i, "").replace(/^0+/, "");
    return stripped || "0";
  }

  private parseCandles(rawCandles: any[]): Candle[] {
    const candles: Candle[] = rawCandles.map((c: any) => ({
      date: new Date(c.t).toISOString().split("T")[0],
      open: Number(c.o) || 0,
      high: Number(c.h) || 0,
      low: Number(c.l) || 0,
      close: Number(c.c) || 0,
      volume: Number(c.v) || 0,
    }));
    candles.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return candles;
  }

  private periodToLimit(period: string): number {
    const map: Record<string, number> = { "1mo": 22, "3mo": 66, "6mo": 132, "1y": 252 };
    return map[period] || 90;
  }

  /** 單一股票即時報價（用於恒指等單獨查詢） */
  async fetchQuote(symbol: string): Promise<Quote | null> {
    const code = this.normalizeSymbol(symbol);
    const cached = quoteCache.get(code);
    if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL_MS) return cached.data;

    return scheduleITickCall(async () => {
      try {
        const url = `${ITICK_BASE_URL}/stock/quote?region=${ITICK_REGION}&code=${code}`;
        const response = await fetchWithRetry429ITick(url, this.getHeaders(), 10000);
        if (!response.ok) { console.error(`[HK Stock Data] fetchQuote HTTP ${response.status} for ${symbol}`); return null; }
        const json = await response.json();
        if (json.code !== 0 || !json.data) { console.error(`[HK Stock Data] fetchQuote failed for ${symbol}: ${json.msg}`); return null; }
        const d = json.data;
        const price = Number(d.ld) || 0;
        const open = Number(d.o) || price;
        const change = price - open;
        const changePercent = open > 0 ? change / open : 0;
        const quote: Quote = { price, change, changePercent };
        quoteCache.set(code, { data: quote, timestamp: Date.now() });
        return quote;
      } catch (error) {
        console.error(`[HK Stock Data] fetchQuote error for ${symbol}:`, error);
        return null;
      }
    });
  }

  /**
   * 批量即時報價：分批call，每批最多5隻（iTick免費版限制）
   * Scanner 主要入口
   */
  async fetchBatchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const result = new Map<string, Quote>();
    const codes = symbols.map((s) => this.normalizeSymbol(s));
    const BATCH_SIZE = 5; // iTick免費版每次最多5隻

    const batches: string[][] = [];
    for (let i = 0; i < codes.length; i += BATCH_SIZE) {
      batches.push(codes.slice(i, i + BATCH_SIZE));
    }
    console.log(`[HK Stock Data] 分${batches.length}批攞報價，每批最多${BATCH_SIZE}隻`);

    for (const batch of batches) {
      await scheduleITickCall(async () => {
        try {
          const url = `${ITICK_BASE_URL}/stock/quotes?region=${ITICK_REGION}&codes=${batch.join(",")}`;
          const response = await fetchWithRetry429ITick(url, this.getHeaders(), 15000);
          if (!response.ok) { console.error(`[HK Stock Data] fetchBatchQuotes HTTP ${response.status}`); return; }
          const json = await response.json();
          if (json.code !== 0 || !json.data) {
            console.error(`[HK Stock Data] fetchBatchQuotes failed: ${json.msg}`);
            return;
          }
          const entries = Array.isArray(json.data)
            ? json.data.map((d: any) => [d.s || d.code, d])
            : Object.entries(json.data);
          for (const [code, d] of entries as [string, any][]) {
            const price = Number(d.ld) || 0;
            const open = Number(d.o) || price;
            const change = price - open;
            const changePercent = open > 0 ? change / open : 0;
            const quote = { price, change, changePercent };
            result.set(String(code), quote);
            quoteCache.set(String(code), { data: quote, timestamp: Date.now() });
          }
          console.log(`[HK Stock Data] ✅ 批次完成，累計 ${result.size} 隻`);
        } catch (error) {
          console.error(`[HK Stock Data] fetchBatchQuotes batch error:`, error);
        }
      });
    }
    console.log(`[HK Stock Data] ✅ 批量報價全部完成，共 ${result.size} 隻`);
    return result;
  }

  /** 單一股票歷史K線（fallback用） */
  async fetchHistoricalData(symbol: string, period: string): Promise<Candle[]> {
    const code = this.normalizeSymbol(symbol);
    const cached = historicalCache.get(code);
    if (cached && Date.now() - cached.timestamp < HISTORICAL_CACHE_TTL_MS) return cached.data;
    const kType = K_TYPE_MAP["1day"];
    const limit = this.periodToLimit(period);

    return scheduleITickCall(async () => {
      try {
        const url = `${ITICK_BASE_URL}/stock/klines?region=${ITICK_REGION}&codes=${code}&kType=${kType}&limit=${limit}`;
        const response = await fetchWithRetry429ITick(url, this.getHeaders(), 15000);
        if (!response.ok) { console.error(`[HK Stock Data] fetchHistoricalData HTTP ${response.status} for ${symbol}`); return []; }
        const json = await response.json();
        if (json.code !== 0 || !json.data) { console.error(`[HK Stock Data] fetchHistoricalData failed for ${symbol}: ${json.msg}`); return []; }
        const rawCandles = Array.isArray(json.data) ? json.data : json.data[code] || [];
        const candles = this.parseCandles(rawCandles);
        historicalCache.set(code, { data: candles, timestamp: Date.now() });
        return candles;
      } catch (error) {
        console.error(`[HK Stock Data] fetchHistoricalData error for ${symbol}:`, error);
        return [];
      }
    });
  }

  /**
   * 批量歷史K線：一次過攞晒成個股票池嘅日K線（1次API call）
   * Scanner 主要入口，大幅節省API call次數
   */
  async fetchBatchHistoricalData(symbols: string[], period: string): Promise<Map<string, Candle[]>> {
    const result = new Map<string, Candle[]>();
    const codes = symbols.map((s) => this.normalizeSymbol(s));
    const kType = K_TYPE_MAP["1day"];
    const limit = this.periodToLimit(period);

    return scheduleITickCall(async () => {
      try {
        const url = `${ITICK_BASE_URL}/stock/klines?region=${ITICK_REGION}&codes=${codes.join(",")}&kType=${kType}&limit=${limit}`;
        const response = await fetchWithRetry429ITick(url, this.getHeaders(), 20000);
        if (!response.ok) { console.error(`[HK Stock Data] fetchBatchHistoricalData HTTP ${response.status}`); return result; }
        const json = await response.json();
        if (json.code !== 0 || !json.data) { console.error(`[HK Stock Data] fetchBatchHistoricalData failed: ${json.msg}`); return result; }

        if (Array.isArray(json.data)) {
          // iTick唔支援批量codes嘅klines，fallback返空，呼叫者要自己逐隻call
          console.warn("[HK Stock Data] ⚠️ klines批量回應係array，iTick可能唔支援批量codes");
          return result;
        }

        for (const code of codes) {
          const rawCandles = json.data[code];
          if (rawCandles && Array.isArray(rawCandles)) {
            const candles = this.parseCandles(rawCandles);
            result.set(code, candles);
            historicalCache.set(code, { data: candles, timestamp: Date.now() });
          }
        }
        console.log(`[HK Stock Data] ✅ 批量K線攞到 ${result.size} 隻股票`);
        return result;
      } catch (error) {
        console.error(`[HK Stock Data] fetchBatchHistoricalData error:`, error);
        return result;
      }
    });
  }

  calculateIndicators(candles: Candle[]): Indicators {
    if (candles.length < 14) return { ema20: 0, rsi: 50, atr: 0, macd: 0, macdSignal: 0 };
    const closes = candles.map((c) => c.close).filter((c) => c > 0);
    const ema20 = this.calculateEMA(closes, 20);
    const rsi = this.calculateRSI(closes, 14);
    const atr = this.calculateATR(candles, 14);
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macd = ema12 - ema26;
    const macdSignal = macd * 0.8;
    return { ema20, rsi, atr, macd, macdSignal };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < prices.length; i++) ema = prices[i] * multiplier + ema * (1 - multiplier);
    return ema;
  }

  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period) return 0;
    const gains: number[] = [], losses: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) { gains.push(diff); losses.push(0); } else { gains.push(0); losses.push(Math.abs(diff)); }
    }
    const avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  private calculateATR(candles: Candle[], period: number = 14): number {
    if (candles.length < period) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      trs.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      ));
    }
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return atr;
  }
}

export const hkStockData = new HKStockData();
export { sleep as hkSleep };
export type { Candle as HKCandle, Quote as HKQuote, Indicators as HKIndicators };
