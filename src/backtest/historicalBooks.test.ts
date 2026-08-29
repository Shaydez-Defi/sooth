import { describe, it, expect } from "vitest";
import { runBacktestWithHistory } from "./engine.js";
import type { MarketHistoryInput } from "./engine.js";

function makeSnapshot(
  capturedAtUnix: number,
  bids: ReadonlyArray<readonly [number, number]>,
  asks: ReadonlyArray<readonly [number, number]>,
  mid: number | null,
): MarketHistoryInput["snapshots"][number] {
  return {
    capturedAtUnix,
    capturedAtIso: new Date(capturedAtUnix * 1000).toISOString(),
    bids,
    asks,
    mid,
    blockNumber: 1,
  };
}

describe("historicalBooks — genuine intra-market repricing", () => {
  it("synthetic imbalance shift mid-market → detects TRADE at the right snapshot, not just entry", () => {
    const expiry = 1_700_000_000 + 3600; // 1h after first snapshot
    const T0 = 1_700_000_000;
    // Balanced at T0 and T0+300: bidDepth 300 vs ask 300 → imbalance 0 → edge 0 → NO_TRADE
    // At T0+600: bidDepth 600 vs ask 300 → imbalance 0.333 → tilt 0.02 → edge 0.02 → TRADE YES
    const balancedBids: ReadonlyArray<readonly [number, number]> = [
      [0.5, 100],
      [0.49, 100],
      [0.48, 100],
    ];
    const balancedAsks: ReadonlyArray<readonly [number, number]> = [
      [0.52, 100],
      [0.53, 100],
      [0.54, 100],
    ];
    const skewedBids: ReadonlyArray<readonly [number, number]> = [
      [0.5, 200],
      [0.49, 200],
      [0.48, 200],
    ]; // 600
    const skewedAsks: ReadonlyArray<readonly [number, number]> = [
      [0.52, 100],
      [0.53, 100],
      [0.54, 100],
    ]; // 300

    const history: MarketHistoryInput = {
      marketId: "0xabc",
      symbol: "ETH-TEST/tUSDC",
      expiry,
      winningOutcome: 0, // YES wins
      voided: false,
      lastPrice: 0.5,
      snapshots: [
        makeSnapshot(T0, balancedBids, balancedAsks, 0.51),
        makeSnapshot(T0 + 300, balancedBids, balancedAsks, 0.51),
        makeSnapshot(T0 + 600, skewedBids, skewedAsks, 0.51), // this one should trigger TRADE
      ],
      dataPath: "HISTORICAL",
    };

    const metrics = runBacktestWithHistory({ markets: [history], startingCapital: 1000, sizePerTrade: 1 });
    expect(metrics.numberOfTrades).toBe(1);
    expect(metrics.historicalTrades).toBe(1);
    expect(metrics.estimatedTrades).toBe(0);
    const trade = metrics.trades[0];
    if (!trade) throw new Error("expected one trade");
    expect(trade.imbalance).toBeCloseTo(0.333, 2);
    expect(trade.edge).toBeCloseTo(0.02, 2);
    expect(trade.bookTag).toBe("HISTORICAL");
    // Should be YES direction because imbalance bid-heavy → tilt positive
    expect(trade.direction).toBe("YES");
    // Entry time is the third snapshot, not the first — proves intra-market repricing
    // (if it were only checking first snapshot, it would be NO_TRADE and 0 trades)
  });

  it("balanced throughout → no TRADE even with multiple snapshots (honest 0)", () => {
    const expiry = 1_700_000_000 + 3600;
    const T0 = 1_700_000_000;
    const bids: ReadonlyArray<readonly [number, number]> = [
      [0.5, 100],
      [0.49, 100],
      [0.48, 100],
    ];
    const asks: ReadonlyArray<readonly [number, number]> = [
      [0.52, 100],
      [0.53, 100],
      [0.54, 100],
    ];
    const history: MarketHistoryInput = {
      marketId: "0xdef",
      symbol: "BTC-TEST/tUSDC",
      expiry,
      winningOutcome: 1,
      voided: false,
      lastPrice: 0.5,
      snapshots: [makeSnapshot(T0, bids, asks, 0.51), makeSnapshot(T0 + 300, bids, asks, 0.51)],
      dataPath: "HISTORICAL",
    };
    const metrics = runBacktestWithHistory({ markets: [history], startingCapital: 1000 });
    expect(metrics.numberOfTrades).toBe(0);
    expect(metrics.historicalTrades).toBe(0);
  });

  it("ESTIMATED fallback still works when no snapshots", () => {
    const history: MarketHistoryInput = {
      marketId: "0x123",
      symbol: "ETH-TEST/tUSDC",
      expiry: 1_700_000_000 + 3600,
      winningOutcome: 0,
      voided: false,
      lastPrice: 0.5,
      snapshots: [],
      dataPath: "ESTIMATED",
    };
    // Single-point ESTIMATED will be balanced 0 imbalance → NO_TRADE → 0 trades (honest)
    const metrics = runBacktestWithHistory({ markets: [history], startingCapital: 1000 });
    expect(metrics.numberOfTrades).toBe(0);
    expect(metrics.withoutHistory).toBe(1);
    expect(metrics.withHistory).toBe(0);
  });

  it("timeRemaining gate respected per snapshot — close-to-expiry snapshot does not trigger TRADE", () => {
    const expiry = 1_700_000_000 + 200; // only 200s after T0
    const T0 = 1_700_000_000;
    const skewedBids: ReadonlyArray<readonly [number, number]> = [
      [0.5, 200],
      [0.49, 200],
      [0.48, 200],
    ];
    const skewedAsks: ReadonlyArray<readonly [number, number]> = [
      [0.52, 100],
      [0.53, 100],
      [0.54, 100],
    ];
    // This snapshot has timeRemaining 50s (<300) → should be NO_TRADE even though imbalance would give edge
    const history: MarketHistoryInput = {
      marketId: "0x999",
      symbol: "ETH-TEST/tUSDC",
      expiry,
      winningOutcome: 0,
      voided: false,
      lastPrice: 0.5,
      snapshots: [makeSnapshot(T0 + 150, skewedBids, skewedAsks, 0.51)], // 50s remaining
      dataPath: "HISTORICAL",
    };
    const metrics = runBacktestWithHistory({ markets: [history], startingCapital: 1000 });
    expect(metrics.numberOfTrades).toBe(0); // filtered by timeRemaining < 300
  });
});
