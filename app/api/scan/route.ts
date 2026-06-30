// app/api/scan/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { runUSScannerV3_7 } from '../../../lib/usScannerV3_7'
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { thresholdSoftenerActive = false } = body
    const result = await runUSScannerV3_7(thresholdSoftenerActive)
    // 轉換成 dashboard 期望嘅格式
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
      // ===== 新增：港幣資金配置 + 逆市抗跌股標記 =====
      capitalAllocatedHKD: rec.capitalAllocatedHKD,
      expectedProfitHKD: rec.expectedProfitHKD,
      isCounterTrend: rec.isCounterTrend,
    }))
    return NextResponse.json({
      success: true,
      signals,
      usedSoftener: result.thresholdSoftenerActive,
      nearMissCount: 0,
      totalScanned: result.totalScanned,
      isDownMarket: result.isDownMarket,
    })
  } catch (error) {
    console.error('[API/scan] Error:', error)
    return NextResponse.json(
      { success: false, error: '掃描服務暫時不可用，請稍後再試' },
      { status: 500 }
    )
  }
}
