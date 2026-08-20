'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, ChevronDown, Loader2, Plus, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { calculateTradeOutcome } from '@/lib/tradeJournalMath';

type Market = 'US' | 'HK';
type ExitReason = 'target' | 'stop' | 'time_exit' | 'manual' | 'cancelled';

export interface JournalSignal {
  id: string;
  stock_code: string;
  stock_name: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  capitalAllocatedHKD?: number;
  estimatedNetProfitHKD?: number;
  tradeabilityScore?: number;
  catalystStatus?: string;
  catalystSummary?: string;
  recommendationReasons?: string[];
}

interface JournalEntry {
  id: string;
  mode: 'paper' | 'live';
  market: Market;
  symbol: string;
  stock_name: string;
  status: 'planned' | 'open' | 'closed' | 'cancelled';
  planned_entry: number;
  planned_target: number;
  planned_stop: number;
  planned_shares: number;
  actual_entry: number | null;
  actual_exit: number | null;
  actual_shares: number | null;
  actual_buy_cost_hkd: number | null;
  actual_sell_cost_hkd: number | null;
  actual_net_pnl_hkd: number | null;
  actual_r_multiple: number | null;
  exit_reason: ExitReason | null;
  created_at: string;
}

const numberValue = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function TradeJournalPanel({ signals, market }: { signals: JournalSignal[]; market: Market }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState('');
  const [mode, setMode] = useState<'paper' | 'live'>('paper');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeForm, setCloseForm] = useState({ exitPrice: '', buyCostHKD: '', sellCostHKD: '', fxToHKD: '7.8', exitReason: 'manual' as ExitReason });

  const selectedSignal = signals.find((signal) => signal.id === selectedSignalId) ?? signals[0];

  const loadEntries = async () => {
    setLoading(true);
    setMessage(null);
    const { data: auth, error: authError } = await supabase.auth.getUser();
    const id = auth.user?.id;
    if (authError || !id) {
      setUserId(null);
      setEntries([]);
      setMessage('請先登入後才可保存交易日誌；系統不會自動替你下單。');
      setLoading(false);
      return;
    }
    setUserId(id);
    const { data, error } = await supabase
      .from('trade_journal_entries')
      .select('*')
      .eq('user_id', id)
      .eq('market', market)
      .order('created_at', { ascending: false });
    if (error) setMessage(`未能讀取交易日誌：${error.message}`);
    else setEntries((data || []) as JournalEntry[]);
    setLoading(false);
  };

  useEffect(() => { void loadEntries(); }, [market]);
  useEffect(() => {
    if (signals.length && !signals.some((signal) => signal.id === selectedSignalId)) setSelectedSignalId(signals[0].id);
  }, [signals, selectedSignalId]);

  const metrics = useMemo(() => {
    const closed = entries.filter((entry) => entry.status === 'closed' && typeof entry.actual_net_pnl_hkd === 'number');
    const pnl = closed.map((entry) => Number(entry.actual_net_pnl_hkd || 0));
    const wins = pnl.filter((value) => value > 0).length;
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    [...closed].reverse().forEach((entry) => {
      cumulative += Number(entry.actual_net_pnl_hkd || 0);
      peak = Math.max(peak, cumulative);
      maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
    });
    return {
      closed: closed.length,
      winRate: closed.length ? wins / closed.length : null,
      totalPnl: pnl.reduce((total, value) => total + value, 0),
      expectancy: closed.length ? pnl.reduce((total, value) => total + value, 0) / closed.length : null,
      avgR: closed.length ? closed.reduce((total, entry) => total + Number(entry.actual_r_multiple || 0), 0) / closed.length : null,
      maxDrawdown,
    };
  }, [entries]);

  const createJournalEntry = async () => {
    if (!userId) {
      setMessage('請先登入後才可建立交易日誌。');
      return;
    }
    if (!selectedSignal) {
      setMessage('目前沒有可記錄的訊號。');
      return;
    }
    setSaving(true);
    setMessage(null);
    const plannedShares = Math.max(1, Math.floor((selectedSignal.capitalAllocatedHKD || 50000) / selectedSignal.entry_price));
    const snapshot = {
      signalId: selectedSignal.id,
      tradeabilityScore: selectedSignal.tradeabilityScore ?? selectedSignal.confidence,
      catalystStatus: selectedSignal.catalystStatus ?? 'unknown',
      catalystSummary: selectedSignal.catalystSummary ?? '',
      recommendationReasons: selectedSignal.recommendationReasons ?? [],
      recordedAt: new Date().toISOString(),
    };
    const { error } = await supabase.from('trade_journal_entries').insert({
      user_id: userId,
      mode,
      market,
      symbol: selectedSignal.stock_code,
      stock_name: selectedSignal.stock_name,
      status: 'planned',
      planned_entry: selectedSignal.entry_price,
      planned_target: selectedSignal.target_price,
      planned_stop: selectedSignal.stop_loss,
      planned_shares: plannedShares,
      planned_cost_hkd: selectedSignal.capitalAllocatedHKD || null,
      planned_net_profit_hkd: selectedSignal.estimatedNetProfitHKD || null,
      strategy_score: selectedSignal.confidence,
      tradeability_score: selectedSignal.tradeabilityScore ?? selectedSignal.confidence,
      catalyst_status: selectedSignal.catalystStatus || null,
      catalyst_summary: selectedSignal.catalystSummary || null,
      signal_snapshot: snapshot,
    });
    if (error) setMessage(`未能建立日誌：${error.message}`);
    else {
      setMessage('已記錄交易計劃。成交後請填寫實際出場價與富途的買入／賣出實際費用。');
      await loadEntries();
    }
    setSaving(false);
  };

  const openCloseForm = (entry: JournalEntry) => {
    setClosingId(entry.id);
    setCloseForm({
      exitPrice: entry.planned_target.toString(),
      buyCostHKD: entry.actual_buy_cost_hkd?.toString() || '0',
      sellCostHKD: entry.actual_sell_cost_hkd?.toString() || '0',
      fxToHKD: market === 'US' ? '7.8' : '1',
      exitReason: 'manual',
    });
  };

  const closeEntry = async (entry: JournalEntry) => {
    if (!userId) return;
    const actualExit = numberValue(closeForm.exitPrice, NaN);
    const buyCostHKD = numberValue(closeForm.buyCostHKD, NaN);
    const sellCostHKD = numberValue(closeForm.sellCostHKD, NaN);
    const fxToHKD = market === 'US' ? numberValue(closeForm.fxToHKD, NaN) : 1;
    if (!(actualExit > 0) || buyCostHKD < 0 || sellCostHKD < 0 || !(fxToHKD > 0)) {
      setMessage('請填寫有效的實際出場價、雙邊實際費用及（美股）實際或採用的美元兌港元匯率。');
      return;
    }
    const shares = entry.actual_shares || entry.planned_shares;
    const actualEntry = entry.actual_entry || entry.planned_entry;
    const outcome = calculateTradeOutcome({
      market,
      plannedEntry: entry.planned_entry,
      plannedStop: entry.planned_stop,
      actualEntry,
      actualExit,
      shares,
      buyCostHKD,
      sellCostHKD,
      fxToHKD,
    });

    setSaving(true);
    const { error } = await supabase
      .from('trade_journal_entries')
      .update({
        status: closeForm.exitReason === 'cancelled' ? 'cancelled' : 'closed',
        actual_entry: actualEntry,
        actual_exit: actualExit,
        actual_shares: shares,
        settlement_fx_to_hkd: fxToHKD,
        actual_buy_cost_hkd: buyCostHKD,
        actual_sell_cost_hkd: sellCostHKD,
        actual_net_pnl_hkd: outcome.netPnlHKD,
        actual_r_multiple: outcome.rMultiple,
        exit_reason: closeForm.exitReason,
        closed_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
      .eq('user_id', userId);
    if (error) setMessage(`未能儲存結果：${error.message}`);
    else {
      setMessage('已儲存實際結果。統計只使用已完成交易，並已扣除你輸入的實際費用。');
      setClosingId(null);
      await loadEntries();
    }
    setSaving(false);
  };

  return (
    <section className="mt-8 bg-[#0d1224] border border-white/10 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3">
        <BookOpen className="w-5 h-5 text-blue-300 mt-0.5" />
        <div>
          <h2 className="text-white font-bold">交易日誌與實際成效</h2>
          <p className="text-slate-400 text-xs mt-1">只記錄你手動確認的紙上或實盤交易；系統不會自動下單，也不會把策略分數當成勝率。</p>
        </div>
      </div>

      <div className="p-5 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 grid gap-3 sm:grid-cols-2">
          <select value={selectedSignalId} onChange={(event) => setSelectedSignalId(event.target.value)} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            {signals.length === 0 ? <option value="">暫無可記錄訊號</option> : signals.map((signal) => <option key={signal.id} value={signal.id}>{signal.stock_code} · {signal.stock_name}</option>)}
          </select>
          <select value={mode} onChange={(event) => setMode(event.target.value as 'paper' | 'live')} className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            <option value="paper">紙上交易</option>
            <option value="live">實盤交易</option>
          </select>
        </div>
        <div className="lg:col-span-2 flex items-center">
          <button disabled={saving || !selectedSignal || !userId} onClick={() => void createJournalEntry()} className="w-full inline-flex justify-center items-center gap-2 bg-blue-300 text-[#0a0e1a] disabled:opacity-40 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-200">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} 記錄這個交易計劃
          </button>
        </div>
      </div>

      {message && <p className="mx-5 mb-4 text-xs text-slate-300 bg-white/5 border border-white/10 rounded-xl px-3 py-2">{message}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 px-5 pb-5">
        {[
          ['已完成樣本', metrics.closed.toString()],
          ['成本後勝率', metrics.winRate === null ? '—' : `${(metrics.winRate * 100).toFixed(1)}%`],
          ['總成本後損益', `HK$${metrics.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
          ['每筆期望值', metrics.expectancy === null ? '—' : `HK$${metrics.expectancy.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
          ['最大回撤', `HK$${metrics.maxDrawdown.toLocaleString(undefined, { maximumFractionDigits: 0 })}`],
        ].map(([label, value]) => <div key={label} className="bg-white/5 border border-white/10 rounded-xl p-3"><p className="text-slate-500 text-[11px]">{label}</p><p className="text-white font-bold text-sm mt-1">{value}</p></div>)}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        <p className="text-slate-300 text-sm font-medium mb-3">最近紀錄</p>
        {loading ? <div className="text-slate-400 text-xs flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />載入中</div> : entries.length === 0 ? <p className="text-slate-500 text-xs">尚未有交易紀錄。先掃描，再把你真正想追蹤的訊號記錄為紙上或實盤計劃。</p> : (
          <div className="space-y-3">
            {entries.slice(0, 10).map((entry) => (
              <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-start justify-between gap-3"><div><p className="text-white text-sm font-semibold">{entry.symbol} <span className="text-slate-500 font-normal">{entry.mode === 'live' ? '實盤' : '紙上'} · {entry.status}</span></p><p className="text-slate-400 text-xs mt-1">計劃：{entry.planned_entry} → {entry.planned_target}；止蝕 {entry.planned_stop}；{entry.planned_shares} 股</p></div>
                  {entry.status === 'closed' ? <span className={`text-sm font-bold ${Number(entry.actual_net_pnl_hkd || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>HK${Number(entry.actual_net_pnl_hkd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} · {Number(entry.actual_r_multiple || 0).toFixed(2)}R</span> : <button onClick={() => openCloseForm(entry)} className="text-xs bg-white/10 text-slate-200 px-3 py-1.5 rounded-lg hover:bg-white/15">填寫出場結果</button>}</div>
                {closingId === entry.id && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"><input value={closeForm.exitPrice} onChange={(event) => setCloseForm({ ...closeForm, exitPrice: event.target.value })} placeholder="實際出場價" className="bg-[#0a0e1a] border border-white/10 rounded-lg px-2 py-2 text-xs text-white" /><input value={closeForm.buyCostHKD} onChange={(event) => setCloseForm({ ...closeForm, buyCostHKD: event.target.value })} placeholder="買入實際費用 HK$" className="bg-[#0a0e1a] border border-white/10 rounded-lg px-2 py-2 text-xs text-white" /><input value={closeForm.sellCostHKD} onChange={(event) => setCloseForm({ ...closeForm, sellCostHKD: event.target.value })} placeholder="賣出實際費用 HK$" className="bg-[#0a0e1a] border border-white/10 rounded-lg px-2 py-2 text-xs text-white" />{market === 'US' && <input value={closeForm.fxToHKD} onChange={(event) => setCloseForm({ ...closeForm, fxToHKD: event.target.value })} placeholder="USD/HKD 匯率" className="bg-[#0a0e1a] border border-white/10 rounded-lg px-2 py-2 text-xs text-white" />}<select value={closeForm.exitReason} onChange={(event) => setCloseForm({ ...closeForm, exitReason: event.target.value as ExitReason })} className="bg-[#0a0e1a] border border-white/10 rounded-lg px-2 py-2 text-xs text-white"><option value="target">目標到價</option><option value="stop">止蝕</option><option value="time_exit">時間退出</option><option value="manual">手動出場</option><option value="cancelled">取消計劃</option></select><button disabled={saving} onClick={() => void closeEntry(entry)} className="sm:col-span-2 lg:col-span-5 bg-emerald-400 text-[#0a0e1a] rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40"><CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />儲存成本後結果</button></div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
