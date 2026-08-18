'use client';

import { useState } from 'react';
import { capitalQuery, type UserCapitalSettings } from './CapitalSettingsPanel';
import { Clock, RefreshCw, Target, ShieldAlert, Sparkles } from 'lucide-react';

type TodayPick = {
  symbol: string;
  stockName?: string;
  currentPrice?: number;
  triggerReason?: string;
  recommendationReasons?: string[];
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  category?: string;
};

export function TodayPicksPanel({ capitalSettings }: { capitalSettings: UserCapitalSettings }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ market?: string; title?: string; notice?: string | null; recommendations?: TodayPick[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/today-picks${capitalQuery(capitalSettings)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.notice || '今日心水資料暫時不可用');
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : '今日心水資料暫時不可用');
    } finally {
      setLoading(false);
    }
  }

  const picks = data?.recommendations || [];
  return (
    <section className="mb-6 rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/10 to-[#0d1224] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-300" />
          <div>
            <h2 className="text-white font-bold">今日心水</h2>
            <p className="text-slate-400 text-xs">按香港時間自動選擇港股，或美股＋指數；只顯示通過完整規則的項目。</p>
          </div>
        </div>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-[#0a0e1a] disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? '分析中...' : '刷新今日心水'}
        </button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {data && <p className="mb-3 text-sm text-slate-300">{data.title}。{data.notice || '資料已按現時段更新。'}</p>}
      {data && picks.length === 0 && <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400"><Clock className="w-4 h-4" />暫時沒有合格訊號；系統不會為湊數而顯示交易建議。</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {picks.map((pick) => (
          <article key={`${pick.symbol}-${pick.category || 'stock'}`} className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 p-4">
            <div className="flex items-center justify-between mb-2"><div><span className="text-white font-bold">{pick.symbol}</span><span className="ml-2 text-xs text-slate-400">{pick.stockName || ''}</span></div><span className="text-xs text-emerald-300">合格</span></div>
            <div className="grid grid-cols-3 gap-2 text-xs mb-3">
              <div><span className="block text-slate-500">現價／觸發</span><span className="text-white">{pick.currentPrice ?? '—'}</span></div>
              <div><span className="block text-slate-500">止蝕</span><span className="text-red-300">{pick.stopLossPrice ?? '—'}</span></div>
              <div><span className="block text-slate-500">止盈</span><span className="text-emerald-300">{pick.takeProfitPrice ?? '—'}</span></div>
            </div>
            <p className="mb-2 text-xs text-slate-300">{pick.triggerReason || '已通過技術、風險回報及成本後盈利規則。'}</p>
            {(pick.recommendationReasons || []).slice(0, 3).map((reason) => <p key={reason} className="flex items-start gap-1 text-xs text-slate-500"><Target className="mt-0.5 w-3 h-3 shrink-0" />{reason}</p>)}
          </article>
        ))}
      </div>
      {!data && <p className="flex items-center gap-2 text-xs text-slate-500"><ShieldAlert className="w-3.5 h-3.5" />按刷新後才會依目前市場時段取得新資料。</p>}
    </section>
  );
}
