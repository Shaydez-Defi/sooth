# Stage 7 Verification — REST API + Edge Analytics (brief §13, §10)

Date: 2026-08-28. Branch `main`, base commit `eedac78` (stage 6) + stage 7 working tree.
Environment: Somnia Shannon testnet (chain 50312), live indexer + on-chain reads, funded test key in `.env`.

## 0. Resume note

Stage 7 was started by an earlier (interrupted) run: `src/api/` (Fastify server + 5 route modules + tests), `src/analytics/edge.ts` (+ tests), edge-at-decision capture in `src/bot/runner.ts` (`pendingOrderMeta`) and `bot_fills` columns (`edgeAtDecision`/`midAtDecision`/`gasUsed`/`gasPrice`/`gasCost` + ALTER-TABLE migration) already existed. This run **continued** that work (did not restart) and fixed forward:

- `edge.ts`: drawdown was hardcoded `0` → now uses Stage 4's peak-to-trough logic (engine.ts:184-191) over the cumulative realized-PnL series captured in `FILL_OBSERVED` events (`data.newRealizedPnL`); null + explicit gap when the series is absent.
- `edge.ts`: removed a silent `catch { // ignore }` in the gas-fallback path — unparseable gas fields are now reported in `metrics.gaps[]`, never dropped silently.
- `edge.ts`: added `gaps: string[]` (STOP-CONDITION reporting) for `winRate`/`realizedEdge`/`adverseSelection`/`maximumDrawdown`/`averageEdge` when not computable.
- `routes.test.ts`: 95 eslint errors fixed (file-level typed-disable header, consistent with route modules).
- `server.ts`: executable entry (`npm run api`) + `package.json` `"api"` script.
- `GET /markets/:id`: 500 "Do not know how to serialize a BigInt" → recursive BigInt→string serialization.
- `GET /orders`: used `withSigner:false` but ec-core's `fetchOpenOrders` is authenticated → every market returned an auth error. Now uses signer when a key is available (same pattern as `/portfolio`); without a key the per-market error is reported honestly.

## 1. Framework choice

**Fastify 4** (`package.json`): TS-ergonomic `inject()` for tests, schema-friendly, minimal. `@fastify/cors` enabled. Entry: `src/api/server.ts` (`npm run api`, port `PORT` env, default 3000). Protocol logic stays in `src/analysis`, `src/backtest`, `src/strategy`, `src/bot`, `src/risk`, `src/ec/orderLifecycle` — routes only shape requests/responses.

## 2. Multi-bot reality check (brief Step 3) — decision (a)

Single-bot-for-hackathon confirmed: `BotRunner` is one instance; `:id` accepts `default`/`1`/`default-1`; any other id → 404 with `knownLimitation: "single-bot-for-hackathon, :id is always default/1"`. No fake multi-bot support. Verified:

```
GET /bots/unknown-999/events → 404 {"knownLimitation":"single-bot-for-hackathon, :id is always default/1", ...}
```

## 3. Endpoint verification — live responses

### GET routes (live testnet state)

| Endpoint | Result (abridged) | Tags |
|---|---|---|
| `GET /health` | `{"status":"ok","dataIntegrity":"DERIVED","timestamp":"2026-08-28T01:47:32.678Z"}` | DERIVED |
| `GET /markets` | 3+ active EC markets, e.g. `marketId 0x…b85d`, `symbol BTC-0-28AUG26-0200-B85D/tUSDC`, `expiry 1787882400` | marketId/expiry LIVE_ONCHAIN, symbol/asset LIVE_INDEXER |
| `GET /markets/0x…b85d` | `unified.info` (indexer: poolAddress, lastPrice "88000", tradeCount "2", marketType "BINARY") + `onchain` (BigInt-safe) | LIVE_INDEXER/LIVE_ONCHAIN |
| `GET /markets/0x…b85d/orderbook?depth=3` | `bids [[0.276,200],[0.266,330],[0.256,460]], asks [[0.303,200],[0.313,330],[0.323,460]]` | bids/asks LIVE_INDEXER |
| `GET /markets/0x…b85d/analysis` | Stage 3 engine: `direction NONE, marketProbability 0.315, edge 0, spreadBps 888.9, timeRemaining 701, recommendation NO_TRADE` | analysis DERIVED, probability LIVE_INDEXER, timeRemaining LIVE_ONCHAIN |
| `GET /positions` | `{"positions":[],"totalRealizedPnL":0,"count":0}` — real table, honestly empty | positions LIVE_ONCHAIN, totalRealizedPnL DERIVED |
| `GET /orders` | per-market arrays, all empty, `dataIntegrity:"LIVE_ONCHAIN"` (post-fix, signer auth) | LIVE_ONCHAIN |
| `GET /portfolio` | balances `nativeWei 49984551656000000000` (49.9846 STT), `tUsdcRaw 500000000` (500 tUSDC), collateral `0x70a8…` + positions + totalRealizedPnL | balances LIVE_ONCHAIN, positions LIVE_ONCHAIN, PnL DERIVED |
| `GET /bots` | single bot `id:"default"`, persisted config (loopIntervalMs 10000 from stage 6), `status`, `tickCount` | DERIVED (persisted) |
| `GET /bots/default/performance` | `{"status":"insufficient_data","metrics":null,"fillsCount":0,"positionsCount":0}` — 0 real fills (stage 6's honest 0/0), **no fabricated numbers** | fills/positions LIVE_ONCHAIN, edgeAtDecision HISTORICAL, computed DERIVED |
| `GET /bots/default/events?limit=2&eventType=EXECUTION` | real persisted stage-6 events (id 108, block 473055094, SKIP decision reasons), `pagination:{limit,offset,total}` | DERIVED (persisted bot_events) |

### POST /orders — validation (400, no pipeline reach)

```
POST /orders {"side":"YES"} → 400 {"error":"price must be number in (0,1) probability","dataIntegrity":"DERIVED"}
```

### POST /orders — risk engine is NOT bypassed for manual orders (brief Step 5)

Oversized order (size 100 > MAX_ORDER_SIZE 10) on market `0x…b85d`:

```
HTTP 400 {"error":"manual order rejected by risk engine (risk checks are NOT bypassed for POST /orders)",
 "risk":{"approved":false,"rejectionReasons":[
   "risk: spread too wide (0.0210 / 5454.5 bps > max 0.0600 / 600 bps)",
   "risk: order size too large (100 > max 10)"]},
 "note":"POST /orders routes through Stage 2 orderLifecycle directly (user-initiated, not bot) but MUST still pass riskEngine.checkOrder first"}
```

Manual orders build a `StrategyDecision` and call `riskEngine.checkOrder` with live balances, positions, `currentLoss` (real `getTotalRealizedPnL`) and book-derived analysis before any execution. Placement only happens after `risk.approved`.

### POST /orders + POST /orders/:id/cancel — controlled small resting order (Stage 2 pattern)

Market `0x…b74e` (ETH-0-28AUG26-0400/tUSDC) passed all gates: spreadBps 436.8 < 600, timeRemaining 7483s > 300, liquidity 1980 > 100.

```
POST /orders {"marketId":"0x…b74e","side":"YES","price":0.60,"size":1}
→ HTTP 201 {"data":{"txHash":"0xe73308203a5697cf8ea62417d5ab86102ca5624764557e8c80ef7b931ad9670a",
   "blockNumber":"473091669","orderId":"73786976294838511292","price":0.6,"size":1,...},
   "risk":{"approved":true,"rejectionReasons":[]}}

POST /orders/73786976294838511292/cancel {"marketId":"0x…b74e"}
→ HTTP 200 {"data":{"txHash":"0xc0b1668700a4b82b54bb06f4246dfb9c93261b62663667280ee32284832a1315",
   "blockNumber":"473091732","orderId":"73786976294838511292","stillOpen":false}}
```

Real gas was spent: portfolio native balance 49.98455 → 49.97930 STT across place+cancel txs (LIVE_ONCHAIN proof of real execution). No fill occurred (order rested below mid, then cancelled) — `bot_fills` remains honestly 0.

### POST /strategies/backtest — Stage 4 engine

```
POST /strategies/backtest {"limit":10}
→ {"data":{"metrics":{...10 settled markets, numberOfTrades 0 (edge below threshold on synthetic ESTIMATED books),
   "startingCapital":1000,"endingCapital":1000},"count":10,
   "dataIntegrity":{"marketId":"HISTORICAL","winningOutcome":"HISTORICAL","book":"ESTIMATED","metrics":"DERIVED"}}}
```

### POST /strategies/analyze — Stage 3 engine

```
POST /strategies/analyze {"symbol":"BTC-0-28AUG26-0200-B85D/tUSDC"}
→ {"data":[{"marketId":"0x…b85d","analysis":{"marketProbability":0.0345,"estimatedProbability":0.05265,
   "edge":0.01815,"liquidity":1520,"spreadBps":6086.9,"timeRemaining":365,...}}],"dataIntegrity":...}

## 4. Edge analytics (brief §10) — what is computed vs reported gaps

Computed from **real captured data** (`bot_fills`, `bot_positions`, `FILL_OBSERVED` events) — proven by unit tests on synthetic fills (`src/analytics/edge.test.ts`, 4 tests):

- Gross PnL (sum `bot_positions.realizedPnL`), Net PnL (after gas), Gas cost (`gasUsed*gasPrice` from fill records / tx receipts)
- Average edge (edge-at-decision captured per fill by Stage 6 runner — `pendingOrderMeta` + `bot_fills.edgeAtDecision`), realized edge (actual P&L vs predicted edge), drawdown (Stage 4 peak-to-trough over the `FILL_OBSERVED` cumulative-PnL series: synthetic +0.4→+0.8→-0.1→+0.3 → maxDrawdown **0.9**), execution quality (fillPrice vs midAtDecision)

Reported gaps (`metrics.gaps[]`), per STOP CONDITIONS — not backfilled:

- `winRate`/`winningTrades`/`losingTrades`/`realizedEdge`: per-fill realized P&L is not computed by the Stage 6 runner for real fills (`updatePositionFromFill` keeps existing realizedPnL) and `winningOutcome` is unknown pre-settlement.
- `adverseSelection`: post-fill mid (t+5m) per fill is not captured — only `midAtDecision` is stored; not computable without approximating.
- `maximumDrawdown`: null + gap when no `FILL_OBSERVED` event carries `newRealizedPnL`.

With 0 real fills the endpoint returns clearly-labeled `insufficient_data` with `metrics: null` (verified live above) — no fabricated example numbers.

## 5. Tests

- `src/api/routes.test.ts` — 14 tests: shape + data-integrity tags per route, malformed-body 400s, `POST /orders` risk rejection (blocked, not executed), single-bot `:id` limitation 404, events pagination.
- `src/analytics/edge.test.ts` — 4 tests: insufficient-data on 0 fills; full metric computation from synthetic fills; drawdown via Stage 4 peak-to-trough on a synthetic cumulative-PnL series; null+gap reporting when series/edge data missing.
- Full repo: `tsc --noEmit` clean, `eslint src` 0 errors, **56/56 tests pass** (10 files).

## 6. Known limitations (explicit)

1. Single-bot only (decision (a), §2 above).
2. `GET /orders` requires `PRIVATE_KEY` for ec-core's authenticated `fetchOpenOrders`; read-only mode reports the per-market auth error honestly instead of fake-empty arrays.
3. Edge analytics win-rate/realized-edge/adverse-selection remain uncomputable until the runner records per-fill realized P&L and/or post-fill mids — future work, documented in `metrics.gaps[]`.
4. `POST /strategies/backtest` books are ESTIMATED (synthetic around lastPrice) per Stage 4's verified finding — no historical EC book time series exists.
5. EIP-7702 not attempted (optional; unverified for Event Contracts per Stage 1.5).

```

### PATCH /bots/:id, POST /bots/:id/start, POST /bots/:id/stop — live lifecycle

```
PATCH /bots/default {"loopIntervalMs":15000}   → persisted config updated (validation: loopIntervalMs 1 → 400, min 5000)
POST /bots/default/start                       → {"id":"default","status":"running"}
  ... ~35s live ...                            → status "running", tickCount 3 (real ticks, real markets)
POST /bots/default/stop                        → {"id":"default","status":"stopped","tickCount":3}
GET /bots/default/events?eventType=TICK        → 3 TICK events persisted
```

Same controlled pattern as the Stage 6 smoke: default order size 1, real signer, loop halted on stop, no unattended execution left running.

