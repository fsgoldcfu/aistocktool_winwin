import { NextRequest, NextResponse } from 'next/server';
import { scanHKMarket } from '@/lib/scannerV3_manus';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mode = 'linkage', riskLevel = 'medium' } = body;

    // Validate mode
    if (mode !== 'linkage' && mode !== 'risk') {
      return NextResponse.json({ error: 'Invalid mode. Must be "linkage" or "risk"' }, { status: 400 });
    }

    // Validate riskLevel
    if (!['high', 'medium', 'low'].includes(riskLevel)) {
      return NextResponse.json({ error: 'Invalid riskLevel. Must be "high", "medium", or "low"' }, { status: 400 });
    }

    // Call the scanner
    const result = await scanHKMarket({
      mode,
      riskLevel,
      softenerEnabled: false
    });

    // Format results for dashboard
    const signals = result.recommendations.map((rec, index) => ({
      id: `scan-${Date.now()}-${index}`,
      stock_code: rec.symbol,
      stock_name: rec.name,
      signal_type: 'buy',
      entry_price: rec.entryPrice,
      target_price: rec.takeProfit,
      stop_loss: rec.stopLoss,
      confidence: rec.confidence,
      analysis: rec.reason,
      timeframe: rec.profitStrategy.timing.includes('日內') ? 'intraday' : '1-3days',
      status: 'active',
      result_pct: null,
      is_premium: index >= 2, // First 2 are free, rest are premium
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: null,
      // Four-stage details
      stage1: {
        passed: rec.reason.includes('盤前早盤異動:🎯'),
        label: '量能異動',
        detail: rec.volumeRatio > 1.2 ? `量比 ${rec.volumeRatio.toFixed(1)}x` : '無顯著量能'
      },
      stage2: {
        passed: rec.reason.includes('新聞催化:🎯'),
        label: '新聞催化',
        detail: rec.reason.includes('新聞催化:🎯') ? '有利好新聞' : '無利好新聞'
      },
      stage3: {
        passed: rec.reason.includes('美股聯動:🎯'),
        label: '美股聯動',
        detail: mode === 'linkage' ? '前晚美股強勢帶動' : '無聯動'
      },
      stage4: {
        passed: rec.reason.includes('技術共振:🎯'),
        label: '技術共振',
        detail: `RSI ${rec.rsi} / MACD ${rec.macd}`
      },
      isFallback: false
    }));

    // If less than 3 recommendations, try softener mode
    let fallbackSignals: any[] = [];
    let usedSoftener = false;

    if (signals.length < 3) {
      const softenerResult = await scanHKMarket({
        mode,
        riskLevel,
        softenerEnabled: true
      });

      usedSoftener = true;

      fallbackSignals = softenerResult.recommendations.map((rec, index) => ({
        id: `scan-softener-${Date.now()}-${index}`,
        stock_code: rec.symbol,
        stock_name: rec.name,
        signal_type: 'buy',
        entry_price: rec.entryPrice,
        target_price: rec.takeProfit,
        stop_loss: rec.stopLoss,
        confidence: rec.confidence,
        analysis: rec.reason,
        timeframe: rec.profitStrategy.timing.includes('日內') ? 'intraday' : '1-3days',
        status: 'active',
        result_pct: null,
        is_premium: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        stage1: {
          passed: rec.reason.includes('盤前早盤異動:🎯'),
          label: '量能異動',
          detail: rec.volumeRatio > 1.2 ? `量比 ${rec.volumeRatio.toFixed(1)}x` : '無顯著量能'
        },
        stage2: {
          passed: rec.reason.includes('新聞催化:🎯'),
          label: '新聞催化',
          detail: rec.reason.includes('新聞催化:🎯') ? '有利好新聞' : '無利好新聞'
        },
        stage3: {
          passed: rec.reason.includes('美股聯動:🎯'),
          label: '美股聯動',
          detail: mode === 'linkage' ? '前晚美股強勢帶動' : '無聯動'
        },
        stage4: {
          passed: rec.reason.includes('技術共振:🎯'),
          label: '技術共振',
          detail: `RSI ${rec.rsi} / MACD ${rec.macd}`
        },
        isFallback: true
      }));
    }

    // Combine: original + softener results (max 5 total)
    const finalSignals = [...signals, ...fallbackSignals].slice(0, 5);

    // If still less than 3, add near-miss stocks as reference
    let nearMissData: any[] = [];
    if (finalSignals.length < 3) {
      const lastResult = usedSoftener
        ? await scanHKMarket({ mode, riskLevel, softenerEnabled: true })
        : result;

      nearMissData = lastResult.nearMissStocks.slice(0, 3 - finalSignals.length).map((nm, index) => ({
        id: `nearmiss-${Date.now()}-${index}`,
        stock_code: nm.symbol,
        stock_name: nm.name,
        signal_type: 'watch',
        entry_price: nm.currentPrice,
        target_price: nm.currentPrice + nm.atr * 1.5,
        stop_loss: nm.currentPrice - nm.atr * 2,
        confidence: 40,
        analysis: nm.eliminationReason,
        timeframe: '1-3days',
        status: 'active',
        result_pct: null,
        is_premium: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: null,
        stage1: { passed: false, label: '量能異動', detail: '未達標' },
        stage2: { passed: false, label: '新聞催化', detail: '無' },
        stage3: { passed: false, label: '美股聯動', detail: '無' },
        stage4: { passed: false, label: '技術共振', detail: '未達標' },
        isFallback: true,
        isNearMiss: true
      }));
    }

    const allSignals = [...finalSignals, ...nearMissData];

    return NextResponse.json({
      success: true,
      signals: allSignals,
      totalScanned: result.totalScanned,
      usedSoftener: signals.length < 3,
      nearMissCount: nearMissData.length,
      scannedAt: new Date().toISOString()
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API /scan] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
