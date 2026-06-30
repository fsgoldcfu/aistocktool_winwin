/**
 * HK Stock Data Layer - iTick API Integration
 *
 * 呢個檔案負責港股嘅即時報價同歷史K線數據獲取，介面結構刻意設計成
 * 同 lib/yfinanceData.ts 一致，等之後可以直接共用 usScannerV3_7.ts
 * 嗰套四階段篩選邏輯，唔需要重寫核心 scanner。
 *
 * 數據源：iTick (https://itick.org)
 * 申請免費 API Token：https://itick.org → 註冊 → 取得 Token
 * 免費版額度（請以官網實際條款為準，呢個數字可能會變）：
 *   - 大約 10-60 次/分鐘請求限制
 *   - 包含基礎實時報價同歷史K線（分鐘線至日線）
 *
 * 環境變數：需要喺 Vercel project 設定 ITICK_API_KEY
 */

const ITICK_BASE_URL = "https://api.itick.org";
const ITICK_REGION = "HK"; // 港股固定用 HK region

// ==================== 介面定義（同 yfinanceData.ts 對齊） ====================

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

// iTick K線週期對照表（kType 參數）
const K_TYPE_MAP: Record<string, number> = {
  "1min": 1,
  "5min": 2,
  "15min": 3,
  "30min": 4,
  "60min": 5,
  "2h": 6,
  "4h": 7,
  "1day": 8,
  "1week": 9,
  "1month": 10,
};

// ==================== 節流用 sleep ====================
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== Quote Cache（避免短時間內重複請求） ====================
const quoteCache = new Map<string, { data: Quote; timestamp: number }>();
const QUOTE_CACHE_TTL_MS = 30 * 1000; // 30秒，因為港股報價變動快過呢個cache窗口會影響準確度，可按需要調整

class HKStockData {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.ITICK_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[HK Stock Data] ⚠️ ITICK_API_KEY 未設定，港股數據將無法獲取");
    }
  }

  private getHeaders() {
    return {
      accept: "application/json",
      token: this.apiKey,
    };
  }

  /**
   * 將港股代碼標準化。
   * 接受輸入格式："0700" / "700" / "700.HK" / "00700"
   * 輸出 iTick 要求嘅格式：純數字字串，例如 "700"
   */
  private normalizeSymbol(symbol: string): string {
    const stripped = symbol.replace(/\.HK$/i, "").replace(/^0+/, "");
    return stripped || "0"; // 防止全部係0嗰陣變成空字串
  }

  /**
   * 取得即時報價
   */
  async fetchQuote(symbol: string): Promise<Quote | null> {
    const code = this.normalizeSymbol(symbol);

    // 檢查 cache
    const cached = quoteCache.get(code);
    if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const url = `${ITICK_BASE_URL}/stock/quote?region=${ITICK_REGION}&code=${code}`;
      const response = await fetch(url, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`[HK Stock Data] fetchQuote HTTP ${response.status} for ${symbol}`);
        return null;
      }

      const json = await response.json();
      if (json.code !== 0 || !json.data) {
        console.error(`[HK Stock Data] fetchQuote failed for ${symbol}: ${json.msg || "unknown error"}`);
        return null;
      }

      const d = json.data;
      // iTick quote 字段：ld=最新價, o=開盤, h=最高, l=最低, v=成交量
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
  }

  /**
   * 取得歷史K線數據
   * period 對應 yfinanceData.ts 嘅用法（例如 "3mo"），
   * 呢個函數會將其轉換成 iTick 嘅 kType + limit 組合。
   */
  async fetchHistoricalData(symbol: string, period: string): Promise<Candle[]> {
    const code = this.normalizeSymbol(symbol);
    const kType = K_TYPE_MAP["1day"]; // 同美股scanner一致，用日K
    const limit = this.periodToLimit(period);

    try {
      const url = `${ITICK_BASE_URL}/stock/klines?region=${ITICK_REGION}&codes=${code}&kType=${kType}&limit=${limit}`;
      const response = await fetch(url, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`[HK Stock Data] fetchHistoricalData HTTP ${response.status} for ${symbol}`);
        return [];
      }

      const json = await response.json();
      if (json.code !== 0 || !json.data) {
        console.error(`[HK Stock Data] fetchHistoricalData failed for ${symbol}: ${json.msg || "unknown error"}`);
        return [];
      }

      // iTick 批量klines回傳格式：{ data: { "700": [...] } }
      const rawCandles = Array.isArray(json.data) ? json.data : json.data[code] || [];

      const candles: Candle[] = rawCandles.map((c: any) => ({
        date: new Date(c.t).toISOString().split("T")[0],
        open: Number(c.o) || 0,
        high: Number(c.h) || 0,
        low: Number(c.l) || 0,
        close: Number(c.c) || 0,
        volume: Number(c.v) || 0,
      }));

      // 確保按日期升序排列（最舊在前，最新在後），同 yfinanceData.ts 行為一致
      candles.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      return candles;
    } catch (error) {
      console.error(`[HK Stock Data] fetchHistoricalData error for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * 將 "3mo" / "1mo" / "1y" 呢類 period 字串轉成大約對應嘅K線條數
   */
  private periodToLimit(period: string): number {
    const map: Record<string, number> = {
      "1mo": 22,
      "3mo": 66,
      "6mo": 132,
      "1y": 252,
    };
    return map[period] || 90;
  }

  /**
   * 計算技術指標（EMA20, RSI14, ATR14, MACD）
   * 邏輯同 usScannerV3_7.ts 入面嘅 calculateEMA/calculateRSI/calculateATR 一致，
   * 呢度獨立實現一份，避免港股/美股數據層互相依賴。
   */
  calculateIndicators(candles: Candle[]): Indicators {
    if (candles.length < 14) {
      return { ema20: 0, rsi: 50, atr: 0, macd: 0, macdSignal: 0 };
    }

    const closes = candles.map((c) => c.close).filter((c) => c > 0);

    const ema20 = this.calculateEMA(closes, 20);
    const rsi = this.calculateRSI(closes, 14);
    const atr = this.calculateATR(candles, 14);

    // 簡化版 MACD：EMA12 - EMA26，signal 用 EMA9 of MACD line
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macd = ema12 - ema26;
    // 簡化處理：因為要完整MACD需要保存整條MACD line嚀計signal，
    // 呢度用粗略近似（0.8倍macd）作為signal，與美股scanner嗰套Placeholder邏輯類似
    const macdSignal = macd * 0.8;

    return { ema20, rsi, atr, macd, macdSignal };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return 0;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }
    return ema;
  }

  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period) return 0;
    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) {
        gains.push(diff);
        losses.push(0);
      } else {
        gains.push(0);
        losses.push(Math.abs(diff));
      }
    }

    const avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateATR(candles: Candle[], period: number = 14): number {
    if (candles.length < period) return 0;
    const trs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const highLow = candles[i].high - candles[i].low;
      const highPrevClose = Math.abs(candles[i].high - candles[i - 1].close);
      const lowPrevClose = Math.abs(candles[i].low - candles[i - 1].close);
      trs.push(Math.max(highLow, highPrevClose, lowPrevClose));
    }

    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
    }
    return atr;
  }

  /**
   * 批量獲取多隻港股即時報價（用iTick嘅batch quotes endpoint，減少請求次數）
   * 適合喺scanner入面一次過攞齊成個股票池嘅報價，避免逐隻request撞rate limit。
   */
  async fetchBatchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const result = new Map<string, Quote>();
    const codes = symbols.map((s) => this.normalizeSymbol(s)).join(",");

    try {
      const url = `${ITICK_BASE_URL}/stock/quotes?region=${ITICK_REGION}&codes=${codes}`;
      const response = await fetch(url, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        console.error(`[HK Stock Data] fetchBatchQuotes HTTP ${response.status}`);
        return result;
      }

      const json = await response.json();
      if (json.code !== 0 || !json.data) {
        console.error(`[HK Stock Data] fetchBatchQuotes failed: ${json.msg || "unknown error"}`);
        return result;
      }

      for (const [code, d] of Object.entries<any>(json.data)) {
        const price = Number(d.ld) || 0;
        const open = Number(d.o) || price;
        const change = price - open;
        const changePercent = open > 0 ? change / open : 0;
        result.set(code, { price, change, changePercent });
      }

      return result;
    } catch (error) {
      console.error(`[HK Stock Data] fetchBatchQuotes error:`, error);
      return result;
    }
  }
}

export const hkStockData = new HKStockData();
export { sleep as hkSleep };
export type { Candle as HKCandle, Quote as HKQuote, Indicators as HKIndicators };
