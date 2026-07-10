// app/api/cron/route.ts
//
// 定時掃描排程：
// UTC 21:00（HKT 05:00）→ 美股收市後掃描，推介「明日留意名單」
// UTC 12:30（HKT 20:30）→ 美股開市前1小時複核，加入跳空過濾
//
// vercel.json 設定：
// { "crons": [
//   { "path": "/api/cron", "schedule": "0 21 * * 1-5" },
//   { "path": "/api/cron", "schedule": "30 12 * * 1-5" }
// ]}
//
// 環境變數：
// RESEND_API_KEY  → resend.com 免費攞
// NOTIFY_EMAIL    → 你嘅Email
// CRON_SECRET     → 自定義保護字串

import { NextRequest, NextResponse } from "next/server";
import { runUSScannerV3_7 } from "../../../lib/usScannerV3_7";
import { runMidtermScanner, type MidtermRecommendation } from "../../../lib/midtermScanner";
import { runHKMidtermScanner, type HKMidtermRecommendation } from "../../../lib/midtermScannerHK";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

// ==================== 判斷而家係咩掃描時段 ====================

function getScanMode(): "post_market" | "pre_market" {
  const utcHour = new Date().getUTCHours();
  const utcMinute = new Date().getUTCMinutes();
  // UTC 21:00 = HKT 05:00（收市後）
  // UTC 12:30 = HKT 20:30（開市前）
  if (utcHour === 21 && utcMinute < 30) return "post_market";
  if (utcHour === 12 && utcMinute >= 30) return "pre_market";
  // 手動觸發時，按UTC時間判斷
  return utcHour >= 12 && utcHour < 21 ? "pre_market" : "post_market";
}

// ==================== 開市跳空過濾 ====================
// 開市前複核時用，如果股票今日已高開>2%，從名單移除

async function filterGapUpStocks(signals: any[]): Promise<{
  filtered: any[];
  removed: string[];
}> {
  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";
  const filtered: any[] = [];
  const removed: string[] = [];

  for (const signal of signals) {
    try {
      const url = `https://finnhub.io/api/v1/quote?symbol=${signal.stock_code}&token=${FINNHUB_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { filtered.push(signal); continue; }
      const data = await res.json();

      const currentPrice = data.c || 0;
      const prevClose = data.pc || currentPrice;
      const changePercent = prevClose > 0 ? (currentPrice - prevClose) / prevClose : 0;

      // 如果而家價比推介價高超過3%，代表已經爆升，唔建議追入
      const entryPrice = signal.entry_price || signal.current_price || 0;
      const gapFromEntry = entryPrice > 0 ? (currentPrice - entryPrice) / entryPrice : 0;

      if (changePercent > 0.02 || gapFromEntry > 0.02) {
        // 高開>2% 或比推介價高>2%，移除
        removed.push(`${signal.stock_code}（已高開${(changePercent * 100).toFixed(1)}%，建議限價$${(entryPrice * 0.98).toFixed(2)}候低入）`);
        console.log(`[Cron] ⚠️ ${signal.stock_code} 已高開 ${(changePercent * 100).toFixed(1)}%，移除出名單`);
      } else {
        // 更新推介嘅即時價
        signal.current_price_live = currentPrice;
        signal.change_percent_live = changePercent;
        filtered.push(signal);
      }

      // 輕微節流避免Finnhub rate limit
      await new Promise(r => setTimeout(r, 500));
    } catch {
      filtered.push(signal); // 攞唔到數據就保留
    }
  }

  return { filtered, removed };
}

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
        from: "AI短炒神器 <onboarding@resend.dev>",
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

// ==================== Email 內文：收市後推介（明日留意名單）====================

function buildPostMarketEmail(signals: any[], midtermUS: MidtermRecommendation[], midtermHK: HKMidtermRecommendation[]): string {
  const hkDate = new Date().toLocaleDateString("zh-HK", { timeZone: "Asia/Hong_Kong", weekday: "long", month: "long", day: "numeric" });
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric" });

  const shortTermSection = signals.length > 0 ? `
    <h2 style="color:#f59e0b;border-bottom:1px solid #333;padding-bottom:8px;margin-top:0;">
      ⚡ 短炒留意名單（${tomorrowStr}）
    </h2>
    <div style="background:#1e2433;border-radius:8px;padding:12px;margin-bottom:16px;">
      <p style="color:#94a3b8;font-size:13px;margin:0 0 8px 0;">
        💡 <strong style="color:#f59e0b;">操作建議：</strong>
        以下係系統預篩嘅股票，建議喺美股開市（HKT 21:30）前掛好<strong style="color:#10b981;">限價單</strong>，
        入場價設喺「建議入場價」或以下，唔好市價追入。
      </p>
    </div>
    ${signals.map((signal, idx) => `
      <div style="background:#1a1f35;border-radius:12px;padding:16px;margin-bottom:12px;border-left:4px solid #f59e0b;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div>
            <span style="color:#fff;font-size:17px;font-weight:bold;">${idx + 1}. ${signal.stock_name} (${signal.stock_code})</span>
            <span style="background:#f59e0b22;color:#f59e0b;font-size:11px;padding:3px 8px;border-radius:12px;margin-left:8px;">
              信心 ${signal.confidence}%
            </span>
          </div>
          <span style="color:#64748b;font-size:12px;">Minervini ${signal.minervini_score || ''}分</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">昨收/推介入場</div>
            <div style="color:#fff;font-weight:bold;font-size:16px;">$${(signal.entry_price || signal.current_price || 0).toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止盈目標</div>
            <div style="color:#10b981;font-weight:bold;font-size:16px;">$${(signal.target_price || signal.take_profit_a || 0).toFixed(2)}</div>
          </div>
          <div style="background:#0d1224;padding:10px;border-radius:8px;text-align:center;">
            <div style="color:#64748b;font-size:11px;">止損</div>
            <div style="color:#ef4444;font-weight:bold;font-size:16px;">$${(signal.stop_loss || 0).toFixed(2)}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div style="background:#10b98122;border:1px solid #10b98144;padding:8px 12px;border-radius:8px;">
            <div style="color:#64748b;font-size:11px;">建議投入</div>
            <div style="color:#fff;font-weight:bold;">HK$${(signal.capitalAllocatedHKD || 50000).toLocaleString()}</div>
          </div>
          <div style="background:#10b98122;border:1px solid #10b98144;padding:8px 12px;border-radius:8px;">
            <div style="color:#64748b;font-size:11px;">預期利潤</div>
            <div style="color:#10b981;font-weight:bold;">HK$${Math.round(signal.expectedProfitHKD || 0).toLocaleString()}</div>
          </div>
        </div>
        ${signal.analysis ? `<p style="color:#64748b;font-size:12px;margin:8px 0 0 0;line-height:1.5;">${signal.analysis}</p>` : ""}
      </div>
    `).join("")}
  ` : `
    <div style="text-align:center;padding:30px;color:#64748b;">
      <p>今日暫時冇短炒推介符合條件</p>
    </div>
  `;

  const midtermSection = (midtermUS.length > 0 || midtermHK.length > 0) ? `
    <h2 style="color:#3b82f6;border-bottom:1px solid #333;padding-bottom:8px;margin-top:24px;">
      🎯 中短線機會（1-4週持倉）
    </h2>
    ${[...midtermUS.slice(0, 2), ...midtermHK.slice(0, 2)].map(rec => {
      const isUS = 'earningsDaysUntil' in rec;
      const r = rec as any;
      return `
        <div style="background:#1a1f35;border-radius:12px;padding:14px;margin-bottom:10px;border-left:4px solid #3b82f6;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span style="color:#fff;font-weight:bold;">${r.stockName} (${r.symbol}) ${isUS ? '🇺🇸' : '🇭🇰'}</span>
            <span style="background:#3b82f622;color:#3b82f6;font-size:11px;padding:2px 8px;border-radius:12px;">${r.triggerLabel}</span>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin:0 0 8px 0;">${r.triggerReason}</p>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
            <div style="text-align:center;background:#0d1224;padding:6px;border-radius:6px;">
              <div style="color:#64748b;font-size:10px;">入場</div>
              <div style="color:#fff;font-size:13px;font-weight:bold;">${isUS ? '$' : 'HK$'}${r.currentPrice.toFixed(2)}</div>
            </div>
            <div style="text-align:center;background:#0d1224;padding:6px;border-radius:6px;">
              <div style="color:#64748b;font-size:10px;">止盈一</div>
              <div style="color:#10b981;font-size:13px;font-weight:bold;">${isUS ? '$' : 'HK$'}${r.takeProfitA.toFixed(2)}</div>
            </div>
            <div style="text-align:center;background:#0d1224;padding:6px;border-radius:6px;">
              <div style="color:#64748b;font-size:10px;">止盈二</div>
              <div style="color:#10b981;font-size:13px;font-weight:bold;">${isUS ? '$' : 'HK$'}${r.takeProfitB.toFixed(2)}</div>
            </div>
            <div style="text-align:center;background:#0d1224;padding:6px;border-radius:6px;">
              <div style="color:#64748b;font-size:10px;">止損</div>
              <div style="color:#ef4444;font-size:13px;font-weight:bold;">${isUS ? '$' : 'HK$'}${r.stopLoss.toFixed(2)}</div>
            </div>
          </div>
          <p style="color:#64748b;font-size:11px;margin:6px 0 0 0;">⏱ ${r.holdingPeriod} · 信心 ${r.confidence}%</p>
        </div>
      `;
    }).join("")}
  ` : "";

  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="background:#0a0e1a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;max-width:600px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:20px;padding:16px;background:#1a1f35;border-radius:12px;">
        <div style="font-size:32px;margin-bottom:4px;">📈</div>
        <h1 style="color:#f59e0b;margin:0;font-size:20px;">AI短炒神器</h1>
        <p style="color:#64748b;margin:4px 0 0 0;font-size:13px;">明日留意名單 · ${hkDate}</p>
        <p style="color:#94a3b8;font-size:12px;margin:8px 0 0 0;">
          美股開市前（HKT 21:00-21:30）掛好限價單，唔好開市即追入
        </p>
      </div>
      ${shortTermSection}
      ${midtermSection}
      <div style="border-top:1px solid #333;margin-top:20px;padding-top:14px;text-align:center;">
        <p style="color:#475569;font-size:11px;margin:0;">⚠️ 以上分析僅供參考，唔構成投資建議。投資涉及風險，請自行判斷。</p>
        <p style="color:#475569;font-size:11px;margin:4px 0 0 0;">系統將於 HKT 20:30 再次複核名單，如有重大變動會再通知你。</p>
      </div>
    </body></html>
  `;
}

// ==================== Email 內文：開市前複核 ====================

function buildPreMarketEmail(filtered: any[], removed: string[]): string {
  const hkTime = new Date().toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit" });

  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="background:#0a0e1a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;max-width:600px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:20px;padding:16px;background:#1a1f35;border-radius:12px;">
        <div style="font-size:28px;margin-bottom:4px;">🔔</div>
        <h1 style="color:#f59e0b;margin:0;font-size:18px;">開市前1小時複核</h1>
        <p style="color:#64748b;margin:4px 0 0 0;font-size:13px;">HKT ${hkTime} · 距美股開市約1小時</p>
      </div>

      ${removed.length > 0 ? `
        <div style="background:#ef444422;border:1px solid #ef444444;border-radius:12px;padding:14px;margin-bottom:16px;">
          <p style="color:#ef4444;font-weight:bold;margin:0 0 8px 0;">⚠️ 以下股票已高開，建議唔好追入：</p>
          ${removed.map(r => `<p style="color:#94a3b8;font-size:13px;margin:4px 0;">• ${r}</p>`).join("")}
        </div>
      ` : ""}

      ${filtered.length > 0 ? `
        <div style="background:#10b98122;border:1px solid #10b98144;border-radius:12px;padding:14px;margin-bottom:16px;">
          <p style="color:#10b981;font-weight:bold;margin:0 0 8px 0;">✅ 以下股票仍然有效，可以考慮入場：</p>
          ${filtered.map(signal => `
            <div style="background:#0d1224;border-radius:8px;padding:10px;margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#fff;font-weight:bold;">${signal.stock_name} (${signal.stock_code})</span>
                <span style="color:#10b981;font-size:13px;">而家: $${(signal.current_price_live || signal.entry_price || 0).toFixed(2)}</span>
              </div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px;">
                <div style="text-align:center;">
                  <div style="color:#64748b;font-size:10px;">建議掛單價</div>
                  <div style="color:#f59e0b;font-size:13px;font-weight:bold;">$${(signal.entry_price || 0).toFixed(2)}</div>
                </div>
                <div style="text-align:center;">
                  <div style="color:#64748b;font-size:10px;">止盈</div>
                  <div style="color:#10b981;font-size:13px;font-weight:bold;">$${(signal.target_price || 0).toFixed(2)}</div>
                </div>
                <div style="text-align:center;">
                  <div style="color:#64748b;font-size:10px;">止損</div>
                  <div style="color:#ef4444;font-size:13px;font-weight:bold;">$${(signal.stop_loss || 0).toFixed(2)}</div>
                </div>
              </div>
            </div>
          `).join("")}
        </div>
        <div style="background:#1e2433;border-radius:8px;padding:12px;margin-bottom:16px;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">
            💡 <strong style="color:#f59e0b;">掛單建議：</strong>
            喺道瓊斯設定「限價單（Limit Order）」，
            入場價設喺建議掛單價或以下，等股票自然升上嚟。
            唔建議市價單追入。
          </p>
        </div>
      ` : `
        <div style="text-align:center;padding:30px;color:#64748b;">
          <p>今日所有推介股票已高開，建議觀望，唔好追入。</p>
        </div>
      `}

      <div style="border-top:1px solid #333;margin-top:16px;padding-top:12px;text-align:center;">
        <p style="color:#475569;font-size:11px;margin:0;">⚠️ 投資涉及風險，以上僅供參考。</p>
      </div>
    </body></html>
  `;
}

// ==================== CRON HANDLER ====================

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scanMode = getScanMode();
  console.log(`[Cron] 觸發時段：${scanMode === "post_market" ? "收市後掃描（HKT 05:00）" : "開市前複核（HKT 20:30）"}`);

  try {
    if (scanMode === "post_market") {
      // ===== 收市後掃描：生成明日留意名單 =====
      console.log("[Cron] 執行收市後短炒掃描...");

      const [scanResult, midtermUS, midtermHK] = await Promise.all([
        runUSScannerV3_7(false),
        runMidtermScanner(true).catch(() => ({ recommendations: [] as MidtermRecommendation[] })),
        runHKMidtermScanner(true).catch(() => ({ recommendations: [] as HKMidtermRecommendation[] })),
      ]);

      // 將 scanner 結果轉成 email 用嘅格式
      const signals = scanResult.recommendations.map(rec => ({
        stock_code: rec.symbol,
        stock_name: rec.stockName,
        entry_price: rec.currentPrice,
        target_price: rec.takeProfitPrice,
        stop_loss: rec.stopLossPrice,
        confidence: rec.confidence,
        analysis: rec.triggerReason,
        capitalAllocatedHKD: rec.capitalAllocatedHKD,
        expectedProfitHKD: rec.expectedProfitHKD,
      }));

      const hasSignals = signals.length > 0 || midtermUS.recommendations.length > 0 || midtermHK.recommendations.length > 0;

      if (hasSignals) {
        const subject = `📈 明日留意名單｜短炒${signals.length}隻 + 中短線${midtermUS.recommendations.length + midtermHK.recommendations.length}個機會`;
        const html = buildPostMarketEmail(signals, midtermUS.recommendations, midtermHK.recommendations);
        await sendEmail(subject, html);

        // 存入 cache 俾開市前複核用
        // 用環境變數傳唔到，改用全局變數暫存（Vercel serverless唔保證，但開市前1小時內通常同一instance）
        (global as any).__cronSignalCache = { signals, timestamp: Date.now() };
      } else {
        console.log("[Cron] 今日冚無推介，唔發Email");
      }

      return NextResponse.json({
        success: true,
        mode: "post_market",
        signalCount: signals.length,
        midtermCount: midtermUS.recommendations.length + midtermHK.recommendations.length,
        emailSent: hasSignals,
      });

    } else {
      // ===== 開市前複核：加入跳空過濾 =====
      console.log("[Cron] 執行開市前複核，檢查跳空...");

      // 攞之前收市後掃描嘅結果
      const cached = (global as any).__cronSignalCache;
      if (!cached || Date.now() - cached.timestamp > 20 * 60 * 60 * 1000) {
        // 超過20小時冚無cache，重新掃描
        const freshScan = await runUSScannerV3_7(true);
        (global as any).__cronSignalCache = {
          signals: freshScan.recommendations.map(rec => ({
            stock_code: rec.symbol,
            stock_name: rec.stockName,
            entry_price: rec.currentPrice,
            target_price: rec.takeProfitPrice,
            stop_loss: rec.stopLossPrice,
            confidence: rec.confidence,
            capitalAllocatedHKD: rec.capitalAllocatedHKD,
            expectedProfitHKD: rec.expectedProfitHKD,
          })),
          timestamp: Date.now(),
        };
      }

      const signals = (global as any).__cronSignalCache?.signals || [];

      // 跳空過濾
      const { filtered, removed } = await filterGapUpStocks(signals);

      const subject = filtered.length > 0
        ? `🔔 開市前複核｜${filtered.length}隻可入場，${removed.length}隻已高開跳過`
        : `⚠️ 開市前複核｜所有推介已高開，今日建議觀望`;

      const html = buildPreMarketEmail(filtered, removed);
      await sendEmail(subject, html);

      return NextResponse.json({
        success: true,
        mode: "pre_market",
        filteredCount: filtered.length,
        removedCount: removed.length,
        removed,
      });
    }

  } catch (error) {
    console.error("[Cron] Error:", error);
    return NextResponse.json({ success: false, error: "掃描失敗" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
