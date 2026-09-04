# Strategy

Sooth runs one strategy pipeline, not many strategies: observe, contextualize, value, score, gate, decide.

## Variables (all real, all tagged)

| # | Variable | Source | Tag |
|---|---|---|---|
| 1 | Market price / mid | YES book best bid/ask | LIVE_INDEXER |
| 2 | Bid/ask spread | Book | DERIVED |
| 3 | Order-book imbalance | `(bidDepth-askDepth)/(bidDepth+askDepth)`, top 3 levels | DERIVED |
| 4 | Depth / liquidity | Share sums in the depth window | DERIVED |
| 5 | Underlying price | Price feed, 27 testnet assets | LIVE |
| 6 | Short-term momentum | Mid rate-of-change over recent real snapshots | DERIVED |
| 7 | Volatility | Stddev of window mids | DERIVED (context only) |
| 8 | Time to expiry | `onchain.expiry - now` | LIVE_ONCHAIN |
| 9 | Strike distance | Strike vs reference, else N/A | DERIVED / N/A |

Anything uncomputable is null with a recorded note. Nothing is estimated silently.

## Fair value

```
fairValue = clamp(market + k·imbalance + clamp(momentum·gain, ±cap) + clamp(gap·gain, ±cap))
```

Constants (`DECISION_CONFIG`): `WATCH_MIN_EDGE 0.01`, `SPREAD_PENALTY_FACTOR 0.5`, `SLIPPAGE_FACTOR 1.0`, `MOMENTUM_GAIN 1.0`, `MOMENTUM_CAP 0.03`, `DISLOCATION_GAIN 1.0`, `DISLOCATION_CAP 0.03`, history window 10 snapshots / min 5 / min 120s span. Strike and volatility are reported, not weighted: question semantics are not machine-readable, and volatility has no direction.

## Edges and score

`rawEdge = fairValue - marketPrice`. `executableEdge = rawEdge − sign·(spread penalty + slippage penalty)`. Score 0–100 from edge, signal agreement, liquidity, execution quality, time buffer, and settlement confidence, with configurable weights.

## Thresholds

`MIN_EDGE 0.02` (trade bar), `WATCH_MIN_EDGE 0.01`, liquidity 100 shares, spread 600 bps, 300s expiry buffer. Tune in `src/config.ts`, never in logic.
