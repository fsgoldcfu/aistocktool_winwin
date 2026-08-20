import { runTodayPicks } from '@/lib/todayPicks';

export const maxDuration = 180;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const capitalSettings = {
      totalCapitalHKD: url.searchParams.has('capital') ? Number(url.searchParams.get('capital')) : undefined,
      dailyAllocationPercent: url.searchParams.has('dailyPct') ? Number(url.searchParams.get('dailyPct')) : undefined,
      maxOpenPositions: url.searchParams.has('positions') ? Number(url.searchParams.get('positions')) : undefined,
    };
    const result = await runTodayPicks(false, capitalSettings);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[API/today-picks] Error:', error);
    return Response.json({
      market: 'CLOSED',
      recommendations: [],
      notice: '今日心水資料暫時不可用，系統未產生交易建議。',
    }, { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } });
  }
}
