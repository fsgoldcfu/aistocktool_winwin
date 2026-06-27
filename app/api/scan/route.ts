// app/api/scan/route.ts
// 美股掃描 API（無需登入版本）

import { NextRequest, NextResponse } from 'next/server'
import { runUSScannerV3_7 } from '../../../lib/usScannerV3_7'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { thresholdSoftenerActive = false } = body

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
