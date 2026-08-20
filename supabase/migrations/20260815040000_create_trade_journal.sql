/*
  Trade journal for measuring actual or paper-traded scanner outcomes.
  This table stores user-entered fills and the original plan snapshot; it does not place orders.
*/

CREATE TABLE IF NOT EXISTS trade_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'paper' CHECK (mode IN ('paper', 'live')),
  market text NOT NULL CHECK (market IN ('US', 'HK')),
  symbol text NOT NULL,
  stock_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'open', 'closed', 'cancelled')),

  planned_entry numeric(18,6) NOT NULL,
  planned_target numeric(18,6) NOT NULL,
  planned_stop numeric(18,6) NOT NULL,
  planned_shares integer NOT NULL CHECK (planned_shares > 0),
  planned_cost_hkd numeric(18,2),
  planned_net_profit_hkd numeric(18,2),
  strategy_score numeric(8,2),
  tradeability_score numeric(8,2),
  catalyst_status text,
  catalyst_summary text,
  signal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  actual_entry numeric(18,6),
  actual_exit numeric(18,6),
  actual_shares integer CHECK (actual_shares IS NULL OR actual_shares > 0),
  settlement_fx_to_hkd numeric(12,6),
  actual_buy_cost_hkd numeric(18,2),
  actual_sell_cost_hkd numeric(18,2),
  actual_net_pnl_hkd numeric(18,2),
  actual_r_multiple numeric(12,4),
  exit_reason text CHECK (exit_reason IS NULL OR exit_reason IN ('target', 'stop', 'time_exit', 'manual', 'cancelled')),
  opened_at timestamptz,
  closed_at timestamptz,
  notes text NOT NULL DEFAULT '',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trade_journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trade journal entries"
  ON trade_journal_entries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trade journal entries"
  ON trade_journal_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trade journal entries"
  ON trade_journal_entries FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own trade journal entries"
  ON trade_journal_entries FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trade_journal_user_created
  ON trade_journal_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_journal_user_market_status
  ON trade_journal_entries(user_id, market, status);

CREATE OR REPLACE FUNCTION update_trade_journal_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trade_journal_updated_at ON trade_journal_entries;
CREATE TRIGGER trade_journal_updated_at
  BEFORE UPDATE ON trade_journal_entries
  FOR EACH ROW EXECUTE FUNCTION update_trade_journal_timestamp();
