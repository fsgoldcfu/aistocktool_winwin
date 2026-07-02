/**
 * lib/midtermScanner.ts
 *
 * 美股中短線選股引擎
 *
 * 同短炒系統(usScannerV3_7.ts)最大分別：
 * - 唔係每日都有推介，等強力催化劑先出訊號
 * - 持倉目標 1-4 週
 * - 止盈分兩批（+10% 先出一半，+20% 出另一半）
 * - 止損 -7%（比短炒寬鬆）
 *
 * 三大買入觸發條件：
 * 1. 業績前低吸：距出業績 3-14 日，過去慣性 beat，股價未被炒起
 * 2. 強股回調低吸：52週強勢股，近期因大市調整回落到超賣區
 * 3. 板塊主題爆發：板塊連續跑贏大市，龍頭股突破
 */

import { yfinanceData } from "./yfinanceData";
import {
  getUpcomingEarnings,
  isEarningsOpportunity,
  type EarningsEvent,
} from "./earningsCalendar";

// ==================== Cache ====================
let cachedMidtermResult: { result: MidtermScanResult; timestamp: number } | null = null;
const MIDTERM_CACHE_TTL_MS = 60 * 60 * 1000; // 1小時cache（中短線唔需要15分鐘咁頻繁）

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== 股票池 ====================
// 中短線用嘅股票池，比短炒更廣，涵蓋更多板塊
const MIDTERM_SECTORS: Record<string, string[]> = {
  "AI半導體": ["NVDA", "AMD", "AVGO", "MU", "MRVL", "QCOM", "AMAT", "LRCX"],
  "科技巨頭": ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "TSLA"],
  "AI應用與雲端": ["PLTR", "SNOW", "NET", "CRWD", "DDOG", "ZS", "MDB", "HUBS"],
  "加密與金融科技": ["COIN", "MSTR", "HOOD", "SQ", "PYPL"],
  "生物醫藥": ["LLY", "MRNA", "NVO", "REGN", "VRTX", "GILD", "BIIB"],
  "中概股": ["BABA", "PDD", "BIDU", "NIO", "XPEV", "LI"],
  "消費與零售": ["AMZN", "COST", "TGT", "WMT"],
  "能源與材料": ["XOM", "CVX", "FCX", "NEM"],
};

const MIDTERM_UNIVERSE: string[] = Array.from(new Set(Object.values(MIDTERM_SECTORS).flat()));

const MIDTERM_STOCK_NAMES: Record<string, string> = {
  "NVDA": "NVIDIA", "AMD": "Advanced Micro Devices", "AVGO": "Broadcom",
  "MU": "Micron Technology", "MRVL": "Marvell Technology", "QCOM": "Qualcomm",
  "AMAT": "Applied Materials", "LRCX": "Lam Research",
  "AAPL": "Apple", "MSFT": "Microsoft", "GOOGL": "Alphabet",
  "META": "Meta Platforms", "AMZN": "Amazon", "TSLA": "Tesla",
  "PLTR": "Palantir", "SNOW": "Snowflake", "NET": "Cloudflare",
  "CRWD": "CrowdStrike", "DDOG": "Datadog", "ZS": "Zscaler",
  "MDB": "MongoDB", "HUBS": "HubSpot",
  "COIN": "Coinbase", "MSTR": "MicroStrategy", "HOOD": "Robinhood",
  "SQ": "Block", "PYPL": "PayPal",
  "LLY": "Eli Lilly", "MRNA": "Moderna", "NVO": "Novo Nordisk",
  "REGN": "Regeneron", "VRTX": "Vertex", "GILD": "Gilead",
  "BIIB": "Biogen",
  "BABA": "Alibaba", "PDD": "PDD Holdings", "BIDU": "Baidu",
  "NIO": "NIO", "XPEV": "XPeng", "LI": "Li Auto",
  "COST": "Costco", "TGT": "Target", "WMT": "Walmart",
  "XOM": "ExxonMobil", "CVX": "Chevron", "FCX": "Freeport-McMoRan",
  "NEM": "Newmont",
};

// ==================== 觸發條件類型 ====================
type TriggerType = "EARNINGS_DIP" | "STRONG_STOCK_PULLBACK" | "SECTOR_BREAKOUT";

export interface MidtermRecommendation {
  symbol: string;
  stockName: string;
  currentPrice: number;
  changePercent: number;

  triggerType: TriggerType;
  triggerLabel: string;
  triggerReason: string;           // 詳細原因，用於 Email 通知

  // 分批止盈
  takeProfitA: number;             // 第一批止盈（50%倉位）
  takeProfitAPercent: number;
  takeProfitB: number;             // 第二批止盈（50%倉位）
  takeProfitBPercent: number;
  stopLoss: number;
  stopLossPercent: number;

  // 資金建議（中短線每注較大）
  suggestedCapitalHKD: number;
  expectedProfitAHKD: number;     // 到第一批止盈嘅預期利潤
  expectedProfitBHKD: number;     // 到第二批止盈嘅預期利潤

  // 技術面
  rsi: number;
  weekHigh52: number;
  weekLow52: number;
  distanceFrom52WeekHigh: number; // 距52週高位跌咗幾多%

  // 業績相關（僅EARNINGS_DIP有）
  earningsDaysUntil?: number;
  earningsBeatCount?: number;

  confidence: number;
  holdingPeriod: string;          // 建議持倉時間
  sector: string;
}

export interface MidtermScanResult {
  recommendations: MidtermRecommendation[];
  scanTime: string;
  totalScanned: number;
  earningsDipCount: number;
  pullbackCount: number;
  sectorBreakoutCount: number;
  hasNewSignals: boolean;         // 用於判斷係咪要發 Email
}

// ==================== 資金配置 ====================
const HKD_RATE = 7.8;
const MIDTERM_CAPITAL_PER_POSITION_HKD = 80000; // 每注 HK$80,000
const MIDTERM_MAX_POSITIONS = 3;

// ==================== 核心分析 ====================

interface StockMetrics {
  currentPrice: number;
  changePercent: number;
  rsi: number;
  ema20: number;
  ema50: number;
  atr: number;
  weekHigh52: number;
  weekLow52: number;
  twentyDayLow: number;
  twentyDayHigh: number;
  volumeRatio: number;
}

async function getStockMetrics(symbol: string): Promise<StockMetrics | null> {
  try {
    const quote = await yfinanceData.fetchQuote(symbol);
    if (!quote || quote.price <= 0) return null;

    const candles = await yfinanceData.fetchHistoricalData(symbol, "1y");
    if (candles.length < 50) return null;

    await sleep(500); // 輕微節流

    const indicators = yfinanceData.calculateIndicators(candles);
    const closes = candles.map((c: any) => c.close);

    // 52週高低
    const weekHigh52 = Math.max(...closes);
    const weekLow52 = Math.min(...closes);

    // 20日高低（判斷短期位置）
    const last20 = closes.slice(-20);
    const twentyDayLow = Math.min(...last20);
    const twentyDayHigh = Math.max(...last20);

    // 成交量比率
    const todayVolume = candles[candles.length - 1]?.volume || 0;
    const avgVolume = candles.slice(-20).map((c: any) => c.volume).reduce((a: number, b: number) => a + b, 0) / 20;
    const volumeRatio = avgVolume > 0 ? todayVolume / avgVolume : 0;

    return {
      currentPrice: quote.price,
      changePercent: quote.changePercent,
      rsi: indicators.rsi,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      atr: indicators.atr,
      weekHigh52,
      weekLow52,
      twentyDayLow,
      twentyDayHigh,
      volumeRatio,
    };
  } catch (error) {
    console.error(`[Midterm] getStockMetrics error for ${symbol}:`, error);
    return null;
  }
}

function getSector(symbol: string): string {
  for (const [sector, symbols] of Object.entries(MIDTERM_SECTORS)) {
    if (symbols.includes(symbol)) return sector;
  }
  return "其他";
}

function buildMidtermRecommendation(
  symbol: string,
  metrics: StockMetrics,
  triggerType: TriggerType,
  triggerLabel: string,
  triggerReason: string,
  confidence: number,
  earningsData?: { daysUntil: number; beatCount: number }
): MidtermRecommendation {
  const { currentPrice } = metrics;

  // 中短線止盈止損（固定百分比，唔用ATR）
  const takeProfitAPercent = 10;
  const takeProfitBPercent = 20;
  const stopLossPercent = -7;

  const takeProfitA = currentPrice * (1 + takeProfitAPercent / 100);
  const takeProfitB = currentPrice * (1 + takeProfitBPercent / 100);
  const stopLoss = currentPrice * (1 + stopLossPercent / 100);

  // 資金計算（每注 HK$80,000，分兩批止盈）
  const sharesCanBuy = Math.floor(MIDTERM_CAPITAL_PER_POSITION_HKD / HKD_RATE / currentPrice);
  const halfShares = Math.floor(sharesCanBuy / 2);
  const expectedProfitAHKD = (takeProfitA - currentPrice) * halfShares * HKD_RATE;
  const expectedProfitBHKD = expectedProfitAHKD + (takeProfitB - currentPrice) * halfShares * HKD_RATE;

  const distanceFrom52WeekHigh = ((metrics.weekHigh52 - currentPrice) / metrics.weekHigh52) * 100;

  return {
    symbol,
    stockName: MIDTERM_STOCK_NAMES[symbol] || symbol,
    currentPrice,
    changePercent: metrics.changePercent,

    triggerType,
    triggerLabel,
    triggerReason,

    takeProfitA,
    takeProfitAPercent,
    takeProfitB,
    takeProfitBPercent,
    stopLoss,
    stopLossPercent: Math.abs(stopLossPercent),

    suggestedCapitalHKD: MIDTERM_CAPITAL_PER_POSITION_HKD,
    expectedProfitAHKD,
    expectedProfitBHKD,

    rsi: metrics.rsi,
    weekHigh52: metrics.weekHigh52,
    weekLow52: metrics.weekLow52,
    distanceFrom52WeekHigh,

    earningsDaysUntil: earningsData?.daysUntil,
    earningsBeatCount: earningsData?.beatCount,

    confidence,
    holdingPeriod: triggerType === "EARNINGS_DIP" ? "業績後視情況，通常 1-3 週" : "2-4 週",
    sector: getSector(symbol),
  };
}

// ==================== 三大篩選條件 ====================

/**
 * 條件一：業績前低吸
 * 距出業績 3-14 日 + 過去慣性 beat + 股價近低位
 */
async function checkEarningsDip(
  symbol: string,
  metrics: StockMetrics,
  upcomingEarnings: EarningsEvent[]
): Promise<MidtermRecommendation | null> {
  const opportunity = await isEarningsOpportunity(
    symbol,
    metrics.currentPrice,
    metrics.twentyDayLow,
    upcomingEarnings
  );

  if (!opportunity.isOpportunity) return null;

  // 額外條件：RSI 唔好太高（唔係追高）
  if (metrics.rsi > 65) return null;

  let confidence = 70;
  if (opportunity.beatCount >= 4) confidence += 15; // 4季全部beat
  if (metrics.rsi < 45) confidence += 10;           // 超賣
  if (metrics.volumeRatio > 1.5) confidence += 5;   // 成交量異動

  confidence = Math.min(confidence, 95);

  return buildMidtermRecommendation(
    symbol, metrics,
    "EARNINGS_DIP",
    "📊 業績前低吸",
    `距出業績 ${opportunity.daysUntil} 日｜過去 ${opportunity.beatCount}/4 季 beat 預期｜股價近近期低位｜RSI ${metrics.rsi.toFixed(0)}`,
    confidence,
    { daysUntil: opportunity.daysUntil, beatCount: opportunity.beatCount }
  );
}

/**
 * 條件二：強股回調低吸
 * 52週強勢（距高位跌 15-35%）+ RSI 超賣 + 大市整體唔係熊市
 */
function checkStrongStockPullback(
  symbol: string,
  metrics: StockMetrics,
  indexChangePercent: number
): MidtermRecommendation | null {
  // 距52週高位跌咗 15-40%（太多可能係爛咗，太少唔夠便宜）
  const distanceFromHigh = ((metrics.weekHigh52 - metrics.currentPrice) / metrics.weekHigh52) * 100;
  if (distanceFromHigh < 15 || distanceFromHigh > 45) return null;

  // RSI 進入超賣區（35-50）— 唔用太低因為強股RSI通常唔會跌穿30
  if (metrics.rsi < 30 || metrics.rsi > 52) return null;

  // 股價仍然高於52週低位（唔係真係爛）
  const distanceFromLow = ((metrics.currentPrice - metrics.weekLow52) / metrics.weekLow52) * 100;
  if (distanceFromLow < 10) return null;

  // 大市唔係持續大跌（唔係熊市入場）
  if (indexChangePercent < -0.02) return null;

  // 股價係20日低位附近（確認係近期低位）
  const nearTwentyDayLow = metrics.currentPrice <= metrics.twentyDayLow * 1.08;
  if (!nearTwentyDayLow) return null;

  let confidence = 65;
  if (distanceFromHigh >= 20 && distanceFromHigh <= 35) confidence += 10; // 最佳回調區間
  if (metrics.rsi >= 35 && metrics.rsi <= 45) confidence += 10;           // 最佳RSI區間
  if (metrics.volumeRatio < 0.8) confidence += 5;                          // 縮量回調更健康

  confidence = Math.min(confidence, 90);

  return buildMidtermRecommendation(
    symbol, metrics,
    "STRONG_STOCK_PULLBACK",
    "💪 強股回調低吸",
    `距52週高位 $${metrics.weekHigh52.toFixed(2)} 回調 ${distanceFromHigh.toFixed(1)}%｜RSI ${metrics.rsi.toFixed(0)} 進入超賣｜股價近20日低位 $${metrics.twentyDayLow.toFixed(2)}`,
    confidence
  );
}

/**
 * 條件三：板塊主題爆發
 * 板塊內多隻股票同時突破 + 龍頭股走勢強
 */
function checkSectorBreakout(
  symbol: string,
  metrics: StockMetrics,
  sectorStrongCount: number,
  sectorName: string
): MidtermRecommendation | null {
  // 板塊至少 3 隻股票今日升幅 > 1.5%
  if (sectorStrongCount < 3) return null;

  // 個股本身今日要升
  if (metrics.changePercent <= 0.005) return null;

  // RSI 唔好太高（唔係已經高追）
  if (metrics.rsi > 70) return null;

  // 股價係近期高位突破（唔係在底部無力反彈）
  const nearHighBreakout = metrics.currentPrice >= metrics.twentyDayHigh * 0.97;
  if (!nearHighBreakout) return null;

  let confidence = 68;
  if (sectorStrongCount >= 4) confidence += 10;
  if (metrics.changePercent > 0.02) confidence += 7;
  if (metrics.volumeRatio > 1.5) confidence += 8;

  confidence = Math.min(confidence, 92);

  return buildMidtermRecommendation(
    symbol, metrics,
    "SECTOR_BREAKOUT",
    "🚀 板塊主題爆發",
    `${sectorName} 板塊今日 ${sectorStrongCount} 隻股票同步走強｜${symbol} 突破近期高位 $${metrics.twentyDayHigh.toFixed(2)}｜成交量放大 ${metrics.volumeRatio.toFixed(1)}x`,
    confidence
  );
}

// ==================== MAIN SCANNER ====================

export async function runMidtermScanner(forceRefresh: boolean = false): Promise<MidtermScanResult> {
  if (!forceRefresh && cachedMidtermResult && Date.now() - cachedMidtermResult.timestamp < MIDTERM_CACHE_TTL_MS) {
    console.log("[Midterm] 使用 Cache 結果");
    return cachedMidtermResult.result;
  }

  const startTime = Date.now();
  console.log("[Midterm Scanner] ====== 中短線選股引擎啟動 ======");

  // 1. 攞大市基準（QQQ 代替納指）
  const qqq = await yfinanceData.fetchQuote("QQQ");
  const indexChangePercent = qqq?.changePercent || 0;
  console.log(`[Midterm] QQQ 今日變幅: ${(indexChangePercent * 100).toFixed(2)}%`);

  // 2. 攞未來14日業績日曆（一次過，之後逐隻股票用）
  const upcomingEarnings = await getUpcomingEarnings(14);
  console.log(`[Midterm] 未來14日有 ${upcomingEarnings.length} 隻股票出業績`);

  // 3. 逐隻股票攞數據（用Twelve Data，要節流）
  const allMetrics = new Map<string, StockMetrics | null>();
  const THROTTLE_MS = 9000; // 配合 Twelve Data 節流

  for (let i = 0; i < MIDTERM_UNIVERSE.length; i++) {
    const symbol = MIDTERM_UNIVERSE[i];
    const metrics = await getStockMetrics(symbol);
    allMetrics.set(symbol, metrics);
    if (i < MIDTERM_UNIVERSE.length - 1) await sleep(THROTTLE_MS);
  }

  // 4. 計算各板塊今日強勢股數量（用於板塊爆發判斷）
  const sectorStrengthMap = new Map<string, number>();
  for (const [sectorName, symbols] of Object.entries(MIDTERM_SECTORS)) {
    let strongCount = 0;
    for (const symbol of symbols) {
      const m = allMetrics.get(symbol);
      if (m && m.changePercent > 0.015) strongCount++;
    }
    sectorStrengthMap.set(sectorName, strongCount);
  }

  // 5. 逐隻股票跑三個條件
  const recommendations: MidtermRecommendation[] = [];
  let earningsDipCount = 0, pullbackCount = 0, sectorBreakoutCount = 0;

  for (const symbol of MIDTERM_UNIVERSE) {
    const metrics = allMetrics.get(symbol);
    if (!metrics) continue;

    const sector = getSector(symbol);
    const sectorStrong = sectorStrengthMap.get(sector) || 0;

    // 按優先順序逐個試，一隻股票最多一個觸發
    const earningsDip = await checkEarningsDip(symbol, metrics, upcomingEarnings);
    if (earningsDip) {
      recommendations.push(earningsDip);
      earningsDipCount++;
      continue;
    }

    const pullback = checkStrongStockPullback(symbol, metrics, indexChangePercent);
    if (pullback) {
      recommendations.push(pullback);
      pullbackCount++;
      continue;
    }

    const sectorBreakout = checkSectorBreakout(symbol, metrics, sectorStrong, sector);
    if (sectorBreakout) {
      recommendations.push(sectorBreakout);
      sectorBreakoutCount++;
    }
  }

  // 6. 排序：業績前低吸優先，之後按信心指數
  const finalRecommendations = recommendations
    .sort((a, b) => {
      if (a.triggerType === "EARNINGS_DIP" && b.triggerType !== "EARNINGS_DIP") return -1;
      if (a.triggerType !== "EARNINGS_DIP" && b.triggerType === "EARNINGS_DIP") return 1;
      return b.confidence - a.confidence;
    })
    .slice(0, MIDTERM_MAX_POSITIONS * 2); // 最多6隻供你揀，但建議最多持3注

  const elapsed = Date.now() - startTime;
  console.log(`[Midterm Scanner] 完成：${finalRecommendations.length} 個中短線機會，耗時 ${elapsed}ms`);

  for (const rec of finalRecommendations) {
    console.log(`[Midterm] → ${rec.symbol}: ${rec.triggerLabel}，信心 ${rec.confidence}%，TP1=$${rec.takeProfitA.toFixed(2)}，TP2=$${rec.takeProfitB.toFixed(2)}`);
  }

  const result: MidtermScanResult = {
    recommendations: finalRecommendations,
    scanTime: new Date().toISOString(),
    totalScanned: MIDTERM_UNIVERSE.length,
    earningsDipCount,
    pullbackCount,
    sectorBreakoutCount,
    hasNewSignals: finalRecommendations.length > 0,
  };

  cachedMidtermResult = { result, timestamp: Date.now() };
  return result;
}
