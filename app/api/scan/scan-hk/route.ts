// app/api/scan-hk/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { runHKScannerV1 } from '../../../lib/hkScannerV1'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { thresholdSoftenerActive = false } = body

    const result = await runHKScannerV1(thresholdSoftenerActive)

    // 轉換成 dashboard 期望嘅格式（同美股 route.ts 一致嘅 signals 結構）
    const signals = result.recommendations.map((rec) => ({
      id: rec.symbol + '-' + Date.now(),
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
      created_at: new Date().toISOString(),
      is_premium: false,
      // 港股直接係 HKD，唔需要匯率轉換
      capitalAllocatedHKD: rec.capitalAllocatedHKD,
      expectedProfitHKD: rec.expectedProfitHKD,
      isCounterTrend: rec.isCounterTrend,
    }))

    return NextResponse.json({
      success: true,
      market: 'HK',
      signals,
      marketPhase: result.marketPhase,
      isDownMarket: result.isDownMarket,
      nearMissCount: 0,
      totalScanned: result.totalScanned,
      marketClosedNotice: result.marketClosedNotice || null,
    })
  } catch (error) {
    console.error('[API/scan-hk] Error:', error)
    return NextResponse.json(
      { success: false, error: '港股掃描服務暫時不可用，請稍後再試' },
      { status: 500 }
    )
  }
}
