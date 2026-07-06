/**
 * US Scanner V3.7 - Thematic SkyNet Edition (Complete Refactoring)
 *
 * This version is a comprehensive overhaul of the US stock screening engine,
 * incorporating advanced features for capturing market-wide thematic explosions,
 * precise time zone calibration, and dynamic strategy adjustments.
 *
 * Key Features:
 * 1. Expanded Stock Universe: 70 high-volatility US stocks across 7 key sectors.
 * 2. Bullish News Engine: Integration of a 60+ keyword library for Stage 3 news filtering.
 * 3. Time-Space Calibration: Forced HKT time locking and dynamic market phase adaptation for US trading hours.
 * 4. Flexible Profit Locks: Relaxed profit percentage for high-priced stocks and a 'Threshold Softener' switch.
 * 5. Sector Resonance Algorithm: Enhanced detection of sector-wide movements.
 * 6. Counter-Trend Priority: 跌市時優先推介逆市抗跌股，避免跌市仲推介順勢股。
 * 7. HKD-based Capital Allocation: 按用戶實際港幣資金配置（總本金/每日用資金/每日目標利潤）重新計算每注資金同利潤門檻。
 */

// ==================== 真實數據源（Finnhub API） ====================
import { yfinanceData as financeAPI } from "./yfinanceData";

// ==================== 掃描結果 Cache（15分鐘） ====================
let cachedScanResult: { result: any; timestamp: number } | null = null;
const SCAN_CACHE_TTL_MS = 15 * 60 * 1000; // 15分鐘

interface Candle {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

interface Quote {
  price: number; change: number; changePercent: number;
}

interface Indicators {
  ema20: number; rsi: number; atr: number; macd: number; macdSignal: number;
}

interface NewsItem {
  title: string;
  url?: string;
}

class YFinanceData {
  async fetchQuote(symbol: string): Promise<Quote | null> {
    try {
      const q = await financeAPI.fetchQuote(symbol);
      return { price: q.price, change: q.change, changePercent: q.changePercent };
    } catch (error) {
      console.error(`[US Scanner] fetchQuote failed for ${symbol}:`, error);
      return null;
    }
  }

  async fetchHistoricalData(symbol: string, period: string): Promise<Candle[]> {
    try {
      return await financeAPI.fetchHistoricalData(symbol, period);
    } catch (error) {
      console.error(`[US Scanner] fetchHistoricalData failed for ${symbol}:`, error);
      return [];
    }
  }

  async fetchHourlyOHLC(symbol: string, hours: number): Promise<any[]> {
    // Finnhub 免費版唔支援 hourly resolution，回傳空陣列
    return [];
  }

  calculateIndicators(candles: Candle[]): Indicators {
    if (candles.length < 14) {
      return { ema20: 0, rsi: 50, atr: 0, macd: 0, macdSignal: 0 };
    }
    const result = financeAPI.calculateIndicators(candles);
    return {
      ema20: result.ema20,
      rsi: result.rsi,
      atr: result.atr,
      macd: result.macd.macd,
      macdSignal: result.macd.signal,
    };
  }
}

const yfinanceData = new YFinanceData();

// 節流用 sleep function
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// CONSTANTS & CONFIGURATION
// ============================================================

const CONFIG = {
  // ===== 用戶實際資金配置（港幣為準）=====
  totalCapitalHKD: 180000,        // 總本金 HK$180,000
  maxDailyCapitalHKD: 100000,     // 每日最多用嚮交易嘅資金 HK$100,000
  dailyProfitTargetHKD: 1000,     // 每日目標利潤 HK$1,000
  expectedPositionsToBuy: 2,      // 5隻推介中，你預期實際會買嘅數量（1-2隻）
  hkdToUsdRate: 7.8,              // 港幣兌美金匯率，可定期手動更新

  positionsCount: 5,              // 每次推介5隻（不變）
  maxStopLossPercent: 3,          // Max 3% stop loss
  minConfidence: 60,              // Minimum confidence score
  thresholdSoftenerEnabled: false, // 降維試槍開關

  // ===== 逆市股偵測（跌市優先推介逆市股）=====
  downMarketThreshold: -0.003,        // 納指跌幅 > 0.3% 視為跌市
  counterTrendRelativeStrength: 0.01, // 個股強於大市 1% 先當「逆市股」
};

// 按你實際資金配置動態換算（程式內部運算用美金）
const maxDailyCapitalUSD = CONFIG.maxDailyCapitalHKD / CONFIG.hkdToUsdRate;          // ≈ $12,820
const capitalPerPositionUSD = maxDailyCapitalUSD / CONFIG.expectedPositionsToBuy;    // ≈ $6,410（預期買2隻時每隻嘅資金）
const dailyProfitTargetUSD = CONFIG.dailyProfitTargetHKD / CONFIG.hkdToUsdRate;       // ≈ $128
const minTargetProfitPerStockUSD = dailyProfitTargetUSD / CONFIG.expectedPositionsToBuy; // ≈ $64（每隻最低要賺嘅利潤）

const US_SECTORS: Record<string, string[]> = {
  // AI半導體與算力（加入ARM、INTC、QCOM、AMAT — 分析師6月大幅升級）
  "AI半導體與算力": ["NVDA", "AMD", "AVGO", "MU", "MRVL", "ARM", "INTC", "QCOM", "AMAT"],
  // 科技核心巨頭
  "科技核心巨頭": ["AAPL", "MSFT", "TSLA", "META", "AMZN", "IBM"],
  // 加密貨幣（移除MARA/RIOT/HUT活躍度低，保留COIN/MSTR）
  "加密貨幣與Web3": ["COIN", "MSTR"],
  // AI應用與雲端安全（加入CRM、SNPS、ZS、PANW — 分析師升級）
  "AI應用與雲端": ["PLTR", "NET", "CRWD", "DDOG", "CRM", "SNPS", "ZS", "PANW"],
  // 中概股（移除JD，保留核心）
  "中概股": ["BABA", "PDD", "NIO", "XPEV"],
  // 消費與金融科技（加入UBER、AXP — 分析師升級；移除GME）
  "消費與金融科技": ["SOFI", "AFRM", "DKNG", "UBER", "AXP"],
  // 醫藥生物科技（加入ARGX、IONS — 分析師目標+40%/+72%）
  "醫藥生物科技": ["LLY", "MRNA", "NVO", "REGN", "VRTX", "ARGX", "IONS"],
  // 國防與能源基建（新板塊 — RTX/GD分析師升級）
  "國防與能源基建": ["RTX", "GD", "VRT"],
};

const US_STOCK_UNIVERSE: string[] = Array.from(new Set(Object.values(US_SECTORS).flat()));

const US_STOCK_NAMES: Record<string, string> = {
  // AI半導體
  "NVDA": "NVIDIA", "AMD": "Advanced Micro Devices", "AVGO": "Broadcom",
  "MU": "Micron Technology", "MRVL": "Marvell Technology",
  "ARM": "Arm Holdings", "INTC": "Intel", "QCOM": "Qualcomm", "AMAT": "Applied Materials",
  // 科技巨頭
  "AAPL": "Apple", "MSFT": "Microsoft", "TSLA": "Tesla",
  "META": "Meta Platforms", "AMZN": "Amazon", "IBM": "IBM",
  // 加密
  "COIN": "Coinbase Global", "MSTR": "MicroStrategy",
  // AI應用與雲端
  "PLTR": "Palantir Technologies", "NET": "Cloudflare",
  "CRWD": "CrowdStrike", "DDOG": "Datadog",
  "CRM": "Salesforce", "SNPS": "Synopsys", "ZS": "Zscaler", "PANW": "Palo Alto Networks",
  // 中概股
  "BABA": "Alibaba Group", "PDD": "PDD Holdings", "NIO": "NIO Inc.", "XPEV": "XPeng",
  // 消費與金融科技
  "SOFI": "SoFi Technologies", "AFRM": "Affirm Holdings",
  "DKNG": "DraftKings", "UBER": "Uber Technologies", "AXP": "American Express",
  // 醫藥生物科技
  "LLY": "Eli Lilly", "MRNA": "Moderna", "NVO": "Novo Nordisk",
  "REGN": "Regeneron Pharmaceuticals", "VRTX": "Vertex Pharmaceuticals",
  "ARGX": "argenx", "IONS": "Ionis Pharmaceuticals",
  // 國防與能源基建
  "RTX": "RTX Corporation", "GD": "General Dynamics", "VRT": "Vertiv Holdings",
};

const BULLISH_KEYWORDS = [
  "Buyback", "Repurchase", "Dividend", "Insider Buy", "Upgrade", "Beats", "Surge", "Double", "Profit", "Guidance", "AI", "LLM", "Chip", "Breakthrough", "Approved", "Acquisition", "Merger", "Partnership", "Bitcoin", "Crypto", "ETF", "Inflow", "Halving", "盈喜", "扭虧為盈", "利潤激增", "營收超預期", "毛利率飆升", "交付量創新高", "訂單爆滿", "淨利增長", "業績亮眼", "突破", "出海", "大模型"
];

// ============================================================
// INTERFACES
// ============================================================

export interface V3_7Recommendation {
  symbol: string;
  stockName: string;
  currentPrice: number;
  change: number;
  changePercent: number;
  
  stage: 1 | 2 | 3 | 4;
  stageLabel: string;
  triggerReason: string;
  
  resistanceLevel: number;
  resistanceSource: string;
  takeProfitPrice: number;
  stopLossPrice: number;
  
  lotSize: number;
  sharesCanBuy: number;
  expectedProfit: number;
  capitalAllocated: number;
  profitFeasible: boolean;
  
  rsi: number;
  ema10: number;
  ema20: number;
  atr: number;
  atrPercent: number;
  
  volumeRatio: number;
  volumeSpike: boolean;
  
  bullishNews: boolean;
  newsHeadline: string;
  newsSentimentScore: number;
  
  confidence: number;
  riskRewardRatio: number;
  debugReason?: string; // Added for debugging

  capitalAllocatedHKD: number;  // 港幣顯示，方便對照實際資金
  expectedProfitHKD: number;    // 港幣顯示，方便對照實際利潤
  isCounterTrend: boolean;      // 是否為「逆市抗跌股」
}

export interface ScanResult {
  recommendations: V3_7Recommendation[];
  scanTime: string;
  hkTime: string;
  marketPhase: string;
  indexChangePercent: number;
  totalScanned: number;
  stage1Candidates: number;
  stage2Candidates: number;
  stage3Candidates: number;
  stage4Candidates: number;
  thresholdSoftenerActive: boolean; // 降維試槍開關狀態
  isDownMarket?: boolean;           // 是否為跌市模式
}

// ============================================================
// UTILS
// ============================================================

/**
 * Get current HK time info and map to US market phases
 * Module 3: 鎖死「香港實時時區判定」與美股時差校準
 */
function getHKTimeInfo() {
  const hktString = new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong", hour12: false });
  const currentTime = new Date(hktString);
  const hkHour = currentTime.getHours();
  const hkMinute = currentTime.getMinutes();
  const hkDayOfWeek = currentTime.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
  const hkTimeStr = `${String(hkHour).padStart(2, '0')}:${String(hkMinute).padStart(2, '0')}`;

  let marketPhase = "closed";
  // US market open (9:30 AM EST) is 9:30 PM HKT
  // US market close (4:00 PM EST) is 4:00 AM HKT (next day)
  // Opening hour: 21:30 - 22:30 HKT
  // Active session: 22:30 - 04:00 HKT

  // ==================== 真實交易日檢查 ====================
  const isWeekendClosed =
    hkDayOfWeek === 0 || // 星期日全日休市
    (hkDayOfWeek === 1 && hkHour < 9) || // 星期一凌晨（對應美東星期日）
    (hkDayOfWeek === 6 && hkHour >= 4); // 星期六04:00後（對應美東星期五收市後）

  const isTradingDay = !isWeekendClosed;

  // Dynamic Market Phase Determination for US market based on HKT
  if (isTradingDay) {
    if ((hkHour === 21 && hkMinute >= 30) || (hkHour === 22 && hkMinute < 30)) {
      marketPhase = "opening-hour";
    } else if ((hkHour === 22 && hkMinute >= 30) || (hkHour >= 23) || (hkHour >= 0 && hkHour < 4)) {
      marketPhase = "active-session";
    } else if (hkHour >= 9 && hkHour < 15) { // HKT 09:00 - 15:00, US market is closed but allow analysis
      marketPhase = "closed-analysis";
    }
  } else {
    marketPhase = "market-closed-weekend";
  }

  if (DEBUG_MODE) {
    console.log(`[DEBUG] HKT Time: ${hkTimeStr} (Day ${hkDayOfWeek}), Market Phase: ${marketPhase}, IsTradingDay: ${isTradingDay}`);
  }

  return { hkHour, hkMinute, hkTimeStr, marketPhase, isTradingDay };
}

/**
 * Get tick size for US stocks (simplified, typically $0.01)
 */
function getTickSize(price: number): number {
  return 0.01; // Most US stocks have a tick size of $0.01
}

/**
 * Calculate EMA from prices
 */
function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * multiplier + ema * (1 - multiplier);
  }
  return ema;
}

/**
 * Calculate RSI from prices
 */
function calculateRSI(prices: number[], period: number = 14): number {
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

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  if (avgLoss === 0) return 100; 
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Calculate ATR from candles
 */
function calculateATR(candles: Candle[], period: number = 14): number {
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
 * Minervini 技術指標評分函數
 * 短炒用「加分制」，唔係硬性過濾，符合條件加分，唔符合唔扣分
 *
 * 條件一覽：
 * 1. 股價 > $5（基本條件）
 * 2. 股價不低於20日最低位（確認支撐）
 * 3. 3個月回報 ≥ 20%（強勢股動力）
 * 4. 每日成交金額50日均 > $500萬（流動性足夠）
 * 5. Average daily range > 3.5%（足夠波動）
 * 6. 不高於200日線60%（未過熱）
 * 7. 接近10/20/50日EMA（低風險入場位）
 * 8+9. VCP整固：5-40日，range < 8%（即將爆發形態）
 */
function calculateMinerviniScore(
  currentPrice: number,
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
  ema20: number
): { score: number; tags: string[] } {
  // ===== Minervini VCP 加分制（總分上限100分）=====
  // 分數按你嘅加權設定：
  //   3個月回報 ≥20%     → 20分（最重要，動力確認）
  //   整固Range <8%      → 15分（VCP收窄確認）
  //   ADR >3.5%          → 15分（足夠波動）
  //   股價不低於20日低位  → 10分（支撐確認）
  //   成交額 >500萬       → 10分（流動性）
  //   接近EMA10/20/50    → 10分（低風險入場位，三條各佔）
  //   整固5-40日          → 10分（整固時間）
  //   股價 > $5           → 5分（基本條件）
  //   不高於200MA 60%    → 5分（唔係過熱）
  // 總分上限：100分

  let score = 0;
  const tags: string[] = [];

  // ① 股價 > $5（5分）
  if (currentPrice > 5) {
    score += 5;
    tags.push("P>$5");
  }

  // ② 股價不低於20日最低位（10分）
  if (lows.length >= 20) {
    const twentyDayLow = Math.min(...lows.slice(-20));
    if (currentPrice >= twentyDayLow) {
      score += 10;
      tags.push("AboveLow20");
    }
  }

  // ③ 3個月回報 ≥ 20%（20分，係最重嘅條件）
  if (closes.length >= 63) {
    const threeMonthReturn = (currentPrice - closes[closes.length - 63]) / closes[closes.length - 63];
    if (threeMonthReturn >= 0.20) {
      score += 20;
      tags.push(`3M+${(threeMonthReturn * 100).toFixed(0)}%`);
    } else if (threeMonthReturn >= 0.10) {
      score += 8; // 10-20%之間部分加分
    }
  }

  // ④ 每日成交金額50日均 > $500萬美元（10分）
  if (closes.length >= 50 && volumes.length >= 50) {
    const last50Closes = closes.slice(-50);
    const last50Volumes = volumes.slice(-50);
    const avgDollarVolume = last50Closes.reduce((sum, c, i) => sum + c * (last50Volumes[i] || 0), 0) / 50;
    if (avgDollarVolume >= 5000000) {
      score += 10;
      tags.push("Vol$OK");
    }
  }

  // ⑤ Average daily range > 3.5%（15分）
  if (closes.length >= 20 && highs.length >= 20 && lows.length >= 20) {
    const last20Highs = highs.slice(-20);
    const last20Lows = lows.slice(-20);
    const last20Closes = closes.slice(-20);
    const avgDailyRange = last20Highs.reduce((sum, h, i) => {
      return sum + (h - last20Lows[i]) / (last20Closes[i] || 1);
    }, 0) / 20;
    if (avgDailyRange >= 0.035) {
      score += 15;
      tags.push(`ADR${(avgDailyRange * 100).toFixed(1)}%`);
    } else if (avgDailyRange >= 0.02) {
      score += 5; // 2-3.5%之間部分加分
    }
  }

  // ⑥ 不高於200日線60%（5分）
  if (closes.length >= 200) {
    const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
    const distanceFromMA200 = (currentPrice - sma200) / sma200;
    if (distanceFromMA200 <= 0.60) {
      score += 5;
      tags.push(`MA200+${(distanceFromMA200 * 100).toFixed(0)}%`);
    }
  } else if (closes.length >= 100) {
    // 數據唔夠200日，用SMA100近似，分數打折
    const sma100 = closes.slice(-100).reduce((a, b) => a + b, 0) / 100;
    if ((currentPrice - sma100) / sma100 <= 0.50) {
      score += 2;
    }
  }

  // ⑦ 接近EMA10/20/50（合共10分，三條各約3-4分）
  if (closes.length >= 50) {
    const ema10 = calculateEMA(closes, 10);
    const ema50 = calculateEMA(closes, 50);

    const distEMA10 = Math.abs(currentPrice - ema10) / ema10;
    const distEMA20 = Math.abs(currentPrice - ema20) / ema20;
    const distEMA50 = Math.abs(currentPrice - ema50) / ema50;

    // 各EMA：股價喺EMA上方且距離 < 3% 得滿分，3-6%得半分
    if (currentPrice >= ema10 && distEMA10 <= 0.03) { score += 4; tags.push("EMA10✓"); }
    else if (currentPrice >= ema10 && distEMA10 <= 0.06) { score += 2; }

    if (currentPrice >= ema20 && distEMA20 <= 0.03) { score += 3; tags.push("EMA20✓"); }
    else if (currentPrice >= ema20 && distEMA20 <= 0.06) { score += 1; }

    if (currentPrice >= ema50 && distEMA50 <= 0.05) { score += 3; tags.push("EMA50✓"); }
    else if (currentPrice >= ema50 && distEMA50 <= 0.08) { score += 1; }
  }

  // ⑧ 整固5-40日（10分）+ ⑨ 整固Range <8%（15分）
  // 兩個條件綁在一起：搵出最佳整固窗口
  if (closes.length >= 40 && highs.length >= 40 && lows.length >= 40) {
    let bestConsolidationDays = 0;
    let bestRange = 1;
    let hasVolumeContraction = false;

    for (let days = 5; days <= 40; days++) {
      const windowHighs = highs.slice(-days);
      const windowLows = lows.slice(-days);
      const windowVolumes = volumes.slice(-days);

      const periodHigh = Math.max(...windowHighs);
      const periodLow = Math.min(...windowLows);
      const range = (periodHigh - periodLow) / periodLow;

      if (range < 0.08) {
        if (days > bestConsolidationDays) {
          bestConsolidationDays = days;
          bestRange = range;
        }
        // 檢查成交量收縮（VCP最強確認）
        if (windowVolumes.length >= 10) {
          const recentAvgVol = windowVolumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
          const priorAvgVol = windowVolumes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
          if (priorAvgVol > 0 && recentAvgVol < priorAvgVol * 1.1) {
            hasVolumeContraction = true;
          }
        }
      }
    }

    if (bestConsolidationDays >= 5) {
      // ⑧ 整固5-40日：10分
      score += 10;
      tags.push(`Consol${bestConsolidationDays}d`);

      // ⑨ 整固Range <8%：15分（已確認因為 range < 0.08）
      score += 15;
      tags.push(`Range${(bestRange * 100).toFixed(1)}%`);

      // 額外：成交量收縮（VCP完整形態）再加5分
      if (hasVolumeContraction) {
        score += 5;
        tags.push("VCP✓");
      }
    }
  }

  // 上限100分，但唔影響原本confidence（原本confidence有自己嘅上限處理）
  return { score: Math.min(score, 100), tags };
}

/**
 * Module 2: Stage 3 真實新聞 — 用 Finnhub /company-news endpoint
 */
async function getUSStockNews(symbol: string): Promise<NewsItem[]> {
  try {
    const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 2); // 過去2天嘅新聞（涵蓋週末/假期）

    const fromStr = from.toISOString().split("T")[0];
    const toStr = today.toISOString().split("T")[0];

    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${fromStr}&to=${toStr}&token=${FINNHUB_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      console.error(`[News] Finnhub HTTP ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return [];

    return data.slice(0, 3).map((item: any) => ({
      title: item.headline || "",
      url: item.url || "",
    }));

  } catch (error) {
    console.error(`[News] Error fetching news for ${symbol}:`, error);
    return [];
  }
}

function hasBullishNews(news: NewsItem[]): boolean {
  if (news.length === 0) return false;
  for (const item of news) {
    for (const keyword of BULLISH_KEYWORDS) {
      if (item.title.toLowerCase().includes(keyword.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

function getNewsSentimentScore(news: NewsItem[]): number {
  return hasBullishNews(news) ? 0.8 : 0.2; // Simplified: 0.8 if bullish news, 0.2 otherwise
}

// ============================================================
// CORE LOGIC
// ============================================================

function calculateResistance(
  candles: Candle[],
  currentPrice: number,
  atr: number
): { resistanceLevel: number; source: string } {
  if (candles.length < 5) {
    const resistance = currentPrice + atr * 1.2; 
    return { resistanceLevel: resistance, source: "ATR Projection (Insufficient Data)" };
  }
  
  const last3Days = candles.slice(-3);
  const threeDayHigh = Math.max(...last3Days.map(c => c.high));
  
  // 戰術變更: 止盈位（TP）計算大瘦身（改為 0.5x ATR）
  const takeProfitPrice = currentPrice + atr * 0.5; 
  
  const candidates: Array<{ level: number; source: string }> = [];
  
  if (threeDayHigh > currentPrice * 1.001) {
    candidates.push({ level: threeDayHigh, source: "3-Day High" });
  }
  candidates.push({ level: takeProfitPrice, source: "ATR Target (0.5x ATR)" });
  
  candidates.sort((a, b) => a.level - b.level);
  
  const minProfitRoom = currentPrice * 0.003; 
  
  for (const candidate of candidates) {
    if (candidate.level - currentPrice >= minProfitRoom) {
      return { resistanceLevel: candidate.level, source: candidate.source };
    }
  }
  
  return { resistanceLevel: takeProfitPrice, source: "ATR Target (Fallback)" };
}

/**
 * Validate profit feasibility with flexible capital and US lot size (1 share)
 * Module 4: 放寬高價股鐵鎖與加入『降維試槍開關』
 * 已改為按用戶實際 HKD 資金配置（capitalPerPositionUSD / minTargetProfitPerStockUSD）計算
 */
function validateProfitFeasibility(
  currentPrice: number,
  takeProfitPrice: number,
  symbol: string,
  hkHour: number,
  thresholdSoftenerActive: boolean
): { feasible: boolean; sharesCanBuy: number; expectedProfit: number; capitalAllocated: number; lotSize: number; reason: string } {
  const lotSize = 1; // US stocks typically trade in 1 share increments
  // 戰術變更: 資金按用戶實際每日可用資金 / 預期買入注數 計算
  const capitalOptions = [capitalPerPositionUSD];
  
  let bestShares = 0;
  let bestExpectedProfit = 0;
  let actualCapitalAllocated = 0;
  let feasibilityReason = "";

  let currentMinTargetProfit = minTargetProfitPerStockUSD;
  // 核心修正: 超過 23:30 HKT，提高預期利潤門檻
  if (hkHour >= 23 || hkHour < 4) { // Covers 23:30 HKT to 04:00 HKT
    currentMinTargetProfit = minTargetProfitPerStockUSD * 1.2;
  }

  // 降維試槍開關: 當開關啟用時，利潤硬門檻打 8 折
  if (thresholdSoftenerActive) {
    currentMinTargetProfit *= 0.8;
  }

  for (const capital of capitalOptions) {
    const sharesCanBuy = Math.floor(capital / currentPrice);

    if (sharesCanBuy === 0) {
      feasibilityReason = `Capital (${capital.toFixed(0)} USD) insufficient to buy 1 share`;
      continue;
    }

    const currentExpectedProfit = (takeProfitPrice - currentPrice) * sharesCanBuy;

    if (currentExpectedProfit >= currentMinTargetProfit && sharesCanBuy > bestShares) {
      bestShares = sharesCanBuy;
      bestExpectedProfit = currentExpectedProfit;
      actualCapitalAllocated = capital;
    }
  }

  if (bestShares === 0) {
    return { feasible: false, sharesCanBuy: 0, expectedProfit: 0, capitalAllocated: 0, lotSize, reason: feasibilityReason || `Cannot meet min profit (${currentMinTargetProfit.toFixed(0)} USD) or buy 1 share` };
  }

  const tickSize = getTickSize(currentPrice);
  const ticksAvailable = Math.floor((takeProfitPrice - currentPrice) / tickSize);
  
  let feasible = bestExpectedProfit >= currentMinTargetProfit && ticksAvailable >= 1;
  feasibilityReason = feasible ? "Meets profit requirements" : `Expected profit (${bestExpectedProfit.toFixed(0)} USD) below ${currentMinTargetProfit.toFixed(0)} USD threshold`;

  // Module 4: 放寬高價股鐵鎖 (Price > $100) 必須滿足「利潤百分比 > 1.0%」
  if (feasible && currentPrice > 100) {
    const profitPercentage = (takeProfitPrice - currentPrice) / currentPrice;
    if (profitPercentage < 0.01) { // Relaxed from 2.5% to 1.0%
      feasible = false;
      feasibilityReason = `High-priced stock (>${currentPrice.toFixed(2)} USD) profit percentage (${(profitPercentage * 100).toFixed(2)}%) below 1.0% threshold`;
    }
  }

  return { feasible, sharesCanBuy: bestShares, expectedProfit: bestExpectedProfit, capitalAllocated: actualCapitalAllocated, lotSize, reason: feasibilityReason };
}

interface StockData {
  quote: Quote;
  candles: Candle[];
  indicators: Indicators;
  news: NewsItem[];
  volumeRatio: number;
  volumeSpike: boolean;
}

async function analyzeStock(symbol: string): Promise<StockData | null> {
  try {
    const quote = await yfinanceData.fetchQuote(symbol);
    if (!quote || quote.price <= 0) {
      return null;
    }

    const candles = await yfinanceData.fetchHistoricalData(symbol, "3mo");
    if (candles.length < 20) {
      return null;
    }
    
    const indicators = yfinanceData.calculateIndicators(candles);
    const news = await getUSStockNews(symbol);

    const todayVolume = candles[candles.length - 1]?.volume || 0;
    const past5DaysVolumes = candles.slice(-6, -1).map(c => c.volume);
    const avgPast5DaysVolume = past5DaysVolumes.length > 0 ? past5DaysVolumes.reduce((a, b) => a + b, 0) / past5DaysVolumes.length : 1;
    const volumeRatio = avgPast5DaysVolume > 0 ? todayVolume / avgPast5DaysVolume : 0;
    const volumeSpike = volumeRatio > 1.3; // +30% spike

    return {
      quote,
      indicators,
      candles,
      news,
      volumeRatio,
      volumeSpike,
    };
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error);
    return null;
  }
}

function buildRecommendation(
  symbol: string,
  data: NonNullable<StockData>,
  stage: 1 | 2 | 3 | 4,
  stageLabel: string,
  triggerReason: string,
  indexChangePercent: number,
  hkTimeInfo: ReturnType<typeof getHKTimeInfo>,
  isResonance: boolean = false,
  thresholdSoftenerActive: boolean
): { recommendation: V3_7Recommendation | null; debugReason: string } {
  const { quote, indicators, candles, news, volumeRatio, volumeSpike } = data;
  
  const currentPrice = quote.price;
  const prevClose = candles[candles.length - 2]?.close || currentPrice; 
  const changePercent = ((currentPrice - prevClose) / prevClose);
  const stockName = US_STOCK_NAMES[symbol] || symbol;

  let debugReason = ``;

  // Module 3: 調整 Stage 4 晚盤判定: 以香港時間為準，超過 23:30 HKT 後進入美股深夜盤，強制實施 `changePercent > 0` 限制
  if (hkTimeInfo.hkHour >= 23 && hkTimeInfo.hkMinute >= 30 || hkTimeInfo.hkHour < 4) { // After 23:30 HKT
    if (changePercent <= 0) {
      debugReason = `Late Session (after 23:30 HKT): Stock is not rising (changePercent: ${(changePercent * 100).toFixed(2)}%)`;
      return { recommendation: null, debugReason };
    }
  }

  // 核心鐵律: 短炒股票當日必須是升緊的 (拒絕接飛刀) 且強於大市
  if (changePercent <= 0 || changePercent <= indexChangePercent) {
    debugReason = `Relative Strength Check Failed: Stock change (${(changePercent * 100).toFixed(2)}%) not greater than index (${(indexChangePercent * 100).toFixed(2)}%) or not positive.`;
    return { recommendation: null, debugReason };
  }

  // 防止追高: 升幅超過 8% 視為過熱，今日入場風險過高，跳過
  if (changePercent > 0.08) {
    debugReason = `Overheated: Stock已升${(changePercent * 100).toFixed(1)}%，risk追高，跳過今日推介`;
    return { recommendation: null, debugReason };
  }

  const closes = candles.map((c: any) => c.close).filter((c: number) => c > 0);
  const ema10 = closes.length >= 10 ? calculateEMA(closes, 10) : 0;
  const atrPercent = currentPrice > 0 ? (indicators.atr / currentPrice) * 100 : 0;

  const { resistanceLevel, source: resistanceSource } = calculateResistance(candles, currentPrice, indicators.atr);
  
  // 戰術變更: 止盈位（TP）計算大瘦身（改為 0.5x ATR）
  let takeProfitPrice = currentPrice + indicators.atr * 0.5;
  
  const stopLossDistance = Math.max(indicators.atr * 0.7, currentPrice * 0.02); 
  const stopLossPrice = currentPrice - stopLossDistance;
  
  const feasibilityInfo = validateProfitFeasibility(currentPrice, takeProfitPrice, symbol, hkTimeInfo.hkHour, thresholdSoftenerActive);
  
  if (!feasibilityInfo.feasible) {
    debugReason = `Profit Feasibility Check Failed: ${feasibilityInfo.reason}`;
    return { recommendation: null, debugReason };
  }

  // ===== 港幣顯示換算 + 逆市抗跌股判定 =====
  const capitalAllocatedHKD = feasibilityInfo.capitalAllocated * CONFIG.hkdToUsdRate;
  const expectedProfitHKD = feasibilityInfo.expectedProfit * CONFIG.hkdToUsdRate;
  const isCounterTrend = indexChangePercent <= CONFIG.downMarketThreshold &&
    (changePercent - indexChangePercent) >= CONFIG.counterTrendRelativeStrength;

  if (isCounterTrend) {
    triggerReason = "💎逆市抗跌股 | " + triggerReason;
  }
        
  let confidence = 50; 
  if (changePercent > 0) confidence += 5;
  if (changePercent > 0.01) confidence += 5; // 1% change
  if (indicators.rsi >= 50 && indicators.rsi <= 70) confidence += 10; 
  if (indicators.macd > indicators.macdSignal) confidence += 10; // Placeholder
  if (currentPrice > ema10) confidence += 5;
  if (currentPrice > indicators.ema20) confidence += 5;
  if (atrPercent >= 2) confidence += 5;
  if (feasibilityInfo.feasible) confidence += 10;
  
  // 逆市強勢美金股加分
  if (indexChangePercent < 0 && changePercent > 0) {
    triggerReason = "🔥 逆市強勢美金股 | " + triggerReason;
    confidence += 15;
  }

  // 逆市抗跌股額外加分（比一般逆市加分更高，因為符合更嚴格嘅相對強度門檻）
  if (isCounterTrend) {
    confidence += 10;
  }

  // 爆量異動 (volumeSpike)
  if (volumeSpike) {
    triggerReason += " | 爆量異動";
    confidence += 10;
  }

  // Module 2: Stage 3 利好新聞爆破
  if (hasBullishNews(news)) {
    triggerReason += " | 利好新聞爆破";
    confidence += 15;
  }

  // 板塊共振拉滿信心
  if (isResonance) {
    confidence = 100; // 信心指數直接拉滿至100%
  }
  
  // 降維試槍開關: 當開關啟用時，RSI 限制放寬至 >45
  if (thresholdSoftenerActive) {
    if (indicators.rsi > 45) {
      confidence += 5; // Small boost for meeting relaxed RSI
    } else {
      debugReason = `Threshold Softener Active: RSI (${indicators.rsi.toFixed(0)}) not above 45.`;
      return { recommendation: null, debugReason };
    }
  }

  // ===== Minervini 技術指標加分（唔係過濾，符合加分，唔符合唔扣分）=====
  // closes 已喺上面宣告，直接用；highs/lows/volumes 新增
  const mHighs = candles.map((c: any) => c.high).filter((h: number) => h > 0);
  const mLows = candles.map((c: any) => c.low).filter((l: number) => l > 0);
  const mVolumes = candles.map((c: any) => c.volume).filter((v: number) => v > 0);
  const minerviniBonus = calculateMinerviniScore(
    currentPrice, closes, mHighs, mLows, mVolumes, indicators.ema20
  );
  confidence += minerviniBonus.score;
  if (minerviniBonus.score > 0) {
    triggerReason += ` | 📐 Minervini+${minerviniBonus.score}(${minerviniBonus.tags.join(",")})`;
  }

  confidence = Math.max(0, Math.min(100, confidence));

  const potentialProfit = takeProfitPrice - currentPrice;
  const potentialLoss = currentPrice - stopLossPrice;
  const riskRewardRatio = potentialLoss > 0 ? potentialProfit / potentialLoss : 0;
  
  return {
    recommendation: {
      symbol,
      stockName,
      currentPrice,
      change: quote.change,
      changePercent: quote.changePercent,
      
      stage,
      stageLabel,
      triggerReason,
      
      resistanceLevel,
      resistanceSource,
      takeProfitPrice,
      stopLossPrice,
      
      lotSize: feasibilityInfo.lotSize,
      sharesCanBuy: feasibilityInfo.sharesCanBuy,
      expectedProfit: feasibilityInfo.expectedProfit,
      capitalAllocated: feasibilityInfo.capitalAllocated,
      profitFeasible: feasibilityInfo.feasible,
      
      rsi: indicators.rsi,
      ema10,
      ema20: indicators.ema20,
      atr: indicators.atr,
      atrPercent,
      
      volumeRatio,
      volumeSpike,
      
      bullishNews: hasBullishNews(news),
      newsHeadline: news.length > 0 ? news[0].title : "",
      newsSentimentScore: getNewsSentimentScore(news),
      
      confidence,
      riskRewardRatio,
      debugReason,

      capitalAllocatedHKD,
      expectedProfitHKD,
      isCounterTrend,
    },
    debugReason: debugReason
  };
}

// ============================================================
// MAIN SCANNER FUNCTION
// ============================================================

export async function runUSScannerV3_7(thresholdSoftenerActive: boolean = false): Promise<ScanResult> {
  // ==================== Cache 檢查（15分鐘內直接返回） ====================
  if (cachedScanResult && (Date.now() - cachedScanResult.timestamp) < SCAN_CACHE_TTL_MS) {
    const ageMinutes = Math.floor((Date.now() - cachedScanResult.timestamp) / 60000);
    console.log(`[US V3.7] ✅ 使用 Cache 數據（${ageMinutes} 分鐘前掃描），避免重複請求 Finnhub`);
    return cachedScanResult.result;
  }

  const startTime = Date.now();
  const hkTimeInfo = getHKTimeInfo();
  
  console.log(`[US V3.7] ====== 玄金美股短炒天網 V3.7 完全體啟動 ======`);
  console.log(`[US V3.7] 目前香港時間: ${hkTimeInfo.hkTimeStr}, 市場階段: ${hkTimeInfo.marketPhase}, 交易日: ${hkTimeInfo.isTradingDay}`);

  // ==================== 非交易日（週末）直接返回空結果，唔做任何推介 ====================
  if (!hkTimeInfo.isTradingDay) {
    console.log(`[US V3.7] ⚠️ 今日為美股休市日（週末），不執行掃描，不產生任何推介。`);
    const closedResult = {
      recommendations: [],
      scanTime: new Date().toISOString(),
      hkTime: hkTimeInfo.hkTimeStr,
      marketPhase: hkTimeInfo.marketPhase,
      indexChangePercent: 0,
      totalScanned: 0,
      stage1Candidates: 0,
      stage2Candidates: 0,
      stage3Candidates: 0,
      stage4Candidates: 0,
      thresholdSoftenerActive: thresholdSoftenerActive,
      isDownMarket: false,
      marketClosedNotice: "美股今日休市（週末），請於美股交易日（香港時間星期一21:30 - 星期六04:00）再嘗試掃描。",
    };
    cachedScanResult = { result: closedResult, timestamp: Date.now() };
    return closedResult;
  }
  console.log(`[US V3.7] 單注資金: $${capitalPerPositionUSD.toFixed(0)} USD（≈HK$${(capitalPerPositionUSD * CONFIG.hkdToUsdRate).toFixed(0)}），最低目標利潤: $${minTargetProfitPerStockUSD.toFixed(0)} USD/股（≈HK$${(minTargetProfitPerStockUSD * CONFIG.hkdToUsdRate).toFixed(0)}）`);
  if (thresholdSoftenerActive) {
    console.log(`[US V3.7] ⚠️ 降維試槍開關已啟用：利潤門檻打8折，RSI放寬至>45。`);
  }

  // 獲取大市指數變幅 (Nasdaq Composite)
  const nasdaqQuote = await yfinanceData.fetchQuote("^IXIC");
  let indexChangePercent = 0;
  if (nasdaqQuote) {
    indexChangePercent = nasdaqQuote.changePercent;
  }
  console.log(`[US V3.7] 納斯達克綜合指數 (^IXIC) 今日變幅: ${(indexChangePercent * 100).toFixed(2)}%`);

  const isDownMarket = indexChangePercent <= CONFIG.downMarketThreshold;
  if (isDownMarket) {
    console.log(`[US V3.7] ⚠️ 大市跌市模式啟動（納指${(indexChangePercent * 100).toFixed(2)}% ≤ ${(CONFIG.downMarketThreshold * 100).toFixed(2)}%），優先推介逆市抗跌股`);
  }

  // Step 1: Fetch all stock data in parallel (batched to avoid rate limiting)
  const stockData = new Map<string, StockData | null>();
  const THROTTLE_DELAY_MS = 1800; // 每隻股票之間延遲：而家多咗新聞 API 請求，加長節流避免 Rate Limit

  for (let i = 0; i < US_STOCK_UNIVERSE.length; i++) {
    const symbol = US_STOCK_UNIVERSE[i];
    const result = await analyzeStock(symbol);
    stockData.set(symbol, result);

    // 節流：每次請求之間加延遲，避開 Finnhub 免費版 60次/分鐘限制
    if (i < US_STOCK_UNIVERSE.length - 1) {
      await sleep(THROTTLE_DELAY_MS);
    }
  }
  
  console.log(`[US V3.7] 已獲取 ${stockData.size} 隻美股數據`);
  
  // 檢查板塊共振
  const resonanceStocks = new Set<string>();
  // 僅在美股開盤前15分鐘（香港時間21:45-22:00）檢查共振
  if (hkTimeInfo.hkHour === 21 && hkTimeInfo.hkMinute >= 45 && hkTimeInfo.hkMinute < 55) { 
    console.log("[US V3.7] 執行玄金板塊共振算法...");
    for (const sectorName in US_SECTORS) {
      const symbolsInSector = US_SECTORS[sectorName];
      let sectorSpikesCount = 0;
      
      for (const symbol of symbolsInSector) {
        const data = stockData.get(symbol);
        if (!data) continue;
        
        const { quote, volumeSpike } = data;
        const currentPrice = quote.price;
        const prevClose = data.candles[data.candles.length - 2]?.close || currentPrice;
        const changePercent = ((currentPrice - prevClose) / prevClose) * 100;
        
        if (changePercent > 3 && volumeSpike) {
          sectorSpikesCount++;
        }
      }
      
      if (sectorSpikesCount >= 2) {
        console.log(`[US V3.7] 🔥 板塊共振觸發: ${sectorName} (${sectorSpikesCount} 隻股票)`);
        for (const sSymbol of symbolsInSector) { // Add all stocks in the resonating sector
          resonanceStocks.add(sSymbol);
        }
      }
    }
  }

  const recommendations: V3_7Recommendation[] = [];
  const rejectedStocks: { symbol: string; reason: string }[] = [];

  let stage1CandidatesCount = 0;
  let stage2CandidatesCount = 0;
  let stage3CandidatesCount = 0;
  let stage4CandidatesCount = 0;

  for (const symbol of US_STOCK_UNIVERSE) {
    const data = stockData.get(symbol);
    if (!data) {
      rejectedStocks.push({ symbol, reason: "No data available" });
      continue;
    }

    let currentStageLabel = "";
    let currentTriggerReason = "";
    let recommendationResult: { recommendation: V3_7Recommendation | null; debugReason: string } = { recommendation: null, debugReason: "" };

    // Stage 3: 利好新聞爆破 (優先檢查)
    if (hasBullishNews(data.news)) {
      currentStageLabel = "利好新聞爆破";
      currentTriggerReason = `利好新聞: ${data.news[0].title}`; // Use first news headline
      recommendationResult = buildRecommendation(symbol, data, 3, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, resonanceStocks.has(symbol), thresholdSoftenerActive);
      if (recommendationResult.recommendation) {
        recommendations.push(recommendationResult.recommendation);
        stage3CandidatesCount++;
        continue; // If news triggered, no need for other stages for this stock
      } else {
        rejectedStocks.push({ symbol, reason: `Stage 3 News Failed: ${recommendationResult.debugReason}` });
      }
    }

    // Stage 2: Opening Momentum (09:30 - 10:30 HKT)
    if (hkTimeInfo.marketPhase === "opening-hour") {
      currentStageLabel = "開市動量";
      currentTriggerReason = `今日漲幅 ${(data.quote.changePercent * 100).toFixed(2)}%`;
      recommendationResult = buildRecommendation(symbol, data, 2, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, resonanceStocks.has(symbol), thresholdSoftenerActive);
      if (recommendationResult.recommendation) {
        recommendations.push(recommendationResult.recommendation);
        stage2CandidatesCount++;
        continue;
      } else {
        rejectedStocks.push({ symbol, reason: `Stage 2 Opening Momentum Failed: ${recommendationResult.debugReason}` });
      }
    }

    // Stage 1: Cross-market Linkage (板塊共振優先)
    if (resonanceStocks.has(symbol)) {
      const sectorName = Object.keys(US_SECTORS).find(key => US_SECTORS[key].includes(symbol)) || "未知板塊";
      currentStageLabel = "玄金題材暴動";
      currentTriggerReason = `🔥【玄金題材暴動】${sectorName} 板塊資金瘋狂湧入，共振爆發！`;
      recommendationResult = buildRecommendation(symbol, data, 1, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, true, thresholdSoftenerActive);
      if (recommendationResult.recommendation) {
        recommendations.push(recommendationResult.recommendation);
        stage1CandidatesCount++;
        continue;
      } else {
        rejectedStocks.push({ symbol, reason: `Stage 1 Resonance Failed: ${recommendationResult.debugReason}` });
      }
    }

    // Stage 4: Fallback (保底防咬)
    currentStageLabel = "保底篩選";
    currentTriggerReason = "技術面覆盤";
    recommendationResult = buildRecommendation(symbol, data, 4, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, resonanceStocks.has(symbol), thresholdSoftenerActive);
    if (recommendationResult.recommendation) {
      recommendations.push(recommendationResult.recommendation);
      stage4CandidatesCount++;
    } else {
      rejectedStocks.push({ symbol, reason: `Stage 4 Fallback Failed: ${recommendationResult.debugReason}` });
    }
  }

  // Final selection: 跌市優先逆市抗跌股，再按預期利潤/信心排序
  const finalRecommendations = recommendations
    .sort((a, b) => {
      if (isDownMarket) {
        if (a.isCounterTrend && !b.isCounterTrend) return -1;
        if (!a.isCounterTrend && b.isCounterTrend) return 1;
      }
      return b.expectedProfit - a.expectedProfit || b.confidence - a.confidence;
    })
    .slice(0, CONFIG.positionsCount); // Target 5 stocks
  
  const elapsed = Date.now() - startTime;
  console.log(`[US V3.7] ====== 掃描完成: ${finalRecommendations.length} 隻美股在 ${elapsed}ms 內推薦 ======`);
  
  for (const rec of finalRecommendations) {
    console.log(`[US V3.7] → ${rec.symbol} (${rec.stockName}): 階段 ${rec.stage}, 信心 ${rec.confidence}%, TP=$${rec.takeProfitPrice.toFixed(2)}, 預期利潤=$${rec.expectedProfit.toFixed(0)} USD (HK$${rec.expectedProfitHKD.toFixed(0)}), 逆市股=${rec.isCounterTrend}, 可行=${rec.profitFeasible}, 原因: ${rec.triggerReason}`);
  }
  console.log("\n⚠️ 玄金操盤手提醒：當前戰術為【極速流】，不論是否到達 TP，香港時間 22:55 必須市價全清，絕不留戀！");

  if (DEBUG_MODE) {
    console.log("\n[DEBUG] Rejected Stocks Reasons:");
    rejectedStocks.forEach(stock => console.log(`- ${stock.symbol}: ${stock.reason}`));
  }
  
  const finalResult = {
    recommendations: finalRecommendations,
    scanTime: new Date().toISOString(),
    hkTime: hkTimeInfo.hkTimeStr,
    marketPhase: hkTimeInfo.marketPhase,
    indexChangePercent,
    totalScanned: stockData.size,
    stage1Candidates: stage1CandidatesCount,
    stage2Candidates: stage2CandidatesCount,
    stage3Candidates: stage3CandidatesCount,
    stage4Candidates: stage4CandidatesCount,
    thresholdSoftenerActive: thresholdSoftenerActive,
    isDownMarket,
  };

  // 存入 Cache，15分鐘內重複請求直接返回
  cachedScanResult = { result: finalResult, timestamp: Date.now() };
  console.log(`[US V3.7] 💾 掃描結果已存入 Cache，15分鐘內有效`);

  return finalResult;
}

// Debugging flag
const DEBUG_MODE = true;
