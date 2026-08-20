import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

END = int(datetime(2026, 8, 18, tzinfo=timezone.utc).timestamp())
START = int(datetime(2016, 8, 18, tzinfo=timezone.utc).timestamp())
SYMBOLS = ["TQQQ", "VOO", "SPY", "SSO"]
OUT = Path("data/index-history")
OUT.mkdir(parents=True, exist_ok=True)


def get_history(symbol: str) -> pd.DataFrame:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        "period1": START,
        "period2": END,
        "interval": "1d",
        "events": "div,splits",
        "includeAdjustedClose": "true",
    }
    r = requests.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    payload = r.json()["chart"]["result"][0]
    ts = payload["timestamp"]
    q = payload["indicators"]["quote"][0]
    adj = payload["indicators"].get("adjclose", [{}])[0].get("adjclose", [None] * len(ts))
    rows = []
    for i, stamp in enumerate(ts):
        row = {
            "date": datetime.fromtimestamp(stamp, timezone.utc).date().isoformat(),
            "open": q["open"][i], "high": q["high"][i], "low": q["low"][i],
            "close": q["close"][i], "adjclose": adj[i], "volume": q["volume"][i],
        }
        if row["adjclose"] is not None and all(row[k] is not None for k in ("open", "high", "low", "close")):
            rows.append(row)
    df = pd.DataFrame(rows).drop_duplicates("date").sort_values("date").reset_index(drop=True)
    if len(df) < 2000:
        raise RuntimeError(f"{symbol}: only {len(df)} rows returned")
    return df


def episodes(df: pd.DataFrame):
    p = df["adjclose"]
    running_max = p.cummax()
    dd = p / running_max - 1
    in_episode = False
    out = []
    start = trough = None
    trough_dd = 0.0
    for i, value in enumerate(dd):
        if value <= -0.10 and not in_episode:
            in_episode = True
            start = i
            trough = i
            trough_dd = float(value)
        elif in_episode:
            if value < trough_dd:
                trough = i
                trough_dd = float(value)
            if value >= -0.05:
                out.append({
                    "peak_date": df.loc[start, "date"],
                    "trough_date": df.loc[trough, "date"],
                    "recovery_date": df.loc[i, "date"],
                    "drawdown_pct": round(trough_dd * 100, 2),
                    "days_to_trough": int((pd.Timestamp(df.loc[trough, "date"]) - pd.Timestamp(df.loc[start, "date"])).days),
                    "days_to_recovery": int((pd.Timestamp(df.loc[i, "date"]) - pd.Timestamp(df.loc[start, "date"])).days),
                })
                in_episode = False
    if in_episode and start is not None and trough is not None:
        out.append({
            "peak_date": df.loc[start, "date"], "trough_date": df.loc[trough, "date"],
            "recovery_date": None, "drawdown_pct": round(trough_dd * 100, 2),
            "days_to_trough": int((pd.Timestamp(df.loc[trough, "date"]) - pd.Timestamp(df.loc[start, "date"])).days),
            "days_to_recovery": None,
        })
    return out


def summarize(symbol: str, df: pd.DataFrame):
    p = df["adjclose"]
    peak_i, trough_i = int(p.idxmax()), int(p.idxmin())
    ret = p.pct_change()
    rolling_max = p.cummax()
    dd = p / rolling_max - 1
    one_year = p.pct_change(252).dropna()
    summary = {
        "symbol": symbol,
        "rows": int(len(df)),
        "start_date": df.iloc[0]["date"], "end_date": df.iloc[-1]["date"],
        "start_adjclose": round(float(p.iloc[0]), 6), "end_adjclose": round(float(p.iloc[-1]), 6),
        "total_return_pct": round(float((p.iloc[-1] / p.iloc[0] - 1) * 100), 2),
        "annualized_return_pct": round(float(((p.iloc[-1] / p.iloc[0]) ** (252 / len(df)) - 1) * 100), 2),
        "annualized_volatility_pct": round(float(ret.std() * math.sqrt(252) * 100), 2),
        "max_drawdown_pct": round(float(dd.min() * 100), 2),
        "max_drawdown_peak_date": df.loc[int(dd.idxmin()), "date"],
        "all_time_high_adjclose": round(float(p.max()), 6), "all_time_high_date": df.loc[peak_i, "date"],
        "all_time_low_adjclose": round(float(p.min()), 6), "all_time_low_date": df.loc[trough_i, "date"],
        "positive_1y_rate_pct": round(float((one_year > 0).mean() * 100), 2),
        "median_1y_return_pct": round(float(one_year.median() * 100), 2),
        "episodes_10pct": episodes(df),
    }
    return summary

all_summary = {"reference_date_utc": "2026-08-18", "source": "Yahoo Finance chart endpoint; adjusted close; 2016-08-18 to 2026-08-18", "symbols": {}}
for symbol in SYMBOLS:
    df = get_history(symbol)
    df.to_csv(OUT / f"{symbol}.csv", index=False)
    all_summary["symbols"][symbol] = summarize(symbol, df)
    time.sleep(0.3)

(OUT / "summary.json").write_text(json.dumps(all_summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(all_summary, ensure_ascii=False, indent=2))
