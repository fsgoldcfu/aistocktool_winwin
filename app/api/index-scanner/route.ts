import { buildCapitalPlan, type CapitalSettingsInput } from '../../../lib/capitalSettings';
import { evaluateFutuUsStockNetProfit } from '../../../lib/shortTermRisk';
import { WATCHLIST, fetchDailyHistory, fetchLivePrice, analyzeSymbol } from '@/lib/indexAnalysis';

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
    if (shares < 1) return { feasible: false, shares, capitalAllocatedHKD: 0, estimatedNetProfitHKD: 0, reason: '每筆資金不足以買入 1 股。' };
    const result = evaluateFutuUsStockNetProfit({ entryPrice: plan.entry, targetPrice: plan.target1, shares, oneWaySlippageBps: Number(process.env.INDEX_ONE_WAY_SLIPPAGE_BPS ?? 5), fxToHKD, minimumNetProfitHKD: Number(process.env.MIN_NET_PROFIT_HKD ?? 500) });
    return { feasible: result.feasible, shares, capitalAllocatedHKD: shares * plan.entry * fxToHKD, estimatedNetProfitHKD: result.estimatedNetProfitHKD, estimatedCostsHKD: result.estimatedCostsHKD, minimumNetProfitHKD: result.minimumNetProfitHKD, reason: result.reason };
  };
  if (requestUrl.searchParams.get('debug') === '1' && process.env.NODE_ENV !== 'production') {
    return json({ hasApiKey: Boolean(apiKey), environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown' });
  }

  if (!apiKey) {
    return json({ status: 'DATA_UNAVAILABLE', error: '未設定 TWELVE_DATA_API_KEY，系統不會產生指數交易計劃。' }, 503);
  }

  try {
    const results = [];
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
      results,
      capitalPlan,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知錯誤';
    return json({ status: 'DATA_UNAVAILABLE', error: `指數資料暫不可用，系統未有產生交易計劃：${message}` }, 503);
  }
}
