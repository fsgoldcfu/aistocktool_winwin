// app/api/scan-midterm/route.ts
import { NextRequest, NextResponse } from "next/server";
import { runMidtermScanner } from "../../../lib/midtermScanner";
import { runHKMidtermScanner } from "../../../lib/midtermScannerHK";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { market = "ALL", forceRefresh = false } = body;

    let usRecommendations: any[] = [];
    let hkRecommendations: any[] = [];

    if (market === "US" || market === "ALL") {
      const usResult = await runMidtermScanner(forceRefresh);
      usRecommendations = usResult.recommendations.map((rec) => ({
        id: `midterm-us-${rec.symbol}-${Date.now()}`,
        market: "US",
        stock_code: rec.symbol,
        stock_name: rec.stockName,
        current_price: rec.currentPrice,
        change_percent: rec.changePercent,

        trigger_type: rec.triggerType,
        trigger_label: rec.triggerLabel,
        trigger_reason: rec.triggerReason,

        // 分批止盈
        take_profit_a: rec.takeProfitA,
        take_profit_a_percent: rec.takeProfitAPercent,
        take_profit_b: rec.takeProfitB,
        take_profit_b_percent: rec.takeProfitBPercent,
        stop_loss: rec.stopLoss,
        stop_loss_percent: rec.stopLossPercent,

        // 資金
        suggested_capital_hkd: rec.suggestedCapitalHKD,
        expected_profit_a_hkd: rec.expectedProfitAHKD,
        expected_profit_b_hkd: rec.expectedProfitBHKD,

        // 技術面
        rsi: rec.rsi,
        week_high_52: rec.weekHigh52,
        week_low_52: rec.weekLow52,
        distance_from_52week_high: rec.distanceFrom52WeekHigh,

        // 業績
        earnings_days_until: rec.earningsDaysUntil,
        earnings_beat_count: rec.earningsBeatCount,

        confidence: rec.confidence,
        holding_period: rec.holdingPeriod,
        sector: rec.sector,
      }));
    }

    if (market === "HK" || market === "ALL") {
      const hkResult = await runHKMidtermScanner(forceRefresh);
      hkRecommendations = hkResult.recommendations.map((rec) => ({
        id: `midterm-hk-${rec.symbol}-${Date.now()}`,
        market: "HK",
        stock_code: rec.symbol,
        stock_name: rec.stockName,
        current_price: rec.currentPrice,
        change_percent: rec.changePercent,

        trigger_type: rec.triggerType,
        trigger_label: rec.triggerLabel,
        trigger_reason: rec.triggerReason,

        take_profit_a: rec.takeProfitA,
        take_profit_a_percent: rec.takeProfitAPercent,
        take_profit_b: rec.takeProfitB,
        take_profit_b_percent: rec.takeProfitBPercent,
        stop_loss: rec.stopLoss,
        stop_loss_percent: rec.stopLossPercent,

        suggested_capital_hkd: rec.suggestedCapitalHKD,
        expected_profit_a_hkd: rec.expectedProfitAHKD,
        expected_profit_b_hkd: rec.expectedProfitBHKD,

        rsi: rec.rsi,
        week_high_52: rec.weekHigh52,
        week_low_52: rec.weekLow52,
        distance_from_52week_high: rec.distanceFrom52WeekHigh,

        confidence: rec.confidence,
        holding_period: rec.holdingPeriod,
        sector: rec.sector,
      }));
    }

    // 美股優先，之後港股，最後按信心排序
    const allRecommendations = [
      ...usRecommendations.filter((r) => r.trigger_type === "EARNINGS_DIP"),
      ...hkRecommendations.filter((r) => r.trigger_type === "EARNINGS_DIP"),
      ...usRecommendations.filter((r) => r.trigger_type !== "EARNINGS_DIP"),
      ...hkRecommendations.filter((r) => r.trigger_type !== "EARNINGS_DIP"),
    ].sort((a, b) => {
      if (a.trigger_type === "EARNINGS_DIP" && b.trigger_type !== "EARNINGS_DIP") return -1;
      if (a.trigger_type !== "EARNINGS_DIP" && b.trigger_type === "EARNINGS_DIP") return 1;
      return b.confidence - a.confidence;
    });

    return NextResponse.json({
      success: true,
      recommendations: allRecommendations,
      totalUS: usRecommendations.length,
      totalHK: hkRecommendations.length,
      scanTime: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[API/scan-midterm] Error:", error);
    return NextResponse.json(
      { success: false, error: "中短線掃描服務暫時不可用，請稍後再試" },
      { status: 500 }
    );
  }
}
