import { WATCHLIST, analyzeSymbol, fetchDailyHistory, fetchLivePrice } from './indexAnalysis';
import { runHKScannerV1 } from './hkScannerV1';
import { runUSScannerV3_7 } from './usScannerV3_7';
import { buildCapitalPlan, estimateUsCapitalFeasibility, type CapitalSettingsInput } from './capitalSettings';

// Compatibility boundary: deployment must use the matching scanner files, but this
// cast prevents a stale one-argument scanner from breaking the whole build while
// a repository is being updated. The complete release includes the two-argument versions.
type CapitalAwareScanner<T> = (thresholdSoftenerActive?: boolean, capitalSettings?: CapitalSettingsInput) => Promise<T>;
const runHKScannerWithCapital = runHKScannerV1 as unknown as CapitalAwareScanner<Awaited<ReturnType<typeof runHKScannerV1>>>;
const runUSScannerWithCapital = runUSScannerV3_7 as unknown as CapitalAwareScanner<Awaited<ReturnType<typeof runUSScannerV3_7>>>;

export type TodayPicksMarket = 'HK' | 'US' | 'CLOSED';

function localParts(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '0';
  return { weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}

export function getTodayPicksMarket(now = new Date()): TodayPicksMarket {
  const hk = localParts('Asia/Hong_Kong', now);
  const ny = localParts('America/New_York', now);
  const hkMinutes = hk.hour * 60 + hk.minute;
  const nyMinutes = ny.hour * 60 + ny.minute;
  if (['Sat', 'Sun'].includes(hk.weekday)) return 'CLOSED';
  if ((hkMinutes >= 570 && hkMinutes < 720) || (hkMinutes >= 780 && hkMinutes < 960)) return 'HK';
  if (!['Sat', 'Sun'].includes(ny.weekday) && nyMinutes >= 570 && nyMinutes < 960) return 'US';
  return 'CLOSED';
}

export async function runTodayPicks(thresholdSoftenerActive = false, capitalSettings?: CapitalSettingsInput) {
  const market = getTodayPicksMarket();
  const generatedAt = new Date().toISOString();
  if (market === 'CLOSED') {
    return {
      market,
      generatedAt,
      title: '目前不在港股或美股正規短炒時段',
      recommendations: [],
      notice: '今日心水只在港股 09:30–12:00／13:00–16:00，或美股香港時間對應的正規交易時段產生。',
    };
  }

  if (market === 'HK') {
    const result = await runHKScannerWithCapital(thresholdSoftenerActive, capitalSettings);
    return {
      market,
      generatedAt,
      title: '今日心水（港股）',
      notice: result.marketClosedNotice || null,
      recommendations: result.recommendations,
      scanner: { tradeabilityThreshold: result.tradeabilityThreshold, qualifiedCandidates: result.qualifiedCandidates, marketPhase: result.marketPhase, capitalPlan: result.capitalPlan || buildCapitalPlan(capitalSettings) },
    };
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const [us, indices] = await Promise.all([
    runUSScannerWithCapital(thresholdSoftenerActive, capitalSettings),
    apiKey ? scanIndices(apiKey, capitalSettings) : Promise.resolve([]),
  ]);
  return {
    market,
    generatedAt,
    title: '今日心水（美股＋指數）',
    notice: us.marketClosedNotice || (!apiKey ? '未設定 TWELVE_DATA_API_KEY，暫不加入指數心水。' : null),
    recommendations: [...us.recommendations, ...indices],
    scanner: { tradeabilityThreshold: us.tradeabilityThreshold, qualifiedCandidates: us.qualifiedCandidates, marketPhase: us.marketPhase, capitalPlan: us.capitalPlan || buildCapitalPlan(capitalSettings) },
  };
}

async function scanIndices(apiKey: string, capitalSettings?: CapitalSettingsInput) {
  const capitalPlan = buildCapitalPlan(capitalSettings);
  const fxToHKD = Number(process.env.USDHKD_RATE ?? 7.8);
  const output = [];
  for (const item of WATCHLIST) {
    const bars = await fetchDailyHistory(item.symbol, apiKey, 10);
    const livePriceResult = await fetchLivePrice(item.symbol, apiKey)
      .then((price) => ({ price, source: 'twelve_data_price' as const, timestamp: new Date().toISOString() }))
      .catch(() => ({ price: null, source: 'prior_close' as const, timestamp: new Date().toISOString() }));
    const analysis = analyzeSymbol(bars, {
      symbol: item.symbol,
      direction: item.direction,
      livePrice: livePriceResult.price ?? undefined,
      priceSource: livePriceResult.source,
      priceTimestamp: livePriceResult.timestamp,
      analysisAsOf: new Date().toISOString(),
    });
    if (analysis.recommendation.status === 'TRADEABLE') {
      const tradePlan = analysis.recommendation.tradePlan;
      const costAfter = tradePlan ? estimateUsCapitalFeasibility({ entryPrice: tradePlan.entry, targetPrice: tradePlan.target1, capitalPlan, fxToHKD, oneWayCostBps: Number(process.env.INDEX_ONE_WAY_SLIPPAGE_BPS ?? 5), minimumNetProfitHKD: Number(process.env.MIN_NET_PROFIT_HKD ?? 500) }) : null;
      if (costAfter && !costAfter.feasible) continue;
      output.push({
        symbol: item.symbol,
        stockName: item.name,
        currentPrice: analysis.latestClose,
        triggerReason: analysis.recommendation.basis,
        recommendationReasons: analysis.recommendation.reasons,
        takeProfitPrice: analysis.recommendation.tradePlan?.target1 ?? null,
        stopLossPrice: analysis.recommendation.tradePlan?.initialStop ?? null,
        confidence: null,
        tradeabilityScore: null,
        category: 'index',
        analysis,
        capitalPlan,
        capitalFeasibility: costAfter,
      });
    }
  }
  return output;
}
