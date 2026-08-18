import json
from pathlib import Path
import pandas as pd

ROOT = Path('data/index-history')
SYMBOLS = ['TQQQ', 'VOO', 'SPY', 'SSO']


def rsi(series, period=14):
    d = series.diff()
    up = d.clip(lower=0).rolling(period).mean()
    down = (-d.clip(upper=0)).rolling(period).mean()
    rs = up / down.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


def summarize_condition(df, mask, label):
    out = {'condition': label, 'observations': int(mask.sum())}
    for n in (5, 10, 20):
        fwd = df['adjclose'].shift(-n) / df['adjclose'] - 1
        x = fwd[mask].dropna()
        out[f'fwd_{n}d_median_pct'] = round(float(x.median() * 100), 2) if len(x) else None
        out[f'fwd_{n}d_positive_pct'] = round(float((x > 0).mean() * 100), 2) if len(x) else None
    return out

all_out = {'basis': 'Adjusted close; forward returns are strictly after the condition date; no future information used in the condition.', 'symbols': {}}
for symbol in SYMBOLS:
    df = pd.read_csv(ROOT / f'{symbol}.csv', parse_dates=['date'])
    p = df['adjclose']
    peak = p.cummax()
    df['drawdown'] = p / peak - 1
    df['sma20'] = p.rolling(20).mean()
    df['sma50'] = p.rolling(50).mean()
    df['sma200'] = p.rolling(200).mean()
    df['rsi14'] = rsi(p)
    conditions = []
    for threshold in (-0.30, -0.20, -0.10, -0.05):
        conditions.append(summarize_condition(df, df['drawdown'] <= threshold, f'drawdown <= {threshold:.0%}'))
    conditions += [
        summarize_condition(df, (df['sma50'] > df['sma200']) & (p > df['sma50']), 'close > SMA50 > SMA200'),
        summarize_condition(df, (df['sma50'] < df['sma200']) & (p < df['sma50']), 'close < SMA50 < SMA200'),
        summarize_condition(df, (df['rsi14'] < 30), 'RSI14 < 30'),
        summarize_condition(df, (df['rsi14'] > 70), 'RSI14 > 70'),
    ]
    all_out['symbols'][symbol] = {'conditions': conditions}
Path(ROOT / 'regime-analysis.json').write_text(json.dumps(all_out, ensure_ascii=False, indent=2), encoding='utf-8')
for symbol, obj in all_out['symbols'].items():
    print('\n' + symbol)
    for c in obj['conditions']:
        print(c)
