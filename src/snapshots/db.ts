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

/** Create table + indexes if not exists. Idempotent. Reuses same DB file for bot tables (events/fills/positions/config). */
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

    CREATE TABLE IF NOT EXISTS bot_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAtUnix INTEGER NOT NULL,
      createdAtIso TEXT NOT NULL,
      marketId TEXT,
      symbol TEXT,
      eventType TEXT NOT NULL,
      data TEXT NOT NULL,
      blockNumber INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bot_events_time ON bot_events(createdAtUnix);
    CREATE INDEX IF NOT EXISTS idx_bot_events_type ON bot_events(eventType);
    CREATE INDEX IF NOT EXISTS idx_bot_events_market ON bot_events(marketId);

    CREATE TABLE IF NOT EXISTS bot_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capturedAtUnix INTEGER NOT NULL,
      capturedAtIso TEXT NOT NULL,
      txHash TEXT NOT NULL,
      blockNumber INTEGER NOT NULL,
      marketId TEXT NOT NULL,
      symbol TEXT NOT NULL,
      orderId TEXT,
      quantityFilled REAL,
      fillPrice REAL,
      rawData TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_fills_market ON bot_fills(marketId);
    CREATE INDEX IF NOT EXISTS idx_bot_fills_block ON bot_fills(blockNumber);

    CREATE TABLE IF NOT EXISTS bot_positions (
      marketId TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      netPosition REAL NOT NULL,
      realizedPnL REAL NOT NULL,
      updatedAtUnix INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updatedAtUnix INTEGER NOT NULL
    );
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

// ── Bot tables (reuse same DB file) ────────────────────────────────────────────

export interface BotEventRow {
  readonly id: number;
  readonly createdAtUnix: number;
  readonly createdAtIso: string;
  readonly marketId: string | null;
  readonly symbol: string | null;
  readonly eventType: string;
  readonly data: string; // JSON
  readonly blockNumber: number | null;
}

export interface InsertBotEventParams {
  readonly marketId?: string | null;
  readonly symbol?: string | null;
  readonly eventType: string;
  readonly data: unknown;
  readonly blockNumber?: number | null;
}

export function insertBotEvent(db: Database.Database, params: InsertBotEventParams): number {
  const nowUnix = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO bot_events (createdAtUnix, createdAtIso, marketId, symbol, eventType, data, blockNumber)
    VALUES (@createdAtUnix, @createdAtIso, @marketId, @symbol, @eventType, @data, @blockNumber)
  `);
  const info = stmt.run({
    createdAtUnix: nowUnix,
    createdAtIso: nowIso,
    marketId: params.marketId ?? null,
    symbol: params.symbol ?? null,
    eventType: params.eventType,
    data: JSON.stringify(params.data),
    blockNumber: params.blockNumber ?? null,
  });
  return Number(info.lastInsertRowid);
}

export function listBotEvents(db: Database.Database, limit = 100): BotEventRow[] {
  return db.prepare("SELECT * FROM bot_events ORDER BY createdAtUnix DESC, id DESC LIMIT ?").all(limit) as BotEventRow[];
}

export function countBotEvents(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM bot_events").get() as { c: number };
  return row.c;
}

export interface BotFillRow {
  readonly id: number;
  readonly capturedAtUnix: number;
  readonly capturedAtIso: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly marketId: string;
  readonly symbol: string;
  readonly orderId: string | null;
  readonly quantityFilled: number | null;
  readonly fillPrice: number | null;
  readonly rawData: string | null;
}

export function insertBotFill(
  db: Database.Database,
  params: { txHash: string; blockNumber: number; marketId: string; symbol: string; orderId?: string | null; quantityFilled?: number | null; fillPrice?: number | null; rawData?: unknown },
): number {
  const nowUnix = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO bot_fills (capturedAtUnix, capturedAtIso, txHash, blockNumber, marketId, symbol, orderId, quantityFilled, fillPrice, rawData)
    VALUES (@capturedAtUnix, @capturedAtIso, @txHash, @blockNumber, @marketId, @symbol, @orderId, @quantityFilled, @fillPrice, @rawData)
  `);
  const info = stmt.run({
    capturedAtUnix: nowUnix,
    capturedAtIso: nowIso,
    txHash: params.txHash,
    blockNumber: params.blockNumber,
    marketId: params.marketId,
    symbol: params.symbol,
    orderId: params.orderId ?? null,
    quantityFilled: params.quantityFilled ?? null,
    fillPrice: params.fillPrice ?? null,
    rawData: params.rawData ? JSON.stringify(params.rawData) : null,
  });
  return Number(info.lastInsertRowid);
}

export interface BotPositionRow {
  readonly marketId: string;
  readonly symbol: string;
  readonly netPosition: number;
  readonly realizedPnL: number;
  readonly updatedAtUnix: number;
}

export function upsertBotPosition(
  db: Database.Database,
  params: { marketId: string; symbol: string; netPosition: number; realizedPnL: number },
): void {
  const nowUnix = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO bot_positions (marketId, symbol, netPosition, realizedPnL, updatedAtUnix)
     VALUES (@marketId, @symbol, @netPosition, @realizedPnL, @updatedAtUnix)
     ON CONFLICT(marketId) DO UPDATE SET symbol=@symbol, netPosition=@netPosition, realizedPnL=@realizedPnL, updatedAtUnix=@updatedAtUnix`,
  ).run({
    marketId: params.marketId,
    symbol: params.symbol,
    netPosition: params.netPosition,
    realizedPnL: params.realizedPnL,
    updatedAtUnix: nowUnix,
  });
}

export function getBotPositions(db: Database.Database): BotPositionRow[] {
  return db.prepare("SELECT * FROM bot_positions").all() as BotPositionRow[];
}

export function getBotPosition(db: Database.Database, marketId: string): BotPositionRow | undefined {
  return db.prepare("SELECT * FROM bot_positions WHERE marketId=?").get(marketId) as BotPositionRow | undefined;
}

export function getTotalRealizedPnL(db: Database.Database): number {
  const row = db.prepare("SELECT COALESCE(SUM(realizedPnL),0) as sum FROM bot_positions").get() as { sum: number };
  return row.sum;
}

/** Most recent snapshot mid for a market (for MID_MOVE observability). */
export function getLatestSnapshotMid(db: Database.Database, marketId: string): { mid: number | null; capturedAtUnix: number; blockNumber: number | null } | undefined {
  const row = db.prepare("SELECT mid, capturedAtUnix, blockNumber FROM snapshots WHERE marketId=? ORDER BY capturedAtUnix DESC, id DESC LIMIT 1").get(marketId) as
    | { mid: number | null; capturedAtUnix: number; blockNumber: number | null }
    | undefined;
  return row;
}
