/*
  Shared US daily OHLCV cache for the fixed scanner universe.
  It contains public market data only. RLS deliberately has no anon/authenticated
  policies: browser clients cannot read or write it; server routes use the
  SUPABASE_SERVICE_ROLE_KEY kept only in Vercel.
*/

CREATE TABLE IF NOT EXISTS us_daily_history_cache (
  symbol text NOT NULL CHECK (symbol = upper(symbol) AND symbol ~ '^[A-Z0-9.\-]+$'),
  period text NOT NULL CHECK (period IN ('3mo')),
  candles jsonb NOT NULL,
  source_updated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, period),
  CHECK (jsonb_typeof(candles) = 'array'),
  CHECK (jsonb_array_length(candles) >= 20)
);

ALTER TABLE us_daily_history_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE us_daily_history_cache FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_us_daily_history_cache_updated_at
  ON us_daily_history_cache(updated_at DESC);
