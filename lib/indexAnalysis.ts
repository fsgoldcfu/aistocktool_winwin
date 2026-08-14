// lib/indexAnalysis.ts
//
// TQQQ 日線分析引擎：
// - 只以已完成日線計算訊號，避免把盤中價格混入 SMA / RSI / ATR
// - 將「觀察區」與「可交易計劃」分開；沒有確認、止蝕或足夠回報風險比時不產生交易計劃
// - 提供含進場、止蝕、目標、最長持有日和成本假設的交易級歷史回測

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

export interface RecentExtreme {
  price: number;
  date: string;
}

export type AnalysisStatus = 'TRADEABLE' | 'WATCH' | 'NO_TRADE';
export type PriceSource = 'twelve_data_price' | 'prior_close';

export interface TradePlan {
  entry: number;
  initialStop: number;
  target1: number;
  target2: number;
  riskPerShare: number;
  rewardRiskToT1: number;
  maxHoldingDays: number;
  entryRule: string;
  invalidation: string;
}

export interface Recommendation {
  status: AnalysisStatus;
  action: string;
  nextBuyPrice: number | null;
  nextSellPrice: number | null;
  tradePlan: TradePlan | null;
  reasons: string[];
  basis: string;
}

export interface SignalBacktestStats {
  label: string;
  occurrences: number;
  hitRate: number | null;
  avgMovePct: number | null;
  medianMovePct: number | null;
  avgDaysToHit: number | null;
}

export interface StrategyBacktestSummary {
  trades: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
  profitFactor: number | null;
  netReturnPct: number | null;
  maxDrawdownPct: number | null;
  maxLosingStreak: number;
  avgHoldDays: number | null;
}

export interface StrategyBacktest {
  name: string;
  inSample: StrategyBacktestSummary;
  outOfSample: StrategyBacktestSummary;
  assumptions: string;
  validationNote: string;
}

export interface AnalysisResult {
  latestDate: string;
  latestClose: number;
  signalClose: number;
  analysisAsOf: string;
  data: {
    priceSource: PriceSource;
    priceTimestamp: string;
    lastCompletedDailyBar: string;
    adjustmentBasis: 'splits';
    signalUsesCompletedDailyBar: true;
  };
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
    bollingerPosition: 'above_upper' | 'below_lower' | 'inside' | null;
  };
  trend: 'strong' | 'neutral' | 'weak';
  supportLevels: LevelCluster[];
  resistanceLevels: LevelCluster[];
  recentReference: {
    low: RecentExtreme;
    high: RecentExtreme;
  };
  historicalStats: {
    oversoldBounce: SignalBacktestStats;
    overboughtPullback: SignalBacktestStats;
    bollingerLowerBounce: SignalBacktestStats;
    bollingerUpperPullback: SignalBacktestStats;
  };
  strategyBacktest: StrategyBacktest;
  recommendation: Recommendation;
}

// ---------- 1. 資料設定 ----------

export const WATCHLIST: WatchlistItem[] = [
  { symbol: 'TQQQ', name: 'TQQQ 3倍做多', direction: 'long' },
];

const TD_BASE = 'https://api.twelvedata.com/time_series';
const MIN_REQUIRED_BARS = 210;
const STRATEGY_VERSION = 'tqqq-daily-pullback-v2';

const STRATEGY_CONFIG = {
  atrPeriod: 14,
  rsiPeriod: 14,
  bollingerPeriod: 20,
  swingWindow: 5,
  supportLookback: 756,
  recentLookback: 10,
  oversoldRsi: 30,
  supportDistanceAtr: 2,
  stopBufferAtr: 0.5,
  minimumStopAtr: 1,
  maximumRiskAtr: 2,
  target1R: 1.5,
  target2R: 2.5,
  maxHoldingDays: 5,
  // 回測假設：每邊 10 bps，涵蓋滑點／bid-ask／佣金的保守簡化估計。
  oneWayCostBps: 10,
} as const;

function assertFinitePositive(value: number, field: string, date: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Twelve Data 日線資料無效：${date} 的 ${field} 不是有效正數`);
  }
}

function normalizeBars(values: unknown): DailyBar[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Twelve Data 沒有返回可用日線資料');
  }

  const seenDates = new Set<string>();
  const bars = values.map((raw: any): DailyBar => {
    const date = String(raw.date ?? raw.datetime ?? '');
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    const volume = raw.volume == null || raw.volume === '' ? 0 : Number(raw.volume);

    if (!date || seenDates.has(date)) {
      throw new Error(`Twelve Data 日線資料日期重複或缺失：${date || 'unknown'}`);
    }
    seenDates.add(date);
    assertFinitePositive(open, 'open', date);
    assertFinitePositive(high, 'high', date);
    assertFinitePositive(low, 'low', date);
    assertFinitePositive(close, 'close', date);
    if (!Number.isFinite(volume) || volume < 0) {
      throw new Error(`Twelve Data 日線資料無效：${date} 的 volume 不可為負數`);
    }
    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      throw new Error(`Twelve Data 日線 OHLC 邏輯無效：${date}`);
    }
    return { date, open, high, low, close, volume };
  });

  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Twelve Data HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * 取得 Twelve Data price endpoint 價格；這只代表供應商 price endpoint 的回應，
 * 而日線訊號仍一律使用最後完成的 daily bar。
 */
export async function fetchLivePrice(symbol: string, apiKey: string): Promise<number> {
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;
  const json = await fetchJson(url);
  const price = Number(json.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Twelve Data price endpoint 錯誤 (${symbol}): ${json.message || 'unknown'}`);
  }
  return price;
}

/**
 * 取得 split-adjusted 日線。Twelve Data 文件的 time_series `adjust=splits` 是其預設模式，
 * 這裡明確指定，避免分拆後 ATR、支持阻力與回測出現人為斷層。
 */
export async function fetchDailyHistory(
  symbol: string,
  apiKey: string,
  years = 10
): Promise<DailyBar[]> {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - years);
  const params = new URLSearchParams({
    symbol,
    interval: '1day',
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
    outputsize: '5000',
    order: 'asc',
    adjust: 'splits',
    apikey: apiKey,
  });
  const json = await fetchJson(`${TD_BASE}?${params.toString()}`);
  if (json.status === 'error' || !json.values) {
    throw new Error(`Twelve Data 錯誤 (${symbol}): ${json.message || 'unknown'}`);
  }
  return normalizeBars(json.values);
}

export async function fetchRecentHistory(
  symbol: string,
  apiKey: string,
  days = 60
): Promise<DailyBar[]> {
  const params = new URLSearchParams({
    symbol,
    interval: '1day',
    outputsize: String(days),
    order: 'asc',
    adjust: 'splits',
    apikey: apiKey,
  });
  const json = await fetchJson(`${TD_BASE}?${params.toString()}`);
  if (json.status === 'error' || !json.values) {
    throw new Error(`Twelve Data 錯誤 (${symbol}): ${json.message || 'unknown'}`);
  }
  return normalizeBars(json.values);
}

export async function fetchAllHistories(
  watchlist: WatchlistItem[],
  apiKey: string,
  throttleMs = 8000
): Promise<Record<string, DailyBar[]>> {
  const results: Record<string, DailyBar[]> = {};
  for (const item of watchlist) {
    results[item.symbol] = await fetchDailyHistory(item.symbol, apiKey);
    if (watchlist.indexOf(item) < watchlist.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }
  return results;
}

// ---------- 2. 技術指標 ----------

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

function atr(bars: DailyBar[], period = STRATEGY_CONFIG.atrPeriod): (number | null)[] {
  const trueRanges = bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const previousClose = bars[i - 1].close;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - previousClose),
      Math.abs(bar.low - previousClose)
    );
  });

  const out: (number | null)[] = new Array(bars.length).fill(null);
  let previousAtr: number | null = null;
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      previousAtr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    } else {
      previousAtr = ((previousAtr as number) * (period - 1) + trueRanges[i]) / period;
    }
    out[i] = previousAtr;
  }
  return out;
}

function volumeStats(bars: DailyBar[], period = 20) {
  const volumes = bars.map((bar) => bar.volume);
  const averages = sma(volumes, period);
  const latestVolume = volumes[volumes.length - 1];
  const latestAverage = averages[averages.length - 1];
  return {
    latestVolume,
    latestAverage,
    volumeSpikeRatio: latestAverage && latestAverage > 0 ? latestVolume / latestAverage : null,
  };
}

function rsi(closes: number[], period = STRATEGY_CONFIG.rsiPeriod): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  const gains: number[] = [0];
  const losses: number[] = [0];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }

  let averageGain = 0;
  let averageLoss = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i < period) continue;
    if (i === period) {
      averageGain = gains.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;
      averageLoss = losses.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;
    } else {
      averageGain = (averageGain * (period - 1) + gains[i]) / period;
      averageLoss = (averageLoss * (period - 1) + losses[i]) / period;
    }
    if (averageLoss === 0) {
      out[i] = 100;
    } else {
      const relativeStrength = averageGain / averageLoss;
      out[i] = 100 - 100 / (1 + relativeStrength);
    }
  }
  return out;
}

interface BollingerBands {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

function bollingerBands(
  closes: number[],
  period = STRATEGY_CONFIG.bollingerPeriod,
  multiplier = 2
): BollingerBands {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const window = closes.slice(i - period + 1, i + 1);
    const average = middle[i] as number;
    const variance = window.reduce((sum, value) => sum + (value - average) ** 2, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    upper[i] = average + multiplier * standardDeviation;
    lower[i] = average - multiplier * standardDeviation;
  }
  return { upper, middle, lower };
}

// ---------- 3. 支持／阻力 ----------

interface SwingPoint {
  date: string;
  price: number;
}

function findSwingPoints(bars: DailyBar[], window = STRATEGY_CONFIG.swingWindow) {
  const lows: SwingPoint[] = [];
  const highs: SwingPoint[] = [];
  for (let i = window; i < bars.length - window; i++) {
    const range = bars.slice(i - window, i + window + 1);
    if (range.every((bar) => bars[i].low <= bar.low)) {
      lows.push({ date: bars[i].date, price: bars[i].low });
    }
    if (range.every((bar) => bars[i].high >= bar.high)) {
      highs.push({ date: bars[i].date, price: bars[i].high });
    }
  }
  return { lows, highs };
}

function findRecentExtreme(bars: DailyBar[], lookback = STRATEGY_CONFIG.recentLookback) {
  const recent = bars.slice(-lookback);
  let low = recent[0];
  let high = recent[0];
  for (const bar of recent) {
    if (bar.low < low.low) low = bar;
    if (bar.high > high.high) high = bar;
  }
  return {
    low: { price: low.low, date: low.date },
    high: { price: high.high, date: high.date },
  };
}

function clusterLevels(points: SwingPoint[], tolerance: number): LevelCluster[] {
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters: LevelCluster[] = [];
  for (const point of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && point.price - last.avg <= tolerance) {
      last.prices.push(point.price);
      last.avg = last.prices.reduce((sum, price) => sum + price, 0) / last.prices.length;
      last.touches += 1;
    } else {
      clusters.push({ avg: point.price, prices: [point.price], touches: 1 });
    }
  }
  return clusters.sort((a, b) => b.touches - a.touches);
}

function classifyTrend(
  latestClose: number,
  sma50: number | null,
  sma200: number | null
): 'strong' | 'neutral' | 'weak' {
  if (sma50 == null || sma200 == null) return 'neutral';
  if (latestClose > sma50 && sma50 > sma200) return 'strong';
  if (latestClose < sma50 && sma50 < sma200) return 'weak';
  return 'neutral';
}

// ---------- 4. 描述性歷史統計 ----------

function backtestSignal(
  bars: DailyBar[],
  triggerIndexes: number[],
  window: number,
  targetPct: number,
  direction: 'up' | 'down',
  label: string
): SignalBacktestStats {
  const moves: number[] = [];
  const daysToHit: number[] = [];
  let hits = 0;

  for (const index of triggerIndexes) {
    const base = bars[index].close;
    const future = bars.slice(index + 1, index + 1 + window);
    if (base <= 0 || future.length === 0) continue;

    let bestMove = 0;
    let hitDay: number | null = null;
    future.forEach((bar, offset) => {
      const extreme = direction === 'up' ? bar.high : bar.low;
      const move = direction === 'up' ? (extreme - base) / base : (base - extreme) / base;
      bestMove = Math.max(bestMove, move);
      if (hitDay === null && move >= targetPct) hitDay = offset + 1;
    });

    moves.push(bestMove * 100);
    if (hitDay !== null) {
      hits += 1;
      daysToHit.push(hitDay);
    }
  }

  if (moves.length === 0) {
    return { label, occurrences: 0, hitRate: null, avgMovePct: null, medianMovePct: null, avgDaysToHit: null };
  }

  const sorted = [...moves].sort((a, b) => a - b);
  const average = moves.reduce((sum, value) => sum + value, 0) / moves.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const averageDays = daysToHit.length
    ? daysToHit.reduce((sum, value) => sum + value, 0) / daysToHit.length
    : null;

  return {
    label,
    occurrences: moves.length,
    hitRate: round1((hits / moves.length) * 100),
    avgMovePct: round1(average),
    medianMovePct: round1(median),
    avgDaysToHit: averageDays == null ? null : round1(averageDays),
  };
}

function findCrossings(
  series: (number | null)[],
  threshold: number,
  direction: 'crossBelow' | 'crossAbove'
): number[] {
  const indexes: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const previous = series[i - 1];
    const current = series[i];
    if (previous == null || current == null) continue;
    if (direction === 'crossBelow' && previous >= threshold && current < threshold) indexes.push(i);
    if (direction === 'crossAbove' && previous <= threshold && current > threshold) indexes.push(i);
  }
  return indexes;
}

function findBollingerReentries(
  bars: DailyBar[],
  lower: (number | null)[],
  upper: (number | null)[],
  direction: 'lower' | 'upper'
): number[] {
  const indexes: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (direction === 'lower' && lower[i - 1] != null && lower[i] != null) {
      if (bars[i - 1].low <= (lower[i - 1] as number) && bars[i].close > (lower[i] as number)) indexes.push(i);
    }
    if (direction === 'upper' && upper[i - 1] != null && upper[i] != null) {
      if (bars[i - 1].high >= (upper[i - 1] as number) && bars[i].close < (upper[i] as number)) indexes.push(i);
    }
  }
  return indexes;
}

// ---------- 5. 完整交易級回測 ----------

function emptyBacktestSummary(): StrategyBacktestSummary {
  return {
    trades: 0,
    wins: 0,
    winRate: null,
    avgR: null,
    profitFactor: null,
    netReturnPct: null,
    maxDrawdownPct: null,
    maxLosingStreak: 0,
    avgHoldDays: null,
  };
}

function simulateLongPullbackStrategy(
  bars: DailyBar[],
  sma50: (number | null)[],
  sma200: (number | null)[],
  atr14: (number | null)[],
  rsi14: (number | null)[],
  bb: BollingerBands,
  startIndex: number,
  endExclusive: number
): StrategyBacktestSummary {
  const trades: Array<{ r: number; returnPct: number; holdingDays: number }> = [];
  const oneWayCost = STRATEGY_CONFIG.oneWayCostBps / 10_000;
  let index = Math.max(startIndex, MIN_REQUIRED_BARS);

  while (index < endExclusive - 1) {
    const previousRsi = rsi14[index - 1];
    const currentRsi = rsi14[index];
    const previousLower = bb.lower[index - 1];
    const currentLower = bb.lower[index];
    const currentAtr = atr14[index];
    const strongTrend = classifyTrend(bars[index].close, sma50[index], sma200[index]) === 'strong';
    const rsiReversal = previousRsi != null && currentRsi != null && previousRsi < STRATEGY_CONFIG.oversoldRsi && currentRsi >= STRATEGY_CONFIG.oversoldRsi;
    const bandReentry = previousLower != null && currentLower != null
      && bars[index - 1].low <= previousLower
      && bars[index].close > currentLower;

    if (!strongTrend || currentAtr == null || (!rsiReversal && !bandReentry)) {
      index += 1;
      continue;
    }

    const entryIndex = index + 1;
    const entryTrigger = bars[index].high;
    const entryBar = bars[entryIndex];
    // 與 live 計劃一致：下一日必須突破 trigger 日高位才成交；跳空則按較差的開市價進場。
    if (entryBar.high < entryTrigger) {
      index += 1;
      continue;
    }
    const rawEntry = Math.max(entryBar.open, entryTrigger);
    const stop = rawEntry - STRATEGY_CONFIG.minimumStopAtr * currentAtr;
    const initialRisk = rawEntry - stop;
    const target = rawEntry + STRATEGY_CONFIG.target1R * initialRisk;
    const lastExitIndex = Math.min(entryIndex + STRATEGY_CONFIG.maxHoldingDays - 1, endExclusive - 1);

    let exitPrice = bars[lastExitIndex].close;
    let exitIndex = lastExitIndex;
    for (let cursor = entryIndex; cursor <= lastExitIndex; cursor++) {
      const bar = bars[cursor];
      // 開市跳空優先；若日內同時碰到 stop 和 target，採最差情況（先 stop）。
      if (bar.open <= stop) {
        exitPrice = bar.open;
        exitIndex = cursor;
        break;
      }
      if (bar.open >= target) {
        exitPrice = bar.open;
        exitIndex = cursor;
        break;
      }
      if (bar.low <= stop) {
        exitPrice = stop;
        exitIndex = cursor;
        break;
      }
      if (bar.high >= target) {
        exitPrice = target;
        exitIndex = cursor;
        break;
      }
    }

    const entryWithCosts = rawEntry * (1 + oneWayCost);
    const exitAfterCosts = exitPrice * (1 - oneWayCost);
    const netProfitPerShare = exitAfterCosts - entryWithCosts;
    const rMultiple = netProfitPerShare / initialRisk;
    const returnPct = netProfitPerShare / entryWithCosts;
    trades.push({ r: rMultiple, returnPct, holdingDays: exitIndex - entryIndex + 1 });
    index = exitIndex + 1;
  }

  if (!trades.length) return emptyBacktestSummary();

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let currentLosingStreak = 0;
  let maxLosingStreak = 0;

  for (const trade of trades) {
    equity *= 1 + trade.returnPct;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    if (trade.r > 0) {
      wins += 1;
      grossProfit += trade.r;
      currentLosingStreak = 0;
    } else {
      grossLoss += Math.abs(trade.r);
      currentLosingStreak += 1;
      maxLosingStreak = Math.max(maxLosingStreak, currentLosingStreak);
    }
  }

  return {
    trades: trades.length,
    wins,
    winRate: round1((wins / trades.length) * 100),
    avgR: round2(trades.reduce((sum, trade) => sum + trade.r, 0) / trades.length),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    netReturnPct: round2((equity - 1) * 100),
    maxDrawdownPct: round2(maxDrawdown * 100),
    maxLosingStreak,
    avgHoldDays: round1(trades.reduce((sum, trade) => sum + trade.holdingDays, 0) / trades.length),
  };
}

function buildStrategyBacktest(
  bars: DailyBar[],
  sma50: (number | null)[],
  sma200: (number | null)[],
  atr14: (number | null)[],
  rsi14: (number | null)[],
  bb: BollingerBands
): StrategyBacktest {
  // 時序分割：前 70% 只作研究樣本，最後 30% 用固定規則作 OOS 檢查。
  // 這不是參數最佳化器；任何日後調參都必須重新切分並保留未見 hold-out。
  const splitIndex = Math.max(MIN_REQUIRED_BARS + 1, Math.floor(bars.length * 0.7));
  return {
    name: '強勢趨勢下 RSI / 布林回歸做多（固定規則）',
    inSample: simulateLongPullbackStrategy(bars, sma50, sma200, atr14, rsi14, bb, MIN_REQUIRED_BARS, splitIndex),
    outOfSample: simulateLongPullbackStrategy(bars, sma50, sma200, atr14, rsi14, bb, splitIndex, bars.length),
    assumptions: `訊號日收市後下一日開市進場；${STRATEGY_CONFIG.maxHoldingDays} 日 time stop；1.0 ATR stop；${STRATEGY_CONFIG.target1R}R target；每邊 ${STRATEGY_CONFIG.oneWayCostBps} bps 成本；同日 stop / target 按 stop 優先。`,
    validationNote: '最後30%為固定規則的時序 OOS 檢查，不等同已完成所有 walk-forward 或過擬合檢定。',
  };
}

// ---------- 6. 交易計劃 ----------

function buildLongRecommendation(args: {
  bars: DailyBar[];
  signalClose: number;
  latestAtr: number;
  latestRsi: number | null;
  priorRsi: number | null;
  latestBbLower: number | null;
  priorBbLower: number | null;
  trend: 'strong' | 'neutral' | 'weak';
  nearestSupport: LevelCluster | null;
  nearestResistance: LevelCluster | null;
  recentReference: { low: RecentExtreme; high: RecentExtreme };
}): Recommendation {
  const {
    bars,
    signalClose,
    latestAtr,
    latestRsi,
    priorRsi,
    latestBbLower,
    priorBbLower,
    trend,
    nearestSupport,
    nearestResistance,
    recentReference,
  } = args;

  const last = bars.length - 1;
  const reasons: string[] = [];
  const isStrongTrend = trend === 'strong';
  const isWeakTrend = trend === 'weak';
  const belowBand = latestBbLower != null && signalClose <= latestBbLower;
  const rsiOversold = latestRsi != null && latestRsi < STRATEGY_CONFIG.oversoldRsi;
  const previousBelowBand = priorBbLower != null && bars[last - 1].low <= priorBbLower;
  const rsiReversal = priorRsi != null && latestRsi != null
    && priorRsi < STRATEGY_CONFIG.oversoldRsi
    && latestRsi >= STRATEGY_CONFIG.oversoldRsi;
  const bandReentry = previousBelowBand && latestBbLower != null && signalClose > latestBbLower;
  const supportDistance = nearestSupport ? signalClose - nearestSupport.avg : null;
  const nearConfirmedSupport = supportDistance != null
    && supportDistance >= 0
    && supportDistance <= latestAtr * STRATEGY_CONFIG.supportDistanceAtr;

  if (isWeakTrend) reasons.push('日線弱勢（收市 < SMA50 < SMA200），不做逆勢低吸。');
  if (!nearestSupport) reasons.push('未找到現價下方的確認支持區，不能設定結構性止蝕。');
  if (nearestSupport && !nearConfirmedSupport) reasons.push('確認支持區距離現價超過 2 ATR，風險回報不合格。');

  const hasSetup = isStrongTrend && nearConfirmedSupport && (rsiOversold || belowBand || previousBelowBand);
  const hasTrigger = isStrongTrend && nearConfirmedSupport && (rsiReversal || bandReentry);

  if (!isStrongTrend && !isWeakTrend) {
    reasons.push('日線趨勢中性，暫不啟動趨勢拉回型做多策略。');
  }

  if (!hasSetup) {
    if (!rsiOversold && !belowBand && !previousBelowBand) {
      reasons.push('未進入 RSI / 布林拉回 setup，沒有追入條件。');
    }
    return {
      status: 'NO_TRADE',
      action: '不交易',
      nextBuyPrice: null,
      nextSellPrice: null,
      tradePlan: null,
      reasons,
      basis: `策略 ${STRATEGY_VERSION}：現階段未同時滿足趨勢、確認支持與拉回 setup。近10日低位 ${round2(recentReference.low.price)} 僅作參考，不作直接入場依據。`,
    };
  }

  if (!hasTrigger) {
    reasons.push('已進入拉回觀察區，但未出現 RSI 重返30或收市重返布林下軌內的確認。');
    return {
      status: 'WATCH',
      action: '觀察反轉確認',
      nextBuyPrice: null,
      nextSellPrice: null,
      tradePlan: null,
      reasons,
      basis: `確認支持約 ${round2(nearestSupport!.avg)}；只在下一個已完成日線出現反轉 trigger 後才建立計劃。近10日低位 ${round2(recentReference.low.price)}(${recentReference.low.date}) 屬未確認參考。`,
    };
  }

  // 下一交易日採「突破 trigger 日高位才進場」的規則；避免把同一根日線收市假設為已成交。
  const entry = round2(bars[last].high);
  const structuralStop = nearestSupport!.avg - STRATEGY_CONFIG.stopBufferAtr * latestAtr;
  const minimumStop = entry - STRATEGY_CONFIG.minimumStopAtr * latestAtr;
  const initialStop = round2(Math.min(structuralStop, minimumStop));
  const riskPerShare = round2(entry - initialStop);
  const riskInAtr = riskPerShare / latestAtr;

  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0 || riskInAtr > STRATEGY_CONFIG.maximumRiskAtr) {
    reasons.push(`初始風險 ${round2(riskInAtr)} ATR，不在策略容許範圍內。`);
    return {
      status: 'NO_TRADE',
      action: '不交易',
      nextBuyPrice: null,
      nextSellPrice: null,
      tradePlan: null,
      reasons,
      basis: '反轉條件雖出現，但結構止蝕距離過遠或無效，拒絕建立交易計劃。',
    };
  }

  const minimumTarget = entry + STRATEGY_CONFIG.target1R * riskPerShare;
  const structuralTarget = nearestResistance?.avg ?? entry + STRATEGY_CONFIG.target2R * riskPerShare;
  const target1 = round2(Math.min(structuralTarget, minimumTarget));
  const rewardRiskToT1 = round2((target1 - entry) / riskPerShare);

  if (rewardRiskToT1 < STRATEGY_CONFIG.target1R) {
    reasons.push(`下一個阻力只提供 ${rewardRiskToT1}R，低於最低 ${STRATEGY_CONFIG.target1R}R 要求。`);
    return {
      status: 'NO_TRADE',
      action: '不交易',
      nextBuyPrice: null,
      nextSellPrice: null,
      tradePlan: null,
      reasons,
      basis: '反轉確認已出現，但最近阻力太近，預期回報不足以補償初始風險。',
    };
  }

  const higherResistance = nearestResistance && nearestResistance.avg > target1
    ? nearestResistance.avg
    : entry + STRATEGY_CONFIG.target2R * riskPerShare;
  const target2 = round2(Math.max(higherResistance, entry + STRATEGY_CONFIG.target2R * riskPerShare));

  reasons.push('強勢日線趨勢、確認支持區和 completed-bar 反轉 trigger 同時成立。');
  return {
    status: 'TRADEABLE',
    action: '確認後做多計劃',
    nextBuyPrice: entry,
    nextSellPrice: target1,
    tradePlan: {
      entry,
      initialStop,
      target1,
      target2,
      riskPerShare,
      rewardRiskToT1,
      maxHoldingDays: STRATEGY_CONFIG.maxHoldingDays,
      entryRule: `下一個美股交易日，價格突破 trigger 日高位 $${entry} 才進場；若未觸及，不成交。`,
      invalidation: `跌穿 $${initialStop} 即失效；若開市跳空跌穿，按可得開市價退出。`,
    },
    reasons,
    basis: `確認支持 ${round2(nearestSupport!.avg)}（${nearestSupport!.touches} 次 swing 觸及）；目標一以 ${STRATEGY_CONFIG.target1R}R 與下一阻力共同限制。`,
  };
}

// ---------- 7. 主分析函數 ----------

export function analyzeSymbol(
  inputBars: DailyBar[],
  config: {
    direction: 'long' | 'short';
    livePrice?: number;
    priceSource?: PriceSource;
    priceTimestamp?: string;
    analysisAsOf?: string;
  }
): AnalysisResult {
  const bars = normalizeBars(inputBars);
  if (bars.length < MIN_REQUIRED_BARS) {
    throw new Error(`數據不足，至少需要 ${MIN_REQUIRED_BARS} 個交易日先可以計算日線策略`);
  }

  const closes = bars.map((bar) => bar.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const atr14 = atr(bars);
  const volumes = volumeStats(bars);
  const rsi14 = rsi(closes);
  const bb = bollingerBands(closes);

  const last = bars.length - 1;
  const signalClose = closes[last];
  const latestClose = config.livePrice ?? signalClose;
  const latestAtr = atr14[last];
  if (latestAtr == null || latestAtr <= 0) {
    throw new Error('ATR 資料不足或無效，不能建立風險計劃');
  }

  const latestRsi = rsi14[last];
  const latestBbUpper = bb.upper[last];
  const latestBbLower = bb.lower[last];
  let bollingerPosition: 'above_upper' | 'below_lower' | 'inside' | null = null;
  if (latestBbUpper != null && latestBbLower != null) {
    if (signalClose > latestBbUpper) bollingerPosition = 'above_upper';
    else if (signalClose < latestBbLower) bollingerPosition = 'below_lower';
    else bollingerPosition = 'inside';
  }

  // 趨勢與訊號只以完成日線的收市價判斷，不受 price endpoint 的盤中更新影響。
  const trend = classifyTrend(signalClose, sma50[last], sma200[last]);
  const recentBars = bars.slice(-STRATEGY_CONFIG.supportLookback);
  const { lows, highs } = findSwingPoints(recentBars);
  const tolerance = latestAtr * 0.75;
  const supportClusters = clusterLevels(lows, tolerance).filter((cluster) => cluster.avg < signalClose);
  const resistanceClusters = clusterLevels(highs, tolerance).filter((cluster) => cluster.avg > signalClose);
  const nearestSupport = [...supportClusters].sort((a, b) => b.avg - a.avg)[0] || null;
  const nearestResistance = [...resistanceClusters].sort((a, b) => a.avg - b.avg)[0] || null;
  const recentReference = findRecentExtreme(bars);

  const oversoldReversalTriggers = findCrossings(rsi14, STRATEGY_CONFIG.oversoldRsi, 'crossAbove');
  const overboughtReversalTriggers = findCrossings(rsi14, 70, 'crossBelow');
  const bbLowerTriggers = findBollingerReentries(bars, bb.lower, bb.upper, 'lower');
  const bbUpperTriggers = findBollingerReentries(bars, bb.lower, bb.upper, 'upper');
  const historicalStats = {
    oversoldBounce: backtestSignal(bars, oversoldReversalTriggers, 10, 0.05, 'up', 'RSI重返30後10日內反彈≥5%'),
    overboughtPullback: backtestSignal(bars, overboughtReversalTriggers, 10, 0.05, 'down', 'RSI跌回70後10日內回落≥5%'),
    bollingerLowerBounce: backtestSignal(bars, bbLowerTriggers, 10, 0.05, 'up', '重返布林下軌內後10日內反彈≥5%'),
    bollingerUpperPullback: backtestSignal(bars, bbUpperTriggers, 10, 0.05, 'down', '跌回布林上軌內後10日內回落≥5%'),
  };

  const recommendation = config.direction === 'long'
    ? buildLongRecommendation({
        bars,
        signalClose,
        latestAtr,
        latestRsi,
        priorRsi: rsi14[last - 1],
        latestBbLower,
        priorBbLower: bb.lower[last - 1],
        trend,
        nearestSupport,
        nearestResistance,
        recentReference,
      })
    : {
        status: 'NO_TRADE' as const,
        action: '不交易',
        nextBuyPrice: null,
        nextSellPrice: null,
        tradePlan: null,
        reasons: ['TQQQ short 並非 long 邏輯的對稱策略，未有獨立回測前不顯示做空指令。'],
        basis: '目前模組只驗證 TQQQ 日線做多拉回規則。',
      };

  return {
    latestDate: bars[last].date,
    latestClose,
    signalClose,
    analysisAsOf: config.analysisAsOf ?? new Date().toISOString(),
    data: {
      priceSource: config.priceSource ?? (config.livePrice != null ? 'twelve_data_price' : 'prior_close'),
      priceTimestamp: config.priceTimestamp ?? new Date().toISOString(),
      lastCompletedDailyBar: bars[last].date,
      adjustmentBasis: 'splits',
      signalUsesCompletedDailyBar: true,
    },
    indicators: {
      sma20: sma20[last],
      sma50: sma50[last],
      sma200: sma200[last],
      atr14: latestAtr,
      avgVolume20: volumes.latestAverage,
      latestVolume: volumes.latestVolume,
      volumeSpikeRatio: volumes.volumeSpikeRatio,
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
    strategyBacktest: buildStrategyBacktest(bars, sma50, sma200, atr14, rsi14, bb),
    recommendation,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
