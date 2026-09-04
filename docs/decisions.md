# Decisions

Every evaluation ends in exactly one of three states.

## TRADE

Executable edge clears 0.02 with liquidity, spread, time, and settlement all green. Output carries fair value, both edges, the 0–100 score, per-variable contribution lines, and gate checks. Only TRADE candidates reach risk, and risk can still reject them.

## WATCH

A genuine middle state, not a relabeled NO_TRADE. Raw edge clears 0.01 but execution costs eat it below the trade bar, with no hard failure. The market is interesting; the fill is not.

## NO_TRADE

Everything else, with the specific blocker cited: edge below bar, spread too wide, liquidity short, expiry too near, fair value uncomputable, or `TRADE BLOCKED - SETTLEMENT RISK`.

## Output shape

```json
{
  "decision": "TRADE",
  "marketPrice": 0.58,
  "fairValue": 0.67,
  "rawEdge": 0.09,
  "executableEdge": 0.07,
  "opportunityScore": 84,
  "reasons": ["order-flow imbalance 0.905 × k=0.060 → +0.0543 (supports UP)"],
  "gateChecks": [{ "name": "resolution-readable", "pass": true }]
}
```

## Latest real evidence

50 settled markets, decision backtest: 0 trades, 50 NO_TRADE (`spread=50`), P&L +0.0000, win rate N/A. Momentum N/A on all 50 (no snapshot coverage — venue newer than the logger). Reported as measured.
