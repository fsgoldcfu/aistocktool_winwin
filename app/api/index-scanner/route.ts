// app/api/index-scanner/route.ts
// 只分析 TQQQ 的已完成日線訊號；price endpoint 僅供現價顯示，不能改寫日線訊號。

import { WATCHLIST, fetchDailyHistory, fetchLivePrice, analyzeSymbol } from '@/lib/indexAnalysis';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function GET(request: Request) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const requestUrl = new URL(request.url);

  // 防止 deployment metadata 被公開枚舉；production 完全不提供 debug 資訊。
  if (requestUrl.searchParams.get('debug') === '1' && process.env.NODE_ENV !== 'production') {
    return json({
      hasApiKey: Boolean(apiKey),
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    });
  }

  if (!apiKey) {
    return json(
      {
        status: 'DATA_UNAVAILABLE',
        error: '未設定 TWELVE_DATA_API_KEY，系統不會產生交易計劃。',
      },
      503
    );
  }

  try {
    const item = WATCHLIST[0];
    const [bars, livePriceResult] = await Promise.all([
      fetchDailyHistory(item.symbol, apiKey, 10),
      fetchLivePrice(item.symbol, apiKey)
        .then((price) => ({ price, source: 'twelve_data_price' as const, timestamp: new Date().toISOString() }))
        .catch(() => ({ price: null, source: 'prior_close' as const, timestamp: new Date().toISOString() })),
    ]);

    const generatedAt = new Date().toISOString();
    const analysis = analyzeSymbol(bars, {
      direction: item.direction,
      livePrice: livePriceResult.price ?? undefined,
      priceSource: livePriceResult.source,
      priceTimestamp: livePriceResult.timestamp,
      analysisAsOf: generatedAt,
    });

    return json({
      status: 'OK',
      generatedAt,
      strategyVersion: 'tqqq-daily-pullback-v2',
      results: [
        {
          symbol: item.symbol,
          name: item.name,
          direction: item.direction,
          priceIsLive: livePriceResult.source === 'twelve_data_price',
          ...analysis,
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知錯誤';
    // Fail closed：資料不完整、限流或格式改變時不回傳貌似精確的買賣價。
    return json(
      {
        status: 'DATA_UNAVAILABLE',
        error: `指數資料暫不可用，系統未有產生交易計劃：${message}`,
      },
      503
    );
  }
}
