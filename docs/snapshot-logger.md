# Snapshot Logger — Continuous EC Order-Book Capture

Continuously logs **real order-book snapshots** for all live EC markets so future backtests have genuine **HISTORICAL** book data instead of Stage 4's **ESTIMATED** synthetic proxy. Read-only, no funds, no private key required.

## What it does

- Every `POLL_INTERVAL_MS` (`src/config.ts:SNAPSHOT_CONFIG`, default `45000ms` ≈ 45s, env `POLL_INTERVAL_MS` overrides, min 5000) discovers live markets via `activeMarkets` (`LIVE_INDEXER`, venue-scoped).
- For each market pulls `fetchOrderBook(yes, DEPTH_LEVELS)` (`LIVE_INDEXER`, `DEPTH_LEVELS=3` from `src/config.ts:ANALYSIS_CONFIG` — same depth as live analysis engine `src/analysis/engine.ts`).
- Computes `bidDepth/askDepth/imbalance` via Stage 3's exact functions (`src/snapshots/compute.ts:computeDepthImbalance` reuses `ANALYSIS_CONFIG.DEPTH_LEVELS`, formula `imbalance=(bidDepth-askDepth)/(bidDepth+askDepth)` in `[-1,1]`, `mid=(bestBid+bestAsk)/2`).
- Inserts one row per market per poll into SQLite `data/snapshots.db` (`better-sqlite3`, zero external service, WAL mode). Schema `src/snapshots/db.ts:initDb`:

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
  imbalance REAL NOT NULL,         -- DERIVED in [-1,1]
  blockNumber INTEGER              -- LIVE_ONCHAIN block at capture
);
CREATE INDEX idx_snapshots_market_time ON snapshots(marketId, capturedAtUnix);
CREATE INDEX idx_snapshots_captured ON snapshots(capturedAtUnix);
```

- Per-market `fetchOrderBook` failure is **skipped gracefully** (log `[WARN] … skipping this market, continuing`) — does not crash whole loop.
- Each poll cycle logs to stdout with timestamp + market count, visible when tailing.
- Clean shutdown on `SIGINT`/`SIGTERM` (closes DB handle + exchange).

Backtest will later read `data/snapshots.db` to replace `ESTIMATED` synthetic balanced books with genuine `HISTORICAL` levels (same `DEPTH_LEVELS` logic, no code change needed). `src/backtest/engine.ts` is **not touched** in this stage.

## Run in the background (Codespace)

```bash
# from repo root — ensure DB dir exists (created automatically)
mkdir -p data logs

# start logger in background, visible log file
nohup npm run snapshot > logs/snapshot.log 2>&1 &
echo $! > logs/snapshot.pid
echo "logger pid $(cat logs/snapshot.pid) — tailing..."

# check it's alive
tail -f logs/snapshot.log
# expect: === Sooth Snapshot Logger === + [ISO] poll #1 — N live market(s) ...

# row-count query against snapshots.db
# using sqlite3 CLI (or better-sqlite3 via node)
sqlite3 data/snapshots.db "SELECT COUNT(*) FROM snapshots;"
# or via node:
node -e "import Database from 'better-sqlite3'; const db=new Database('data/snapshots.db'); console.log(db.prepare('SELECT COUNT(*) as c FROM snapshots').get()); db.close()"
# quick per-market counts
sqlite3 data/snapshots.db "SELECT symbol, COUNT(*) as n, MIN(capturedAtIso) as first, MAX(capturedAtIso) as last FROM snapshots GROUP BY symbol ORDER BY n DESC LIMIT 20;"
# imbalance drift check (proves live, not static — later poll should differ)
sqlite3 data/snapshots.db "SELECT capturedAtIso, symbol, imbalance, mid, bidDepth, askDepth FROM snapshots ORDER BY capturedAtUnix DESC LIMIT 20;"
```

Default `POLL_INTERVAL_MS=45000` means ~80 polls/hour, ~80×N rows/hour (N = live markets, typically 4-8 on testnet venue `0x6797…`). Adjust via env if needed:

```bash
POLL_INTERVAL_MS=30000 nohup npm run snapshot > logs/snapshot.log 2>&1 &
# or persist in .env: POLL_INTERVAL_MS=45000
```

## Stop / restart

```bash
# graceful stop (SIGTERM closes DB handle so it can be safely restarted)
kill "$(cat logs/snapshot.pid)"
# or if pid file missing:
pkill -f snapshot-logger
# verify stopped
tail logs/snapshot.log   # should end with "received SIGTERM — shutting down..."
sqlite3 data/snapshots.db "SELECT COUNT(*) FROM snapshots;"

# restart
nohup npm run snapshot > logs/snapshot.log 2>&1 &
echo $! > logs/snapshot.pid
```

## Files

- `src/config.ts:SNAPSHOT_CONFIG` — `POLL_INTERVAL_MS` + `DB_PATH` (zero external service)
- `src/snapshots/db.ts` — `openSnapshotDb`, `initDb`, `insertSnapshot`, `countSnapshots`, `recentSnapshots`
- `src/snapshots/compute.ts` — `computeDepthImbalance` (reuses Stage 3 exact formula, cited)
- `src/scripts/snapshot-logger.ts` — poller (read-only, per-market skip, SIGINT/SIGTERM, cycle logging)
- `data/snapshots.db` — SQLite WAL, gitignored, unattended in Codespace
- `logs/snapshot.log` — stdout capture when run via nohup (gitignored)

## Tags

Every stored row is tagged by provenance in code comments and docs: `LIVE_INDEXER` (levels/mid), `DERIVED` (depth/imbalance), `LIVE_ONCHAIN` (marketId/blockNumber). No `ESTIMATED` here — these are genuine captures for future `HISTORICAL` backtests.
