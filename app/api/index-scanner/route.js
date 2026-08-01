// app/api/index-scanner/route.js
//
// 撳「更新」時前端call呢個endpoint，
// 一次過分析 道指(DIA)/納指(QQQ)/TQQQ/SQQQ/UVIX，
// 回傳每隻嘅趨勢、支持阻力、下一個買入/賣出建議價。
//
// ⚠️ 如果你個repo用緊 Pages Router(pages/api)，將呢個檔案
// 放去 pages/api/index-scanner.js，並改寫做:
//   export default async function handler(req, res) { ... res.json(...) }

import { WATCHLIST, fetchAllHistories, analyzeSymbol } from '../../../lib/indexAnalysis';

export const maxDuration = 60; // Vercel function timeout (5個symbol x 8秒throttle約需40秒)

export async function GET() {
  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: '未設定 TWELVE_DATA_API_KEY（Vercel環境變數）' },
      { status: 500 }
    );
  }

  try {
    const histories = await fetchAllHistories(WATCHLIST, apiKey);

    const results = WATCHLIST.map((item) => {
      const bars = histories[item.symbol];
      const analysis = analyzeSymbol(bars, { direction: item.direction });
      return {
        symbol: item.symbol,
        name: item.name,
        direction: item.direction,
        ...analysis,
      };
    });

    return Response.json({
      generatedAt: new Date().toISOString(),
      results,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
