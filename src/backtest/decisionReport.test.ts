import { describe, it, expect } from "vitest";
import { evaluateDecisions, bucketRejection, type DecisionEvalMarket } from "./decisionReport.js";

function tiltedBook(): { bids: Array<[number, number]>; asks: Array<[number, number]> } {
  return {
    bids: [
      [0.53, 2000],
      [0.525, 2000],
      [0.52, 2000],
    ],
    asks: [
      [0.55, 100],
      [0.555, 100],
      [0.56, 100],
    ],
  };
}

function flatBook(): { bids: Array<[number, number]>; asks: Array<[number, number]> } {
  return {
    bids: [
      [0.53, 500],
      [0.525, 500],
      [0.52, 500],
    ],
    asks: [
      [0.55, 500],
      [0.555, 500],
      [0.56, 500],
    ],
  };
}

function marketWith(book: { bids: Array<[number, number]>; asks: Array<[number, number]> }, winningOutcome: number | null): DecisionEvalMarket {
  const expiry = 100000;
  const snapshots = [0, 60, 120, 180, 240, 300].map((t) => ({
    capturedAtUnix: t,
    bids: book.bids,
    asks: book.asks,
    mid: 0.54,
    blockNumber: 1,
  }));
  return {
    marketId: "0xtest",
    symbol: "BTC-TEST/tUSDC",
    asset: "BTC",
    expiry,
    winningOutcome,
    voided: false,
    snapshots,
    fallbackBook: null,
    referenceTicks: [],
    referenceAsset: null,
    bookTag: "HISTORICAL",
  };
}

describe("decisionReport - framework tracking on synthetic settled markets", () => {
  it("takes the first TRADE and settles it against the real-shaped outcome", () => {
    // imbalance (6000-300)/6300 = 0.905 → delta 0.054 → fair 0.594, raw 0.054,
    // spread 0.04 → penalty 0.02, slip 1/6300 → exec ≈ 0.034 ≥ 0.02 → TRADE YES
    const report = evaluateDecisions([marketWith(tiltedBook(), 0)]);
    expect(report.marketsEvaluated).toBe(1);
    expect(report.tradesTaken).toBe(1);
    expect(report.tradeSignalSnapshots).toBe(6);
    expect(report.predictions).toHaveLength(1);
    const pred = report.predictions[0];
    expect(pred?.predicted).toBe("YES");
    expect(pred?.actual).toBe("YES");
    expect(pred?.correct).toBe(true);
    expect(report.winRate).toBe(1);
    expect(report.totalPnL).toBeCloseTo(1 - (pred?.entryPrice ?? 0), 10);
  });

  it("reports NO_TRADE everywhere on balanced books with real reason counts", () => {
    const report = evaluateDecisions([marketWith(flatBook(), 1)]);
    expect(report.tradesTaken).toBe(0);
    expect(report.noTradeSnapshots).toBe(6);
    expect(report.rejectionReasons["edge-below-threshold"]).toBe(6);
    expect(report.winRate).toBeNull();
  });

  it("buckets rejection reasons by category", () => {
    expect(bucketRejection("WATCH", "anything")).toBe("watch-below-trade-bar");
    expect(bucketRejection("NO_TRADE", "NO_TRADE: liquidity 10.00 < min 100")).toBe("liquidity");
    expect(bucketRejection("NO_TRADE", "NO_TRADE: spread 0.09 (900 bps) > max")).toBe("spread");
    expect(bucketRejection("NO_TRADE", "NO_TRADE: timeRemaining 10s < buffer")).toBe("expiry");
    expect(bucketRejection("NO_TRADE", "TRADE BLOCKED - SETTLEMENT RISK: x")).toBe("settlement");
    expect(bucketRejection("NO_TRADE", "NO_TRADE: edge +0.001 (stuff) < watch bar")).toBe("edge-below-threshold");
    expect(bucketRejection("NO_TRADE", "mystery")).toBe("other");
  });
});
