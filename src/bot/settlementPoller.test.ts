import { describe, it, expect } from "vitest";
import { openSnapshotDb, upsertBotPosition, getBotPosition } from "../snapshots/db.js";
import { runSettlementPoll, type MarketSettlementStatus, type SettlementStatusResolver } from "./settlementPoller.js";

const RESOLVED_YES: MarketSettlementStatus = { isResolved: true, isVoided: false, winningOutcome: 0, status: 4, inFinalizedList: true };
const RESOLVED_NO: MarketSettlementStatus = { isResolved: true, isVoided: false, winningOutcome: 1, status: 4, inFinalizedList: true };
const VOIDED: MarketSettlementStatus = { isResolved: false, isVoided: true, winningOutcome: null, status: 5, inFinalizedList: true };
const UNRESOLVED: MarketSettlementStatus = { isResolved: false, isVoided: false, winningOutcome: null, status: 1, inFinalizedList: false };
const RESOLVED_NO_OUTCOME: MarketSettlementStatus = { isResolved: true, isVoided: false, winningOutcome: null, status: 4, inFinalizedList: true };

function resolverOf(statuses: Record<string, MarketSettlementStatus>): SettlementStatusResolver {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async (marketIds) => {
    const map = new Map<string, MarketSettlementStatus>();
    for (const id of marketIds) {
      const st = statuses[id];
      if (st !== undefined) map.set(id, st);
    }
    return map;
  };
}

describe("runSettlementPoll — SETTLEMENT realization from on-chain settlement state", () => {
  it("YES position resolves YES → (1 - avgEntryPrice) * size, position CLOSED with source SETTLEMENT", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 1, totalSize: 1, avgEntryPrice: 0.6, realizedPnL: 0 });
    const result = await runSettlementPoll(db, { resolve: resolverOf({ "0x1": RESOLVED_YES }), nowUnix: 1_800_000_000 });
    expect(result.realized).toHaveLength(1);
    expect(result.realized[0]?.realizedPnLDelta).toBeCloseTo(0.4, 9);
    expect(result.stillOpen).toHaveLength(0);
    const pos = getBotPosition(db, "0x1");
    expect(pos?.status).toBe("CLOSED");
    expect(pos?.realizationSource).toBe("SETTLEMENT");
    expect(pos?.totalSize).toBeCloseTo(0, 9);
    expect(pos?.realizedPnL).toBeCloseTo(0.4, 9);
    expect(pos?.realizedAtUnix).toBe(1_800_000_000);
    db.close();
  });

  it("YES position resolves NO → -avgEntryPrice * size (full loss)", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 2, totalSize: 2, avgEntryPrice: 0.6, realizedPnL: 0 });
    const result = await runSettlementPoll(db, { resolve: resolverOf({ "0x1": RESOLVED_NO }) });
    expect(result.realized[0]?.realizedPnLDelta).toBeCloseTo(-1.2, 9);
    expect(getBotPosition(db, "0x1")?.realizedPnL).toBeCloseTo(-1.2, 9);
    db.close();
  });

  it("NO position resolves NO → (1 - avgEntryPrice) * size (NO price basis)", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "NO", netPosition: 1, totalSize: 1, avgEntryPrice: 0.4, realizedPnL: 0 });
    const result = await runSettlementPoll(db, { resolve: resolverOf({ "0x1": RESOLVED_NO }) });
    expect(result.realized[0]?.realizedPnLDelta).toBeCloseTo(0.6, 9);
    db.close();
  });

  it("voided market → (0.5 - avgEntryPrice) * size, tagged VOIDED", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 2, totalSize: 2, avgEntryPrice: 0.6, realizedPnL: 0 });
    const result = await runSettlementPoll(db, { resolve: resolverOf({ "0x1": VOIDED }) });
    expect(result.realized[0]?.realizedPnLDelta).toBeCloseTo((0.5 - 0.6) * 2, 9);
    expect(result.realized[0]?.voided).toBe(true);
    db.close();
  });
it("unresolved market → position stays OPEN, no premature realization, no P&L guess", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 1, totalSize: 1, avgEntryPrice: 0.6, realizedPnL: 0 });
    const before = getBotPosition(db, "0x1");
    const result = await runSettlementPoll(db, { resolve: resolverOf({ "0x1": UNRESOLVED }) });
    expect(result.stillOpen).toHaveLength(1);
    expect(result.realized).toHaveLength(0);
    expect(result.stillOpen[0]?.reason).toContain("no premature realization");
    const after = getBotPosition(db, "0x1");
    expect(after?.status).toBe("OPEN");
    expect(after?.realizedPnL).toBeCloseTo(before?.realizedPnL ?? 0, 9);
    db.close();
  });

  it("market absent from resolver map → left open", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 1, totalSize: 1, avgEntryPrice: 0.6, realizedPnL: 0 });
    const result = await runSettlementPoll(db, { resolve: resolverOf({}) });
    expect(result.stillOpen).toHaveLength(1);
    db.close();
  });

  it("resolver failure as a whole → errors reported, every position left open (no silent catch)", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 1, totalSize: 1, avgEntryPrice: 0.6, realizedPnL: 0 });
    const resolver: SettlementStatusResolver = () => Promise.reject(new Error("indexer unreachable"));
    const result = await runSettlementPoll(db, { resolve: resolver });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toContain("indexer unreachable");
    expect(result.stillOpen).toHaveLength(1);
    expect(getBotPosition(db, "0x1")?.status).toBe("OPEN");
    db.close();
  });

  it("open position with missing cost basis → error entry, never guessed", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 1, totalSize: 1, avgEntryPrice: null, realizedPnL: 0 });
    const result = await runSettlementPoll(db, { resolve: resolverOf({ "0x1": RESOLVED_YES }) });
    expect(result.realized).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toContain("avgEntryPrice");
    expect(getBotPosition(db, "0x1")?.status).toBe("OPEN");
    db.close();
  });

  it("resolved but winningOutcome ambiguous → error entry, left open (no guess)", async () => {
    const db = openSnapshotDb(":memory:");
    upsertBotPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "YES", netPosition: 1, totalSize: 1, avgEntryPrice: 0.6, realizedPnL: 0 });
    const result = await runSettlementPoll(db, { resolve: resolverOf({ "0x1": RESOLVED_NO_OUTCOME }) });
    expect(result.realized).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toContain("uncomputable");
    db.close();
  });

  it("zero open positions → no-op (honest, like live bot_positions today)", async () => {
    const db = openSnapshotDb(":memory:");
    const result = await runSettlementPoll(db, { resolve: (marketIds) => Promise.resolve(new Map<string, MarketSettlementStatus>(marketIds.map((id) => [id, UNRESOLVED]))) });
    expect(result.checkedPositions).toBe(0);
    expect(result.realized).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    db.close();
  });
});