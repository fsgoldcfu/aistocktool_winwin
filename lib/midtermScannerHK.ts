/**
 * lib/midtermScannerHK.ts
 *
 * 港股中短線選股引擎
 *
 * 同美股版(midtermScanner.ts)邏輯一致，但：
 * 1. 數據源用 iTick (hkStockData.ts)
 * 2. 資金直接用 HKD，唔需要匯率換算
 * 3. 業績日期暫時stub（Finnhub唔支援港股業績日曆）
 * 4. 股票池：恒指成份股為主，共50隻
 */

import { hkStockData } from "./hkStockData";

// ==================== Cache ====================
let cachedHKMidtermResult: { result: HKMidtermScanResult; timestamp: number } | null = null;
const HK_MIDTERM_CACHE_TTL_MS = 60 * 60 * 1000; // 1小時

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== 港股股票池（50隻恒指成份股為主）====================
const HK_MIDTERM_SECTORS: Record<string, string[]> = {
  "科技與電商": ["0700", "9988", "3690", "9618", "1810", "0981", "0992", "9999"],
  "金融": ["0005", "2318", "1299", "0388", "0939", "1398", "3988", "0011"],
  "能源與資源": ["0883", "0857", "2628", "1088", "0386", "0941"],
  "新能源汽車": ["1211", "9866", "2015", "0175", "2238"],
  "醫藥健康": ["1177", "2269", "6160", "0241", "1093"],
  "地產與基建": ["0016", "0012", "1038", "0002", "0003"],
  "消費與零售": ["0291", "0762", "6862", "9961", "0151"],
  "半導體": ["0711", "1347", "6963", "0522"],
};

const HK_MIDTERM_UNIVERSE: string[] = Array.from(new Set(Object.values(HK_MIDTERM_SECTORS).flat()));

const HK_STOCK_NAMES: Record<string, string> = {
  "0700": "騰訊控股", "9988": "阿里巴巴-SW", "3690": "美團-W",
  "9618": "京東集團-SW", "1810": "小米集團-W", "0981": "中芯國際",
  "0992": "聯想集團", "9999": "網易-S",
  "0005": "滙豐控股", "2318": "中國平安", "1299": "友邦保險",
  "0388": "香港交易所", "0939": "建設銀行", "1398": "工商銀行",
  "3988": "中國銀行", "0011": "恒生銀行",
  "0883": "中國海洋石油", "0857": "中國石油股份", "2628": "中國人壽",
  "1088": "中國神華", "0386": "中國石化", "0941": "中國移動",
  "1211": "比亞迪股份", "9866": "蔚來-SW", "2015": "理想汽車-W",
  "0175": "吉利汽車", "2238": "廣汽集團",
  "1177": "中國生物製藥", "2269": "藥明生物", "6160": "百濟神州-B",
  "0241": "阿里健康", "1093": "石藥集團",
  "0016": "新鴻基地產", "0012": "恒基地產", "1038": "長江基建集團",
  "0002": "中電控股", "0003": "香港中華煤氣",
  "0291": "華潤啤酒", "0762": "中國聯通", "6862": "海底撈",
  "9961": "攜程集團-S", "0151": "中國旺旺",
  "0711": "唐錦源集團", "1347": "華虹半導體", "6963": "艾為電子",
  "0522": "ASM太平洋",
};

// ==================== 觸發條件類型 ====================
type HKTriggerType = "STRONG_STOCK_PULLBACK" | "SECTOR_BREAKOUT" | "EARNINGS_DIP";

export interface HKMidtermRecommendation {
  symbol: string;
  stockName: string;
  currentPrice: number;
  changePercent: number;

  triggerType: HKTriggerType;
  triggerLabel: string;
  triggerReason: string;

  // 分批止盈
  takeProfitA: number;
  takeProfitAPercent: number;
  takeProfitB: number;
  takeProfitBPercent: number;
  stopLoss: number;
  stopLossPercent: number;

  // 資金（直接HKD）
  suggestedCapitalHKD: number;
  sharesCanBuy: number;
  expectedProfitAHKD: number;
  expectedProfitBHKD: number;

  // 技術面
  rsi: number;
  weekHigh52: number;
  weekLow52: number;
  distanceFrom52WeekHigh: number;

  confidence: number;
  holdingPeriod: string;
  sector: string;
}

export interface HKMidtermScanResult {
  recommendations: HKMidtermRecommendation[];
  scanTime: string;
  hkTime: string;
  totalScanned: number;
  pullbackCount: number;
  sectorBreakoutCount: number;
  hasNewSignals: boolean;
}

// ==================== 資金配置 ====================
const HK_MIDTERM_CAPITAL_PER_POSITION_HKD = 80000;
const HK_MIDTERM_MAX_POSITIONS = 3;

// ==================== 股票指標 ====================
interface HKStockMetrics {
  currentPrice: number;
  changePercent: number;
  rsi: number;
  ema20: number;
  atr: number;
  weekHigh52: number;
  weekLow52: number;
  twentyDayLow: number;
  twentyDayHigh: number;
  volumeRatio: number;
}

function getSectorHK(symbol: string): string {
  const code = symbol.replace(/^0+/, "") || "0";
  for (const [sector, symbols] of Object.entries(HK_MIDTERM_SECTORS)) {
    if (symbols.includes(symbol) || symbols.includes(code)) return sector;
  }
  return "其他";
}

function getTickSizeHK(price: number): number {
  if (price < 0.25) return 0.001;
  if (price < 0.5) return 0.005;
  if (price < 10) return 0.01;
  if (price < 20) return 0.02;
  if (price < 100) return 0.05;
  if (price < 200) return 0.1;
  if (price < 500) return 0.2;
  return 0.5;
}

function roundToTick(price: number, symbol: string): number {
  const tick = getTickSizeHK(price);
  return Math.round(price / tick) * tick;
}

function buildHKMidtermRecommendation(
  symbol: string,
  metrics: HKStockMetrics,
  triggerType: HKTriggerType,
  triggerLabel: string,
  triggerReason: string,
  confidence: number
): HKMidtermRecommendation {
  const { currentPrice } = metrics;

  const takeProfitAPercent = 10;
  const takeProfitBPercent = 20;
  const stopLossPercent = 7;

  const takeProfitA = roundToTick(currentPrice * (1 + takeProfitAPercent / 100), symbol);
  const takeProfitB = roundToTick(currentPrice * (1 + takeProfitBPercent / 100), symbol);
  const stopLoss = roundToTick(currentPrice * (1 - stopLossPercent / 100), symbol);

  // 港股每手股數簡化做1股，實際落單要自己對照
  const sharesCanBuy = Math.floor(HK_MIDTERM_CAPITAL_PER_POSITION_HKD / currentPrice);
  const halfShares = Math.floor(sharesCanBuy / 2);
  const expectedProfitAHKD = (takeProfitA - currentPrice) * halfShares;
  const expectedProfitBHKD = expectedProfitAHKD + (takeProfitB - currentPrice) * halfShares;

  const distanceFrom52WeekHigh = ((metrics.weekHigh52 - currentPrice) / metrics.weekHigh52) * 100;

  return {
    symbol,
    stockName: HK_STOCK_NAMES[symbol] || symbol,
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
    stopLossPercent,

    suggestedCapitalHKD: HK_MIDTERM_CAPITAL_PER_POSITION_HKD,
    sharesCanBuy,
    expectedProfitAHKD,
    expectedProfitBHKD,

    rsi: metrics.rsi,
    weekHigh52: metrics.weekHigh52,
    weekLow52: metrics.weekLow52,
    distanceFrom52WeekHigh,

    confidence,
    holdingPeriod: "2-4 週",
    sector: getSectorHK(symbol),
  };
}

// ==================== 篩選條件 ====================

function checkHKStrongStockPullback(
  symbol: string,
  metrics: HKStockMetrics,
  indexChangePercent: number
): HKMidtermRecommendation | null {
  const distanceFromHigh = ((metrics.weekHigh52 - metrics.currentPrice) / metrics.weekHigh52) * 100;

  // 距52週高位回調 15-45%
  if (distanceFromHigh < 15 || distanceFromHigh > 45) return null;

  // RSI 超賣區 30-52
  if (metrics.rsi < 28 || metrics.rsi > 52) return null;

  // 距52週低位仍有距離（唔係真係爛）
  const distanceFromLow = ((metrics.currentPrice - metrics.weekLow52) / metrics.weekLow52) * 100;
  if (distanceFromLow < 10) return null;

  // 大市唔係大跌
  if (indexChangePercent < -0.02) return null;

  // 股價近20日低位
  const nearLow = metrics.currentPrice <= metrics.twentyDayLow * 1.08;
  if (!nearLow) return null;

  let confidence = 65;
  if (distanceFromHigh >= 20 && distanceFromHigh <= 35) confidence += 10;
  if (metrics.rsi >= 33 && metrics.rsi <= 45) confidence += 10;
  if (metrics.volumeRatio < 0.8) confidence += 5;

  // 港股加分：如果係半導體或科技板塊（你比較熟同埋有眼光）
  const sector = getSectorHK(symbol);
  if (sector === "半導體" || sector === "科技與電商") confidence += 5;

  confidence = Math.min(confidence, 90);

  return buildHKMidtermRecommendation(
    symbol, metrics,
    "STRONG_STOCK_PULLBACK",
    "💪 強股回調低吸",
    `距52週高位 HK$${metrics.weekHigh52.toFixed(2)} 回調 ${distanceFromHigh.toFixed(1)}%｜RSI ${metrics.rsi.toFixed(0)} 進入超賣｜股價近20日低位 HK$${metrics.twentyDayLow.toFixed(2)}`,
    confidence
  );
}

function checkHKSectorBreakout(
  symbol: string,
  metrics: HKStockMetrics,
  sectorStrongCount: number,
  sectorName: string
): HKMidtermRecommendation | null {
  if (sectorStrongCount < 3) return null;
  if (metrics.changePercent <= 0.01) return null;
  if (metrics.rsi > 72) return null;

  const nearHighBreakout = metrics.currentPrice >= metrics.twentyDayHigh * 0.96;
  if (!nearHighBreakout) return null;

  let confidence = 66;
  if (sectorStrongCount >= 4) confidence += 10;
  if (metrics.changePercent > 0.03) confidence += 8;
  if (metrics.volumeRatio > 1.5) confidence += 8;

  confidence = Math.min(confidence, 90);

  return buildHKMidtermRecommendation(
    symbol, metrics,
    "SECTOR_BREAKOUT",
    "🚀 板塊主題爆發",
    `${sectorName} 板塊今日 ${sectorStrongCount} 隻股票同步走強｜${symbol} 突破近期高位 HK$${metrics.twentyDayHigh.toFixed(2)}｜成交量放大 ${metrics.volumeRatio.toFixed(1)}x`,
    confidence
  );
}

// ==================== MAIN SCANNER ====================

export async function runHKMidtermScanner(forceRefresh: boolean = false): Promise<HKMidtermScanResult> {
  if (!forceRefresh && cachedHKMidtermResult && Date.now() - cachedHKMidtermResult.timestamp < HK_MIDTERM_CACHE_TTL_MS) {
    console.log("[HK Midterm] 使用 Cache 結果");
    return cachedHKMidtermResult.result;
  }

  const startTime = Date.now();
  const hkTimeStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong", hour12: false });
  console.log("[HK Midterm Scanner] ====== 港股中短線選股引擎啟動 ======");

  // 恒生指數變幅
  const hsiQuote = await hkStockData.fetchQuote("HSI");
  const indexChangePercent = hsiQuote?.changePercent || 0;
  console.log(`[HK Midterm] 恒指今日變幅: ${(indexChangePercent * 100).toFixed(2)}%`);

  // 批量攞報價（節省iTick API call）
  const batchQuotes = await hkStockData.fetchBatchQuotes(HK_MIDTERM_UNIVERSE);
  console.log(`[HK Midterm] 批量報價完成，攞到 ${batchQuotes.size} 隻`);

  // 逐隻攞歷史K線（需要節流，因為iTick限制）
  const allMetrics = new Map<string, HKStockMetrics | null>();

  for (const symbol of HK_MIDTERM_UNIVERSE) {
    const normalizedCode = symbol.replace(/^0+/, "") || "0";
    const quote = batchQuotes.get(normalizedCode) || batchQuotes.get(symbol);
    if (!quote || quote.price <= 0) { allMetrics.set(symbol, null); continue; }

    try {
      const candles = await hkStockData.fetchHistoricalData(symbol, "1y");
      if (candles.length < 50) { allMetrics.set(symbol, null); continue; }

      const indicators = hkStockData.calculateIndicators(candles);
      const closes = candles.map((c) => c.close);

      const weekHigh52 = Math.max(...closes);
      const weekLow52 = Math.min(...closes);
      const last20 = closes.slice(-20);
      const twentyDayLow = Math.min(...last20);
      const twentyDayHigh = Math.max(...last20);

      const todayVolume = candles[candles.length - 1]?.volume || 0;
      const avgVolume = candles.slice(-20).map((c) => c.volume).reduce((a, b) => a + b, 0) / 20;
      const volumeRatio = avgVolume > 0 ? todayVolume / avgVolume : 0;

      allMetrics.set(symbol, {
        currentPrice: quote.price,
        changePercent: quote.changePercent,
        rsi: indicators.rsi,
        ema20: indicators.ema20,
        atr: indicators.atr,
        weekHigh52,
        weekLow52,
        twentyDayLow,
        twentyDayHigh,
        volumeRatio,
      });
    } catch (error) {
      console.error(`[HK Midterm] Error for ${symbol}:`, error);
      allMetrics.set(symbol, null);
    }
  }

  // 計算板塊強度
  const sectorStrengthMap = new Map<string, number>();
  for (const [sectorName, symbols] of Object.entries(HK_MIDTERM_SECTORS)) {
    let strongCount = 0;
    for (const symbol of symbols) {
      const m = allMetrics.get(symbol);
      if (m && m.changePercent > 0.015) strongCount++;
    }
    sectorStrengthMap.set(sectorName, strongCount);
  }

  // 跑篩選條件
  const recommendations: HKMidtermRecommendation[] = [];
  let pullbackCount = 0, sectorBreakoutCount = 0;

  for (const symbol of HK_MIDTERM_UNIVERSE) {
    const metrics = allMetrics.get(symbol);
    if (!metrics) continue;

    const sector = getSectorHK(symbol);
    const sectorStrong = sectorStrengthMap.get(sector) || 0;

    const pullback = checkHKStrongStockPullback(symbol, metrics, indexChangePercent);
    if (pullback) { recommendations.push(pullback); pullbackCount++; continue; }

    const breakout = checkHKSectorBreakout(symbol, metrics, sectorStrong, sector);
    if (breakout) { recommendations.push(breakout); sectorBreakoutCount++; }
  }

  const finalRecommendations = recommendations
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, HK_MIDTERM_MAX_POSITIONS * 2);

  const elapsed = Date.now() - startTime;
  console.log(`[HK Midterm Scanner] 完成：${finalRecommendations.length} 個機會，耗時 ${elapsed}ms`);

  const result: HKMidtermScanResult = {
    recommendations: finalRecommendations,
    scanTime: new Date().toISOString(),
    hkTime: hkTimeStr,
    totalScanned: HK_MIDTERM_UNIVERSE.length,
    pullbackCount,
    sectorBreakoutCount,
    hasNewSignals: finalRecommendations.length > 0,
  };

  cachedHKMidtermResult = { result, timestamp: Date.now() };
  return result;
}
