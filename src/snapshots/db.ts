/**
 * Snapshot storage — SQLite at data/snapshots.db (better-sqlite3, zero external service).
 * Schema matches Stage 4 logger brief: id, marketId, symbol, capturedAtUnix, capturedAtIso,
 * bidLevels JSON, askLevels JSON, mid, bidDepth, askDepth, imbalance, blockNumber.
 *
 * Depth: uses ANALYSIS_CONFIG.DEPTH_LEVELS (same as live engine) so later backtests use identical logic.
 * Tags: LIVE_INDEXER (bidLevels/askLevels/mid), DERIVED (bidDepth/askDepth/imbalance), LIVE_ONCHAIN (blockNumber).
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SNAPSHOT_CONFIG } from "../config.js";

export interface SnapshotRow {
  readonly id: number;
  readonly marketId: string; // LIVE_ONCHAIN bytes32
  readonly symbol: string; // LIVE_INDEXER UnifiedMarket symbol
  readonly capturedAtUnix: number; // DERIVED (Date.now)
  readonly capturedAtIso: string; // DERIVED
  readonly bidLevels: string; // LIVE_INDEXER JSON string of [price, qty][]
  readonly askLevels: string; // LIVE_INDEXER JSON string
  readonly mid: number | null; // LIVE_INDEXER derived from book best bid/ask
  readonly bidDepth: number; // DERIVED sum of top DEPTH_LEVELS bid qtys
  readonly askDepth: number; // DERIVED sum of top DEPTH_LEVELS ask qtys
  readonly imbalance: number; // DERIVED (bidDepth-askDepth)/(bidDepth+askDepth) in [-1,1]
  readonly blockNumber: number | null; // LIVE_ONCHAIN chain block at capture
}

export interface InsertSnapshotParams {
  readonly marketId: string;
  readonly symbol: string;
  readonly capturedAtUnix: number;
  readonly capturedAtIso: string;
  readonly bidLevels: ReadonlyArray<readonly [number, number]>;
  readonly askLevels: ReadonlyArray<readonly [number, number]>;
  readonly mid: number | null;
  readonly bidDepth: number;
  readonly askDepth: number;
  readonly imbalance: number;
  readonly blockNumber: number | null;
}

/**
 * Open (or create) the snapshot DB, ensuring directory exists.
 * Caller is responsible for closing (db.close()) on shutdown.
 */
export function openSnapshotDb(dbPath: string = SNAPSHOT_CONFIG.DB_PATH): Database.Database {
  const dir = path.dirname(dbPath);
  if (dir !== "." && dir !== "") {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  // Performance + durability for unattended logger
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  initDb(db);
  return db;
}

/** Create table + indexes if not exists. Idempotent. */
export function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketId TEXT NOT NULL,
      symbol TEXT NOT NULL,
      capturedAtUnix INTEGER NOT NULL,
      capturedAtIso TEXT NOT NULL,
      bidLevels TEXT NOT NULL,
      askLevels TEXT NOT NULL,
      mid REAL,
      bidDepth REAL NOT NULL,
      askDepth REAL NOT NULL,
      imbalance REAL NOT NULL,
      blockNumber INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_market_time ON snapshots(marketId, capturedAtUnix);
    CREATE INDEX IF NOT EXISTS idx_snapshots_captured ON snapshots(capturedAtUnix);
  `);
}

/** Insert one snapshot row. Returns inserted row id. */
export function insertSnapshot(db: Database.Database, params: InsertSnapshotParams): number {
  const stmt = db.prepare(`
    INSERT INTO snapshots (marketId, symbol, capturedAtUnix, capturedAtIso, bidLevels, askLevels, mid, bidDepth, askDepth, imbalance, blockNumber)
    VALUES (@marketId, @symbol, @capturedAtUnix, @capturedAtIso, @bidLevels, @askLevels, @mid, @bidDepth, @askDepth, @imbalance, @blockNumber)
  `);
  const info = stmt.run({
    marketId: params.marketId,
    symbol: params.symbol,
    capturedAtUnix: params.capturedAtUnix,
    capturedAtIso: params.capturedAtIso,
    bidLevels: JSON.stringify(params.bidLevels),
    askLevels: JSON.stringify(params.askLevels),
    mid: params.mid,
    bidDepth: params.bidDepth,
    askDepth: params.askDepth,
    imbalance: params.imbalance,
    blockNumber: params.blockNumber,
  });
  return Number(info.lastInsertRowid);
}

/** Count total rows — for verification and liveness checks. */
export function countSnapshots(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM snapshots").get() as { c: number };
  return row.c;
}

/** Fetch recent rows for verification. */
export function recentSnapshots(db: Database.Database, limit = 10): SnapshotRow[] {
  return db.prepare("SELECT * FROM snapshots ORDER BY capturedAtUnix DESC, id DESC LIMIT ?").all(limit) as SnapshotRow[];
}
