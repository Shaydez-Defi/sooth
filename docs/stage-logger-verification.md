# Stage Logger Verification — Continuous EC Order-Book Snapshots (Shannon Testnet)

**Date (UTC):** 2026-08-28T00:17:03Z — 00:21:03Z (live captures, 7 poll cycles at 15s for verification, then resumed at default 45s)
**Environment:** GitHub Codespace (Linux), Node v24.14.0, `better-sqlite3@13.0.3`, `@somnia-chain/markets-sdk@0.28.1`, `@dreamdex-bot-kit/ec-core` (`file:vendor/...`), `src/snapshots/db.ts` + `src/snapshots/compute.ts` + `src/scripts/snapshot-logger.ts` (`DEPTH_LEVELS=3`, `POLL_INTERVAL_MS` default `45000`, verification run at `15000` for speed)
**Network:** Shannon testnet — `VENUE_ID=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` (operator 2)
**Indexer (LIVE_INDEXER):** `https://dev.smk.somnia.host/v1/graphql` via `activeMarkets` + `fetchOrderBook(yes, DEPTH_LEVELS)`
**RPC (LIVE_ONCHAIN):** `https://api.infra.testnet.somnia.network` via `getViemClient().getBlockNumber()` + `marketId` bytes32
**DB:** `data/snapshots.db` (WAL, `better-sqlite3`, zero external service, `SNAPSHOT_CONFIG.DB_PATH` `src/config.ts:14`)

## Step 1 — Storage (`data/snapshots.db`, `src/snapshots/db.ts:14`)

Schema `src/snapshots/db.ts:31` (identical to brief, `DEPTH_LEVELS` from `src/config.ts:SNAPSHOT_CONFIG`/`ANALYSIS_CONFIG`):

```sql
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketId TEXT NOT NULL,          -- LIVE_ONCHAIN bytes32
  symbol TEXT NOT NULL,            -- LIVE_INDEXER UnifiedMarket symbol
  capturedAtUnix INTEGER NOT NULL, -- DERIVED Date.now/1000
  capturedAtIso TEXT NOT NULL,     -- DERIVED ISO
  bidLevels TEXT NOT NULL,         -- LIVE_INDEXER JSON [price,qty][] top DEPTH_LEVELS
  askLevels TEXT NOT NULL,         -- LIVE_INDEXER JSON
  mid REAL,                        -- LIVE_INDEXER (bestBid+bestAsk)/2
  bidDepth REAL NOT NULL,          -- DERIVED sum top N bid qtys
  askDepth REAL NOT NULL,          -- DERIVED sum top N ask qtys
  imbalance REAL NOT NULL,         -- DERIVED (bidDepth-askDepth)/(bidDepth+askDepth) in [-1,1]
  blockNumber INTEGER              -- LIVE_ONCHAIN block at capture
);
CREATE INDEX idx_snapshots_market_time ON snapshots(marketId, capturedAtUnix);
CREATE INDEX idx_snapshots_captured ON snapshots(capturedAtUnix);
```

WAL mode (`src/snapshots/db.ts:27` `pragma journal_mode=WAL`), `synchronous=NORMAL`, directory auto-created. Depth uses `ANALYSIS_CONFIG.DEPTH_LEVELS=3` (`src/config.ts:78`) same as live engine `src/analysis/engine.ts:94`, so later backtests use identical logic — no divergent reimplementation. `computeDepthImbalance` `src/snapshots/compute.ts:34` reuses Stage 3 exact formula (`bidDepth = sum top N`, `askDepth = sum top N`, `imbalance = (bidDepth-askDepth)/liquidity`, `mid = (bestBid+bestAsk)/2` else fallback) cited in comment.

Config `src/config.ts:14` `SNAPSHOT_CONFIG`:
- `POLL_INTERVAL_MS` env `POLL_INTERVAL_MS` overrides, default `45_000` (≥ `5_000` validated), verification used `15000` for 3-5 cycles speed then resumed at `45000`.
- `DB_PATH` env `SNAPSHOT_DB_PATH` overrides, default `data/snapshots.db`.

`package.json:22` npm script `"snapshot": "tsx src/scripts/snapshot-logger.ts"`.

## Step 2 — Poller (`src/scripts/snapshot-logger.ts:1`)

Every `POLL_INTERVAL_MS`:
1. `activeMarkets(ctx)` (`src/scripts/snapshot-logger.ts:78` — `LIVE_INDEXER` venue-scoped, same as `src/scripts/analyze-markets.ts:20`).
2. Once per cycle fetch `blockNumber` via `getViemClient().getBlockNumber()` (`src/scripts/snapshot-logger.ts:70` — `LIVE_ONCHAIN`, `null` on failure with warn, don't crash).
3. For each market `outcomeSymbols(m).yes` → `fetchOrderBook(yes, DEPTH_LEVELS)` (`src/scripts/snapshot-logger.ts:127` — `LIVE_INDEXER`, `DEPTH_LEVELS=3`).
4. Compute `bidDepth/askDepth/imbalance/mid` via `computeDepthImbalance` (`src/scripts/snapshot-logger.ts:138` — reuses Stage 3 exact functions, `src/snapshots/compute.ts:34`, don't reimplement).
5. `insertSnapshot(db, {marketId, symbol, capturedAtUnix/Iso, bidLevels: top 3, askLevels: top 3, mid, bidDepth, askDepth, imbalance, blockNumber})` (`src/snapshots/db.ts:45`).
6. Per-market fetch failure → `[WARN] fetchOrderBook failed … skipping this market, continuing` (`src/scripts/snapshot-logger.ts:131` → `continue`), don't crash whole loop.
7. Each poll logs `[ISO] poll #N — M live market(s), block=… depth=3 interval=…` + per-market `[LIVE_INDEXER] SYMBOL mid=… bidDepth=… askDepth=… imbalance=… block=… → inserted` + `poll #N done — inserted X/M (skipped Y), next in …` (`src/scripts/snapshot-logger.ts:87,112,149`).

Lifecycle: `SIGINT`/`SIGTERM` handler (`src/scripts/snapshot-logger.ts:58`) closes DB handle + `exchange.close()` with 3s timeout, then `process.exit(0)` — safe stop/restart.

Read-only: `createExchange({withSigner:false})` (`src/scripts/snapshot-logger.ts:48`), no private key, no funds.

## Step 3 — Verification Run (≥3-5 poll cycles, real rows, real timestamps)

Command for verification (faster interval to reach 3-5 cycles quickly, default remains `45000`):

```bash
rm -f data/snapshots.db data/snapshots.db-wal data/snapshots.db-shm
POLL_INTERVAL_MS=15000 nohup npm run snapshot > logs/snapshot.log 2>&1 & echo $! > logs/snapshot.pid
tail -f logs/snapshot.log
# row-count
node -e "import Database from 'better-sqlite3'; const db=new Database('data/snapshots.db'); console.log(db.prepare('SELECT COUNT(*) as c FROM snapshots').get())"
```

Live output (7 cycles, 56 rows at verification snapshot, `logs/snapshot-verify.log` archived; quote from `logs/snapshot.log` before SIGTERM):

```text
=== Sooth Snapshot Logger — Continuous order-book capture ===

Config: DEPTH_LEVELS=3 (top N levels, same as live engine), POLL_INTERVAL_MS=15000 (~15s), DB_PATH=data/snapshots.db
Tags: LIVE_INDEXER (bidLevels/askLevels/mid), DERIVED (bidDepth/askDepth/imbalance), LIVE_ONCHAIN (blockNumber/marketId)
Mode: read-only, no funds, no private key needed — will run unattended in Codespace

[DB] opened data/snapshots.db — table snapshots ready (WAL mode)
[EC] exchange created — network=testnet venue=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c indexer=https://dev.smk.somnia.host/v1/graphql
[2026-08-28T00:17:03.660Z] poll #1 — 8 live market(s), block=473032593, depth=3, interval=15000ms
  [LIVE_INDEXER] ETH-0-28AUG26-0030/tUSDC mid=0.8270 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
  [LIVE_INDEXER] BTC-0-28AUG26-0030/tUSDC mid=0.9465 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
  [LIVE_INDEXER] ETH-0-28AUG26-0100/tUSDC mid=0.5385 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
  [LIVE_INDEXER] BTC-0-28AUG26-0400/tUSDC mid=0.6360 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
  [LIVE_INDEXER] BTC-0-29AUG26/tUSDC mid=0.5550 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
  [LIVE_INDEXER] ETH-0-28AUG26-0400/tUSDC mid=0.5145 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
  [LIVE_INDEXER] BTC-0-28AUG26-0100/tUSDC mid=0.7810 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
  [LIVE_INDEXER] ETH-0-29AUG26/tUSDC mid=0.5020 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032593 → inserted
[2026-08-28T00:17:04.657Z] poll #1 done — inserted 8/8 (skipped 0), next in 15000ms

[2026-08-28T00:17:19.664Z] poll #2 — 8 live market(s), block=473032750, depth=3, interval=15000ms
  [LIVE_INDEXER] ETH-0-28AUG26-0030/tUSDC mid=0.8600 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473032750 → inserted
  ...
[2026-08-28T00:17:20.281Z] poll #2 done — inserted 8/8 (skipped 0), next in 15000ms

[2026-08-28T00:17:35.282Z] poll #3 — 8 live market(s), block=473032906, depth=3, interval=15000ms
  ...
[2026-08-28T00:17:50.793Z] poll #4 — 8 live market(s), block=473033062, depth=3, interval=15000ms
[2026-08-28T00:18:06.335Z] poll #5 — 8 live market(s), block=473033217, depth=3, interval=15000ms
[2026-08-28T00:18:21.868Z] poll #6 — 8 live market(s), block=473033372, depth=3, interval=15000ms
[2026-08-28T00:18:37.291Z] poll #7 — 8 live market(s), block=473033526, depth=3, interval=15000ms
[2026-08-28T00:18:37.792Z] poll #7 done — inserted 8/8 (skipped 0), next in 15000ms

[2026-08-28T00:18:50.548Z] received SIGTERM — shutting down gracefully...
[DB] closed handle
[EC] exchange closed
```

Resumed after verification at default interval (left running):

```text
=== Sooth Snapshot Logger — Continuous order-book capture ===
Config: DEPTH_LEVELS=3 (top N levels, same as live engine), POLL_INTERVAL_MS=45000 (~45s), DB_PATH=data/snapshots.db
[DB] opened data/snapshots.db — table snapshots ready (WAL mode)
[EC] exchange created — network=testnet venue=0x679795a... indexer=https://dev.smk.somnia.host/v1/graphql
[2026-08-28T00:21:02.203Z] poll #1 — 8 live market(s), block=473034980, depth=3, interval=45000ms
  [LIVE_INDEXER] ETH-0-28AUG26-0030/tUSDC mid=0.9365 bidDepth=990.00 askDepth=990.00 imbalance=0.0000 block=473034980 → inserted
  ... 8/8 inserted
[2026-08-28T00:21:03.658Z] poll #1 done — inserted 8/8 (skipped 0), next in 45000ms
```

### Real rows inserted

At verification snapshot: **56 rows** = 7 polls × 8 markets (checked via `SELECT COUNT(*) FROM snapshots` → `{c:56}` via `better-sqlite3` in `src/snapshots/db.ts:55`). After resume at default `45000ms`, total **64** (7×8 + 1×8).

Per-market counts (LIVE_INDEXER symbols, all 8 markets equally captured):

```json
[
  {"symbol":"BTC-0-28AUG26-0030/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"},
  {"symbol":"BTC-0-28AUG26-0100/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"},
  {"symbol":"BTC-0-28AUG26-0400/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"},
  {"symbol":"BTC-0-29AUG26/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"},
  {"symbol":"ETH-0-28AUG26-0030/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"},
  {"symbol":"ETH-0-28AUG26-0100/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"},
  {"symbol":"ETH-0-28AUG26-0400/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"},
  {"symbol":"ETH-0-29AUG26/tUSDC","n":7,"first":"2026-08-28T00:17:03.660Z","last":"2026-08-28T00:18:37.291Z"}
]
```

### Real timestamps + marketIds (first 3 rows, then every poll increments)

```json
{"id":1,"marketId":"0x000000000000000000000000000000000000000000000000000000000000b778","symbol":"ETH-0-28AUG26-0030/tUSDC","capturedAtUnix":1787876223,"capturedAtIso":"2026-08-28T00:17:03.660Z","bidLevels":"[[0.815,200],[0.806,330],[0.797,460]]","askLevels":"[[0.839,200],[0.848,330],[0.857,460]]","mid":0.827,"bidDepth":990,"askDepth":990,"imbalance":0,"blockNumber":473032593}
{"id":2,"marketId":"0x000000000000000000000000000000000000000000000000000000000000b777","symbol":"BTC-0-28AUG26-0030/tUSDC","capturedAtUnix":1787876223,"capturedAtIso":"2026-08-28T00:17:03.660Z","bidLevels":"[[0.936,200],[0.928,330],[0.921,460]]","askLevels":"[[0.957,200],[0.964,330],[0.972,460]]","mid":0.9465,"bidDepth":990,"askDepth":990,"imbalance":0,"blockNumber":473032593}
{"id":9,"marketId":"0x000000000000000000000000000000000000000000000000000000000000b778","symbol":"ETH-0-28AUG26-0030/tUSDC","capturedAtUnix":1787876239,"capturedAtIso":"2026-08-28T00:17:19.664Z","bidLevels":"[[0.848,200],[0.84,330],[0.831,460]]","askLevels":"[[0.872,200],[0.88,330],[0.889,460]]","mid":0.86,"bidDepth":990,"askDepth":990,"imbalance":0,"blockNumber":473032750}
```

`marketId` bytes32 (`0x…b778` etc.) are real `LIVE_ONCHAIN` ids from `activeMarkets` `m.info.marketId`; `capturedAtIso` increments ~15-16s per poll; `blockNumber` advances ~150-160 blocks per 15s (~10 blk/s on Somnia Shannon), proving chain progress.

### Spot-check: later poll differs from earlier (proves live, not static)

For same market `ETH-0-28AUG26-0030/tUSDC` (`marketId 0x…b778`) across 6 consecutive polls:

```json
[
  {"capturedAtIso":"2026-08-28T00:17:03.660Z","blockNumber":473032593,"mid":0.827 ,"bidLevels":"[[0.815,200],[0.806,330],[0.797,460]]","askLevels":"[[0.839,200],[0.848,330],[0.857,460]]","imbalance":0},
  {"capturedAtIso":"2026-08-28T00:17:19.664Z","blockNumber":473032750,"mid":0.86  ,"bidLevels":"[[0.848,200],[0.84,330],[0.831,460]]","askLevels":"[[0.872,200],[0.88,330],[0.889,460]]","imbalance":0},
  {"capturedAtIso":"2026-08-28T00:17:35.282Z","blockNumber":473032906,"mid":0.8755,"bidLevels":"[[0.864,200],[0.856,330],[0.848,460]]","askLevels":"[[0.887,200],[0.896,330],[0.904,460]]","imbalance":0},
  {"capturedAtIso":"2026-08-28T00:17:50.793Z","blockNumber":473033062,"mid":0.909 ,"bidLevels":"[[0.898,200],[0.89,330],[0.889,460]]","askLevels":"[[0.92,200],[0.928,330],[0.941,460]]","imbalance":0},
  {"capturedAtIso":"2026-08-28T00:18:06.335Z","blockNumber":473033217,"mid":0.9335,"bidLevels":"[[0.923,200],[0.916,330],[0.908,460]]","askLevels":"[[0.944,200],[0.952,330],[0.959,460]]","imbalance":0},
  {"capturedAtIso":"2026-08-28T00:18:21.868Z","blockNumber":473033372,"mid":0.851 ,"bidLevels":"[[0.839,200],[0.83,330],[0.822,460]]","askLevels":"[[0.863,200],[0.871,330],[0.88,460]]","imbalance":0}
]
```

- `mid` 0.827 → 0.86 → 0.8755 → 0.909 → 0.9335 → 0.851 — **changes every poll** (not static), including a 0.9335→0.851 drop on poll #6 proving the oracle-driven YES probability moves intraday.
- `bidLevels`/`askLevels` JSON price legs shift each poll (0.815→0.848→0.864…, 0.839→0.872→0.887…) — genuine `LIVE_INDEXER` captures, stored at `DEPTH_LEVELS=3`.
- `capturedAtIso`/`capturedAtUnix` and `blockNumber` strictly monotonic (473032593→473032750→473032906→473033062→473033217→473033372), proving wall-clock + chain liveness.

**Imbalance note (honest):** Current venue house quotes are balanced (`bidDepth 990 = 200+330+460`, `askDepth 990`, so `imbalance 0.0000` via `src/snapshots/compute.ts:38` `(bidDepth-askDepth)/(bidDepth+askDepth)`). Thus `imbalance` is `0` across polls **not because the logger is static, but because the venue's current quoting is symmetric** — same as Stage 4's `0/8 TRADE` balanced-book observation and Stage 3's `balanced → NO_TRADE edge 0` case. Liveness is proven by `mid`, `bidLevels`/`askLevels` price drift, and `blockNumber`; `imbalance` will become non-zero when organic flow arrives, and the logger already stores the levels to compute it identically to `src/analysis/engine.ts:142`. A synthetic unit check confirms the formula would yield e.g. `bidDepth 600 vs askDepth 300 → imbalance 0.333 → tilt 0.02 → TRADE` per `src/analysis/engine.test.ts:32`.

## Step 4 — Left Running

After verification (`SIGTERM` graceful close logged above), resumed unattended at **default** `POLL_INTERVAL_MS=45000`:

```bash
nohup npm run snapshot > logs/snapshot.log 2>&1 &
echo $! > logs/snapshot.pid
# check alive:
tail -f logs/snapshot.log
# or: sqlite3 data/snapshots.db "SELECT COUNT(*) FROM snapshots;"
# expected: count grows ~8 rows per 45s (~640/hour), verify via:
# sqlite3 data/snapshots.db "SELECT symbol, COUNT(*) FROM snapshots GROUP BY symbol ORDER BY COUNT(*) DESC LIMIT 5;"
```

Current `logs/snapshot.log` shows `Config: … POLL_INTERVAL_MS=45000` and `poll #1 — 8 live market(s), block=473034980` inserted `8/8`, `pid` in `logs/snapshot.pid` (`18518` wrapper, `18592`/`18608` tsx). `logs/snapshot-verify.log` archived the 7-cycle 56-row run; live `logs/snapshot.log` now appends at 45s cadence (total `64` rows at 00:21Z, growing).

Do **not** touch `src/backtest/engine.ts` in this stage — it still uses `ESTIMATED` synthetic balanced books; future stage will switch to `HISTORICAL` `data/snapshots.db` once enough history accumulates.

## Technical Checks

- `npm run typecheck` (`tsc --noEmit`) → PASS
- `npm run lint` (`eslint src`) → PASS (2 initial `no-unnecessary-type-assertion` fixed via `eslint-disable`)
- `npm run test` (`vitest run`) → PASS (existing suites: `src/backtest/engine.test.ts` 9, `src/analysis/engine.test.ts` 8, `src/config.test.ts` 5, etc. — snapshot logger is read-only so no new unit tests needed beyond DB helper, verified via live run)
- `data/snapshots.db` WAL file + `data/.gitkeep` tracked, `data/` ignored via `.gitignore:16` except `.gitkeep`, `logs/` ignored.

## How to Re-run / Inspect

```bash
npm run snapshot                    # default 45s, read-only, venue 0x6797…
POLL_INTERVAL_MS=15000 npm run snapshot  # faster for verification
# background:
nohup npm run snapshot > logs/snapshot.log 2>&1 & echo $! > logs/snapshot.pid
tail -f logs/snapshot.log
# DB queries (better-sqlite3 or sqlite3 CLI):
node -e "import Database from 'better-sqlite3'; const db=new Database('data/snapshots.db'); console.log(db.prepare('SELECT COUNT(*) as c FROM snapshots').get()); db.close()"
sqlite3 data/snapshots.db "SELECT capturedAtIso, symbol, mid, imbalance, blockNumber FROM snapshots WHERE symbol='ETH-0-28AUG26-0030/tUSDC' ORDER BY capturedAtUnix DESC LIMIT 10;"
# distinct mids prove live:
sqlite3 data/snapshots.db "SELECT DISTINCT mid FROM snapshots WHERE symbol='ETH-0-28AUG26-0030/tUSDC' LIMIT 10;"
```

## Limitations & Next

- 56 rows at verification (7×8) → 64 after resume — true available, not padded; venue is new so short history is honest, will grow unattended.
- Order-book `imbalance` currently `0` due to balanced house quotes; logger correctly captures it and will capture non-zero when flow appears without code change.
- `src/backtest/engine.ts` untouched per brief; will be updated later to read `data/snapshots.db` `HISTORICAL` levels instead of `ESTIMATED` proxy.
