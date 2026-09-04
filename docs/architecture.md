# Architecture

One sentence: Sooth watches Event Contract markets and tells you what to trade, or when to stay out.

```
DreamDEX Market
      ↓
Market Data (src/api, src/snapshots)
      ↓
Sooth Intelligence (src/analysis)
      ↓
Fair Value (contextEngine)
      ↓
Opportunity (decision: score + TRADE/WATCH/NO_TRADE)
      ↓
Risk + Settlement (src/risk, settlementGate)
      ↓
TRADE / WATCH / NO TRADE → Execution (src/ec, src/bot)
```

## Data flow, concretely

1. `GET /markets` / `POST /strategies/analyze` sweep the venue registry (cached 60s, shared context, labeled `cacheAgeSec`/`stale`).
2. Per market: book (`fetchOrderBook`), on-chain state (`marketOnchain`), underlying (`fetchPrice`), history (`snapshots.db`), reference window (price-feed history).
3. `collectVariables` → `computeFairValue` → `checkSettlement` → `decideMarket`. Pure functions, no I/O inside.
4. Risk engine gates writes. Bot runner polls the same pipeline on a loop.
5. Frontend renders decisions; it computes no trading logic (table tiers map 1:1 from backend `decision`).

## Why this shape

- Intelligence is pure and testable: 20 unit tests cover contributions, caps, boundaries, penalties, gates, scoring.
- I/O lives at the edges (routes, scripts, feed client). Nothing inside the decision path touches the network.
- Response shapes are additive: new fields (`decision`, `gateChecks`, `cacheAgeSec`) never break old readers.
- Serverless note: `api/index.js` is a prebuilt esbuild bundle (`npm run bundle:api`) because the file: bot-kit dependency ships TypeScript. Functions cap at 10s; the shared cache keeps reads alive.

## Module map

- `src/analysis/variables.ts` — 9 real variables, null-with-note discipline
- `src/analysis/contextEngine.ts` — fair value combination
- `src/analysis/dislocation.ts` — underlying-vs-contract gap
- `src/analysis/decision.ts` — edges, score, TRADE/WATCH/NO_TRADE
- `src/analysis/settlementGate.ts` — resolution verification
- `src/analysis/referenceFeed.ts` — price-feed access (null-safe)
- `src/analysis/engine.ts` — Stage 3 book math (unchanged semantics)
- `src/risk/`, `src/ec/`, `src/bot/` — gates and execution (unchanged)
- `src/backtest/` — P&L engine, history matcher, decision report
