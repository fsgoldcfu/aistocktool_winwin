/*
  # StockSignal 玄金操盤手 - Database Schema

  1. New Tables
    - `profiles`
      - `id` (uuid, FK to auth.users)
      - `email` (text)
      - `full_name` (text)
      - `phone` (text)
      - `subscription_status` (text: 'free' | 'active' | 'expired' | 'cancelled')
      - `subscription_expires_at` (timestamptz)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `stock_signals`
      - `id` (uuid, primary key)
      - `stock_code` (text) - HK stock code e.g. "0700.HK"
      - `stock_name` (text)
      - `signal_type` (text: 'buy' | 'sell' | 'watch')
      - `entry_price` (numeric)
      - `target_price` (numeric)
      - `stop_loss` (numeric)
      - `confidence` (integer 1-100)
      - `analysis` (text)
      - `timeframe` (text: 'intraday' | '1-3days' | '1week')
      - `status` (text: 'active' | 'closed' | 'cancelled')
      - `result_pct` (numeric, nullable)
      - `is_premium` (boolean)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `created_by` (uuid, FK to auth.users)

    - `signal_views`
      - `id` (uuid, primary key)
      - `signal_id` (uuid, FK to stock_signals)
      - `user_id` (uuid, FK to auth.users)
      - `viewed_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Profiles: users can read/update their own profile
    - Stock signals: free signals visible to all authenticated users; premium signals only for active subscribers
    - Signal views: users can insert/read their own views
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text DEFAULT '',
  phone text DEFAULT '',
  subscription_status text NOT NULL DEFAULT 'free',
  subscription_expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Stock signals table
CREATE TABLE IF NOT EXISTS stock_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_code text NOT NULL,
  stock_name text NOT NULL,
  signal_type text NOT NULL DEFAULT 'buy',
  entry_price numeric(10,3) NOT NULL,
  target_price numeric(10,3) NOT NULL,
  stop_loss numeric(10,3) NOT NULL,
  confidence integer NOT NULL DEFAULT 70,
  analysis text DEFAULT '',
  timeframe text NOT NULL DEFAULT '1-3days',
  status text NOT NULL DEFAULT 'active',
  result_pct numeric(6,2),
  is_premium boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE stock_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view free signals"
  ON stock_signals FOR SELECT
  TO authenticated
  USING (
    is_premium = false
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.subscription_status = 'active'
      AND (profiles.subscription_expires_at IS NULL OR profiles.subscription_expires_at > now())
    )
  );

CREATE POLICY "Admins can insert signals"
  ON stock_signals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can update signals"
  ON stock_signals FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Signal views table
CREATE TABLE IF NOT EXISTS signal_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES stock_signals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz DEFAULT now()
);

ALTER TABLE signal_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own signal views"
  ON signal_views FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own signal views"
  ON signal_views FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stock_signals_created_at ON stock_signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_signals_status ON stock_signals(status);
CREATE INDEX IF NOT EXISTS idx_stock_signals_is_premium ON stock_signals(is_premium);
CREATE INDEX IF NOT EXISTS idx_signal_views_user_id ON signal_views(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status ON profiles(subscription_status);
