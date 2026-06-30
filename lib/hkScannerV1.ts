/**
 * HK Scanner V1 - 港股短炒推介引擎
 *
 * 結構同 lib/usScannerV3_7.ts 一致，方便日後維護同比對邏輯，
 * 主要分別：
 * 1. 數據源用 lib/hkStockData.ts (iTick API) 而唔係 yfinanceData (Finnhub/Twelve Data)
 * 2. 資金配置直接用港幣（HKD），唔需要匯率轉換
 * 3. 交易時段判斷簡化（港股本身就係香港時間，唔需要時區校準）
 * 4. Stage 3「利好新聞爆破」暫時 stub（TODO：iTick/Finnhub 免費版未必支援港股新聞，
 *    需要另外接新聞源，例如 AAStocks RSS 或者新聞 API）
 * 5. 逆市抗跌股優先邏輯、信心指數計算方式同美股版一致
 */

import { hkStockData, type HKCandle as Candle, type HKQuote as Quote, type HKIndicators as Indicators } from "./hkStockData";

// ==================== 掃描結果 Cache（15分鐘） ====================
let cachedHKScanResult: { result: any; timestamp: number } | null = null;
const HK_SCAN_CACHE_TTL_MS = 15 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// CONFIGURATION（港股直接用 HKD，唔需要匯率轉換）
// ============================================================

const HK_CONFIG = {
  totalCapitalHKD: 180000,
  maxDailyCapitalHKD: 100000,
  dailyProfitTargetHKD: 1000,
  expectedPositionsToBuy: 2,

  positionsCount: 5,
  maxStopLossPercent: 3,
  minConfidence: 60,
  thresholdSoftenerEnabled: false,

  downMarketThreshold: -0.003,        // 恒指跌幅 > 0.3% 視為跌市
  counterTrendRelativeStrength: 0.01, // 個股強於大市 1% 先當「逆市股」
};

// 港股每注資金 / 每隻最低目標利潤（直接用 HKD，唔經過匯率）
const capitalPerPositionHKD = HK_CONFIG.maxDailyCapitalHKD / HK_CONFIG.expectedPositionsToBuy; // ≈ HK$50,000
const minTargetProfitPerStockHKD = HK_CONFIG.dailyProfitTargetHKD / HK_CONFIG.expectedPositionsToBuy; // ≈ HK$500

// ============================================================
// 港股股票池（可按需要增減）
// ============================================================

const HK_SECTORS: Record<string, string[]> = {
  "科技與電商": ["0700", "9988", "3690", "9618", "1810"],
  "金融與保險": ["0005", "2318", "1299", "0388", "0939"],
  "能源與資源": ["0883", "0857", "2628", "1088", "0386"],
  "汽車與新能源": ["1211", "9866", "2015", "0175", "1958"],
  "電訊與公用": ["0941", "0762", "0006", "0002", "1038"],
};

const HK_STOCK_UNIVERSE: string[] = Array.from(new Set(Object.values(HK_SECTORS).flat()));

const HK_STOCK_NAMES: Record<string, string> = {
  "0700": "騰訊控股", "9988": "阿里巴巴-SW", "3690": "美團-W", "9618": "京東集團-SW", "1810": "小米集團-W",
  "0005": "滙豐控股", "2318": "中國平安", "1299": "友邦保險", "0388": "香港交易所", "0939": "建設銀行",
  "0883": "中國海洋石油", "0857": "中國石油股份", "2628": "中國人壽", "1088": "中國神華", "0386": "中國石油化工股份",
  "1211": "比亞迪股份", "9866": "蔚來-SW", "2015": "理想汽車-W", "0175": "吉利汽車", "1958": "北京汽車",
  "0941": "中國移動", "0762": "中國聯通", "0006": "電能實業", "0002": "中電控股", "1038": "長江基建集團",
};

const BULLISH_KEYWORDS_HK = [
  "盈喜", "扭虧為盈", "利潤激增", "營收超預期", "毛利率飆升", "交付量創新高", "訂單爆滿",
  "淨利增長", "業績亮眼", "突破", "出海", "大模型", "回購", "增持", "派息", "上調目標價",
];

// ============================================================
// INTERFACES
// ============================================================

export interface HKRecommendation {
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
  expectedProfitHKD: number;
  capitalAllocatedHKD: number;
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

  confidence: number;
  riskRewardRatio: number;
  isCounterTrend: boolean;
  debugReason?: string;
}

export interface HKScanResult {
  recommendations: HKRecommendation[];
  scanTime: string;
  hkTime: string;
  marketPhase: string;
  indexChangePercent: number;
  totalScanned: number;
  stage1Candidates: number;
  stage2Candidates: number;
  stage3Candidates: number;
  stage4Candidates: number;
  isDownMarket: boolean;
  marketClosedNotice?: string;
}

// ============================================================
// UTILS
// ============================================================

/**
 * 港股交易時段判斷（已經係香港時間，唔需要時區轉換）
 * 港股交易時段：09:30-12:00（早市）, 13:00-16:00（午市），週一至五
 */
function getHKMarketTimeInfo() {
  const hktString = new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong", hour12: false });
  const now = new Date(hktString);
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay(); // 0=Sunday, 6=Saturday
  const timeStr = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const totalMinutes = hour * 60 + minute;

  const morningOpen = 9 * 60 + 30;   // 09:30
  const morningClose = 12 * 60;       // 12:00
  const afternoonOpen = 13 * 60;      // 13:00
  const afternoonClose = 16 * 60;     // 16:00
  const openingWindowEnd = 9 * 60 + 45; // 開市動量階段：09:30-09:45

  let marketPhase = "closed";
  let isTradingDay = isWeekday;

  if (isWeekday) {
    if (totalMinutes >= morningOpen && totalMinutes < openingWindowEnd) {
      marketPhase = "opening-hour";
    } else if (
      (totalMinutes >= openingWindowEnd && totalMinutes < morningClose) ||
      (totalMinutes >= afternoonOpen && totalMinutes < afternoonClose)
    ) {
      marketPhase = "active-session";
    } else if (totalMinutes >= morningClose && totalMinutes < afternoonOpen) {
      marketPhase = "lunch-break";
    } else {
      marketPhase = "closed-analysis"; // 收市後但仍可分析
    }
  } else {
    marketPhase = "market-closed-weekend";
    isTradingDay = false;
  }

  return { hour, minute, timeStr, marketPhase, isTradingDay, dayOfWeek };
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

function hasBullishNews(news: { title: string }[]): boolean {
  if (news.length === 0) return false;
  for (const item of news) {
    for (const keyword of BULLISH_KEYWORDS_HK) {
      if (item.title.includes(keyword)) return true;
    }
  }
  return false;
}

/**
 * TODO: 港股新聞源未接通。
 * 暫時回傳空陣列，等於 Stage 3（利好新聞爆破）永遠唔會觸發。
 * 將來可以接 AAStocks RSS、東方財經新聞 API，或者其他中文財經新聞源，
 * 然後將呢個函數改成真正攞新聞，介面同美股版 getUSStockNews 一致。
 */
async function getHKStockNews(symbol: string): Promise<{ title: string; url?: string }[]> {
  return [];
}

function getTickSize(price: number): number {
  // 港股tick size按價格分級（簡化版，主要價格帶）
  if (price < 0.25) return 0.001;
  if (price < 0.5) return 0.005;
  if (price < 10) return 0.01;
  if (price < 20) return 0.02;
  if (price < 100) return 0.05;
  if (price < 200) return 0.1;
  if (price < 500) return 0.2;
  return 0.5;
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
    return { resistanceLevel: currentPrice + atr * 1.2, source: "ATR Projection (Insufficient Data)" };
  }

  const last3Days = candles.slice(-3);
  const threeDayHigh = Math.max(...last3Days.map((c) => c.high));
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

function validateProfitFeasibilityHK(
  currentPrice: number,
  takeProfitPrice: number,
  thresholdSoftenerActive: boolean
): { feasible: boolean; sharesCanBuy: number; expectedProfitHKD: number; capitalAllocatedHKD: number; lotSize: number; reason: string } {
  // 港股一手股數因股票而異，呢度簡化做1手=1股，方便計算；
  // 實際下單時要按交易所公佈嘅每手股數調整（例如騰訊一手100股）。
  const lotSize = 1;
  const capital = capitalPerPositionHKD;

  let currentMinTargetProfit = minTargetProfitPerStockHKD;
  if (thresholdSoftenerActive) {
    currentMinTargetProfit *= 0.8;
  }

  const sharesCanBuy = Math.floor(capital / currentPrice);
  if (sharesCanBuy === 0) {
    return { feasible: false, sharesCanBuy: 0, expectedProfitHKD: 0, capitalAllocatedHKD: 0, lotSize, reason: `資金(${capital.toFixed(0)} HKD)不足以買1股` };
  }

  const expectedProfitHKD = (takeProfitPrice - currentPrice) * sharesCanBuy;
  const tickSize = getTickSize(currentPrice);
  const ticksAvailable = Math.floor((takeProfitPrice - currentPrice) / tickSize);

  let feasible = expectedProfitHKD >= currentMinTargetProfit && ticksAvailable >= 1;
  let reason = feasible ? "符合利潤要求" : `預期利潤(${expectedProfitHKD.toFixed(0)} HKD)未達${currentMinTargetProfit.toFixed(0)} HKD門檻`;

  if (feasible && currentPrice > 50) {
    const profitPercentage = (takeProfitPrice - currentPrice) / currentPrice;
    if (profitPercentage < 0.01) {
      feasible = false;
      reason = `高價股(>${currentPrice.toFixed(2)} HKD)利潤百分比(${(profitPercentage * 100).toFixed(2)}%)低於1.0%門檻`;
    }
  }

  return { feasible, sharesCanBuy, expectedProfitHKD, capitalAllocatedHKD: feasible ? capital : 0, lotSize, reason };
}

interface HKStockDataBundle {
  quote: Quote;
  candles: Candle[];
  indicators: Indicators;
  news: { title: string; url?: string }[];
  volumeRatio: number;
  volumeSpike: boolean;
}

async function analyzeHKStock(symbol: string): Promise<HKStockDataBundle | null> {
  try {
    const quote = await hkStockData.fetchQuote(symbol);
    if (!quote || quote.price <= 0) return null;

    const candles = await hkStockData.fetchHistoricalData(symbol, "3mo");
    if (candles.length < 20) return null;

    const indicators = hkStockData.calculateIndicators(candles);
    const news = await getHKStockNews(symbol);

    const todayVolume = candles[candles.length - 1]?.volume || 0;
    const past5DaysVolumes = candles.slice(-6, -1).map((c) => c.volume);
    const avgPast5DaysVolume = past5DaysVolumes.length > 0 ? past5DaysVolumes.reduce((a, b) => a + b, 0) / past5DaysVolumes.length : 1;
    const volumeRatio = avgPast5DaysVolume > 0 ? todayVolume / avgPast5DaysVolume : 0;
    const volumeSpike = volumeRatio > 1.3;

    return { quote, candles, indicators, news, volumeRatio, volumeSpike };
  } catch (error) {
    console.error(`[HK Scanner] Error analyzing ${symbol}:`, error);
    return null;
  }
}

function buildHKRecommendation(
  symbol: string,
  data: HKStockDataBundle,
  stage: 1 | 2 | 3 | 4,
  stageLabel: string,
  triggerReason: string,
  indexChangePercent: number,
  isResonance: boolean,
  thresholdSoftenerActive: boolean
): { recommendation: HKRecommendation | null; debugReason: string } {
  const { quote, indicators, candles, news, volumeRatio, volumeSpike } = data;
  const currentPrice = quote.price;
  const prevClose = candles[candles.length - 2]?.close || currentPrice;
  const changePercent = (currentPrice - prevClose) / prevClose;
  const stockName = HK_STOCK_NAMES[symbol] || symbol;

  let debugReason = "";

  // 核心鐵律: 短炒股票當日必須是升緊嘅，且強於大市
  if (changePercent <= 0 || changePercent <= indexChangePercent) {
    debugReason = `相對強度檢查未通過：股票變動(${(changePercent * 100).toFixed(2)}%)未強於指數(${(indexChangePercent * 100).toFixed(2)}%)或非正數`;
    return { recommendation: null, debugReason };
  }

  // 防止追高: 升幅超過 8% 跳過
  if (changePercent > 0.08) {
    debugReason = `過熱: 已升${(changePercent * 100).toFixed(1)}%，跳過今日推介`;
    return { recommendation: null, debugReason };
  }

  const closes = candles.map((c) => c.close).filter((c) => c > 0);
  const ema10 = closes.length >= 10 ? calculateEMA(closes, 10) : 0;
  const atrPercent = currentPrice > 0 ? (indicators.atr / currentPrice) * 100 : 0;

  const { resistanceLevel, source: resistanceSource } = calculateResistance(candles, currentPrice, indicators.atr);
  const takeProfitPrice = currentPrice + indicators.atr * 0.5;
  const stopLossDistance = Math.max(indicators.atr * 0.7, currentPrice * 0.02);
  const stopLossPrice = currentPrice - stopLossDistance;

  const feasibilityInfo = validateProfitFeasibilityHK(currentPrice, takeProfitPrice, thresholdSoftenerActive);
  if (!feasibilityInfo.feasible) {
    debugReason = `利潤可行性檢查未通過: ${feasibilityInfo.reason}`;
    return { recommendation: null, debugReason };
  }

  const isCounterTrend = indexChangePercent <= HK_CONFIG.downMarketThreshold &&
    (changePercent - indexChangePercent) >= HK_CONFIG.counterTrendRelativeStrength;

  if (isCounterTrend) {
    triggerReason = "💎逆市抗跌股 | " + triggerReason;
  }

  let confidence = 50;
  if (changePercent > 0) confidence += 5;
  if (changePercent > 0.01) confidence += 5;
  if (indicators.rsi >= 50 && indicators.rsi <= 70) confidence += 10;
  if (indicators.macd > indicators.macdSignal) confidence += 10;
  if (currentPrice > ema10) confidence += 5;
  if (currentPrice > indicators.ema20) confidence += 5;
  if (atrPercent >= 2) confidence += 5;
  if (feasibilityInfo.feasible) confidence += 10;

  if (indexChangePercent < 0 && changePercent > 0) {
    triggerReason = "🔥 逆市強勢港股 | " + triggerReason;
    confidence += 15;
  }
  if (isCounterTrend) confidence += 10;

  if (volumeSpike) {
    triggerReason += " | 爆量異動";
    confidence += 10;
  }

  if (hasBullishNews(news)) {
    triggerReason += " | 利好新聞爆破";
    confidence += 15;
  }

  if (isResonance) confidence = 100;

  if (thresholdSoftenerActive) {
    if (indicators.rsi > 45) {
      confidence += 5;
    } else {
      debugReason = `降維試槍模式: RSI(${indicators.rsi.toFixed(0)})未高於45`;
      return { recommendation: null, debugReason };
    }
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
      expectedProfitHKD: feasibilityInfo.expectedProfitHKD,
      capitalAllocatedHKD: feasibilityInfo.capitalAllocatedHKD,
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

      confidence,
      riskRewardRatio,
      isCounterTrend,
      debugReason,
    },
    debugReason,
  };
}

// ============================================================
// MAIN SCANNER FUNCTION
// ============================================================

export async function runHKScannerV1(thresholdSoftenerActive: boolean = false): Promise<HKScanResult> {
  if (cachedHKScanResult && Date.now() - cachedHKScanResult.timestamp < HK_SCAN_CACHE_TTL_MS) {
    return cachedHKScanResult.result;
  }

  const startTime = Date.now();
  const timeInfo = getHKMarketTimeInfo();

  console.log(`[HK Scanner V1] ====== 港股短炒推介引擎啟動 ======`);
  console.log(`[HK Scanner V1] 目前時間: ${timeInfo.timeStr}, 市場階段: ${timeInfo.marketPhase}, 交易日: ${timeInfo.isTradingDay}`);

  if (!timeInfo.isTradingDay) {
    const closedResult: HKScanResult = {
      recommendations: [],
      scanTime: new Date().toISOString(),
      hkTime: timeInfo.timeStr,
      marketPhase: timeInfo.marketPhase,
      indexChangePercent: 0,
      totalScanned: 0,
      stage1Candidates: 0,
      stage2Candidates: 0,
      stage3Candidates: 0,
      stage4Candidates: 0,
      isDownMarket: false,
      marketClosedNotice: "港股今日休市（週末），請於交易日（週一至五 09:30-16:00）再嘗試掃描。",
    };
    cachedHKScanResult = { result: closedResult, timestamp: Date.now() };
    return closedResult;
  }

  console.log(`[HK Scanner V1] 單注資金: HK$${capitalPerPositionHKD.toFixed(0)}, 最低目標利潤: HK$${minTargetProfitPerStockHKD.toFixed(0)}/股`);

  // 恒生指數變幅（用作大市基準）
  const hsiQuote = await hkStockData.fetchQuote("HSI");
  let indexChangePercent = 0;
  if (hsiQuote) {
    indexChangePercent = hsiQuote.changePercent;
  }
  console.log(`[HK Scanner V1] 恒生指數今日變幅: ${(indexChangePercent * 100).toFixed(2)}%`);

  const isDownMarket = indexChangePercent <= HK_CONFIG.downMarketThreshold;
  if (isDownMarket) {
    console.log(`[HK Scanner V1] ⚠️ 大市跌市模式啟動，優先推介逆市抗跌股`);
  }

  // Step 1: 批量攞數據（盡量減少API call次數，夾返iTick 5次/分鐘嘅限制）
  // 策略：1次批量quote + 1次批量klines = 2次API call搞掂全部25隻股票
  const stockData = new Map<string, HKStockDataBundle | null>();

  console.log(`[HK Scanner V1] 開始批量獲取港股數據（節省API call）...`);

  // 批量報價（1次call攞晒所有stock嘅quote）
  const batchQuotes = await hkStockData.fetchBatchQuotes(HK_STOCK_UNIVERSE);
  console.log(`[HK Scanner V1] 批量報價完成，攞到 ${batchQuotes.size} 隻`);

  // 批量歷史K線（1次call攞晒所有stock嘅klines）
  const batchHistorical = await hkStockData.fetchBatchHistoricalData(HK_STOCK_UNIVERSE, "3mo");
  console.log(`[HK Scanner V1] 批量K線完成，攞到 ${batchHistorical.size} 隻`);

  // 組裝成 stockData map
  for (const symbol of HK_STOCK_UNIVERSE) {
    const normalizedCode = symbol.replace(/^0+/, "") || "0";
    const quote = batchQuotes.get(normalizedCode) || batchQuotes.get(symbol);
    const candles = batchHistorical.get(normalizedCode) || batchHistorical.get(symbol) || [];

    if (!quote || quote.price <= 0 || candles.length < 20) {
      stockData.set(symbol, null);
      continue;
    }

    const indicators = hkStockData.calculateIndicators(candles);
    const todayVolume = candles[candles.length - 1]?.volume || 0;
    const past5DaysVolumes = candles.slice(-6, -1).map((c) => c.volume);
    const avgPast5DaysVolume = past5DaysVolumes.length > 0
      ? past5DaysVolumes.reduce((a, b) => a + b, 0) / past5DaysVolumes.length : 1;
    const volumeRatio = avgPast5DaysVolume > 0 ? todayVolume / avgPast5DaysVolume : 0;
    const volumeSpike = volumeRatio > 1.3;

    stockData.set(symbol, {
      quote,
      candles,
      indicators,
      news: [], // 港股新聞暫時stub
      volumeRatio,
      volumeSpike,
    });
  }

  console.log(`[HK Scanner V1] 已獲取 ${stockData.size} 隻港股數據`);

  // 板塊共振檢查（僅喺開市初段檢查）
  const resonanceStocks = new Set<string>();
  if (timeInfo.marketPhase === "opening-hour") {
    for (const sectorName in HK_SECTORS) {
      const symbolsInSector = HK_SECTORS[sectorName];
      let sectorSpikesCount = 0;

      for (const symbol of symbolsInSector) {
        const data = stockData.get(symbol);
        if (!data) continue;
        const { quote, volumeSpike } = data;
        const currentPrice = quote.price;
        const prevClose = data.candles[data.candles.length - 2]?.close || currentPrice;
        const changePercent = ((currentPrice - prevClose) / prevClose) * 100;
        if (changePercent > 3 && volumeSpike) sectorSpikesCount++;
      }

      if (sectorSpikesCount >= 2) {
        console.log(`[HK Scanner V1] 🔥 板塊共振觸發: ${sectorName}`);
        for (const sSymbol of symbolsInSector) resonanceStocks.add(sSymbol);
      }
    }
  }

  const recommendations: HKRecommendation[] = [];
  const rejectedStocks: { symbol: string; reason: string }[] = [];

  let stage1Count = 0, stage2Count = 0, stage3Count = 0, stage4Count = 0;

  for (const symbol of HK_STOCK_UNIVERSE) {
    const data = stockData.get(symbol);
    if (!data) {
      rejectedStocks.push({ symbol, reason: "無數據" });
      continue;
    }

    let result: { recommendation: HKRecommendation | null; debugReason: string };

    // Stage 3: 利好新聞爆破（暫時 stub，news永遠空，唔會觸發）
    if (hasBullishNews(data.news)) {
      result = buildHKRecommendation(symbol, data, 3, "利好新聞爆破", `利好新聞: ${data.news[0].title}`, indexChangePercent, resonanceStocks.has(symbol), thresholdSoftenerActive);
      if (result.recommendation) {
        recommendations.push(result.recommendation);
        stage3Count++;
        continue;
      } else {
        rejectedStocks.push({ symbol, reason: `Stage3失敗: ${result.debugReason}` });
      }
    }

    // Stage 2: 開市動量
    if (timeInfo.marketPhase === "opening-hour") {
      result = buildHKRecommendation(symbol, data, 2, "開市動量", `今日漲幅 ${(data.quote.changePercent * 100).toFixed(2)}%`, indexChangePercent, resonanceStocks.has(symbol), thresholdSoftenerActive);
      if (result.recommendation) {
        recommendations.push(result.recommendation);
        stage2Count++;
        continue;
      } else {
        rejectedStocks.push({ symbol, reason: `Stage2失敗: ${result.debugReason}` });
      }
    }

    // Stage 1: 板塊共振
    if (resonanceStocks.has(symbol)) {
      const sectorName = Object.keys(HK_SECTORS).find((key) => HK_SECTORS[key].includes(symbol)) || "未知板塊";
      result = buildHKRecommendation(symbol, data, 1, "板塊共振", `🔥${sectorName}板塊資金湧入，共振爆發！`, indexChangePercent, true, thresholdSoftenerActive);
      if (result.recommendation) {
        recommendations.push(result.recommendation);
        stage1Count++;
        continue;
      } else {
        rejectedStocks.push({ symbol, reason: `Stage1失敗: ${result.debugReason}` });
      }
    }

    // Stage 4: 保底篩選
    result = buildHKRecommendation(symbol, data, 4, "保底篩選", "技術面覆盤", indexChangePercent, resonanceStocks.has(symbol), thresholdSoftenerActive);
    if (result.recommendation) {
      recommendations.push(result.recommendation);
      stage4Count++;
    } else {
      rejectedStocks.push({ symbol, reason: `Stage4失敗: ${result.debugReason}` });
    }
  }

  // 跌市優先逆市抗跌股，再按預期利潤/信心排序
  const finalRecommendations = recommendations
    .sort((a, b) => {
      if (isDownMarket) {
        if (a.isCounterTrend && !b.isCounterTrend) return -1;
        if (!a.isCounterTrend && b.isCounterTrend) return 1;
      }
      return b.expectedProfitHKD - a.expectedProfitHKD || b.confidence - a.confidence;
    })
    .slice(0, HK_CONFIG.positionsCount);

  const elapsed = Date.now() - startTime;
  console.log(`[HK Scanner V1] ====== 掃描完成: ${finalRecommendations.length} 隻港股在 ${elapsed}ms 內推薦 ======`);
  for (const rec of finalRecommendations) {
    console.log(`[HK Scanner V1] → ${rec.symbol}(${rec.stockName}): 信心${rec.confidence}%, 預期利潤HK$${rec.expectedProfitHKD.toFixed(0)}, 逆市股=${rec.isCounterTrend}`);
  }

  const finalResult: HKScanResult = {
    recommendations: finalRecommendations,
    scanTime: new Date().toISOString(),
    hkTime: timeInfo.timeStr,
    marketPhase: timeInfo.marketPhase,
    indexChangePercent,
    totalScanned: stockData.size,
    stage1Candidates: stage1Count,
    stage2Candidates: stage2Count,
    stage3Candidates: stage3Count,
    stage4Candidates: stage4Count,
    isDownMarket,
  };

  cachedHKScanResult = { result: finalResult, timestamp: Date.now() };
  return finalResult;
}
