import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { CandleData } from './yfinanceData';

const PERIOD = '3mo';
const MAX_CACHE_AGE_HOURS = Math.max(24, Number(process.env.US_HISTORY_CACHE_MAX_AGE_HOURS ?? 72));

export interface PersistedUsHistoryRecord {
  symbol: string;
  period: string;
  candles: CandleData[];
  sourceUpdatedAt: string;
  updatedAt: string;
}

export interface UsHistoryCacheReadResult {
  records: PersistedUsHistoryRecord[];
  freshSymbols: string[];
  staleSymbols: string[];
  persistenceAvailable: boolean;
  error?: string;
}

let adminClient: SupabaseClient | null | undefined;

function getAdminClient(): SupabaseClient | null {
  if (adminClient !== undefined) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    adminClient = null;
    return adminClient;
  }

  adminClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return adminClient;
}

function isValidCandle(value: unknown): value is CandleData {
  if (!value || typeof value !== 'object') return false;
  const candle = value as CandleData;
  return typeof candle.date === 'string'
    && candle.date.length >= 8
    && Number.isFinite(Number(candle.open))
    && Number.isFinite(Number(candle.high))
    && Number.isFinite(Number(candle.low))
    && Number.isFinite(Number(candle.close))
    && Number(candle.open) > 0
    && Number(candle.high) > 0
    && Number(candle.low) > 0
    && Number(candle.close) > 0
    && Number.isFinite(Number(candle.volume))
    && Number(candle.volume) >= 0;
}

function normalizePersistedCandles(value: unknown): CandleData[] | null {
  if (!Array.isArray(value) || value.length < 20 || !value.every(isValidCandle)) return null;
  const deduplicated = new Map<string, CandleData>();
  for (const candle of value) {
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) return null;
    deduplicated.set(candle.date, {
      date: candle.date,
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
    });
  }
  return Array.from(deduplicated.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function isFresh(updatedAt: string): boolean {
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) && (Date.now() - timestamp) <= MAX_CACHE_AGE_HOURS * 60 * 60 * 1000;
}

/**
 * 只在 server route / scanner 執行。資料表沒有 anon policy，service role 也絕不會傳給 client。
 */
export async function readUsDailyHistoryCache(symbols: string[]): Promise<UsHistoryCacheReadResult> {
  const client = getAdminClient();
  const normalizedSymbols = Array.from(new Set(symbols.map((symbol) => symbol.toUpperCase())));
  if (!client) {
    return { records: [], freshSymbols: [], staleSymbols: normalizedSymbols, persistenceAvailable: false, error: 'SUPABASE_SERVICE_ROLE_KEY 未設定。' };
  }

  try {
    const { data, error } = await client
      .from('us_daily_history_cache')
      .select('symbol, period, candles, source_updated_at, updated_at')
      .eq('period', PERIOD)
      .in('symbol', normalizedSymbols);
    if (error) throw error;

    const records: PersistedUsHistoryRecord[] = [];
    const freshSymbols: string[] = [];
    const staleSymbols: string[] = [];
    const seen = new Set<string>();

    for (const row of data ?? []) {
      const symbol = String(row.symbol ?? '').toUpperCase();
      const candles = normalizePersistedCandles(row.candles);
      if (!normalizedSymbols.includes(symbol) || !candles) continue;
      const updatedAt = String(row.updated_at ?? '');
      const sourceUpdatedAt = String(row.source_updated_at ?? updatedAt);
      records.push({ symbol, period: PERIOD, candles, sourceUpdatedAt, updatedAt });
      seen.add(symbol);
      if (isFresh(updatedAt)) freshSymbols.push(symbol);
      else staleSymbols.push(symbol);
    }

    for (const symbol of normalizedSymbols) if (!seen.has(symbol)) staleSymbols.push(symbol);
    return { records, freshSymbols, staleSymbols, persistenceAvailable: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown Supabase history cache error';
    console.warn(`[US History Cache] 讀取持久快取失敗；將啟用 quote fallback。${message}`);
    return { records: [], freshSymbols: [], staleSymbols: normalizedSymbols, persistenceAvailable: false, error: message };
  }
}

export async function upsertUsDailyHistoryCache(symbol: string, candles: CandleData[]): Promise<void> {
  const client = getAdminClient();
  if (!client) throw new Error('SUPABASE_SERVICE_ROLE_KEY 未設定，無法寫入日線持久快取。');
  const normalizedCandles = normalizePersistedCandles(candles);
  if (!normalizedCandles) throw new Error(`${symbol} 的日線資料格式不完整，拒絕寫入快取。`);

  const now = new Date().toISOString();
  const { error } = await client
    .from('us_daily_history_cache')
    .upsert({
      symbol: symbol.toUpperCase(),
      period: PERIOD,
      candles: normalizedCandles,
      source_updated_at: now,
      updated_at: now,
    }, { onConflict: 'symbol,period' });
  if (error) throw error;
}

export function isUsHistoryPersistenceConfigured(): boolean {
  return Boolean(getAdminClient());
}

export const US_HISTORY_CACHE_PERIOD = PERIOD;
export const US_HISTORY_CACHE_MAX_AGE_HOURS = MAX_CACHE_AGE_HOURS;
