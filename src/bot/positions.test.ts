import { describe, it, expect } from "vitest";
import { openSnapshotDb, getBotPosition, insertBotFill } from "../snapshots/db.js";
import { applyFillToPosition, computeSettlementPnL, settlementWon, weightedEntryPrice, type ApplyFillInput } from "./positions.js";

function buy(db: import("better-sqlite3").Database, marketId: string, symbol: string, qty: number, price: number): ReturnType<typeof applyFillToPosition> {
  const fillId = insertBotFill(db, { txHash: `0x${"b".repeat(64)}${marketId}${Math.random()}`, blockNumber: 1, marketId, symbol, side: "buy", outcome: "YES", quantityFilled: qty, fillPrice: price });
  return applyFillToPosition(db, { marketId, symbol, side: "buy", outcome: "YES", quantityFilled: qty, fillPrice: price, fillId });
}

function sell(db: import("better-sqlite3").Database, marketId: string, symbol: string, qty: number, price: number, outcome: "YES" | "NO" = "YES"): ReturnType<typeof applyFillToPosition> {
  const fillId = insertBotFill(db, { txHash: `0x${"s".repeat(64)}${marketId}${Math.random()}`, blockNumber: 1, marketId, symbol, side: "sell", outcome, quantityFilled: qty, fillPrice: price });
  return applyFillToPosition(db, { marketId, symbol, side: "sell", outcome, quantityFilled: qty, fillPrice: price, fillId });
}

describe("weighted-average cost basis", () => {
  it("weightedEntryPrice is quantity-weighted across fills", () => {
    expect(weightedEntryPrice(0.6, 2, 0.5, 1)).toBeCloseTo((0.6 * 2 + 0.5 * 1) / 3, 9);
    expect(weightedEntryPrice(null, 0, 0.4, 2)).toBeCloseTo(0.4, 9);
  });

  it("multiple buys into one position accumulate totalSize and re-average avgEntryPrice", () => {
    const db = openSnapshotDb(":memory:");
    const r1 = buy(db, "0x1", "BTC-TEST/tUSDC", 2, 0.6);
    expect(r1.kind).toBe("opened");
    const pos1 = getBotPosition(db, "0x1");
    expect(pos1?.totalSize).toBeCloseTo(2, 9);
    expect(pos1?.avgEntryPrice).toBeCloseTo(0.6, 9);
    expect(pos1?.realizedPnL).toBeCloseTo(0, 9);
    expect(pos1?.status).toBe("OPEN");

    const r2 = buy(db, "0x1", "BTC-TEST/tUSDC", 1, 0.5);
    expect(r2.kind).toBe("added");
    const pos2 = getBotPosition(db, "0x1");
    expect(pos2?.totalSize).toBeCloseTo(3, 9);
    expect(pos2?.avgEntryPrice).toBeCloseTo((0.6 * 2 + 0.5 * 1) / 3, 9);
    // buys never realize P&L
    expect(pos2?.realizedPnL).toBeCloseTo(0, 9);
    db.close();
  });
});

describe("EARLY_CLOSE realization (sell before settlement)", () => {
  it("partial close realizes (exitPrice - avgEntryPrice) * exitedSize and keeps the remaining basis", () => {
    const db = openSnapshotDb(":memory:");
    buy(db, "0x1", "BTC-TEST/tUSDC", 2, 0.6);
    const res = sell(db, "0x1", "BTC-TEST/tUSDC", 1, 0.65);
    expect(res.kind).toBe("partially_closed");
    if (res.kind !== "partially_closed") throw new Error("expected partially_closed");
    expect(res.realizedPnLDelta).toBeCloseTo(0.05, 9); // (0.65-0.6)*1
    const pos = getBotPosition(db, "0x1");
    expect(pos?.totalSize).toBeCloseTo(1, 9);
    expect(pos?.avgEntryPrice).toBeCloseTo(0.6, 9); // buys' basis unchanged on partial exit
    expect(pos?.realizedPnL).toBeCloseTo(0.05, 9);
    expect(pos?.status).toBe("OPEN");
    db.close();
  });

  it("full close realizes and marks the position CLOSED with realizationSource EARLY_CLOSE", () => {
    const db = openSnapshotDb(":memory:");
    buy(db, "0x1", "BTC-TEST/tUSDC", 2, 0.6);
    const res = sell(db, "0x1", "BTC-TEST/tUSDC", 2, 0.65);
    expect(res.kind).toBe("closed_early");
    const pos = getBotPosition(db, "0x1");
    expect(pos?.status).toBe("CLOSED");
    expect(pos?.realizationSource).toBe("EARLY_CLOSE");
    expect(pos?.totalSize).toBeCloseTo(0, 9);
    expect(pos?.realizedPnL).toBeCloseTo(0.1, 9); // (0.65-0.6)*2
    const fill = db.prepare("SELECT realizedPnL FROM bot_fills WHERE side='sell'").get() as { realizedPnL: number };
    expect(fill.realizedPnL).toBeCloseTo(0.1, 9);
    db.close();
  });

  it("over-exit realizes only the held shares and closes (never negative size)", () => {
    const db = openSnapshotDb(":memory:");
    buy(db, "0x1", "BTC-TEST/tUSDC", 2, 0.6);
    const res = sell(db, "0x1", "BTC-TEST/tUSDC", 5, 0.65);
    expect(res.kind).toBe("closed_early");
    if (res.kind !== "closed_early") throw new Error("expected closed_early");
    expect(res.realizedPnLDelta).toBeCloseTo(0.1, 9); // (0.65-0.6)*2, not *5
    const pos = getBotPosition(db, "0x1");
    expect(pos?.totalSize).toBeCloseTo(0, 9);
    db.close();
  });
});
describe("invalid/ambiguous fills are explicit errors, never silent", () => {
  it("sell with no open position", () => {
    const db = openSnapshotDb(":memory:");
    const res = sell(db, "0x1", "BTC-TEST/tUSDC", 1, 0.5);
    expect(res.kind).toBe("error");
    if (res.kind !== "error") throw new Error("expected error");
    expect(res.reason).toContain("no open position");
    db.close();
  });

  it("sell of the wrong outcome (holding YES, selling NO)", () => {
    const db = openSnapshotDb(":memory:");
    buy(db, "0x1", "BTC-TEST/tUSDC", 2, 0.6);
    const res = sell(db, "0x1", "BTC-TEST/tUSDC", 1, 0.5, "NO");
    expect(res.kind).toBe("error");
    if (res.kind !== "error") throw new Error("expected error");
    expect(res.reason).toContain("holds YES");
    db.close();
  });

  it("non-positive qty and out-of-range price", () => {
    const db = openSnapshotDb(":memory:");
    const input: ApplyFillInput = { marketId: "0x1", symbol: "s", side: "buy", outcome: "YES", quantityFilled: 0, fillPrice: 0.5 };
    expect(applyFillToPosition(db, input).kind).toBe("error");
    expect(applyFillToPosition(db, { ...input, quantityFilled: 1, fillPrice: 1 }).kind).toBe("error");
    expect(applyFillToPosition(db, { ...input, quantityFilled: 1, fillPrice: 0 }).kind).toBe("error");
    db.close();
  });
});

describe("opposite-outcome buy switches the position at the crossing-implied exit price", () => {
  it("holding YES, buying NO realizes YES at (1 - NO price) then opens NO", () => {
    const db = openSnapshotDb(":memory:");
    buy(db, "0x1", "BTC-TEST/tUSDC", 2, 0.6);
    const res = applyFillToPosition(db, { marketId: "0x1", symbol: "BTC-TEST/tUSDC", side: "buy", outcome: "NO", quantityFilled: 1, fillPrice: 0.3 });
    expect(res.kind).toBe("closed_early");
    if (res.kind !== "closed_early") throw new Error("expected closed_early");
    // implied YES exit = 1 - 0.3 = 0.7 → (0.7 - 0.6) * 2 = 0.2 realized from the closed YES leg
    expect(res.realizedPnLDelta).toBeCloseTo(0.2, 9);
    const pos = getBotPosition(db, "0x1");
    expect(pos?.side).toBe("NO");
    expect(pos?.totalSize).toBeCloseTo(1, 9);
    expect(pos?.avgEntryPrice).toBeCloseTo(0.3, 9);
    expect(pos?.realizedPnL).toBeCloseTo(0.2, 9);
    expect(pos?.status).toBe("OPEN");
    db.close();
  });
});

describe("settlement payout formula (Stage 4 exact)", () => {
  it("YES position, YES wins → (1 - avg) * size", () => {
    expect(computeSettlementPnL({ side: "YES", avgEntryPrice: 0.6, size: 1, winningOutcome: 0, voided: false })).toBeCloseTo(0.4, 9);
  });
  it("YES position, NO wins → -avg * size", () => {
    expect(computeSettlementPnL({ side: "YES", avgEntryPrice: 0.6, size: 1, winningOutcome: 1, voided: false })).toBeCloseTo(-0.6, 9);
  });
  it("NO position, NO wins → (1 - avg) * size (NO price basis)", () => {
    expect(computeSettlementPnL({ side: "NO", avgEntryPrice: 0.4, size: 1, winningOutcome: 1, voided: false })).toBeCloseTo(0.6, 9);
  });
  it("voided → (0.5 - avg) * size", () => {
    expect(computeSettlementPnL({ side: "YES", avgEntryPrice: 0.6, size: 2, winningOutcome: null, voided: true })).toBeCloseTo((0.5 - 0.6) * 2, 9);
  });
  it("returns null (not a guess) when outcome is unresolved", () => {
    expect(computeSettlementPnL({ side: "YES", avgEntryPrice: 0.6, size: 1, winningOutcome: null, voided: false })).toBeNull();
    expect(settlementWon("YES", null)).toBeNull();
    expect(settlementWon("YES", 7)).toBeNull();
  });
});