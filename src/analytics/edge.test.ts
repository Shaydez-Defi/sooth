import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openSnapshotDb, insertBotFill, insertBotEvent, insertSnapshot, upsertBotPosition } from "../snapshots/db.js";
import { computeEdgeAnalytics } from "./edge.js";

describe("edge analytics - synthetic fills, not live", () => {
  it("insufficient-data when 0 fills", () => {
    const db = openSnapshotDb(":memory:");
    const result = computeEdgeAnalytics(db);
    expect(result.status).toBe("insufficient_data");
    expect(result.metrics).toBeNull();
    expect(result.fillsCount).toBe(0);
    expect(result.dataIntegrity.fills).toBe("LIVE_ONCHAIN");
    db.close();
  });

  it("computes from synthetic fills with edge/mid/gas", () => {
    const db = openSnapshotDb(":memory:");
    // Two synthetic fills: one win-like edge 0.02 mid 0.5 fill 0.51, one edge 0.015
    insertBotFill(db, {
      txHash: "0xabc1",
      blockNumber: 100,
      marketId: "0x1",
      symbol: "ETH-TEST/tUSDC",
      orderId: "1",
      quantityFilled: 1,
      fillPrice: 0.51,
      edgeAtDecision: 0.02,
      midAtDecision: 0.5,
      gasUsed: "100000",
      gasPrice: "1000000000",
      gasCost: 0.0001,
      rawData: { simulated: true },
    });
    upsertBotPosition(db, { marketId: "0x1", symbol: "ETH-TEST/tUSDC", netPosition: 1, realizedPnL: 0.4 });

    insertBotFill(db, {
      txHash: "0xabc2",
      blockNumber: 101,
      marketId: "0x1",
      symbol: "ETH-TEST/tUSDC",
      orderId: "2",
      quantityFilled: 1,
      fillPrice: 0.52,
      edgeAtDecision: 0.015,
      midAtDecision: 0.5,
      gasUsed: "120000",
      gasPrice: "1000000000",
      gasCost: 0.00012,
      rawData: { simulated: true },
    });
    upsertBotPosition(db, { marketId: "0x1", symbol: "ETH-TEST/tUSDC", netPosition: 2, realizedPnL: 0.8 });

    const result = computeEdgeAnalytics(db);
    expect(result.status).toBe("ok");
    expect(result.metrics).not.toBeNull();
    if (!result.metrics) throw new Error("expected metrics");
    expect(result.metrics.tradeCount).toBe(2);
    expect(result.metrics.grossPnL).toBeCloseTo(0.8, 2);
    expect(result.metrics.gasCost).toBeCloseTo(0.00022, 5);
    expect(result.metrics.netPnL).toBeCloseTo(0.79978, 4);
    expect(result.metrics.averageEdge).toBeCloseTo(0.0175, 4);
    expect(result.metrics.executionQuality).toBeCloseTo(0.015, 3); // (0.01+0.02)/2
    // Win rate, realized edge are null per gap (needs settlement outcome) - we report gap, not fabricated
    expect(result.metrics.winRate).toBeNull();
    expect(result.metrics.realizedEdge).toBeNull();
    // Adverse selection: null + explicit gap (post-fill mid not captured)
    expect(result.metrics.adverseSelection).toBeNull();
    expect(result.metrics.gaps.join(" ")).toContain("adverseSelection");
    db.close();
  });

  it("drawdown uses Stage 4 peak-to-trough over the FILL_OBSERVED cumulative PnL series", () => {
    const db = openSnapshotDb(":memory:");
    // Synthetic cumulative realized PnL series: +0.4 → +0.8 → -0.1 → +0.3
    // peak 0.8; dd at -0.1 = 0.9; dd at +0.3 = 0.5 → maxDrawdown 0.9 (matches Stage 4 logic shape)
    const series = [0.4, 0.8, -0.1, 0.3];
    for (const [i, cum] of series.entries()) {
      insertBotFill(db, {
        txHash: `0xdd${i}`,
        blockNumber: 200 + i,
        marketId: "0x2",
        symbol: "BTC-TEST/tUSDC",
        orderId: String(i),
        quantityFilled: 1,
        fillPrice: 0.5,
        edgeAtDecision: 0.02,
        midAtDecision: 0.5,
        rawData: { simulated: true },
      });
      upsertBotPosition(db, { marketId: "0x2", symbol: "BTC-TEST/tUSDC", netPosition: i + 1, realizedPnL: cum });
      insertBotEvent(db, {
        marketId: "0x2",
        symbol: "BTC-TEST/tUSDC",
        eventType: "FILL_OBSERVED",
        data: { simulated: true, newRealizedPnL: cum },
        blockNumber: 200 + i,
      });
    }
    const result = computeEdgeAnalytics(db);
    expect(result.status).toBe("ok");
    if (!result.metrics) throw new Error("expected metrics");
    expect(result.metrics.maximumDrawdown).toBeCloseTo(0.9, 6);
    // no drawdown gap when series exists
    expect(result.metrics.gaps.join(" ")).not.toContain("maximumDrawdown:");
    db.close();
  });

  it("drawdown is null with explicit gap when no FILL_OBSERVED event carries newRealizedPnL", () => {
    const db = openSnapshotDb(":memory:");
    insertBotFill(db, {
      txHash: "0xnoseries",
      blockNumber: 300,
      marketId: "0x3",
      symbol: "ETH-TEST/tUSDC",
      orderId: "9",
      quantityFilled: 1,
      fillPrice: 0.5,
      rawData: { simulated: true },
    });
    const result = computeEdgeAnalytics(db);
    expect(result.status).toBe("ok");
    if (!result.metrics) throw new Error("expected metrics");
    expect(result.metrics.maximumDrawdown).toBeNull();
    expect(result.metrics.gaps.join(" ")).toContain("maximumDrawdown");
    // legacy fill without edge fields → averageEdge gap too
    expect(result.metrics.averageEdge).toBeNull();
    expect(result.metrics.gaps.join(" ")).toContain("averageEdge");
    db.close();
  });
});
describe("edge analytics - Stage 9: winRate/realizedEdge from realized positions, adverse selection from real snapshots", () => {
  const T0 = 1_700_000_000; // fixed synthetic fill time (seconds)

  const snap = (marketId: string, symbol: string, mid: number, at: number, idOffset = 0) =>
    insertSnapshot(dbFixture, {
      marketId,
      symbol,
      capturedAtUnix: at,
      capturedAtIso: new Date(at * 1000).toISOString(),
      bidLevels: [[mid - 0.01, 100]],
      askLevels: [[mid + 0.01, 100]],
      mid,
      bidDepth: 100,
      askDepth: 100,
      imbalance: 0,
      blockNumber: 100 + idOffset,
    });

  let dbFixture: import("better-sqlite3").Database;

  beforeEach(() => {
    dbFixture = openSnapshotDb(":memory:");
  });

  afterEach(() => {
    dbFixture.close();
  });

  it("winRate/winning/losing/realizedEdge from CLOSED positions only; open positions excluded; gaps scoped", () => {
    upsertBotPosition(dbFixture, { marketId: "0xA", symbol: "X/tUSDC", side: "YES", netPosition: 1, totalSize: 0, avgEntryPrice: 0.6, realizedPnL: 0.4, status: "CLOSED", realizationSource: "SETTLEMENT", realizedAtUnix: T0 });
    upsertBotPosition(dbFixture, { marketId: "0xB", symbol: "Y/tUSDC", side: "YES", netPosition: 1, totalSize: 0, avgEntryPrice: 0.6, realizedPnL: -0.1, status: "CLOSED", realizationSource: "EARLY_CLOSE", realizedAtUnix: T0 });
    upsertBotPosition(dbFixture, { marketId: "0xC", symbol: "Z/tUSDC", side: "YES", netPosition: 2, totalSize: 2, avgEntryPrice: 0.6, realizedPnL: 0, status: "OPEN" });
    insertBotFill(dbFixture, { txHash: "0xfz1", blockNumber: 1, marketId: "0xC", symbol: "Z/tUSDC", orderId: "z1", side: "buy", outcome: "YES", quantityFilled: 2, fillPrice: 0.6, capturedAtUnix: T0, rawData: { simulated: true } });

    const result = computeEdgeAnalytics(dbFixture);
    expect(result.status).toBe("ok");
    if (!result.metrics) throw new Error("expected metrics");
    expect(result.metrics.winningTrades).toBe(1);
    expect(result.metrics.losingTrades).toBe(1);
    expect(result.metrics.winRate).toBeCloseTo(0.5, 6);
    expect(result.metrics.realizedEdge).toBeCloseTo((0.4 + -0.1) / 2, 6);
    expect(result.metrics.resolvedTrades).toBe(2);
    expect(result.metrics.openPositions).toBe(1);
    expect(result.metrics.grossPnL).toBeCloseTo(0.3, 6); // 0.4 - 0.1 + 0 (open)
    // scoped gap: open position excluded, but the metric IS computed - no blanket gap
    const gaps = result.metrics.gaps.join(" ");
    expect(gaps).toContain("1 open position(s) excluded");
  });

  it("adverse selection from REAL snapshots near fill+5m, signed by side", () => {
    snap("0xM", "BTC-TEST/tUSDC", 0.48, T0 + 300, 1);
    snap("0xN", "ETH-TEST/tUSDC", 0.55, T0 + 300, 2);
    // buy at 0.50, mid falls to 0.48 at t+5m → adverse (0.50-0.48)*+1 = 0.02
    insertBotFill(dbFixture, { txHash: "0xfM", blockNumber: 1, marketId: "0xM", symbol: "BTC-TEST/tUSDC", orderId: "m1", side: "buy", outcome: "YES", quantityFilled: 1, fillPrice: 0.5, capturedAtUnix: T0, rawData: { simulated: true } });
    // sell at 0.50, mid rises to 0.55 at t+5m → adverse (0.50-0.55)*-1 = 0.05
    insertBotFill(dbFixture, { txHash: "0xfN", blockNumber: 1, marketId: "0xN", symbol: "ETH-TEST/tUSDC", orderId: "n1", side: "sell", outcome: "YES", quantityFilled: 1, fillPrice: 0.5, capturedAtUnix: T0, rawData: { simulated: true } });

    const result = computeEdgeAnalytics(dbFixture);
    if (!result.metrics) throw new Error("expected metrics");
    expect(result.metrics.adverseSelection).toBeCloseTo((0.02 + 0.05) / 2, 6);
    expect(result.metrics.gaps.join(" ")).not.toContain("adverseSelection: no fill has a computable post-fill mid");
  });

  it("adverseSelection NOT COMPUTABLE per fill when no snapshot exists near fill+5m", () => {
    snap("0xM", "BTC-TEST/tUSDC", 0.55, 100, 1); // a real snapshot, but far from T0+300
    insertBotFill(dbFixture, { txHash: "0xfX", blockNumber: 1, marketId: "0xM", symbol: "BTC-TEST/tUSDC", orderId: "x1", side: "buy", outcome: "YES", quantityFilled: 1, fillPrice: 0.5, capturedAtUnix: T0, rawData: { simulated: true } });
    upsertBotPosition(dbFixture, { marketId: "0xM", symbol: "BTC-TEST/tUSDC", netPosition: 1, realizedPnL: 0 });

    const result = computeEdgeAnalytics(dbFixture);
    if (!result.metrics) throw new Error("expected metrics");
    expect(result.metrics.adverseSelection).toBeNull();
    const gaps = result.metrics.gaps.join(" ");
    expect(gaps).toContain("adverseSelection fill id=");
    expect(gaps).toContain("no snapshot within");
    expect(gaps).toContain("0xM");
  });

  it("fills without side/outcome (pre-Stage-9) report per-fill adverse-selection gaps", () => {
    snap("0xM", "BTC-TEST/tUSDC", 0.48, T0 + 300, 1);
    insertBotFill(dbFixture, { txHash: "0xfL", blockNumber: 1, marketId: "0xM", symbol: "BTC-TEST/tUSDC", orderId: "l1", quantityFilled: 1, fillPrice: 0.5, capturedAtUnix: T0, rawData: { simulated: true } });

    const result = computeEdgeAnalytics(dbFixture);
    if (!result.metrics) throw new Error("expected metrics");
    expect(result.metrics.adverseSelection).toBeNull();
    expect(result.metrics.gaps.join(" ")).toContain("side/outcome not recorded");
  });
});
