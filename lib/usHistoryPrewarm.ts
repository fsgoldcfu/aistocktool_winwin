import { yfinanceData, type HistoricalDataSource } from './yfinanceData';
import { upsertUsDailyHistoryCache } from './usHistoryPersistence';
import { US_STOCK_UNIVERSE } from './usScannerV3_7';

export const US_HISTORY_PREWARM_BATCH_SIZE = 6;
export const US_HISTORY_PREWARM_BATCH_COUNT = Math.ceil(US_STOCK_UNIVERSE.length / US_HISTORY_PREWARM_BATCH_SIZE);

export interface UsHistoryPrewarmResult {
  batch: number;
  batchCount: number;
  symbols: string[];
  updated: string[];
  skipped: Array<{ symbol: string; source: HistoricalDataSource; reason: string }>;
  failed: Array<{ symbol: string; reason: string }>;
  stoppedForProviderCooldown: boolean;
}

export async function prewarmUsHistoryBatch(batch: number): Promise<UsHistoryPrewarmResult> {
  if (!Number.isInteger(batch) || batch < 0 || batch >= US_HISTORY_PREWARM_BATCH_COUNT) {
    throw new Error(`batch 必須為 0 至 ${US_HISTORY_PREWARM_BATCH_COUNT - 1} 的整數。`);
  }

  const symbols = US_STOCK_UNIVERSE.slice(
    batch * US_HISTORY_PREWARM_BATCH_SIZE,
    (batch + 1) * US_HISTORY_PREWARM_BATCH_SIZE,
  );
  const result: UsHistoryPrewarmResult = {
    batch,
    batchCount: US_HISTORY_PREWARM_BATCH_COUNT,
    symbols,
    updated: [],
    skipped: [],
    failed: [],
    stoppedForProviderCooldown: false,
  };

  console.log(`[US History Prewarm] 開始 batch ${batch + 1}/${US_HISTORY_PREWARM_BATCH_COUNT}：${symbols.join(', ')}`);
  for (const symbol of symbols) {
    // 預熱必須重新向供應商取已收市的資料；stale cache 只用作供應商失敗時的安全退路。
    yfinanceData.invalidateFreshHistoryCache(symbol, '3mo');
    const history = await yfinanceData.fetchHistoricalDataWithMeta(symbol, '3mo');

    if (history.source === 'cooldown') {
      result.stoppedForProviderCooldown = true;
      result.skipped.push({ symbol, source: history.source, reason: history.error || 'Twelve Data 429 cooldown active.' });
      console.warn(`[US History Prewarm] ${symbol} 觸發供應商 cooldown，停止本 batch 避免重複消耗 credit。`);
      break;
    }
    if (history.source === 'budget-exhausted') {
      result.skipped.push({ symbol, source: history.source, reason: history.error || 'Local request budget reached.' });
      break;
    }
    if (history.candles.length < 20) {
      result.failed.push({ symbol, reason: history.error || `日線不足（source=${history.source}）` });
      continue;
    }

    try {
      await upsertUsDailyHistoryCache(symbol, history.candles);
      result.updated.push(symbol);
      console.log(`[US History Prewarm] 已更新 ${symbol}（${history.candles.length} bars；source=${history.source}）`);
    } catch (error) {
      result.failed.push({ symbol, reason: error instanceof Error ? error.message : 'Supabase upsert failed.' });
    }
  }

  console.log(`[US History Prewarm] batch ${batch + 1} 完成：更新=${result.updated.length}，略過=${result.skipped.length}，失敗=${result.failed.length}`);
  return result;
}
