import { describe, it, expect } from "vitest";
import { openSnapshotDb, insertBotFill, insertBotEvent, upsertBotPosition } from "../snapshots/db.js";
import { computeEdgeAnalytics } from "./edge.js";

describe("edge analytics — synthetic fills, not live", () => {
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
    // Win rate, realized edge are null per gap (needs settlement outcome) — we report gap, not fabricated
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
