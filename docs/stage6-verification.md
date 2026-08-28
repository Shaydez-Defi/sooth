# Stage 6 Verification — Bot Kit Runner (Shannon Testnet, Supervised)

**Date (UTC):** 2026-08-28T00:54:00Z (smoke run at 00:54 UTC, blocks 473054895→473055094, 3 ticks, 10s interval)
**Environment:** GitHub Codespace (Linux), Node v24.14.0, `@somnia-chain/markets-sdk@0.28.1`, `@dreamdex-bot-kit/ec-core` (`file:vendor/...`), `src/bot/runner.ts` + `src/snapshots/db.ts` (WAL)
**Network:** Shannon testnet — `VENUE_ID=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c`
**Indexer (LIVE_INDEXER):** `https://dev.smk.somnia.host/v1/graphql`
**RPC (LIVE_ONCHAIN):** `https://api.infra.testnet.somnia.network` (blockNumber via `getBlockNumber`, balances, OrderFilled logs)
**DB (DERIVED):** `data/snapshots.db` (392 snapshots at start, 109 bot_events after smoke, 0 fills/positions)
**Config (DERIVED, src/config.ts):** `ANALYSIS DEPTH_LEVELS=3 K=0.06 MIN_EDGE=0.02 MIN_LIQUIDITY=100 MAX_SPREAD=0.06/600 MIN_TIME_REMAINING=300` + `BOT_CONFIG ENABLED=true MAX_POSITION=5 MAX_LOSS=50 DEFAULT_ORDER_SIZE=1 LOOP_INTERVAL_MS=10000 (smoke override, default 30000)` + `MID_MOVE_CONFIG MID_MOVE_ALERT_THRESHOLD=0.025`

## Step 1 — Real-Time Data Preference (brief §11)

**Checked before defaulting to polling:**

- **Spot DreamDexWs:** `vendor/dreamdex-bot-kit/packages/core/src/ws.ts:27` `DreamDexWs` exposes `subscribeOrderbook([symbols])`, `subscribeTrades`, heartbeat 30s, auto-reconnect — real-time WS exists for spot (`wss://stg.api.dreamdex.io/v0/ws/public`). Verified in `docs/bot-kit-summary.md §4b` and `strategies/market-making/src/index.ts:36` `ws.subscribeOrderbook`.
- **EC / markets-sdk:** `grep -R subscribeOrderbook|watchOrderBook vendor/dreamdex-bot-kit/packages/ec-core/src` → **0 hits**. `packages/ec-core/src/exchange.ts` exposes `SomniaMarkets` with `wsRpcUrl: wss://api.infra.testnet.somnia.network/ws` but only `fetchPrice/watchPrice` (underlying BTC/ETH spot via `priceFeed`, `config.ts:123`), **not** order-book WS. All 6 `strategies/ec-*` (`ec-starter`, `ec-maker`, etc.) poll: `activeMarkets(ctx)` + `ctx.exchange.fetchOrderBook(yes, depth)` every loop (`strategies/ec-starter/src/index.ts:98`). SDK's `SomniaMarkets` has no `subscribeOrderBook` or `watchOrderBook` method; grep `subscribe|watch` in `ec-core/src` returns only `wsRpcUrl` and `watchPrice`.
- **Fills:** Stage 1 finding says prefer on-chain `OrderFilled` events over REST/indexer (indexer lags seconds, `docs/event-contracts.md:124`). Spot `TOPIC.OrderFilled = 0xc87f...` (`packages/core/src/contract.ts:161`, 6-arg `OrderFilled(takerOrderId,makerOrderId,quantityFilled,takerRemaining,makerRemaining,fillPrice)`). EC binary pools embed the **same OrderBook core**, emit same `OrderFilled`/`OrderPlaced`/`BinaryOrderPlaced` on their pool addresses (`node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js:70` `OrderFilled`, `dist/writer.js:150`). For EC we poll `viem.getLogs({ address: pool, fromBlock, toBlock })` with `OrderFilled` topic, not REST. Real-time `watchEvent` per-pool would fan out per market; polling `getLogs` per tick is deterministic and Codespace-safe.

**Conclusion:** **EC is poll-only for order-book** (no EC order-book WS exists), and **fills are via on-chain log polling** (`getLogs` with `0xc87f...` on each pool, plus `BinaryOrderPlaced` for side). We poll `activeMarkets` + `fetchOrderBook` + `getLogs` every tick — not silently polling when a real-time path exists, because no EC real-time order-book path exists to use. This is explicitly logged in `src/bot/runner.ts:1-13` header.

## Step 2 — Bot Runner (`src/bot/runner.ts`)

```ts
class BotRunner {
  status(): "running"|"stopped"
  async start(opts?: { dbPath?, withSigner?, loopIntervalMs?, marketScope? }): Promise<void>
  async stop(reason?: string): Promise<void>
  getConfig(): PersistedBotConfig; setConfig(cfg): void; updateConfig(patch): PersistedBotConfig;
  checkAutoStopReason(): string | null; // loss limit or disabled
  simulateFill(marketId,symbol,qty,price,realizedPnLDelta): void; // test helper
}
```

- **Loop:** interval from `BOT_CONFIG.LOOP_INTERVAL_MS` (default 30s, smoke uses 10s via `updateConfig({loopIntervalMs:10000})` persisted to `bot_config` table, survives restart). Each tick: `discover live markets → for each { analyzeMarket → checkMidMove → edgeThreshold.decide → runPipeline (Stage 5, real execution enabled via ecCtx) → logEvent } → pollFills (getLogs OrderFilled per pool since lastFillBlock) → re-check stop conditions`. `setInterval` with `unref` so it doesn't block exit.
- **Position/PnL:** in-memory `orderState` + persisted `bot_positions`/`bot_fills` tables in same `data/snapshots.db` (WAL, `src/snapshots/db.ts:63` bot tables). Built from **real `OrderFilled` events** via `getLogs`, not assumptions. `pollFills` decodes `quantityFilled`/`fillPrice`/`takerOrderId` from logs, inserts `bot_fills`, `upsertBotPosition` netPosition + realizedPnL, logs `FILL_OBSERVED`. `currentLoss` for risk engine's loss-limit is **real running total** `getTotalRealizedPnL(db)` (`SELECT SUM(realizedPnL) FROM bot_positions`, negative = loss), not stale/static.
- **Stop conditions (brief §6 step 8):** At tick start and post-tick, checks `cfg.bot.enabled` (log `AUTO_STOP_DISABLED` + `stop("auto-stop: bot disabled")`) and `currentLoss >= maxLoss` (log `AUTO_STOP_LOSS_LIMIT` + `stop("auto-stop: loss limit ...")`). `start()` also refuses if `enabled=false` (logs `AUTO_STOP_DISABLED` without starting). All stop paths log why and call `stop()` — don't keep looping past a real violation.

## Step 3 — Bot Configuration API Surface (brief §7)

`src/bot/config.ts:12` `PersistedBotConfig`:

```ts
interface PersistedBotConfig {
  bot: BotConfig; // Stage 5 shape (maxPosition/maxLoss/minLiquidity... all from BOT_CONFIG)
  marketScope: string; // "all" or single marketId bytes32 — so bot can be scoped to one market
  label?: string;
  midMoveThreshold: number; // from MID_MOVE_CONFIG
  loopIntervalMs: number; // from BOT_CONFIG.LOOP_INTERVAL_MS
}
```

Persisted to `bot_config` table (`id=1`, `data JSON`, `updatedAtUnix`), so `start()/stop()` + `marketScope` survive a process restart. Programmatic `runner.getConfig()/setConfig()/updateConfig()` is the surface the later REST layer (`GET /bots/:id`, `POST /bots/:id/start|stop`) will call into — no HTTP wired yet (brief §13 is later). Verified persistence in `src/bot/runner.test.ts:96` (write `marketScope=0xabc` to `/tmp/...db`, reopen, still `0xabc`).

## Step 4 — Monitoring / Events Surface (`src/bot/events.ts`)

Persisted `bot_events` table (reuse logger DB, `src/snapshots/db.ts:70`):

```sql
bot_events(id, createdAtUnix, createdAtIso, marketId, symbol, eventType, data JSON, blockNumber)
```

Every loop tick logs per market, per stage:

- `TICK` { tick, blockNumber, totalPnL, currentLoss }
- `MARKET_EVALUATED` { analysis (mid/edge/imbalance/liquidity/spread/direction/recommendation/reasons LIVE_INDEXER/DERIVED) }
- `STRATEGY_DECISION` { decision (PLACE_ORDER|SKIP, side, price, size, reasons) }
- `RISK_CHECK` { approved, rejectionReasons } or `{skipped:true}` when strategy SKIPs (short-circuit)
- `EXECUTION` { executed, txHash/blockNumber/orderId or blocked reason }
- `MID_MOVE_OBSERVED` { priorMid/currentMid/delta/threshold/priorBlock→currentBlock } (see 4b)
- `FILL_OBSERVED` { txHash, blockNumber, quantityFilled, fillPrice } (from OrderFilled log)
- `BOT_START`/`BOT_STOP`/`AUTO_STOP_*`

This is the data model for eventual `GET /bots/:id/events` (brief §13) — built now, HTTP not wired yet. Queryable independently: `SELECT * FROM bot_events WHERE eventType='MID_MOVE_OBSERVED' ORDER BY createdAtUnix`.

## Step 4b — Mid-Price Movement Observability (not a new strategy)

Since Stage-logger data shows **imbalance staying flat (0.000 balanced) while mid price actively drifts intraday** (e.g., 0.082 over 47s), add lightweight check alongside bot's per-tick evaluation — does NOT feed strategy/risk, does NOT trigger orders, purely logged.

- For each market each tick: `currentMid` (LIVE_INDEXER from `fetchOrderBook` bestBid/ask mid) vs most recent prior `snapshots.mid` for that `marketId` (`SELECT mid FROM snapshots WHERE marketId=? ORDER BY capturedAtUnix DESC`, same DB logger writes to — don't duplicate storage).
- If `|currentMid - priorMid| >= MID_MOVE_ALERT_THRESHOLD` (DERIVED, `src/config.ts:153` `MID_MOVE_ALERT_THRESHOLD=0.025` = 2.5 cents probability points; pick 0.025 because it catches observed drifts like 0.082/0.165/0.269 while not spamming on 1-tick jitter <1 cent), log distinctly:

  ```
  [MID_MOVE] ETH-0-28AUG26-0030/tUSDC mid 0.827 → 0.909 (+0.082) over 47s (block 473032593 → 473033062)
  ```

- Store in same `bot_events` with `eventType="MID_MOVE_OBSERVED"`, tagged `LIVE_INDEXER` for mids, `DERIVED` for delta/threshold, explicitly not a trading signal (`data.tag="DERIVED mid-move observability, NOT a trading signal"`). Queryable separately (`src/bot/midMove.ts:30` `checkMidMove`).

**Test:** `src/bot/midMove.test.ts:12` synthetic: prior mid 0.827 + current 0.909 → delta 0.082 ≥0.025 → `MID_MOVE_OBSERVED` logged with prior/current/threshold; 0.51→0.515 delta 0.005 <0.025 → no event; no prior row → no event.

## Step 5 — Run It For Real, Briefly, Supervised

Command: `npx tsx src/scripts/bot-smoke.ts` (runner with `withSigner:true`, `loopIntervalMs=10000`, default `MIN_EDGE=0.02`, no test loosening). Started at block `473054895`, let run 25s (~3 ticks: immediate + 2 intervals), then manual `stop()` and confirm `status()` + halt.

**Real loop output (blocks 473054895→473055094, 3 ticks, 8 live markets each, venue `0x6797...`):**

```text
=== Sooth Bot Smoke — Supervised Real Run (several cycles, then stop) ===

DB: data/snapshots.db — snapshots + bot tables (events/fills/positions/config)
Config: default MIN_EDGE=0.02, loop 10s for smoke (override), real execution enabled, no loosening

[SMOKE] status before start: stopped
[BOT] started — scope=all interval=10000ms venue=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c withSigner=true block=473054895
[SMOKE] status after start: running — running, will tick every 10s
[SMOKE] waiting 25s for ~3 ticks (immediate + 2 intervals) — observe [BOT] tick logs...
[BOT] tick #1 — 8 live market(s) block=473054895 scope=all
[MID_MOVE] ETH-0-28AUG26-0100-B7C4/tUSDC mid 0.271 → 0.436 (+0.165) over 38s (block 473054521 → 473054895)
[MID_MOVE] BTC-0-28AUG26-0100-B7C3/tUSDC mid 0.531 → 0.800 (+0.269) over 38s (block 473054521 → 473054895)
[MID_MOVE] ETH-0-28AUG26-0100-B750/tUSDC mid 0.829 → 0.924 (+0.095) over 38s (block 473054521 → 473054895)
[MID_MOVE] ETH-0-28AUG26-0400/tUSDC mid 0.573 → 0.613 (+0.040) over 38s (block 473054521 → 473054895)
[MID_MOVE] BTC-0-28AUG26-0400/tUSDC mid 0.674 → 0.726 (+0.052) over 38s (block 473054521 → 473054895)
[BOT] tick #2 — 8 live market(s) block=473054995 scope=all
[MID_MOVE] BTC-0-28AUG26-0100-B7C3/tUSDC mid 0.745 → 0.697 (-0.048) over 3s (block 473054976 → 473054995)
[BOT] tick #3 — 8 live market(s) block=473055094 scope=all
[MID_MOVE] ETH-0-28AUG26-0100-B7C4/tUSDC mid 0.343 → 0.280 (-0.063) over 13s (block 473054976 → 473055094)
[MID_MOVE] BTC-0-28AUG26-0100-B7C3/tUSDC mid 0.745 → 0.697 (-0.048) over 13s (block 473054976 → 473055094)

[SMOKE] tickCount so far: 3 — issuing manual stop
[BOT] stopped — reason=smoke manual stop ticks=3
[SMOKE] status before stop: running → after stop: stopped
[SMOKE] tickCount after stop: 3 — waiting 12s to confirm halt...
[SMOKE] tickCount 12s later: 3 — halted=true

[SMOKE] recent bot_events (last 20, persisted) — total in DB: 109
  #90 STRATEGY_DECISION BTC-0-28AUG26-0100-B74F/tUSDC block=473055094 {"decision":{"action":"SKIP","reasons":["order-book imbalance: no book depth to assess (empty bid or ask side)"]}}
  #91 RISK_CHECK BTC-0-28AUG26-0100-B74F/tUSDC block=473055094 {"skipped":true,"reason":"strategy SKIPs — risk not checked (short-circuit)"}
  #92 EXECUTION BTC-0-28AUG26-0100-B74F/tUSDC block=473055094 {"executed":false,"reason":"SKIP — no execution","decision":{"action":"SKIP",...},"risk":null}
  #93 MARKET_EVALUATED ETH-0-28AUG26-0400/tUSDC block=473055094 {"analysis":{"marketProbability":0.5835,"estimatedProbability":0.5835,"edge":0,"imbalance":0,"liquidity":1980,"spread":0.029,"spreadBps":497,"direction":"NONE","recommendation":"NO_TRADE","reasons":["order-book imbalance 0.000 (balanced) → tilt +0.0000 (k=0.060) → estimated 0.5835 vs market 0.5835","NO_TRADE: edge +0.0000 (< minEdge 0.0200)"]}}
  #94 STRATEGY_DECISION ETH-0-28AUG26-0400/tUSDC block=473055094 {"decision":{"action":"SKIP","reasons":["order-book imbalance 0.000 (balanced) → tilt +0.0000 → estimated 0.5835 vs market 0.5835","NO_TRADE: edge +0.0000 < minEdge 0.0200"]}}
  #95 RISK_CHECK ETH-0-28AUG26-0400/tUSDC block=473055094 {"skipped":true}
  #96 EXECUTION ETH-0-28AUG26-0400/tUSDC block=473055094 {"executed":false,"reason":"SKIP"}
  ...
  #109 BOT_STOP  block=— {"reason":"smoke manual stop","tickCount":3}

[SMOKE] fills count=0 positions count=0 (expected 0, unless live book shifted to trigger TRADE — not forced)
[SMOKE] MID_MOVE_OBSERVED count=8 — may be 0 if mids flat, or >0 if stage-logger data shows drift (threshold 0.025)

=== Smoke done — bot stopped, DB closed, no unattended execution left running ===
```

*Traceability:*

- **LIVE_INDEXER/LIVE_ONCHAIN** every tick: `activeMarkets` → 8 live (`-0030` 15m empty books, `-0100` spans, `-0400` 1h, `-29AUG` 1d), `fetchOrderBook(yes,3)` depth 3 per side (house 200/330/460 vs 990 asymmetry → 0 imbalance when balanced), `marketOnchain` expiry → `timeRemaining`, `getBlockNumber` each tick, balances `49.98 STT 500 tUSDC` (funded), openPositions 0.
- **DERIVED** `analyzeMarket` on each book: 5 markets `balanced 0.000 → tilt 0 → edge 0 <0.02 → NO_TRADE`; 3 markets `empty bid or ask side` → `no book depth to assess` stop condition (brief), all `SKIP`. `edgeThreshold.decide` carried reasons unchanged. `dryRun` would have shown same, but here `runPipeline` is **real** (withSigner) — proves wiring without forcing.
- **Risk→Execution:** All 8 per tick `SKIP` → `RISK_CHECK skipped:true (short-circuit)` → `EXECUTION executed:false` — **no `placeRestingOrder` called**, hence `fills 0 positions 0` (honest, not forced; venue's quoting is symmetric `0` imbalance, mid drifts but edge stays 0). If during this run a book had moved to e.g. Stage 3's `-0.222` ask-heavy and edge `-0.013→-0.020+`, pipeline would have let `RISK_CHECK approved` and placed `1@mid` GTC — not artificially forced here.
- **Mid-move observability (4b):** 8 `MID_MOVE_OBSERVED` events across 3 ticks, e.g. `0.271→0.436 (+0.165) over 38s (block 473054521→473054895)` — LIVE_INDEXER mids, DERIVED delta `0.165 >= 0.025` threshold, logged as `MID_MOVE_OBSERVED` distinct from strategy/risk/execution, demonstrating value even on `SKIP` ticks. Tagged not-a-signal in `data.tag`.
- **Stop/start:** `status before start: stopped → after start: running`, `before stop: running → after stop: stopped`, `tickCount 3 → 12s later 3 halted=true` — loop actually halts. `BOT_START`/`BOT_STOP` persisted in `bot_events` (id 1 and 109), `loopIntervalMs 10000` persisted in `bot_config` (survives restart, shown in `runner.test.ts` file-restart test).
- **Position/PnL:** `bot_fills`/`bot_positions` tables exist but empty this run because no fill occurred; `currentLoss` for risk is `getTotalRealizedPnL = 0` (real total, not stale). If a fill had occurred, `pollFills` would have decoded `OrderFilled` log and `upsertBotPosition` would have updated `netPosition`/`realizedPnL`.

**Not left running:** Smoke explicitly `stop("smoke manual stop")` and `db.close()` before exit; `process.exit(0)` — no unattended execution with real signer left on.

## Step 6 — Tests

- `src/bot/runner.test.ts:12` (5 tests):
  - `start/stop lifecycle` — mock `ecFactory` → `start` → `running` + `BOT_START` persisted, `stop` → `stopped` + `BOT_STOP`, `tickCount` halted.
  - `loss-limit-triggered auto-stop (synthetic)` — `updateConfig maxLoss 5`, `simulateFill(..., -10)` → `getTotalRealizedPnL -10`, `checkAutoStopReason()` returns `"loss limit"` string.
  - `event log records every tick outcome including SKIPs` — direct `logEvent` 4 types → `countBotEvents 4` and ordered `MARKET_EVALUATED→STRATEGY_DECISION→RISK_CHECK→EXECUTION`.
  - `fill-based position update from synthetic OrderFilled-shaped input` — `simulateFill` 2× → `getBotPosition netPosition 3 realizedPnL 0.2`, `bot_fills 2`, `FILL_OBSERVED ≥2`.
  - `BOT_START/BOT_STOP persisted and survives restart via SQLite file` — `/tmp/...db` file restart → events/config survive.
- `src/bot/midMove.test.ts:12` (3 tests): synthetic prior mid `0.827` + current `0.909` delta `0.082 ≥0.025` → `MID_MOVE_OBSERVED` 1 event with correct `priorMid/currentMid/threshold`; under threshold `0.005` → 0 events; no prior snapshot → `moved false`.

## Technical Checks

- `npx tsc --noEmit` → PASS
- `npx eslint src` → PASS (0 errors)
- `npx vitest run` → PASS (38 tests: `src/bot/runner.test.ts` 5, `src/bot/midMove.test.ts` 3, `src/strategy/pipeline.test.ts` 3, `src/backtest/engine.test.ts` 9, `src/analysis/engine.test.ts` 8, `src/config.test.ts` 5, `src/ec/orderLifecycle.test.ts` 2, `src/constants.test.ts` 3)

## How to Re-run

```bash
npx tsx src/scripts/bot-smoke.ts    # supervised 3-tick smoke, auto-stop proof, prints real events
# or programmatically:
import { BotRunner } from "./src/bot/runner.js";
const r = new BotRunner();
await r.start({ withSigner:true }); // loops every 30s (or BOT_LOOP_INTERVAL_MS)
await r.stop("done");              // status() now "stopped", loop halted
```

## Files Added/Modified

- `src/config.ts` — added `BOT_CONFIG.LOOP_INTERVAL_MS` + `MID_MOVE_CONFIG.MID_MOVE_ALERT_THRESHOLD=0.025`
- `src/snapshots/db.ts` — added bot tables (`bot_events`/`bot_fills`/`bot_positions`/`bot_config`) + helpers (`insertBotEvent`, `insertBotFill`, `upsertBotPosition`, `getTotalRealizedPnL`, `getLatestSnapshotMid`) to same `data/snapshots.db` (WAL)
- `src/bot/events.ts` — event log wrapper (persisted)
- `src/bot/config.ts` — `PersistedBotConfig` (marketScope + BotConfig, persisted to `bot_config`)
- `src/bot/midMove.ts` — mid-move observability check (`checkMidMove`)
- `src/bot/runner.ts` — `BotRunner` start/stop/loop, real `runPipeline` execution, `pollFills` via `getLogs` OrderFilled (`0xc87f...`), mid-move per tick, auto-stop on loss/disabled, shared DB
- `src/bot/runner.test.ts` — 5 tests (lifecycle, loss-limit auto-stop, event log, fill position, persistence)
- `src/bot/midMove.test.ts` — 3 tests (over/under/no-prior)
- `src/scripts/bot-smoke.ts` — supervised smoke (several cycles, then manual stop + halt proof)
- `docs/stage5-verification.md` — still valid (pipeline 0 approved due to balanced books — now also mid-move drift observed)
- `.gitignore` — already has `data/` + `!data/.gitkeep` for DB

## Next

Edge analytics (§10, reporting on data we already have), REST API (§13) tying this together for a frontend, and optional EIP-7702 (§12) are remaining brief items. This is the last "engine" stage — bot is real, not a claim.
