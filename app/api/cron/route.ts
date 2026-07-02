// app/api/cron/route.ts
//
// Vercel Cron Job 定時觸發入口
// 設定方式：喺 repo 根目錄建立 vercel.json，加入以下內容：
//
// {
//   "crons": [
//     { "path": "/api/cron", "schedule": "0 9 * * 1-5" },   // 港股開市前（UTC 09:00 = HKT 17:00，提早掃）
//     { "path": "/api/cron", "schedule": "0 13 * * 1-5" }   // 美股開市前（UTC 13:00 = HKT 21:00）
//   ]
// }
//
// Resend 免費版：3,000封/月，完全夠用
// 申請：https://resend.com → 免費註冊 → 攞 API Key
// 環境變數：RESEND_API_KEY、NOTIFY_EMAIL（你想收通知嘅Email）

import { NextRequest, NextResponse } from "next/server";
import { runMidtermScanner, type MidtermRecommendation } from "../../../lib/midtermScanner";
import { runHKMidtermScanner, type HKMidtermRecommendation } from "../../../lib/midtermScannerHK";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "";

// 保護 cron endpoint，防止外部隨意觸發
const CRON_SECRET = process.env.CRON_SECRET || "";

// ==================== Email 發送 ====================

async function sendEmail(subject: string, htmlContent: string): Promise<boolean> {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    console.warn("[Cron] RESEND_API_KEY 或 NOTIFY_EMAIL 未設定，跳過發送 Email");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "AI短炒神器 <onboarding@resend.dev>", // Resend 免費版用呢個 from，唔需要自己域名
        to: [NOTIFY_EMAIL],
        subject,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      console.error("[Cron] Email 發送失敗:", await response.text());
      return false;
    }

    console.log(`[Cron] ✅ Email 已發送至 ${NOTIFY_EMAIL}`);
    return true;
  } catch (error) {
    console.error("[Cron] Email 發送 error:", error);
    return false;
  }
}

// ==================== Email 內文生成 ====================

function buildMidtermEmailHTML(
  usRecs: MidtermRecommendation[],
  hkRecs: HKMidtermRecommendation[]
): string {
  const hasUS = usRecs.length > 0;
  const hasHK = hkRecs.length > 0;

  const triggerLabelColor: Record<string, string> = {
    EARNINGS_DIP: "#f59e0b",
    STRONG_STOCK_PULLBACK: "#10b981",
    SECTOR_BREAKOUT: "#3b82f6",
  };

  const usSection = hasUS ? `
    <h2 style="color:#f59e0b;border-bottom:1px solid #333;padding-bottom:8px;">🇺🇸 美股中短線機會</h2>
    ${usRecs.map((rec) => `
      <div style="background:#1a1f35;border-radius:12px;padding:16px;margin-bottom:16px;border-left:4px solid ${triggerLabelColor[rec.triggerType] || "#888"}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="color:#fff;font-size:18px;font-weight:bold;">${rec.stockName} (${rec.symbol})</span>
          <span style="background:${triggerLabelColor[rec.triggerType]};color:#000;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:bold;">${rec.triggerLabel}</span>
        </div>
        <p style="color:#94a3b8;font-size:13px;margin:0 0 12px 0;">${rec.triggerReason}</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">入場參考</div>
            <div style="color:#fff;font-weight:bold;">$${rec.currentPrice.toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止盈第一批 (+${rec.takeProfitAPercent}%)</div>
            <div style="color:#10b981;font-weight:bold;">$${rec.takeProfitA.toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止盈第二批 (+${rec.takeProfitBPercent}%)</div>
            <div style="color:#10b981;font-weight:bold;">$${rec.takeProfitB.toFixed(2)}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止損 (-${rec.stopLossPercent}%)</div>
            <div style="color:#ef4444;font-weight:bold;">$${rec.stopLoss.toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">建議投入</div>
            <div style="color:#fff;font-weight:bold;">HK$${rec.suggestedCapitalHKD.toLocaleString()}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">AI 信心指數</div>
            <div style="color:#f59e0b;font-weight:bold;">${rec.confidence}%</div>
          </div>
        </div>
        ${rec.earningsDaysUntil ? `<p style="color:#f59e0b;font-size:12px;margin:10px 0 0 0;">📅 距出業績 ${rec.earningsDaysUntil} 日，過去 ${rec.earningsBeatCount}/4 季 beat 預期</p>` : ""}
        <p style="color:#64748b;font-size:12px;margin:8px 0 0 0;">⏱ 建議持倉：${rec.holdingPeriod}</p>
      </div>
    `).join("")}
  ` : "";

  const hkSection = hasHK ? `
    <h2 style="color:#f59e0b;border-bottom:1px solid #333;padding-bottom:8px;margin-top:24px;">🇭🇰 港股中短線機會</h2>
    ${hkRecs.map((rec) => `
      <div style="background:#1a1f35;border-radius:12px;padding:16px;margin-bottom:16px;border-left:4px solid ${triggerLabelColor[rec.triggerType] || "#888"}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="color:#fff;font-size:18px;font-weight:bold;">${rec.stockName} (${rec.symbol})</span>
          <span style="background:${triggerLabelColor[rec.triggerType]};color:#000;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:bold;">${rec.triggerLabel}</span>
        </div>
        <p style="color:#94a3b8;font-size:13px;margin:0 0 12px 0;">${rec.triggerReason}</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">入場參考</div>
            <div style="color:#fff;font-weight:bold;">HK$${rec.currentPrice.toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止盈第一批 (+${rec.takeProfitAPercent}%)</div>
            <div style="color:#10b981;font-weight:bold;">HK$${rec.takeProfitA.toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止盈第二批 (+${rec.takeProfitBPercent}%)</div>
            <div style="color:#10b981;font-weight:bold;">HK$${rec.takeProfitB.toFixed(2)}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止損 (-${rec.stopLossPercent}%)</div>
            <div style="color:#ef4444;font-weight:bold;">HK$${rec.stopLoss.toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">建議投入</div>
            <div style="color:#fff;font-weight:bold;">HK$${rec.suggestedCapitalHKD.toLocaleString()}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">AI 信心指數</div>
            <div style="color:#f59e0b;font-weight:bold;">${rec.confidence}%</div>
          </div>
        </div>
        <p style="color:#64748b;font-size:12px;margin:8px 0 0 0;">⏱ 建議持倉：${rec.holdingPeriod}</p>
      </div>
    `).join("")}
  ` : "";

  const noSignal = !hasUS && !hasHK ? `
    <div style="text-align:center;padding:40px;color:#64748b;">
      <p style="font-size:16px;">今日暫時冇強力中短線信號</p>
      <p style="font-size:13px;">系統會繼續監察，有機會先通知你</p>
    </div>
  ` : "";

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="background:#0a0e1a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;max-width:600px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="background:#f59e0b;width:48px;height:48px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:8px;">
          <span style="font-size:24px;">📈</span>
        </div>
        <h1 style="color:#fff;margin:0;font-size:22px;">AI短炒神器</h1>
        <p style="color:#64748b;margin:4px 0 0 0;font-size:13px;">中短線選股通知・${new Date().toLocaleDateString("zh-HK")}</p>
      </div>
      ${usSection}
      ${hkSection}
      ${noSignal}
      <div style="border-top:1px solid #333;margin-top:24px;padding-top:16px;text-align:center;">
        <p style="color:#475569;font-size:11px;margin:0;">⚠️ 以上分析僅供參考，唔構成投資建議。投資涉及風險，請自行判斷。</p>
        <p style="color:#475569;font-size:11px;margin:4px 0 0 0;">AI短炒神器 © ${new Date().getFullYear()}</p>
      </div>
    </body>
    </html>
  `;
}

// ==================== CRON HANDLER ====================

export async function GET(req: NextRequest) {
  // 驗證 cron secret（防止外部隨意觸發）
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[Cron] 定時掃描觸發");

  try {
    // 並行掃描美股同港股
    const [usResult, hkResult] = await Promise.all([
      runMidtermScanner(true),
      runHKMidtermScanner(true),
    ]);

    const hasAnySignal = usResult.hasNewSignals || hkResult.hasNewSignals;

    if (hasAnySignal) {
      const subject = `📈 AI短炒神器 - 中短線機會發現（美股${usResult.recommendations.length}個 + 港股${hkResult.recommendations.length}個）`;
      const html = buildMidtermEmailHTML(usResult.recommendations, hkResult.recommendations);
      await sendEmail(subject, html);
    } else {
      console.log("[Cron] 今日暫時冇強力信號，唔發 Email");
    }

    return NextResponse.json({
      success: true,
      hasSignals: hasAnySignal,
      us: { count: usResult.recommendations.length },
      hk: { count: hkResult.recommendations.length },
      emailSent: hasAnySignal,
    });

  } catch (error) {
    console.error("[Cron] Error:", error);
    return NextResponse.json({ success: false, error: "掃描失敗" }, { status: 500 });
  }
}

// 同時支援 POST（方便你手動觸發測試）
export async function POST(req: NextRequest) {
  return GET(req);
}
