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

export interface RecentExtreme {
  price: number;
  date: string;
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
    rsi14: number | null;
    bollingerUpper: number | null;
    bollingerLower: number | null;
    bollingerPosition: 'above_upper' | 'below_lower' | 'inside' | null; // 現價相對布林通道嘅位置
  };
  trend: 'strong' | 'neutral' | 'weak';
  supportLevels: LevelCluster[];
  resistanceLevels: LevelCluster[];
  // 近10個交易日嘅極值，未經5日反向確認，僅供參考、唔會直接用嚟計算買賣建議價
  recentReference: {
    low: RecentExtreme;
    high: RecentExtreme;
  };
  // 用返成段歷史做嘅回測統計：呢個symbol過往RSI超賣/超買、布林觸底/觸頂之後，
  // 通常會點郁（樣本數、勝率、平均幅度、平均需要幾多日）
  historicalStats: {
    oversoldBounce: SignalBacktestStats; // RSI<30 之後嘅反彈統計
    overboughtPullback: SignalBacktestStats; // RSI>70 之後嘅回落統計
    bollingerLowerBounce: SignalBacktestStats; // 觸及布林下軌之後嘅反彈統計
    bollingerUpperPullback: SignalBacktestStats; // 觸及布林上軌之後嘅回落統計
  };
  recommendation: Recommendation;
}

// ---------- 1. 資料設定 ----------

// direction: 'long' = 你想搵買入訊號；'short' = 你想搵做空(賣出)訊號
export const WATCHLIST: WatchlistItem[] = [
  { symbol: 'TQQQ', name: 'TQQQ 3倍做多', direction: 'long' },
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
 * 輕量版：淨係攞最近 `days` 個交易日，用嚟更新「近期參考位」同重新計算指標，
 * 唔使成次update都重新攞成年歷史，快好多。
 */
export async function fetchRecentHistory(
  symbol: string,
  apiKey: string,
  days = 60
): Promise<DailyBar[]> {
  const url = `${TD_BASE}?symbol=${symbol}&interval=1day&outputsize=${days}&apikey=${apiKey}`;
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

/**
 * 近期未確認參考位：唔使等「後5日」確認，
 * 直接攞最近 `lookback` 個交易日嘅最低/最高，即時反應。
 * 用嚟補返confirmed swing point「慢半拍」嘅缺口，
 * 但由於未經確認，唔會直接用嚟計算買賣建議價，只做參考顯示。
 */
function findRecentExtreme(bars: DailyBar[], lookback = 10) {
  const recent = bars.slice(-lookback);
  let low = recent[0];
  let high = recent[0];
  for (const b of recent) {
    if (b.low < low.low) low = b;
    if (b.high > high.high) high = b;
  }
  return {
    low: { price: low.low, date: low.date },
    high: { price: high.high, date: high.date },
  };
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

// ---------- 5b. RSI / 布林通道 ----------

/** Wilder's RSI */
function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i < period) continue;
    if (i === period) {
      avgGain = gains.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
      avgLoss = losses.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
    } else {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }
  return out;
}

interface BollingerBands {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

function bollingerBands(closes: number[], period = 20, mult = 2): BollingerBands {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const mean = middle[i] as number;
    const variance = window.reduce((sum, c) => sum + (c - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

// ---------- 5c. 歷史訊號回測統計 ----------

export interface SignalBacktestStats {
  label: string;
  occurrences: number;
  hitRate: number | null; // 百分比：出現訊號後，在窗口內達到目標幅度的次數比例
  avgMovePct: number | null; // 平均最大波動幅度（%）
  medianMovePct: number | null;
  avgDaysToHit: number | null;
}

/**
 * 通用回測：喺 `triggerIdxs` 呢啲交易日出現訊號之後，
 * 睇未來 `window` 個交易日入面，價格喺 `direction` 方向最多郁咗幾多%，
 * 有冇達到 `targetPct` 呢個門檻，同埋用咗幾多日先達到。
 */
function backtestSignal(
  bars: DailyBar[],
  triggerIdxs: number[],
  window: number,
  targetPct: number,
  direction: 'up' | 'down',
  label: string
): SignalBacktestStats {
  const moves: number[] = [];
  const daysToHit: number[] = [];
  let hits = 0;

  for (const idx of triggerIdxs) {
    const base = bars[idx].close;
    if (base <= 0) continue;
    const future = bars.slice(idx + 1, idx + 1 + window);
    if (future.length === 0) continue;

    let bestMovePct = 0;
    let hitDay: number | null = null;
    future.forEach((b, i) => {
      const extreme = direction === 'up' ? b.high : b.low;
      const movePct = direction === 'up' ? (extreme - base) / base : (base - extreme) / base;
      if (movePct > bestMovePct) bestMovePct = movePct;
      if (hitDay === null && movePct >= targetPct) hitDay = i + 1;
    });

    moves.push(bestMovePct * 100);
    if (hitDay !== null) {
      hits += 1;
      daysToHit.push(hitDay);
    }
  }

  if (moves.length === 0) {
    return {
      label,
      occurrences: 0,
      hitRate: null,
      avgMovePct: null,
      medianMovePct: null,
      avgDaysToHit: null,
    };
  }

  const sorted = [...moves].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const avg = moves.reduce((a, b) => a + b, 0) / moves.length;
  const avgDays =
    daysToHit.length > 0 ? daysToHit.reduce((a, b) => a + b, 0) / daysToHit.length : null;

  return {
    label,
    occurrences: moves.length,
    hitRate: Math.round((hits / moves.length) * 1000) / 10,
    avgMovePct: Math.round(avg * 10) / 10,
    medianMovePct: Math.round(median * 10) / 10,
    avgDaysToHit: avgDays !== null ? Math.round(avgDays * 10) / 10 : null,
  };
}

/**
 * 搵所有「向下穿越門檻」(例如RSI由>=30跌到<30) 嘅交易日index，
 * 用嚟做超賣/超買訊號嘅觸發點，避免連續多日都喺同一區間入面被重複計算。
 */
function findCrossings(
  series: (number | null)[],
  threshold: number,
  direction: 'crossBelow' | 'crossAbove'
): number[] {
  const idxs: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    if (prev === null || cur === null) continue;
    if (direction === 'crossBelow' && prev >= threshold && cur < threshold) idxs.push(i);
    if (direction === 'crossAbove' && prev <= threshold && cur > threshold) idxs.push(i);
  }
  return idxs;
}

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
  const rsi14 = rsi(closes, 14);
  const bb = bollingerBands(closes, 20, 2);

  const last = bars.length - 1;
  const latestClose = closes[last];
  const latestAtr = atr14[last] as number;
  const latestRsi = rsi14[last];
  const latestBbUpper = bb.upper[last];
  const latestBbLower = bb.lower[last];

  let bollingerPosition: 'above_upper' | 'below_lower' | 'inside' | null = null;
  if (latestBbUpper !== null && latestBbLower !== null) {
    if (latestClose > latestBbUpper) bollingerPosition = 'above_upper';
    else if (latestClose < latestBbLower) bollingerPosition = 'below_lower';
    else bollingerPosition = 'inside';
  }

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

  const recentReference = findRecentExtreme(bars, 10);

  // ---- 歷史回測：用成段可用歷史（唔止3年）計樣本 ----
  const oversoldTriggers = findCrossings(rsi14, 30, 'crossBelow');
  const overboughtTriggers = findCrossings(rsi14, 70, 'crossAbove');
  const bbLowerTriggers = bars
    .map((b, i) => (bb.lower[i] !== null && b.low <= (bb.lower[i] as number) ? i : -1))
    .filter((i) => i >= 0);
  const bbUpperTriggers = bars
    .map((b, i) => (bb.upper[i] !== null && b.high >= (bb.upper[i] as number) ? i : -1))
    .filter((i) => i >= 0);

  const historicalStats = {
    oversoldBounce: backtestSignal(bars, oversoldTriggers, 10, 0.05, 'up', 'RSI跌穿30後10日內反彈≥5%'),
    overboughtPullback: backtestSignal(bars, overboughtTriggers, 10, 0.05, 'down', 'RSI升穿70後10日內回落≥5%'),
    bollingerLowerBounce: backtestSignal(bars, bbLowerTriggers, 10, 0.05, 'up', '觸及布林下軌後10日內反彈≥5%'),
    bollingerUpperPullback: backtestSignal(bars, bbUpperTriggers, 10, 0.05, 'down', '觸及布林上軌後10日內回落≥5%'),
  };

  const recommendation = buildRecommendation({
    direction: config.direction,
    latestClose,
    latestAtr,
    trend,
    nearestSupport,
    nearestResistance,
    recentReference,
    latestRsi,
    bollingerPosition,
    historicalStats,
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
      rsi14: latestRsi,
      bollingerUpper: latestBbUpper,
      bollingerLower: latestBbLower,
      bollingerPosition,
    },
    trend,
    supportLevels: supportClusters.slice(0, 3),
    resistanceLevels: resistanceClusters.slice(0, 3),
    recentReference,
    historicalStats,
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
  recentReference,
  latestRsi,
  bollingerPosition,
  historicalStats,
}: {
  direction: 'long' | 'short';
  latestClose: number;
  latestAtr: number;
  trend: 'strong' | 'neutral' | 'weak';
  nearestSupport: LevelCluster | null;
  nearestResistance: LevelCluster | null;
  recentReference: { low: RecentExtreme; high: RecentExtreme };
  latestRsi: number | null;
  bollingerPosition: 'above_upper' | 'below_lower' | 'inside' | null;
  historicalStats: {
    oversoldBounce: SignalBacktestStats;
    overboughtPullback: SignalBacktestStats;
    bollingerLowerBounce: SignalBacktestStats;
    bollingerUpperPullback: SignalBacktestStats;
  };
}): Recommendation {
  const tpMult = TP_MULTIPLIER[trend];

  // 睇下現時RSI/布林通道狀態，係咪啱啱好觸發咗超賣/超買訊號，
  // 如果係，就將對應嘅歷史回測統計（樣本數/勝率/平均幅度/平均日數）組成一句話。
  const isOversold = (latestRsi !== null && latestRsi < 30) || bollingerPosition === 'below_lower';
  const isOverbought = (latestRsi !== null && latestRsi > 70) || bollingerPosition === 'above_upper';

  function formatStat(stat: SignalBacktestStats): string | null {
    if (stat.occurrences === 0 || stat.hitRate === null) return null;
    return `${stat.label}：過往${stat.occurrences}次入面${stat.hitRate}%命中，平均幅度${stat.avgMovePct}%，平均${stat.avgDaysToHit}日內達到`;
  }

  const oversoldNote = isOversold
    ? [formatStat(historicalStats.oversoldBounce), formatStat(historicalStats.bollingerLowerBounce)]
        .filter(Boolean)
        .join('；')
    : null;
  const overboughtNote = isOverbought
    ? [
        formatStat(historicalStats.overboughtPullback),
        formatStat(historicalStats.bollingerUpperPullback),
      ]
        .filter(Boolean)
        .join('；')
    : null;

  // 近10日嘅未確認低/高位，只有喺離現價合理範圍內(2個ATR之內)先當有效，
  // 避免用返太耐之前、已經冇意義嘅極值。
  const recentLowValid =
    recentReference.low.price < latestClose &&
    latestClose - recentReference.low.price <= latestAtr * 2;
  const recentHighValid =
    recentReference.high.price > latestClose &&
    recentReference.high.price - latestClose <= latestAtr * 2;

  if (direction === 'long') {
    // 買入價：喺所有「現價之下」嘅有效支持候選入面，揀最貼近現價嗰個
    // （即係最近、最實際嘅支持位），而唔係死跟3年確認支持位或者ATR估算。
    const buyCandidates: number[] = [latestClose - 0.5 * latestAtr];
    if (nearestSupport) buyCandidates.push(nearestSupport.avg);
    if (recentLowValid) buyCandidates.push(recentReference.low.price);
    const buyPrice = Math.max(...buyCandidates.filter((p) => p < latestClose));

    // 賣出/止賺價：喺現價之上嘅阻力候選入面，揀最貼近現價嗰個做保守封頂，
    // 近期未確認高位如果比3年阻力更貼近現價，都會攞嚟做封頂參考。
    const sellCandidates: number[] = [latestClose + tpMult * latestAtr * 4];
    if (nearestResistance) sellCandidates.push(nearestResistance.avg);
    if (recentHighValid) sellCandidates.push(recentReference.high.price);
    const sellPrice = Math.min(...sellCandidates.filter((p) => p > latestClose));

    const usedRecentLow = recentLowValid && buyPrice === round2(recentReference.low.price);
    const usedRecentHigh = recentHighValid && sellPrice === round2(recentReference.high.price);

    let basis = `趨勢=${trend}，買入價=${
      usedRecentLow ? '近期實際低位' : nearestSupport ? '3年確認支持位' : 'ATR估算'
    }${round2(buyPrice)}；賣出價=${
      usedRecentHigh ? '近期實際高位' : nearestResistance ? '3年確認阻力位' : 'ATR估算'
    }${round2(sellPrice)}`;
    if (recentLowValid) {
      basis += `｜近10日曾跌至${round2(recentReference.low.price)}(${recentReference.low.date})`;
    }
    if (oversoldNote) {
      basis += `｜現處超賣區：${oversoldNote}`;
    }
    if (overboughtNote) {
      basis += `｜現處超買區（留意漲勢可能轉弱）：${overboughtNote}`;
    }

    return {
      action: '低接做多',
      nextBuyPrice: round2(buyPrice),
      nextSellPrice: round2(sellPrice),
      basis,
    };
  } else {
    // 做空進場價：現價之上、最貼近現價嘅阻力候選（近期實際高位優先於估算值）
    const sellCandidates: number[] = [latestClose + 0.5 * latestAtr];
    if (nearestResistance) sellCandidates.push(nearestResistance.avg);
    if (recentHighValid) sellCandidates.push(recentReference.high.price);
    const sellPrice = Math.min(...sellCandidates.filter((p) => p > latestClose));

    // 回補/止賺價：現價之下、最貼近現價嘅支持候選
    const buyCandidates: number[] = [latestClose - tpMult * latestAtr * 4];
    if (nearestSupport) buyCandidates.push(nearestSupport.avg);
    if (recentLowValid) buyCandidates.push(recentReference.low.price);
    const buyPrice = Math.max(...buyCandidates.filter((p) => p < latestClose));

    const usedRecentHigh = recentHighValid && sellPrice === round2(recentReference.high.price);
    const usedRecentLow = recentLowValid && buyPrice === round2(recentReference.low.price);

    let basis = `趨勢=${trend}，做空進場價=${
      usedRecentHigh ? '近期實際高位' : nearestResistance ? '3年確認阻力位' : 'ATR估算'
    }${round2(sellPrice)}；回補價=${
      usedRecentLow ? '近期實際低位' : nearestSupport ? '3年確認支持位' : 'ATR估算'
    }${round2(buyPrice)}`;
    if (recentHighValid) {
      basis += `｜近10日曾升至${round2(recentReference.high.price)}(${recentReference.high.date})`;
    }
    if (overboughtNote) {
      basis += `｜現處超買區：${overboughtNote}`;
    }
    if (oversoldNote) {
      basis += `｜現處超賣區（留意跌勢可能轉弱）：${oversoldNote}`;
    }

    return {
      action: '高沽做空',
      nextSellPrice: round2(sellPrice),
      nextBuyPrice: round2(buyPrice),
      basis,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
