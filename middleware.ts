// middleware.ts
// 暫時停用所有登入保護

import { NextResponse } from 'next/server'

export function middleware() {
  return NextResponse.next()
}

export const config = {
  matcher: [],
}
