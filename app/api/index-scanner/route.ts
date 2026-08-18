import { buildCapitalPlan, estimateUsCapitalFeasibility, type CapitalSettingsInput } from '../../../lib/capitalSettings';
import { WATCHLIST, fetchStaticIndexHistory, fetchLivePrice, analyzeSymbol } from '@/lib/indexAnalysis';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

export async function GET(request: Request) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const requestUrl = new URL(request.url);
  const capitalSettings: CapitalSettingsInput = {
    totalCapitalHKD: requestUrl.searchParams.has('capital') ? Number(requestUrl.searchParams.get('capital')) : undefined,
    dailyAllocationPercent: requestUrl.searchParams.has('dailyPct') ? Number(requestUrl.searchParams.get('dailyPct')) : undefined,
    maxOpenPositions: requestUrl.searchParams.has('positions') ? Number(requestUrl.searchParams.get('positions')) : undefined,
  };
  const capitalPlan = buildCapitalPlan(capitalSettings);
  const fxToHKD = Number(process.env.USDHKD_RATE ?? 7.8);
  const indexProfitGate = (analysis: any) => {
    const plan = analysis.recommendation?.tradePlan;
    if (!plan) return null;
    const shares = Math.floor((capitalPlan.capitalPerPositionHKD / fxToHKD) / plan.entry);
    return estimateUsCapitalFeasibility({ entryPrice: plan.entry, targetPrice: plan.target1, capitalPlan, fxToHKD, oneWayCostBps: Number(process.env.INDEX_ONE_WAY_SLIPPAGE_BPS ?? 5), minimumNetProfitHKD: Number(process.env.MIN_NET_PROFIT_HKD ?? 500) });
  };
  if (requestUrl.searchParams.get('debug') === '1' && process.env.NODE_ENV !== 'production') {
    return json({ hasApiKey: Boolean(apiKey), environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown' });
  }

  try {
    const results = [];
    for (const item of WATCHLIST) {
      const bars = fetchStaticIndexHistory(item.symbol);
      const livePriceResult = apiKey
        ? await fetchLivePrice(item.symbol, apiKey)
            .then((price) => ({ price, source: 'twelve_data_price' as const, timestamp: new Date().toISOString() }))
            .catch(() => ({ price: null, source: 'prior_close' as const, timestamp: new Date().toISOString() }))
        : { price: null, source: 'prior_close' as const, timestamp: new Date().toISOString() };
      const analysis = analyzeSymbol(bars, {
        symbol: item.symbol,
        direction: item.direction,
        livePrice: livePriceResult.price ?? undefined,
        priceSource: livePriceResult.source,
        priceTimestamp: livePriceResult.timestamp,
        analysisAsOf: new Date().toISOString(),
      });
      results.push({
        symbol: item.symbol,
        name: item.name,
        direction: item.direction,
        priceIsLive: livePriceResult.source === 'twelve_data_price',
        ...analysis,
        capitalPlan,
        capitalFeasibility: indexProfitGate(analysis),
      });
    }

    return json({
      status: 'OK',
      generatedAt: new Date().toISOString(),
      strategyVersion: 'multi-etf-daily-pullback-v3',
      historySource: 'project-static-completed-daily-bars',
      livePriceNotice: apiKey ? null : '未設定 TWELVE_DATA_API_KEY；指數只使用專案內最後完成日線的收市價，不顯示盤中現價。',
      results,
      capitalPlan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知錯誤';
    return json({ status: 'DATA_UNAVAILABLE', error: `指數資料暫不可用，系統未有產生交易計劃：${message}` }, 503);
  }
}
