import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export interface Profile {
  id: string
  email: string
  display_name: string | null
  full_name: string | null
  phone: string | null
  is_subscribed: boolean
  subscription_status: string | null
  subscribed_at: string | null
  subscription_expires_at: string | null
  created_at: string
  [key: string]: any
}

export interface StockSignal {
  id: string
  stock_code: string
  stock_name: string
  signal_type: string
  entry_price: number
  target_price: number
  stop_loss: number
  confidence: number
  reason: string
  analysis: string
  timeframe: string
  status: string
  result_pct: number | null
  created_at: string
  [key: string]: any
}
