// app/api/index-scanner/route.ts
//
// 撳「更新」時前端call呢個endpoint。
// 只有TQQQ一隻symbol，所以直接一次過攞返5年真實歷史數據
// （唔使靜態寫死數據 —— 得一個symbol，一次API call已經好快，
//   數據仲會永遠係最新，唔會有斷更/過時嘅問題）。
//
// ⚠️ 如果你個repo用緊 Pages Router(pages/api)，將呢個檔案
// 改名放去 pages/api/index-scanner.ts，並改寫做:
//   export default async function handler(req: NextApiRequest, res: NextApiResponse) { ... }

import { WATCHLIST, fetchDailyHistory, fetchLivePrice, analyzeSymbol } from '@/lib/indexAnalysis';

export const maxDuration = 30;

export async function GET(request: Request) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const url = new URL(request.url);

  // 診斷用：加 ?debug=1 打開個URL，唔會洩露key本身，
  // 淨係話你知呢個deployment有冇讀到環境變數，方便核對緊邊個環境。
  if (url.searchParams.get('debug') === '1') {
    return Response.json({
      hasApiKey: Boolean(apiKey),
      apiKeyLength: apiKey ? apiKey.length : 0,
      vercelEnv: process.env.VERCEL_ENV || 'unknown',
      gitBranch: process.env.VERCEL_GIT_COMMIT_REF || 'unknown',
      deployedAt: new Date().toISOString(),
    });
  }

  if (!apiKey) {
    return Response.json(
      { error: '未設定 TWELVE_DATA_API_KEY（Vercel環境變數）' },
      { status: 500 }
    );
  }

  try {
    const item = WATCHLIST[0]; // TQQQ

    // 一次過攞10年daily歷史（單一symbol，一次call，唔使throttle；
    // 10年樣本數大好多，RSI/布林通道嘅歷史回測統計會更可靠）
    // + 同時攞返即市報價（daily bar嘅收盤價只反映上一個完整交易日，
    //   唔會update實時價格，所以要獨立攞多一個price endpoint）
    const [bars, livePrice] = await Promise.all([
      fetchDailyHistory(item.symbol, apiKey, 10),
      fetchLivePrice(item.symbol, apiKey).catch(() => null), // 即市報價攞唔到就fallback用daily收盤價
    ]);

    const analysis = analyzeSymbol(bars, {
      direction: item.direction,
      livePrice: livePrice ?? undefined,
    });
    const result = {
      symbol: item.symbol,
      name: item.name,
      direction: item.direction,
      priceIsLive: livePrice !== null,
      ...analysis,
    };

    return Response.json({
      generatedAt: new Date().toISOString(),
      results: [result],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    return Response.json({ error: message }, { status: 500 });
  }
}
