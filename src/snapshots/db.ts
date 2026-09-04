/**
 * Snapshot storage - SQLite at data/snapshots.db (better-sqlite3, zero external service).
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
 * Serverless note: the platform filesystem is read-only except /tmp, so deployments
 * point SNAPSHOT_DB_PATH at /tmp and start empty. To avoid that, a bundled seed copy
 * (data/seed-snapshots.db, committed) is copied in when the target is missing.
 * Caller is responsible for closing (db.close()) on shutdown.
 */
export function openSnapshotDb(dbPath: string = SNAPSHOT_CONFIG.DB_PATH): Database.Database {
  seedDbIfMissing(dbPath);
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

const SEED_DB_PATH = "data/seed-snapshots.db";

/**
 * Copy the bundled seed DB to dbPath when the target is missing (serverless cold
 * start). Never overwrites an existing DB. Failures fall through to a fresh DB
 * rather than failing the open.
 */
export function seedDbIfMissing(dbPath: string): void {
  if (dbPath === ":memory:" || dbPath === "") return;
  if (fs.existsSync(dbPath)) return;
  const seed = path.resolve(SEED_DB_PATH);
  if (path.resolve(dbPath) === seed) return;
  if (!fs.existsSync(seed)) return;
  try {
    const dir = path.dirname(dbPath);
    if (dir !== "." && dir !== "") {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(seed, dbPath);
  } catch (err) {
    console.warn(`[snapshots] seed copy failed, starting fresh DB: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Create table + indexes if not exists. Idempotent. Reuses same DB file for bot tables (events/fills/positions/config). */export function initDb(db: Database.Database): void {
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
      side TEXT,
      outcome TEXT,
      quantityFilled REAL,
      fillPrice REAL,
      realizedPnL REAL,
      edgeAtDecision REAL,
      midAtDecision REAL,
      gasUsed TEXT,
      gasPrice TEXT,
      gasCost REAL,
      rawData TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_fills_market ON bot_fills(marketId);
    CREATE INDEX IF NOT EXISTS idx_bot_fills_block ON bot_fills(blockNumber);

    CREATE TABLE IF NOT EXISTS bot_positions (
      marketId TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'YES',
      netPosition REAL NOT NULL,
      totalSize REAL NOT NULL DEFAULT 0,
      avgEntryPrice REAL,
      realizedPnL REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      realizationSource TEXT,
      realizedAtUnix INTEGER,
      updatedAtUnix INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updatedAtUnix INTEGER NOT NULL
    );
  `);
  // Migration for existing bot_fills without new edge/gas columns (stage 7)
  for (const col of ["edgeAtDecision REAL", "midAtDecision REAL", "gasUsed TEXT", "gasPrice TEXT", "gasCost REAL"]) {
    try {
      db.exec(`ALTER TABLE bot_fills ADD COLUMN ${col}`);
    } catch {
      // column already exists - ignore
    }
  }
  // Migration for existing bot_fills without stage-9 side/outcome/realizedPnL columns
  for (const col of ["side TEXT", "outcome TEXT", "realizedPnL REAL"]) {
    try {
      db.exec(`ALTER TABLE bot_fills ADD COLUMN ${col}`);
    } catch {
      // column already exists - ignore
    }
  }
  // Migration for existing bot_positions without stage-9 cost-basis/realization columns
  for (const col of [
    "side TEXT NOT NULL DEFAULT 'YES'",
    "totalSize REAL NOT NULL DEFAULT 0",
    "avgEntryPrice REAL",
    "status TEXT NOT NULL DEFAULT 'OPEN'",
    "realizationSource TEXT",
    "realizedAtUnix INTEGER",
  ]) {
    try {
      db.exec(`ALTER TABLE bot_positions ADD COLUMN ${col}`);
    } catch {
      // column already exists - ignore
    }
  }
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

/** Count total rows - for verification and liveness checks. */
export function countSnapshots(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM snapshots").get() as { c: number };
  return row.c;
}

/** Fetch recent rows for verification. */
export function recentSnapshots(db: Database.Database, limit = 10): SnapshotRow[] {
  return db.prepare("SELECT * FROM snapshots ORDER BY capturedAtUnix DESC, id DESC LIMIT ?").all(limit) as SnapshotRow[];
}

/** Recent rows for one market, newest first - feeds momentum/volatility windows. */
export function recentSnapshotsForMarket(db: Database.Database, marketId: string, limit = 10): SnapshotRow[] {
  return db
    .prepare("SELECT * FROM snapshots WHERE marketId=? ORDER BY capturedAtUnix DESC, id DESC LIMIT ?")
    .all(marketId, limit) as SnapshotRow[];
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

/** Side of a fill on the book: buy (opens/adds an outcome position) or sell (exits - EARLY_CLOSE). */
export type FillSide = "buy" | "sell";
/** The outcome token a position/fill trades: YES (outcome 0) or NO (outcome 1). */
export type PositionSide = "YES" | "NO";
/** Position lifecycle status. CLOSED = realized (SETTLEMENT or EARLY_CLOSE). */
export type PositionStatus = "OPEN" | "CLOSED";
/** How a position's P&L was realized. SETTLEMENT = market resolved/voided on-chain; EARLY_CLOSE = exited by an opposite-side fill before settlement. */
export type RealizationSource = "SETTLEMENT" | "EARLY_CLOSE";

export interface BotFillRow {
  readonly id: number;
  readonly capturedAtUnix: number;
  readonly capturedAtIso: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly marketId: string;
  readonly symbol: string;
  readonly orderId: string | null;
  readonly side: FillSide | null;
  readonly outcome: PositionSide | null;
  readonly quantityFilled: number | null;
  readonly fillPrice: number | null;
  readonly realizedPnL: number | null;
  readonly edgeAtDecision: number | null;
  readonly midAtDecision: number | null;
  readonly gasUsed: string | null;
  readonly gasPrice: string | null;
  readonly gasCost: number | null;
  readonly rawData: string | null;
}

export function insertBotFill(
  db: Database.Database,
  params: {
    txHash: string;
    blockNumber: number;
    marketId: string;
    symbol: string;
    orderId?: string | null;
    side?: FillSide | null;
    outcome?: PositionSide | null;
    quantityFilled?: number | null;
    fillPrice?: number | null;
    realizedPnL?: number | null;
    capturedAtUnix?: number | null;
    edgeAtDecision?: number | null;
    midAtDecision?: number | null;
    gasUsed?: string | null;
    gasPrice?: string | null;
    gasCost?: number | null;
    rawData?: unknown;
  },
): number {
  const nowUnix = params.capturedAtUnix ?? Math.floor(Date.now() / 1000);
  const nowIso = new Date(nowUnix * 1000).toISOString();
  const stmt = db.prepare(`
    INSERT INTO bot_fills (capturedAtUnix, capturedAtIso, txHash, blockNumber, marketId, symbol, orderId, side, outcome, quantityFilled, fillPrice, realizedPnL, edgeAtDecision, midAtDecision, gasUsed, gasPrice, gasCost, rawData)
    VALUES (@capturedAtUnix, @capturedAtIso, @txHash, @blockNumber, @marketId, @symbol, @orderId, @side, @outcome, @quantityFilled, @fillPrice, @realizedPnL, @edgeAtDecision, @midAtDecision, @gasUsed, @gasPrice, @gasCost, @rawData)
  `);
  const info = stmt.run({
    capturedAtUnix: nowUnix,
    capturedAtIso: nowIso,
    txHash: params.txHash,
    blockNumber: params.blockNumber,
    marketId: params.marketId,
    symbol: params.symbol,
    orderId: params.orderId ?? null,
    side: params.side ?? null,
    outcome: params.outcome ?? null,
    quantityFilled: params.quantityFilled ?? null,
    fillPrice: params.fillPrice ?? null,
    realizedPnL: params.realizedPnL ?? null,
    edgeAtDecision: params.edgeAtDecision ?? null,
    midAtDecision: params.midAtDecision ?? null,
    gasUsed: params.gasUsed ?? null,
    gasPrice: params.gasPrice ?? null,
    gasCost: params.gasCost ?? null,
    rawData: params.rawData ? JSON.stringify(params.rawData) : null,
  });
  return Number(info.lastInsertRowid);
}

export function listBotFills(db: Database.Database, limit = 100): BotFillRow[] {
  return db.prepare("SELECT * FROM bot_fills ORDER BY capturedAtUnix DESC, id DESC LIMIT ?").all(limit) as BotFillRow[];
}

export interface BotPositionRow {
  readonly marketId: string;
  readonly symbol: string;
  readonly side: PositionSide;
  readonly netPosition: number;
  readonly totalSize: number;
  readonly avgEntryPrice: number | null;
  readonly realizedPnL: number;
  readonly status: PositionStatus;
  readonly realizationSource: RealizationSource | null;
  readonly realizedAtUnix: number | null;
  readonly updatedAtUnix: number;
}

export function upsertBotPosition(
  db: Database.Database,
  params: {
    marketId: string;
    symbol: string;
    side?: PositionSide;
    netPosition: number;
    totalSize?: number;
    avgEntryPrice?: number | null;
    realizedPnL: number;
    status?: PositionStatus;
    realizationSource?: RealizationSource | null;
    realizedAtUnix?: number | null;
  },
): void {
  const nowUnix = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO bot_positions (marketId, symbol, side, netPosition, totalSize, avgEntryPrice, realizedPnL, status, realizationSource, realizedAtUnix, updatedAtUnix)
     VALUES (@marketId, @symbol, @side, @netPosition, @totalSize, @avgEntryPrice, @realizedPnL, @status, @realizationSource, @realizedAtUnix, @updatedAtUnix)
     ON CONFLICT(marketId) DO UPDATE SET symbol=@symbol, side=@side, netPosition=@netPosition, totalSize=@totalSize, avgEntryPrice=@avgEntryPrice, realizedPnL=@realizedPnL, status=@status, realizationSource=@realizationSource, realizedAtUnix=@realizedAtUnix, updatedAtUnix=@updatedAtUnix`,
  ).run({
    marketId: params.marketId,
    symbol: params.symbol,
    side: params.side ?? "YES",
    netPosition: params.netPosition,
    totalSize: params.totalSize ?? Math.abs(params.netPosition),
    avgEntryPrice: params.avgEntryPrice ?? null,
    realizedPnL: params.realizedPnL,
    status: params.status ?? "OPEN",
    realizationSource: params.realizationSource ?? null,
    realizedAtUnix: params.realizedAtUnix ?? null,
    updatedAtUnix: nowUnix,
  });
}

/** Partial update of one position row. Only keys present in the patch are written. Never silent: caller validates. */
export function patchBotPosition(
  db: Database.Database,
  marketId: string,
  patch: {
    readonly side?: PositionSide;
    readonly netPosition?: number;
    readonly totalSize?: number;
    readonly avgEntryPrice?: number | null;
    readonly realizedPnL?: number;
    readonly status?: PositionStatus;
    readonly realizationSource?: RealizationSource | null;
    readonly realizedAtUnix?: number | null;
  },
): void {
  const sets: string[] = [];
  const bind: Record<string, unknown> = { marketId };
  for (const key of ["side", "netPosition", "totalSize", "avgEntryPrice", "realizedPnL", "status", "realizationSource", "realizedAtUnix"] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${key}=@${key}`);
      bind[key] = patch[key];
    }
  }
  bind.updatedAtUnix = Math.floor(Date.now() / 1000);
  sets.push("updatedAtUnix=@updatedAtUnix");
  db.prepare(`UPDATE bot_positions SET ${sets.join(", ")} WHERE marketId=@marketId`).run(bind);
}

export function getBotPositions(db: Database.Database): BotPositionRow[] {
  return db.prepare("SELECT * FROM bot_positions").all() as BotPositionRow[];
}

/** Positions still holding exposure (cost basis built, not yet realized). This is what the settlement poller iterates. */
export function getOpenBotPositions(db: Database.Database): BotPositionRow[] {
  return db.prepare("SELECT * FROM bot_positions WHERE status='OPEN' AND totalSize > 0").all() as BotPositionRow[];
}

/** Positions whose P&L has been realized (SETTLEMENT or EARLY_CLOSE), per brief tag: wins/losses derivable from this. */
export function getClosedBotPositions(db: Database.Database): BotPositionRow[] {
  return db.prepare("SELECT * FROM bot_positions WHERE status='CLOSED'").all() as BotPositionRow[];
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

/**
 * Closest real snapshot mid to `targetUnix` for a market (adverse selection per fill).
 * Returns null when no snapshot is within `maxDeviationSeconds` - callers then report the fill's
 * adverse selection as NOT COMPUTABLE (never interpolate or approximate silently).
 * Tag: LIVE_INDEXER mid (HISTORICAL snapshot), DERIVED deviation.
 */
export function closestSnapshotMid(
  db: Database.Database,
  marketId: string,
  targetUnix: number,
  maxDeviationSeconds: number,
): { mid: number; capturedAtUnix: number; deviationSeconds: number } | null {
  const row = db
    .prepare(
      "SELECT mid, capturedAtUnix, ABS(capturedAtUnix - ?) AS deviation FROM snapshots WHERE marketId=? AND mid IS NOT NULL ORDER BY deviation ASC LIMIT 1",
    )
    .get(targetUnix, marketId) as { mid: number | null; capturedAtUnix: number; deviation: number } | undefined;
  if (row === undefined || row.mid === null || row.deviation > maxDeviationSeconds) return null;
  return { mid: row.mid, capturedAtUnix: row.capturedAtUnix, deviationSeconds: row.deviation };
}
