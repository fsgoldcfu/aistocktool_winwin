// components/IndexScannerDashboard.jsx
//
// 顯示 道指(DIA)/納指(QQQ)/TQQQ/SQQQ/UVIX 嘅
// 買入/賣出建議卡片，撳「更新」call /api/index-scanner。
//
// 零額外npm依賴，純inline SVG做icon，方便你喺GitHub web editor
// 直接貼檔案用，唔使裝package。
//
// 用法：喺你嘅page/dashboard入面
//   import IndexScannerDashboard from '../components/IndexScannerDashboard';
//   <IndexScannerDashboard />

'use client';

import { useState, useEffect, useCallback } from 'react';

// ---------- 視覺 tokens ----------
const COLORS = {
  bg: '#0A0E17',
  card: '#131A29',
  cardBorder: '#232C3D',
  textPrimary: '#E8ECF4',
  textSecondary: '#7C8AA5',
  textMuted: '#4B5568',
  long: '#E3A008',   // 做多 = 琥珀金
  short: '#2DD4BF',  // 做空 = 青綠
  danger: '#EF4444',
  gaugeTrack: '#1C2434',
};

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        animation: spinning ? 'spin 0.9s linear infinite' : 'none',
      }}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/**
 * 訊號本質嘅視覺化：支持—現價—阻力 嘅位置量規。
 * 呢個係成個dashboard嘅signature元素。
 */
function RangeGauge({ support, resistance, price, accent }) {
  if (support == null || resistance == null || resistance <= support) {
    return (
      <div style={{ fontSize: 11, color: COLORS.textMuted, padding: '10px 0' }}>
        歷史支持/阻力數據不足
      </div>
    );
  }
  const pct = Math.min(100, Math.max(0, ((price - support) / (resistance - support)) * 100));

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          position: 'relative',
          height: 6,
          borderRadius: 3,
          background: COLORS.gaugeTrack,
          overflow: 'visible',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: `${pct}%`,
            top: -5,
            transform: 'translateX(-50%)',
            width: 2,
            height: 16,
            background: accent,
            borderRadius: 1,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${pct}%`,
            top: -22,
            transform: 'translateX(-50%)',
            fontSize: 10,
            fontFamily: 'ui-monospace, monospace',
            color: accent,
            whiteSpace: 'nowrap',
          }}
        >
          現價 {price.toFixed(2)}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          fontSize: 10,
          fontFamily: 'ui-monospace, monospace',
          color: COLORS.textSecondary,
        }}
      >
        <span>支持 {support.toFixed(2)}</span>
        <span>阻力 {resistance.toFixed(2)}</span>
      </div>
    </div>
  );
}

function TrendBadge({ trend }) {
  const label = { strong: '強勢', neutral: '中性', weak: '弱勢' }[trend] || trend;
  const color = { strong: COLORS.long, neutral: COLORS.textSecondary, weak: COLORS.danger }[trend];
  return (
    <span
      style={{
        fontSize: 11,
        fontFamily: 'ui-monospace, monospace',
        color,
        border: `1px solid ${color}55`,
        borderRadius: 4,
        padding: '2px 6px',
      }}
    >
      {label}
    </span>
  );
}

function SymbolCard({ result }) {
  const isLong = result.direction === 'long';
  const accent = isLong ? COLORS.long : COLORS.short;
  const rec = result.recommendation || {};
  const support = result.supportLevels?.[0]?.avg ?? null;
  const resistance = result.resistanceLevels?.[0]?.avg ?? null;

  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorder}`,
        borderRadius: 10,
        padding: 16,
        borderLeft: `3px solid ${accent}`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: COLORS.textPrimary,
              letterSpacing: '-0.01em',
            }}
          >
            {result.symbol}
          </div>
          <div style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}>
            {result.name}
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: accent,
            background: `${accent}1A`,
            borderRadius: 4,
            padding: '3px 8px',
            whiteSpace: 'nowrap',
          }}
        >
          {isLong ? '做多策略' : '做空策略'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <TrendBadge trend={result.trend} />
        {result.indicators?.volumeSpikeRatio != null && (
          <span style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: 'ui-monospace, monospace' }}>
            量比 {result.indicators.volumeSpikeRatio.toFixed(2)}x
          </span>
        )}
      </div>

      <RangeGauge support={support} resistance={resistance} price={result.latestClose} accent={accent} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginTop: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isLong ? '建議買入價' : '建議做空價'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: COLORS.textPrimary }}>
            {(isLong ? rec.nextBuyPrice : rec.nextSellPrice)?.toFixed(2) ?? '—'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isLong ? '建議賣出價' : '建議回補價'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: accent }}>
            {(isLong ? rec.nextSellPrice : rec.nextBuyPrice)?.toFixed(2) ?? '—'}
          </div>
        </div>
      </div>

      {rec.basis && (
        <div style={{ fontSize: 11, color: COLORS.textSecondary, marginTop: 12, lineHeight: 1.5 }}>
          {rec.basis}
        </div>
      )}
    </div>
  );
}

export default function IndexScannerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/index-scanner');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || '請求失敗');
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div
      style={{
        background: COLORS.bg,
        minHeight: '100%',
        padding: '20px 16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.textPrimary }}>
            指數 / 槓桿ETF 掃描
          </div>
          {data?.generatedAt && (
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
              更新時間 {new Date(data.generatedAt).toLocaleString('zh-HK')}
            </div>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: loading ? COLORS.cardBorder : COLORS.long,
            color: loading ? COLORS.textSecondary : '#1A1300',
            border: 'none',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          <RefreshIcon spinning={loading} />
          {loading ? '分析中…' : '更新'}
        </button>
      </div>

      {error && (
        <div
          style={{
            background: `${COLORS.danger}1A`,
            border: `1px solid ${COLORS.danger}55`,
            color: COLORS.danger,
            borderRadius: 8,
            padding: 12,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {!data && loading && (
        <div style={{ color: COLORS.textSecondary, fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          首次分析5年歷史數據，需要約30-40秒，請稍候…
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 14,
        }}
      >
        {data?.results?.map((r) => (
          <SymbolCard key={r.symbol} result={r} />
        ))}
      </div>

      <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 20, lineHeight: 1.6 }}>
        以上建議價由歷史ATR、均線同支持/阻力聚類計算得出，僅供參考，並非保證獲利，槓桿ETF長線持有有波動耗損風險。
      </div>
    </div>
  );
}
