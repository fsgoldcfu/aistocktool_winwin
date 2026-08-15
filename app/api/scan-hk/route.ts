// app/api/scan-hk/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runHKScannerV1 } from '../../../lib/hkScannerV1';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const thresholdSoftenerActive = body?.thresholdSoftenerActive === true;
    const result = await runHKScannerV1(thresholdSoftenerActive);
    const generatedAt = new Date().toISOString();

    const signals = result.recommendations.map((rec) => ({
      id: `${rec.symbol}-${generatedAt}`,
      stock_code: rec.symbol,
      stock_name: rec.stockName,
      signal_type: 'buy',
      entry_price: rec.currentPrice,
      target_price: rec.takeProfitPrice,
      stop_loss: rec.stopLossPrice,
      confidence: rec.confidence,
      reason: rec.triggerReason,
      analysis: rec.triggerReason,
      timeframe: 'intraday',
      status: 'active',
      result_pct: null,
      created_at: generatedAt,
      is_premium: false,
      capitalAllocatedHKD: rec.capitalAllocatedHKD,
      expectedProfitHKD: rec.expectedProfitHKD,
      isCounterTrend: rec.isCounterTrend,
      riskRewardRatio: rec.riskRewardRatio,
      atrPercent: rec.atrPercent,
      entryRule: rec.entryRule,
      invalidation: rec.invalidation,
      maxHoldingMinutes: rec.maxHoldingMinutes,
      tradeabilityScore: rec.tradeabilityScore,
      tradeabilityReason: rec.tradeabilityReason,
      resistanceLevel: rec.resistanceLevel,
      resistanceSource: rec.resistanceSource,
    }));

    return NextResponse.json(
      {
        success: true,
        market: 'HK',
        signals,
        marketPhase: result.marketPhase,
        isDownMarket: result.isDownMarket,
        totalScanned: result.totalScanned,
        marketClosedNotice: result.marketClosedNotice || null,
        tradeabilityThreshold: result.tradeabilityThreshold,
        qualifiedCandidates: result.qualifiedCandidates,
        generatedAt,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[API/scan-hk] Error:', error);
    return NextResponse.json(
      { success: false, error: '港股掃描資料暫時不可用，系統未產生交易訊號。' },
      { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
