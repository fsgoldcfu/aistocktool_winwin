import { NextRequest, NextResponse } from 'next/server';
import { prewarmUsHistoryBatch } from '../../../lib/usHistoryPrewarm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const rawBatch = request.nextUrl.searchParams.get('batch');
  const batch = rawBatch == null ? Number.NaN : Number(rawBatch);
  if (!Number.isInteger(batch)) {
    return NextResponse.json({ success: false, error: '請提供整數 batch query parameter。' }, { status: 400 });
  }

  try {
    const result = await prewarmUsHistoryBatch(batch);
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '日線預熱失敗。';
    console.error('[API/history-prewarm] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
