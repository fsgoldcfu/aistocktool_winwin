// app/api/scan/route.ts
// 美股掃描 API — 接你嘅 usScannerV3_7.ts 邏輯（內建 15分鐘 Cache + 節流）

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { runUSScannerV3_7 } from '@/lib/usScannerV3_7'

export async function POST(req: NextRequest) {
  try {
    // 1. 驗證用戶已登入
    const supabase = createServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 })
    }

    // 2. 驗證用戶已訂閱
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_subscribed')
      .eq('id', user.id)
      .single()

    if (!profile?.is_subscribed) {
      return NextResponse.json({ error: '需要有效訂閱' }, { status: 403 })
    }

    // 3. 解析請求參數
    const body = await req.json()
    const { thresholdSoftenerActive = false } = body

    // 4. 執行掃描（內建 Cache，15分鐘內重複請求直接返回，唔會重新 call Finnhub）
    const result = await runUSScannerV3_7(thresholdSoftenerActive)

    return NextResponse.json(result)

  } catch (error) {
    console.error('[API/scan] Error:', error)
    return NextResponse.json(
      { error: '掃描服務暫時不可用，請稍後再試' },
      { status: 500 }
    )
  }
}
