import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { openSnapshotDb, insertSnapshot, countBotEvents } from "../snapshots/db.js";
import { checkMidMove } from "./midMove.js";
import { MID_MOVE_CONFIG } from "../config.js";

describe("midMove observability — synthetic, not a trading signal", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openSnapshotDb(":memory:");
  });

  it("pair crossing threshold → MID_MOVE_OBSERVED event logged", () => {
    const marketId = "0xabc";
    const threshold = MID_MOVE_CONFIG.MID_MOVE_ALERT_THRESHOLD; // 0.025
    // Prior snapshot mid 0.827
    insertSnapshot(db, {
      marketId,
      symbol: "ETH-TEST/tUSDC",
      capturedAtUnix: Math.floor(Date.now() / 1000) - 47,
      capturedAtIso: new Date(Date.now() - 47000).toISOString(),
      bidLevels: [[0.8, 100]],
      askLevels: [[0.854, 100]],
      mid: 0.827,
      bidDepth: 100,
      askDepth: 100,
      imbalance: 0,
      blockNumber: 473032593,
    });

    const beforeCount = countBotEvents(db);
    const res = checkMidMove(db, {
      marketId,
      symbol: "ETH-TEST/tUSDC",
      currentMid: 0.909,
      currentBlockNumber: 473033062,
    });
    expect(res.moved).toBe(true);
    expect(res.overThreshold).toBe(true);
    expect(res.delta).toBeCloseTo(0.082, 3);
    expect(countBotEvents(db)).toBe(beforeCount + 1);
    const events = db.prepare("SELECT * FROM bot_events WHERE eventType='MID_MOVE_OBSERVED'").all() as Array<{ marketId: string; data: string }>;
    expect(events.length).toBe(1);
    const first = events[0];
    if (!first) throw new Error("expected one MID_MOVE event");
    const data = JSON.parse(first.data) as { priorMid: number; currentMid: number; delta: number; threshold: number };
    expect(data.priorMid).toBeCloseTo(0.827, 3);
    expect(data.currentMid).toBeCloseTo(0.909, 3);
    expect(data.threshold).toBe(threshold);
    db.close();
  });

  it("pair under threshold → no event", () => {
    const marketId = "0xdef";
    insertSnapshot(db, {
      marketId,
      symbol: "BTC-TEST/tUSDC",
      capturedAtUnix: Math.floor(Date.now() / 1000) - 10,
      capturedAtIso: new Date().toISOString(),
      bidLevels: [[0.5, 100]],
      askLevels: [[0.52, 100]],
      mid: 0.51,
      bidDepth: 100,
      askDepth: 100,
      imbalance: 0,
      blockNumber: 100,
    });
    const before = countBotEvents(db);
    const res = checkMidMove(db, {
      marketId,
      symbol: "BTC-TEST/tUSDC",
      currentMid: 0.515, // delta 0.005 < 0.025
      currentBlockNumber: 101,
    });
    expect(res.moved).toBe(false);
    expect(countBotEvents(db)).toBe(before);
    db.close();
  });

  it("no prior snapshot → no event, moved false", () => {
    const res = checkMidMove(db, {
      marketId: "0x999",
      symbol: "UNK/tUSDC",
      currentMid: 0.6,
      currentBlockNumber: 1,
    });
    expect(res.moved).toBe(false);
    expect(res.delta).toBeNull();
    expect(countBotEvents(db)).toBe(0);
    db.close();
  });
});
