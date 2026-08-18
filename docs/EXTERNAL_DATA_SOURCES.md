# External Data Sources and Verification Notes

## Twelve Data

Official documentation: https://twelvedata.com/docs

The `time_series` endpoint supports `order=asc` and `adjust` modes including `splits`; its documented default adjustment is splits. The updated US/TQQQ historical-data paths explicitly request `order=asc` and `adjust=splits`, then validate date uniqueness and OHLCV consistency before calculating indicators. The provider documents error responses for missing data, rate limits and invalid parameters, which the API layers must treat as non-tradeable rather than silently replacing with a recommendation.

## TQQQ fund structure

ProShares fund page: https://www.proshares.com/our-etfs/leveraged-and-inverse/tqqq

SEC Summary Prospectus: https://www.sec.gov/Archives/edgar/data/1174610/000168386323006700/f36277d1.htm

TQQQ targets three times the Nasdaq-100's daily performance before fees and expenses. Its multi-day return can deviate substantially from three times the index return, especially with higher volatility. This supports the implementation choice to use completed daily bars for signals and to require explicit risk controls.

## Backtest validation

Bailey et al., “The Probability of Backtest Overfitting” (2017): https://escholarship.org/uc/item/4w1110bb

The paper describes the risk of selecting apparently profitable rules after testing many variations on the same history. The implementation therefore labels the TQQQ 70/30 time split as limited OOS validation, not evidence of guaranteed edge, and preserves a no-trade state rather than forcing recommendations.

## iTick schema caveat

No authoritative iTick documentation was available through the current lookup. The HK quote parser therefore checks the plausible previous-close field variants `pc`, `preClose` and `yc`, then falls back to `o` only when none exist. This must be confirmed against a real iTick payload in Vercel logs or a non-production test before interpreting relative-strength output as production-verified.
