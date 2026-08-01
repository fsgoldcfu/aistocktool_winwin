// lib/indexAnalysis.ts
//
// 指數/槓桿ETF 歷史數據分析引擎
// 涵蓋：道指(DIA代理)、納指(QQQ代理)、TQQQ、SQQQ、UVIX

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  direction: 'long' | 'short';
}

export interface LevelCluster {
  avg: number;
  prices: number[];
  touches: number;
}

export interface Recommendation {
  action: string;
  nextBuyPrice: number;
  nextSellPrice: number;
  basis: string;
}

export interface AnalysisResult {
  latestDate: string;
  latestClose: number;
  indicators: {
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    atr14: number | null;
    avgVolume20: number | null;
    latestVolume: number;
    volumeSpikeRatio: number | null;
  };
  trend: 'strong' | 'neutral' | 'weak';
  supportLevels: LevelCluster[];
  resistanceLevels: LevelCluster[];
  recommendation: Recommendation;
}

// ---------- 1. 資料設定 ----------

// direction: 'long' = 你想搵買入訊號；'short' = 你想搵做空(賣出)訊號
export const WATCHLIST: WatchlistItem[] = [
  { symbol: 'DIA', name: '道瓊工業指數 (ETF代理)', direction: 'short' },
  { symbol: 'QQQ', name: '納斯達克100指數 (ETF代理)', direction: 'long' },
  { symbol: 'TQQQ', name: 'TQQQ 3倍做多', direction: 'long' },
  { symbol: 'SQQQ', name: 'SQQQ 3倍做空', direction: 'long' },
  { symbol: 'UVIX', name: 'UVIX 2倍VIX', direction: 'short' },
];

// ---------- 2. 攞歷史數據 (Twelve Data) ----------

const TD_BASE = 'https://api.twelvedata.com/time_series';

/**
 * 攞單一symbol嘅5年daily K線 (由舊至新排序)
 */
export async function fetchDailyHistory(
  symbol: string,
  apiKey: string,
  years = 5
): Promise<DailyBar[]> {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - years);

  const url = `${TD_BASE}?symbol=${symbol}&interval=1day&start_date=${start
    .toISOString()
    .slice(0, 10)}&end_date=${end.toISOString().slice(0, 10)}&outputsize=5000&apikey=${apiKey}`;

  const res = await fetch(url);
  const json = await res.json();

  if (json.status === 'error' || !json.values) {
    throw new Error(`Twelve Data 錯誤 (${symbol}): ${json.message || 'unknown'}`);
  }

  return json.values
    .map((v: any) => ({
      date: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseFloat(v.volume || 0),
    }))
    .reverse();
}

/**
 * 8秒節流佇列，避免5個symbol一齊call爆429。
 */
export async function fetchAllHistories(
  watchlist: WatchlistItem[],
  apiKey: string,
  throttleMs = 8000
): Promise<Record<string, DailyBar[]>> {
  const results: Record<string, DailyBar[]> = {};
  for (const item of watchlist) {
    results[item.symbol] = await fetchDailyHistory(item.symbol, apiKey);
    await new Promise((r) => setTimeout(r, throttleMs));
  }
  return results;
}

// ---------- 3. 技術指標 ----------

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder's ATR */
function atr(bars: DailyBar[], period = 14): (number | null)[] {
  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const prevClose = bars[i - 1].close;
    return Math.max(
      b.high - b.low,
      Math.abs(b.high - prevClose),
      Math.abs(b.low - prevClose)
    );
  });

  const out: (number | null)[] = new Array(bars.length).fill(null);
  let prevAtr: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      prevAtr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prevAtr = ((prevAtr as number) * (period - 1) + tr[i]) / period;
    }
    out[i] = prevAtr;
  }
  return out;
}

function volumeStats(bars: DailyBar[], period = 20) {
  const vols = bars.map((b) => b.volume);
  const avgVol = sma(vols, period);
  const latestVol = vols[vols.length - 1];
  const latestAvg = avgVol[avgVol.length - 1];
  return {
    avgVolSeries: avgVol,
    latestVolume: latestVol,
    latestAvgVolume: latestAvg,
    volumeSpikeRatio: latestAvg ? latestVol / latestAvg : null,
  };
}

// ---------- 4. 歷史支持/阻力 (swing point + 聚類) ----------

interface SwingPoint {
  date: string;
  price: number;
}

function findSwingPoints(bars: DailyBar[], window = 5) {
  const lows: SwingPoint[] = [];
  const highs: SwingPoint[] = [];
  for (let i = window; i < bars.length - window; i++) {
    const slice = bars.slice(i - window, i + window + 1);
    const isLow = slice.every((b) => bars[i].low <= b.low);
    const isHigh = slice.every((b) => bars[i].high >= b.high);
    if (isLow) lows.push({ date: bars[i].date, price: bars[i].low });
    if (isHigh) highs.push({ date: bars[i].date, price: bars[i].high });
  }
  return { lows, highs };
}

function clusterLevels(points: SwingPoint[], tolerance: number): LevelCluster[] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: LevelCluster[] = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && p.price - last.avg <= tolerance) {
      last.prices.push(p.price);
      last.avg = last.prices.reduce((a, b) => a + b, 0) / last.prices.length;
      last.touches += 1;
    } else {
      clusters.push({ avg: p.price, prices: [p.price], touches: 1 });
    }
  }
  return clusters.sort((a, b) => b.touches - a.touches);
}

// ---------- 5. 趨勢判斷 ----------

function classifyTrend({
  latestClose,
  sma50,
  sma200,
}: {
  latestClose: number;
  sma50: number | null;
  sma200: number | null;
}): 'strong' | 'neutral' | 'weak' {
  if (sma50 == null || sma200 == null) return 'neutral';
  if (latestClose > sma50 && sma50 > sma200) return 'strong';
  if (latestClose < sma50 && sma50 < sma200) return 'weak';
  return 'neutral';
}

const TP_MULTIPLIER: Record<'strong' | 'neutral' | 'weak', number> = {
  strong: 0.4,
  neutral: 0.25,
  weak: 0.15,
};

// ---------- 6. 主分析函數 ----------

export function analyzeSymbol(
  bars: DailyBar[],
  config: { direction: 'long' | 'short' }
): AnalysisResult {
  if (!bars || bars.length < 210) {
    throw new Error('數據不足，至少需要約210個交易日先可以計SMA200/ATR');
  }

  const closes = bars.map((b) => b.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const atr14 = atr(bars, 14);
  const vol = volumeStats(bars, 20);

  const last = bars.length - 1;
  const latestClose = closes[last];
  const latestAtr = atr14[last] as number;

  const trend = classifyTrend({
    latestClose,
    sma50: sma50[last],
    sma200: sma200[last],
  });

  const recentBars = bars.slice(-756); // 約3年交易日
  const { lows, highs } = findSwingPoints(recentBars, 5);
  const tolerance = latestAtr * 0.75;
  const supportClusters = clusterLevels(lows, tolerance).filter(
    (c) => c.avg < latestClose
  );
  const resistanceClusters = clusterLevels(highs, tolerance).filter(
    (c) => c.avg > latestClose
  );

  const nearestSupport =
    [...supportClusters].sort((a, b) => b.avg - a.avg)[0] || null;
  const nearestResistance =
    [...resistanceClusters].sort((a, b) => a.avg - b.avg)[0] || null;

  const recommendation = buildRecommendation({
    direction: config.direction,
    latestClose,
    latestAtr,
    trend,
    nearestSupport,
    nearestResistance,
  });

  return {
    latestDate: bars[last].date,
    latestClose,
    indicators: {
      sma20: sma20[last],
      sma50: sma50[last],
      sma200: sma200[last],
      atr14: latestAtr,
      avgVolume20: vol.latestAvgVolume,
      latestVolume: vol.latestVolume,
      volumeSpikeRatio: vol.volumeSpikeRatio,
    },
    trend,
    supportLevels: supportClusters.slice(0, 3),
    resistanceLevels: resistanceClusters.slice(0, 3),
    recommendation,
  };
}

function buildRecommendation({
  direction,
  latestClose,
  latestAtr,
  trend,
  nearestSupport,
  nearestResistance,
}: {
  direction: 'long' | 'short';
  latestClose: number;
  latestAtr: number;
  trend: 'strong' | 'neutral' | 'weak';
  nearestSupport: LevelCluster | null;
  nearestResistance: LevelCluster | null;
}): Recommendation {
  const tpMult = TP_MULTIPLIER[trend];

  if (direction === 'long') {
    const buyPrice = nearestSupport
      ? Math.max(nearestSupport.avg, latestClose - 0.5 * latestAtr)
      : latestClose - 0.5 * latestAtr;

    let sellPrice = latestClose + tpMult * latestAtr * 4;
    if (nearestResistance) sellPrice = Math.min(sellPrice, nearestResistance.avg);

    return {
      action: '低接做多',
      nextBuyPrice: round2(buyPrice),
      nextSellPrice: round2(sellPrice),
      basis: `趨勢=${trend}，買入參考支持位${nearestSupport ? round2(nearestSupport.avg) : '（無明顯支持，用ATR估算）'}；賣出參考阻力位${nearestResistance ? round2(nearestResistance.avg) : '（無明顯阻力，用ATR估算）'}`,
    };
  } else {
    const sellPrice = nearestResistance
      ? Math.min(nearestResistance.avg, latestClose + 0.5 * latestAtr)
      : latestClose + 0.5 * latestAtr;

    let buyPrice = latestClose - tpMult * latestAtr * 4;
    if (nearestSupport) buyPrice = Math.max(buyPrice, nearestSupport.avg);

    return {
      action: '高沽做空',
      nextSellPrice: round2(sellPrice),
      nextBuyPrice: round2(buyPrice),
      basis: `趨勢=${trend}，做空進場參考阻力位${nearestResistance ? round2(nearestResistance.avg) : '（無明顯阻力，用ATR估算）'}；回補參考支持位${nearestSupport ? round2(nearestSupport.avg) : '（無明顯支持，用ATR估算）'}`,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
