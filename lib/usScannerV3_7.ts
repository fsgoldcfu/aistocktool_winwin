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
import { yfinanceData as financeAPI, type HistoricalDataSource } from "./yfinanceData";
import { buildLongIntradayRiskPlan, calculateTradeabilityScore, evaluateFutuUsStockNetProfit } from './shortTermRisk';
import { assessCatalyst, type CatalystAssessment, type EarningsEvidence } from './catalystAnalysis';
import { buildCapitalPlan, type CapitalPlan, type CapitalSettingsInput } from './capitalSettings';

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
  datetime?: number;
  source?: string;
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
  maxStopLossPercent: 0.03,      // 以小數表示：最多 3% 初始風險
  minimumRewardRisk: 1.5,         // 最低 1.5R，否則不推介
  maxHoldingMinutes: 90,          // intraday time stop，避免訊號變成無限期持倉
  minConfidence: 60,              // Minimum strategy confirmation score
  tradeabilityThreshold: 60,     // Minimum daily execution score
  minimumNetProfitHKD: Number(process.env.MIN_NET_PROFIT_HKD ?? 500),
  estimatedOneWaySlippageBps: Number(process.env.US_ONE_WAY_SLIPPAGE_BPS ?? 5),
  thresholdSoftenerEnabled: false, // 降維試槍開關

  // ===== 逆市股偵測（跌市優先推介逆市股）=====
  downMarketThreshold: -0.003,        // 納指跌幅 > 0.3% 視為跌市
  counterTrendRelativeStrength: 0.01, // 個股強於大市 1% 先當「逆市股」
};

// 沒有由介面傳入設定時，沿用舊版假設；正式掃描會以每次 request 的 capitalPlan 覆蓋。
const DEFAULT_CAPITAL_PLAN = buildCapitalPlan({
  totalCapitalHKD: CONFIG.totalCapitalHKD,
  dailyAllocationPercent: (CONFIG.maxDailyCapitalHKD / CONFIG.totalCapitalHKD) * 100,
  maxOpenPositions: CONFIG.expectedPositionsToBuy,
});

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
  catalystStatus: CatalystAssessment['status'];
  catalystSummary: string;
  catalystEvidence: string[];
  catalystHeadline?: string;
  catalystUrl?: string;
  upcomingEarningsDate?: string;
  recommendationReasons: string[];
  
  confidence: number;
  riskRewardRatio: number;
  debugReason?: string; // Added for debugging

  capitalAllocatedHKD: number;  // 港幣顯示，方便對照實際資金
  expectedProfitHKD: number;    // 結構目標的估計毛利（未扣成本）
  estimatedCostsHKD: number;    // 以配置假設計算的買入及賣出成本
  estimatedNetProfitHKD: number; // 結構目標的估計成本後淨盈利（非保證）
  minimumNetProfitHKD: number;
  isCounterTrend: boolean;      // 是否為「逆市抗跌股」
  entryRule: string;
  invalidation: string;
  maxHoldingMinutes: number;
  tradeabilityScore: number;
  tradeabilityReason: string;
}

export type RejectionCode =
  | 'data_unavailable'
  | 'catalyst_risk'
  | 'late_session'
  | 'relative_strength'
  | 'overheated'
  | 'risk_reward_or_stop'
  | 'profit_structure'
  | 'net_profit'
  | 'confidence'
  | 'tradeability'
  | 'other';

export interface RejectionSummaryItem {
  code: RejectionCode;
  label: string;
  count: number;
}

export interface ScanCoverage {
  requested: number;
  ready: number;
  unavailable: number;
  historyNetwork: number;
  historyFreshCache: number;
  historyStaleCache: number;
  historyCooldownOrBudget: number;
  windowRequestsUsed: number;
  windowRequestBudget: number;
  cooldownRemainingMs: number;
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
  tradeabilityThreshold: number;
  qualifiedCandidates: number;
  capitalPlan?: CapitalPlan;
  marketClosedNotice?: string;
  coverage?: ScanCoverage;
  rejectionSummary?: RejectionSummaryItem[];
}

// ============================================================
// UTILS
// ============================================================

/**
 * Get current HK time info and map to US market phases
 * Module 3: 鎖死「香港實時時區判定」與美股時差校準
 */
function getHKTimeInfo() {
  const now = new Date();
  const getParts = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).formatToParts(now);
    const value = (type: string) => parts.find((part) => part.type === type)?.value || '0';
    const weekday = value('weekday');
    return { hour: Number(value('hour')), minute: Number(value('minute')), weekday };
  };
  const hk = getParts('Asia/Hong_Kong');
  const ny = getParts('America/New_York');
  const hkTimeStr = `${String(hk.hour).padStart(2, '0')}:${String(hk.minute).padStart(2, '0')}`;
  const nyMinutes = ny.hour * 60 + ny.minute;
  const isTradingDay = !['Sat', 'Sun'].includes(ny.weekday);
  const marketPhase = !isTradingDay
    ? 'market-closed-weekend'
    : nyMinutes >= 570 && nyMinutes < 630
      ? 'opening-hour'
      : nyMinutes >= 630 && nyMinutes < 960
        ? 'active-session'
        : 'closed-analysis';

  if (DEBUG_MODE) {
    console.log(`[DEBUG] HKT ${hkTimeStr}; NY ${ny.hour}:${String(ny.minute).padStart(2, '0')}; phase ${marketPhase}; weekday ${ny.weekday}`);
  }
  // 公眾假期仍須由資料供應商是否返回有效 quote / bar 作最後 gate。
  return { hkHour: hk.hour, hkMinute: hk.minute, hkTimeStr, nyHour: ny.hour, nyMinute: ny.minute, marketPhase, isTradingDay };
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
const newsCache = new Map<string, { expiresAt: number; items: NewsItem[] }>();
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;

async function getUSStockNews(symbol: string): Promise<NewsItem[]> {
  const normalizedSymbol = symbol.toUpperCase();
  const cached = newsCache.get(normalizedSymbol);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
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
    if (!Array.isArray(data) || data.length === 0) {
      newsCache.set(normalizedSymbol, { items: [], expiresAt: Date.now() + NEWS_CACHE_TTL_MS });
      return [];
    }

    const items = data.slice(0, 8).map((item: any) => ({
      title: item.headline || "",
      url: item.url || "",
      datetime: Number(item.datetime) || undefined,
      source: item.source || undefined,
    }));
    newsCache.set(normalizedSymbol, { items, expiresAt: Date.now() + NEWS_CACHE_TTL_MS });
    return items;

  } catch (error) {
    console.error(`[News] Error fetching news for ${symbol}:`, error);
    return [];
  }
}

interface EarningsEvent extends EarningsEvidence { symbol: string }
let earningsCalendarCache: { expiresAt: number; events: EarningsEvent[] } | null = null;
let earningsCalendarRequest: Promise<EarningsEvent[]> | null = null;

async function getUSEarningsCalendar(): Promise<EarningsEvent[]> {
  const nowMs = Date.now();
  if (earningsCalendarCache && earningsCalendarCache.expiresAt > nowMs) return earningsCalendarCache.events;
  if (earningsCalendarRequest) return earningsCalendarRequest;

  earningsCalendarRequest = (async () => {
    try {
      const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
      if (!FINNHUB_KEY) return [];
      const now = new Date();
      const from = new Date(now);
      const to = new Date(now);
      from.setDate(from.getDate() - 14);
      to.setDate(to.getDate() + 8);
      const formatDate = (date: Date) => date.toISOString().slice(0, 10);
      const url = `https://finnhub.io/api/v1/calendar/earnings?from=${formatDate(from)}&to=${formatDate(to)}&token=${FINNHUB_KEY}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return [];
      const payload = await response.json();
      const calendar = Array.isArray(payload?.earningsCalendar) ? payload.earningsCalendar : [];
      const events = calendar
        .filter((item: any) => typeof item?.symbol === 'string' && typeof item?.date === 'string')
        .map((item: any) => ({
          symbol: String(item.symbol).toUpperCase(),
          date: item.date,
          hour: item.hour || undefined,
          epsActual: typeof item.epsActual === 'number' ? item.epsActual : null,
          epsEstimate: typeof item.epsEstimate === 'number' ? item.epsEstimate : null,
          revenueActual: typeof item.revenueActual === 'number' ? item.revenueActual : null,
          revenueEstimate: typeof item.revenueEstimate === 'number' ? item.revenueEstimate : null,
        }));
      earningsCalendarCache = { events, expiresAt: nowMs + 60 * 60 * 1000 };
      return events;
    } catch (error) {
      console.warn('[Earnings] unable to read earnings calendar:', error);
      return [];
    } finally {
      earningsCalendarRequest = null;
    }
  })();
  return earningsCalendarRequest;
}

async function getUSEarningsEvents(symbol: string): Promise<EarningsEvent[]> {
  const events = await getUSEarningsCalendar();
  return events.filter((item) => item.symbol === symbol.toUpperCase());
}

function selectCatalyst(symbol: string, news: NewsItem[], earnings: EarningsEvent[]): CatalystAssessment {
  const today = new Date().toISOString().slice(0, 10);
  const ordered = [...earnings].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = ordered.find((item) => item.date >= today) ?? null;
  const recent = [...ordered].reverse().find((item) => item.date < today) ?? null;
  return assessCatalyst({ headlines: news, upcomingEarnings: upcoming, recentEarnings: recent });
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
  thresholdSoftenerActive: boolean,
  capitalPlan: CapitalPlan
): { feasible: boolean; sharesCanBuy: number; expectedProfit: number; capitalAllocated: number; lotSize: number; reason: string } {
  const lotSize = 1; // US stocks typically trade in 1 share increments
  // 戰術變更: 資金按用戶實際每日可用資金 / 預期買入注數 計算
  const capitalOptions = [capitalPlan.capitalPerPositionHKD / CONFIG.hkdToUsdRate];
  
  let bestShares = 0;
  let bestExpectedProfit = 0;
  let actualCapitalAllocated = 0;
  let feasibilityReason = "";

  

  for (const capital of capitalOptions) {
    const sharesCanBuy = Math.floor(capital / currentPrice);

    if (sharesCanBuy === 0) {
      feasibilityReason = `Capital (${capital.toFixed(0)} USD) insufficient to buy 1 share`;
      continue;
    }

    const currentExpectedProfit = (takeProfitPrice - currentPrice) * sharesCanBuy;

    if (sharesCanBuy > bestShares) {
      bestShares = sharesCanBuy;
      bestExpectedProfit = currentExpectedProfit;
      actualCapitalAllocated = capital;
    }
  }

  if (bestShares === 0) {
    return { feasible: false, sharesCanBuy: 0, expectedProfit: 0, capitalAllocated: 0, lotSize, reason: feasibilityReason || '資金不足以買入 1 股。' };
  }

  const tickSize = getTickSize(currentPrice);
  const ticksAvailable = Math.floor((takeProfitPrice - currentPrice) / tickSize);
  
  let feasible = ticksAvailable >= 1;
  feasibilityReason = feasible ? '有至少一個有效價格跳動，下一步交由成本後淨盈利門檻判定。' : '結構目標不足一個有效價格跳動。';

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
  catalyst: CatalystAssessment;
  volumeRatio: number;
  volumeSpike: boolean;
  historicalSource: HistoricalDataSource;
  historicalWarning?: string;
}

interface StockAnalysisResult {
  data: StockData | null;
  dataIssue?: string;
  historicalSource?: HistoricalDataSource;
}

async function analyzeStock(symbol: string): Promise<StockAnalysisResult> {
  try {
    // 先確認日線是否可用；當 Twelve Data 預算／cooldown 阻擋新股票時，
    // 不再額外對該股票發送 Finnhub quote 或 news 請求。
    const history = await financeAPI.fetchHistoricalDataWithMeta(symbol, '3mo');
    const candles = history.candles;
    if (candles.length < 20) {
      return { data: null, dataIssue: `history_${history.source}`, historicalSource: history.source };
    }

    const quote = await yfinanceData.fetchQuote(symbol);
    if (!quote || quote.price <= 0) {
      return { data: null, dataIssue: 'quote_unavailable', historicalSource: history.source };
    }
    
    const indicators = yfinanceData.calculateIndicators(candles);
    const [news, earnings] = await Promise.all([getUSStockNews(symbol), getUSEarningsEvents(symbol)]);
    const catalyst = selectCatalyst(symbol, news, earnings);

    const todayVolume = candles[candles.length - 1]?.volume || 0;
    const past5DaysVolumes = candles.slice(-6, -1).map(c => c.volume);
    const avgPast5DaysVolume = past5DaysVolumes.length > 0 ? past5DaysVolumes.reduce((a, b) => a + b, 0) / past5DaysVolumes.length : 1;
    const volumeRatio = avgPast5DaysVolume > 0 ? todayVolume / avgPast5DaysVolume : 0;
    const volumeSpike = volumeRatio > 1.3; // +30% spike

    return {
      data: {
        quote,
        indicators,
        candles,
        news,
        catalyst,
        volumeRatio,
        volumeSpike,
        historicalSource: history.source,
        historicalWarning: history.error,
      },
      historicalSource: history.source,
    };
  } catch (error) {
    console.error(`Error analyzing ${symbol}:`, error);
    return { data: null, dataIssue: 'unexpected_error' };
  }
}

const REJECTION_LABELS: Record<RejectionCode, string> = {
  data_unavailable: '資料不足／供應商限流',
  catalyst_risk: '業績或事件風險',
  late_session: '尾市動能不足',
  relative_strength: '相對強度不足或非上升',
  overheated: '當日升幅過熱',
  risk_reward_or_stop: '止蝕或至少 1.5R 結構不合格',
  profit_structure: '目標價／最小 tick／倉位結構不可行',
  net_profit: '成本後淨盈利未達 HK$500',
  confidence: '策略確認分數不足',
  tradeability: 'Tradeability Score 未達門檻',
  other: '其他規則未通過',
};

function classifyRejection(reason: string): RejectionCode {
  if (/No data available|quote_unavailable|history_|資料不足|限流|cooldown/i.test(reason)) return 'data_unavailable';
  if (/事件風險|業績|catalyst/i.test(reason)) return 'catalyst_risk';
  if (/Late Session/i.test(reason)) return 'late_session';
  if (/Relative Strength/i.test(reason)) return 'relative_strength';
  if (/Overheated/i.test(reason)) return 'overheated';
  if (/成本後淨盈利/i.test(reason)) return 'net_profit';
  if (/Profit Feasibility|有效價格跳動|資金不足/i.test(reason)) return 'profit_structure';
  if (/Risk Plan|至少 .*R|回報風險|止蝕/i.test(reason)) return 'risk_reward_or_stop';
  if (/Confidence/i.test(reason)) return 'confidence';
  if (/Tradeability Score/i.test(reason)) return 'tradeability';
  return 'other';
}

function buildRejectionSummary(rejectedBySymbol: Map<string, string>): RejectionSummaryItem[] {
  const counts = new Map<RejectionCode, number>();
  for (const reason of Array.from(rejectedBySymbol.values())) {
    const code = classifyRejection(reason);
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  return (Object.keys(REJECTION_LABELS) as RejectionCode[])
    .map((code) => ({ code, label: REJECTION_LABELS[code], count: counts.get(code) || 0 }))
    .filter((item) => item.count > 0);
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
  thresholdSoftenerActive: boolean,
  capitalPlan: CapitalPlan = DEFAULT_CAPITAL_PLAN
): { recommendation: V3_7Recommendation | null; debugReason: string } {
  const { quote, indicators, candles, news, catalyst, volumeRatio, volumeSpike } = data;
  
  const currentPrice = quote.price;
  // 報價供應商以 previous close 計算的變幅，避免日線資料有／無當日未完成 bar 時訊號改變。
  const changePercent = quote.changePercent;
  const stockName = US_STOCK_NAMES[symbol] || symbol;

  let debugReason = ``;

  if (catalyst.blockTrade) {
    debugReason = `事件風險保護：${catalyst.summary}`;
    return { recommendation: null, debugReason };
  }

  // 美東 14:30 後只接受仍然上升的股票；以 America/New_York 計算，避免夏令時間令 HKT 固定時段錯位。
  if (hkTimeInfo.nyHour > 14 || (hkTimeInfo.nyHour === 14 && hkTimeInfo.nyMinute >= 30)) {
    if (changePercent <= 0) {
      debugReason = `Late Session: stock is not rising (changePercent: ${(changePercent * 100).toFixed(2)}%)`;
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

  const riskPlanResult = buildLongIntradayRiskPlan({
    currentPrice,
    atr: indicators.atr,
    candles,
    tickSize: getTickSize(currentPrice),
    maxStopLossPercent: CONFIG.maxStopLossPercent,
    minimumRewardRisk: CONFIG.minimumRewardRisk,
    maxHoldingMinutes: CONFIG.maxHoldingMinutes,
  });
  if (!riskPlanResult.plan) {
    debugReason = `Risk Plan Rejected: ${riskPlanResult.reason}`;
    return { recommendation: null, debugReason };
  }
  const { entryPrice: plannedEntryPrice, takeProfitPrice, stopLossPrice, resistanceLevel, resistanceSource, riskRewardRatio, entryRule, invalidation, maxHoldingMinutes } = riskPlanResult.plan;

  const feasibilityInfo = validateProfitFeasibility(plannedEntryPrice, takeProfitPrice, symbol, hkTimeInfo.hkHour, thresholdSoftenerActive, capitalPlan);
  
  if (!feasibilityInfo.feasible) {
    debugReason = `Profit Feasibility Check Failed: ${feasibilityInfo.reason}`;
    return { recommendation: null, debugReason };
  }

  // ===== 港幣顯示換算 + 逆市抗跌股判定 =====
  const netProfitEligibility = evaluateFutuUsStockNetProfit({
    entryPrice: plannedEntryPrice,
    targetPrice: takeProfitPrice,
    shares: feasibilityInfo.sharesCanBuy,
    oneWaySlippageBps: CONFIG.estimatedOneWaySlippageBps,
    fxToHKD: CONFIG.hkdToUsdRate,
    minimumNetProfitHKD: CONFIG.minimumNetProfitHKD,
  });
  if (!netProfitEligibility.feasible) {
    debugReason = `成本後淨盈利檢查未通過: ${netProfitEligibility.reason}`;
    return { recommendation: null, debugReason };
  }

  const capitalAllocatedHKD = feasibilityInfo.capitalAllocated * CONFIG.hkdToUsdRate;
  const expectedProfitHKD = netProfitEligibility.estimatedGrossProfitHKD;
  const estimatedCostsHKD = netProfitEligibility.estimatedCostsHKD;
  const estimatedNetProfitHKD = netProfitEligibility.estimatedNetProfitHKD;
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

  // 可追溯的催化只作有限加分；未公布業績絕不當成正面預期。
  if (catalyst.status === 'verified-positive') {
    triggerReason += ` | 催化：${catalyst.primaryHeadline || catalyst.summary}`;
    confidence += catalyst.scoreAdjustment;
  } else if (catalyst.upcomingEarningsDate) {
    triggerReason += ` | 業績窗口 ${catalyst.upcomingEarningsDate}（不作正面加分）`;
  }

  // 板塊共振拉滿信心
  if (isResonance) {
    // 板塊共振只是一項 feature，不可把未經校準的分數直接標示為 100% 勝率。
    confidence += 5;
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
  if (confidence < CONFIG.minConfidence) {
    debugReason = `Confidence ${confidence} below minimum ${CONFIG.minConfidence}; not enough independent confirmations.`;
    return { recommendation: null, debugReason };
  }

  const tradeability = calculateTradeabilityScore({
    volumeRatio,
    relativeStrength: changePercent - indexChangePercent,
    atrPercent,
    riskRewardRatio,
    isCounterTrend,
  }, CONFIG.tradeabilityThreshold);
  if (!tradeability.passed) {
    debugReason = tradeability.reason;
    return { recommendation: null, debugReason };
  }
  triggerReason += ` | ${tradeability.reason}`;
  const recommendationReasons = [
    `相對強度：當日 ${(changePercent * 100).toFixed(2)}%，相對指數 ${((changePercent - indexChangePercent) * 100).toFixed(2)}%。`,
    `風險計劃：入場 $${plannedEntryPrice.toFixed(2)}、止蝕 $${stopLossPrice.toFixed(2)}、結構目標 $${takeProfitPrice.toFixed(2)}、${riskRewardRatio.toFixed(2)}R。`,
    `可交易性：${tradeability.reason}`,
    `成本後門檻：${netProfitEligibility.reason}`,
    `催化／事件：${catalyst.summary}`,
    ...catalyst.evidence,
  ];
  
  return {
    recommendation: {
      symbol,
      stockName,
      currentPrice: plannedEntryPrice,
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
      profitFeasible: netProfitEligibility.feasible,
      
      rsi: indicators.rsi,
      ema10,
      ema20: indicators.ema20,
      atr: indicators.atr,
      atrPercent,
      
      volumeRatio,
      volumeSpike,
      
      bullishNews: catalyst.status === 'verified-positive',
      newsHeadline: catalyst.primaryHeadline || news[0]?.title || "",
      newsSentimentScore: catalyst.status === 'verified-positive' ? 0.8 : 0.2,
      catalystStatus: catalyst.status,
      catalystSummary: catalyst.summary,
      catalystEvidence: catalyst.evidence,
      catalystHeadline: catalyst.primaryHeadline,
      catalystUrl: catalyst.primaryUrl,
      upcomingEarningsDate: catalyst.upcomingEarningsDate,
      recommendationReasons,
      
      confidence,
      riskRewardRatio,
      debugReason,
      entryRule,
      invalidation,
      maxHoldingMinutes,
      tradeabilityScore: tradeability.score,
      tradeabilityReason: tradeability.reason,

      capitalAllocatedHKD,
      expectedProfitHKD,
      estimatedCostsHKD,
      estimatedNetProfitHKD,
      minimumNetProfitHKD: netProfitEligibility.minimumNetProfitHKD,
      isCounterTrend,
    },
    debugReason: debugReason
  };
}

// ============================================================
// MAIN SCANNER FUNCTION
// ============================================================

export async function runUSScannerV3_7(thresholdSoftenerActive: boolean = false, capitalSettings?: CapitalSettingsInput): Promise<ScanResult> {
  const capitalPlan = buildCapitalPlan(capitalSettings);
  const canUseCache = capitalSettings == null;
  // ==================== Cache 檢查（15分鐘內直接返回） ====================
  if (canUseCache && cachedScanResult && (Date.now() - cachedScanResult.timestamp) < SCAN_CACHE_TTL_MS) {
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
      tradeabilityThreshold: CONFIG.tradeabilityThreshold,
      qualifiedCandidates: 0,
      marketClosedNotice: "美股今日休市（週末），請於美股交易日（香港時間星期一21:30 - 星期六04:00）再嘗試掃描。",
    };
    cachedScanResult = { result: closedResult, timestamp: Date.now() };
    return closedResult;
  }
  // 短炒計劃只在正式 regular session 產生；收市分析不可偽裝為可即時下單訊號。
  if (!['opening-hour', 'active-session'].includes(hkTimeInfo.marketPhase)) {
    return {
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
      thresholdSoftenerActive,
      isDownMarket: false,
      tradeabilityThreshold: CONFIG.tradeabilityThreshold,
      qualifiedCandidates: 0,
      marketClosedNotice: '美股正規交易時段以外不產生可交易短炒訊號；請待美東 09:30–16:00 再掃描。',
    };
  }

  const capitalPerPositionUSD = capitalPlan.capitalPerPositionHKD / CONFIG.hkdToUsdRate;
  console.log(`[US V3.7] 本金 HK$${capitalPlan.totalCapitalHKD.toFixed(0)}；每日配置 ${capitalPlan.dailyAllocationPercent.toFixed(2)}%；每筆資金 HK$${capitalPlan.capitalPerPositionHKD.toFixed(0)}（≈$${capitalPerPositionUSD.toFixed(0)} USD）`);
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

  // Step 1: 每隻股票的日線請求由 yfinanceData 內的 15 分鐘共用 cache、序列化佇列、
  // 請求預算及 429 cooldown 管理；這裡保留逐一分析，避免新聞／日線資料同時爆發請求。
  const stockData = new Map<string, StockData | null>();
  const dataIssues = new Map<string, string>();
  const historicalSources = new Map<string, HistoricalDataSource>();

  const scanOrder = [...US_STOCK_UNIVERSE].sort((left, right) => {
    const leftStatus = financeAPI.getHistoricalCacheStatus(left, '3mo');
    const rightStatus = financeAPI.getHistoricalCacheStatus(right, '3mo');
    // 未曾取得日線的股票優先；其次是已有 stale fallback 但無 fresh cache 的股票。
    const leftRank = leftStatus.fresh ? 2 : leftStatus.stale ? 1 : 0;
    const rightRank = rightStatus.fresh ? 2 : rightStatus.stale ? 1 : 0;
    return leftRank - rightRank;
  });

  for (const symbol of scanOrder) {
    const outcome = await analyzeStock(symbol);
    stockData.set(symbol, outcome.data);
    if (outcome.dataIssue) dataIssues.set(symbol, outcome.dataIssue);
    if (outcome.historicalSource) historicalSources.set(symbol, outcome.historicalSource);
  }

  const dataReadyCount = Array.from(stockData.values()).filter((data): data is StockData => data != null).length;
  const historySourceCount = (source: HistoricalDataSource) => Array.from(historicalSources.values()).filter((value) => value === source).length;
  const providerHealth = financeAPI.getTwelveDataHistoryHealth();
  const coverage: ScanCoverage = {
    requested: US_STOCK_UNIVERSE.length,
    ready: dataReadyCount,
    unavailable: US_STOCK_UNIVERSE.length - dataReadyCount,
    historyNetwork: historySourceCount('network'),
    historyFreshCache: historySourceCount('fresh-cache'),
    historyStaleCache: historySourceCount('stale-cache'),
    historyCooldownOrBudget: historySourceCount('cooldown') + historySourceCount('budget-exhausted'),
    windowRequestsUsed: providerHealth.windowRequestsUsed,
    windowRequestBudget: providerHealth.windowRequestBudget,
    cooldownRemainingMs: providerHealth.cooldownRemainingMs,
  };
  console.log(`[US V3.7] 已獲取 ${coverage.ready}/${coverage.requested} 隻美股數據；日線 fresh=${coverage.historyNetwork}、cache=${coverage.historyFreshCache}、stale=${coverage.historyStaleCache}、限流=${coverage.historyCooldownOrBudget}`);
  
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
        const changePercent = quote.changePercent;
        
        if (changePercent > 0.03 && volumeSpike) {
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
  const rejectedStocks = new Map<string, string>();
  const recordRejected = (symbol: string, reason: string) => rejectedStocks.set(symbol, reason);

  let stage1CandidatesCount = 0;
  let stage2CandidatesCount = 0;
  let stage3CandidatesCount = 0;
  let stage4CandidatesCount = 0;

  for (const symbol of US_STOCK_UNIVERSE) {
    const data = stockData.get(symbol);
    if (!data) {
      recordRejected(symbol, dataIssues.get(symbol) || 'No data available');
      continue;
    }

    let currentStageLabel = "";
    let currentTriggerReason = "";
    let recommendationResult: { recommendation: V3_7Recommendation | null; debugReason: string } = { recommendation: null, debugReason: "" };

    // Stage 3: 利好新聞爆破 (優先檢查)
    if (hasBullishNews(data.news)) {
      currentStageLabel = "利好新聞爆破";
      currentTriggerReason = `利好新聞: ${data.news[0].title}`; // Use first news headline
      recommendationResult = buildRecommendation(symbol, data, 3, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, resonanceStocks.has(symbol), thresholdSoftenerActive, capitalPlan);
      if (recommendationResult.recommendation) {
        recommendations.push(recommendationResult.recommendation);
        rejectedStocks.delete(symbol);
        stage3CandidatesCount++;
        continue; // If news triggered, no need for other stages for this stock
      } else {
        recordRejected(symbol, `Stage 3 News Failed: ${recommendationResult.debugReason}`);
      }
    }

    // Stage 2: Opening Momentum (09:30 - 10:30 HKT)
    if (hkTimeInfo.marketPhase === "opening-hour") {
      currentStageLabel = "開市動量";
      currentTriggerReason = `今日漲幅 ${(data.quote.changePercent * 100).toFixed(2)}%`;
      recommendationResult = buildRecommendation(symbol, data, 2, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, resonanceStocks.has(symbol), thresholdSoftenerActive, capitalPlan);
      if (recommendationResult.recommendation) {
        recommendations.push(recommendationResult.recommendation);
        rejectedStocks.delete(symbol);
        stage2CandidatesCount++;
        continue;
      } else {
        recordRejected(symbol, `Stage 2 Opening Momentum Failed: ${recommendationResult.debugReason}`);
      }
    }

    // Stage 1: Cross-market Linkage (板塊共振優先)
    if (resonanceStocks.has(symbol)) {
      const sectorName = Object.keys(US_SECTORS).find(key => US_SECTORS[key].includes(symbol)) || "未知板塊";
      currentStageLabel = "玄金題材暴動";
      currentTriggerReason = `🔥【玄金題材暴動】${sectorName} 板塊資金瘋狂湧入，共振爆發！`;
      recommendationResult = buildRecommendation(symbol, data, 1, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, true, thresholdSoftenerActive, capitalPlan);
      if (recommendationResult.recommendation) {
        recommendations.push(recommendationResult.recommendation);
        rejectedStocks.delete(symbol);
        stage1CandidatesCount++;
        continue;
      } else {
        recordRejected(symbol, `Stage 1 Resonance Failed: ${recommendationResult.debugReason}`);
      }
    }

    // Stage 4: Fallback (保底防咬)
    currentStageLabel = "保底篩選";
    currentTriggerReason = "技術面覆盤";
    recommendationResult = buildRecommendation(symbol, data, 4, currentStageLabel, currentTriggerReason, indexChangePercent, hkTimeInfo, resonanceStocks.has(symbol), thresholdSoftenerActive, capitalPlan);
    if (recommendationResult.recommendation) {
      recommendations.push(recommendationResult.recommendation);
      rejectedStocks.delete(symbol);
      stage4CandidatesCount++;
    } else {
      recordRejected(symbol, `Stage 4 Fallback Failed: ${recommendationResult.debugReason}`);
    }
  }

  // 只由已通過 Tradeability Score 的候選中最多選 5 隻；少於 5 隻或 0 隻均為正常結果。
  const finalRecommendations = recommendations
    .filter((recommendation) => recommendation.tradeabilityScore >= CONFIG.tradeabilityThreshold)
    .sort((a, b) => {
      if (isDownMarket) {
        if (a.isCounterTrend && !b.isCounterTrend) return -1;
        if (!a.isCounterTrend && b.isCounterTrend) return 1;
      }
      return b.tradeabilityScore - a.tradeabilityScore
        || b.riskRewardRatio - a.riskRewardRatio
        || b.confidence - a.confidence
        || b.expectedProfit - a.expectedProfit;
    })
    .slice(0, CONFIG.positionsCount); // Target 5 stocks
  
  const elapsed = Date.now() - startTime;
  console.log(`[US V3.7] ====== 掃描完成: ${finalRecommendations.length} 隻美股在 ${elapsed}ms 內推薦 ======`);
  
  for (const rec of finalRecommendations) {
    console.log(`[US V3.7] → ${rec.symbol} (${rec.stockName}): 階段 ${rec.stage}, 信心 ${rec.confidence}%, TP=$${rec.takeProfitPrice.toFixed(2)}, 預期利潤=$${rec.expectedProfit.toFixed(0)} USD (HK$${rec.expectedProfitHKD.toFixed(0)}), 逆市股=${rec.isCounterTrend}, 可行=${rec.profitFeasible}, 原因: ${rec.triggerReason}`);
  }
  console.log(`\n⚠️ 短炒風險規則：每個計劃最長持有 ${CONFIG.maxHoldingMinutes} 分鐘；跌穿 initial stop 或時間到即退出。`);

  const rejectionSummary = buildRejectionSummary(rejectedStocks);
  console.log(`[US V3.7] 淘汰統計：${rejectionSummary.map((item) => `${item.label}=${item.count}`).join('；') || '無'}`);

  if (DEBUG_MODE) {
    console.log("\n[DEBUG] Rejected Stocks Reasons:");
    rejectedStocks.forEach((reason, symbol) => console.log(`- ${symbol}: ${reason}`));
  }
  
  const finalResult: ScanResult = {
    recommendations: finalRecommendations,
    scanTime: new Date().toISOString(),
    hkTime: hkTimeInfo.hkTimeStr,
    marketPhase: hkTimeInfo.marketPhase,
    indexChangePercent,
    totalScanned: coverage.ready,
    stage1Candidates: stage1CandidatesCount,
    stage2Candidates: stage2CandidatesCount,
    stage3Candidates: stage3CandidatesCount,
    stage4Candidates: stage4CandidatesCount,
    thresholdSoftenerActive: thresholdSoftenerActive,
    isDownMarket,
    tradeabilityThreshold: CONFIG.tradeabilityThreshold,
    qualifiedCandidates: recommendations.filter((recommendation) => recommendation.tradeabilityScore >= CONFIG.tradeabilityThreshold).length,
    capitalPlan,
    coverage,
    rejectionSummary,
  };

  // 存入 Cache，15分鐘內重複請求直接返回
  if (canUseCache) cachedScanResult = { result: finalResult, timestamp: Date.now() };
  console.log(`[US V3.7] 💾 掃描結果已存入 Cache，15分鐘內有效`);

  return finalResult;
}

// Debugging flag
const DEBUG_MODE = process.env.SCANNER_DEBUG === 'true';
