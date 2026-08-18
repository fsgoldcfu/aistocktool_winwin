'use client';

import { useEffect, useState } from 'react';
import { Settings2, Save } from 'lucide-react';

export interface UserCapitalSettings {
  totalCapitalHKD: number;
  dailyAllocationPercent: number;
  maxOpenPositions: number;
}

export const DEFAULT_USER_CAPITAL_SETTINGS: UserCapitalSettings = {
  totalCapitalHKD: 180000,
  dailyAllocationPercent: 55.5556,
  maxOpenPositions: 2,
};

const STORAGE_KEY = 'aistocktool-capital-settings-v1';

export function loadUserCapitalSettings(): UserCapitalSettings {
  if (typeof window === 'undefined') return DEFAULT_USER_CAPITAL_SETTINGS;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return {
      totalCapitalHKD: Number(stored?.totalCapitalHKD ?? DEFAULT_USER_CAPITAL_SETTINGS.totalCapitalHKD),
      dailyAllocationPercent: Number(stored?.dailyAllocationPercent ?? DEFAULT_USER_CAPITAL_SETTINGS.dailyAllocationPercent),
      maxOpenPositions: Number(stored?.maxOpenPositions ?? DEFAULT_USER_CAPITAL_SETTINGS.maxOpenPositions),
    };
  } catch { return DEFAULT_USER_CAPITAL_SETTINGS; }
}

export function capitalQuery(settings: UserCapitalSettings): string {
  const params = new URLSearchParams({ capital: String(settings.totalCapitalHKD), dailyPct: String(settings.dailyAllocationPercent), positions: String(settings.maxOpenPositions) });
  return `?${params.toString()}`;
}

export function CapitalSettingsPanel({ value, onChange }: { value: UserCapitalSettings; onChange: (value: UserCapitalSettings) => void }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const dailyCapital = draft.totalCapitalHKD * draft.dailyAllocationPercent / 100;
  const perPosition = dailyCapital / Math.max(1, draft.maxOpenPositions);

  function save() {
    const next = {
      totalCapitalHKD: Math.max(1, Number(draft.totalCapitalHKD)),
      dailyAllocationPercent: Math.min(100, Math.max(0.01, Number(draft.dailyAllocationPercent))),
      maxOpenPositions: Math.min(5, Math.max(1, Math.floor(Number(draft.maxOpenPositions)))),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    onChange(next);
    setDraft(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  return <section className="mb-6 rounded-2xl border border-blue-400/20 bg-blue-500/5 p-5">
    <div className="flex items-center gap-2 mb-3"><Settings2 className="w-5 h-5 text-blue-300" /><div><h2 className="text-white font-bold">資金設定</h2><p className="text-slate-400 text-xs">訊號會按以下設定計算可買股數及成本後盈利，不會讀取或管理你的銀行／券商餘額。</p></div></div>
    <div className="grid gap-3 md:grid-cols-4 items-end">
      <label className="text-xs text-slate-400">實際本金（HKD）<input type="number" min="1" value={draft.totalCapitalHKD} onChange={(e) => setDraft({ ...draft, totalCapitalHKD: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d1224] px-3 py-2 text-white" /></label>
      <label className="text-xs text-slate-400">每日最多投入（%）<input type="number" min="0.01" max="100" step="0.01" value={draft.dailyAllocationPercent} onChange={(e) => setDraft({ ...draft, dailyAllocationPercent: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d1224] px-3 py-2 text-white" /></label>
      <label className="text-xs text-slate-400">最多同時持倉數<input type="number" min="1" max="5" step="1" value={draft.maxOpenPositions} onChange={(e) => setDraft({ ...draft, maxOpenPositions: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#0d1224] px-3 py-2 text-white" /></label>
      <button onClick={save} className="flex items-center justify-center gap-2 rounded-lg bg-blue-400 px-3 py-2 text-sm font-bold text-[#0a0e1a]"><Save className="w-4 h-4" />{saved ? '已保存' : '保存資金設定'}</button>
    </div>
    <p className="mt-3 text-xs text-slate-400">每日可用資金約 HK${dailyCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}；每筆配置約 HK${perPosition.toLocaleString(undefined, { maximumFractionDigits: 0 })}。系統會以實際股數、board lot、成本和 HK$500 閘門重新判斷。</p>
  </section>;
}
