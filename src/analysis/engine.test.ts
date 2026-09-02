import { describe, it, expect } from "vitest";
import { analyzeMarket, computeEstimatedProbability } from "./engine.js";
import { ANALYSIS_CONFIG } from "../config.js";

const baseInput = {
  marketId: "0xabc123",
  symbol: "ETH-TEST/tUSDC",
  bestBid: 0.55,
  bestAsk: 0.57,
  marketProbability: 0.56,
  timeRemaining: 1000,
  bids: [
    [0.55, 200] as const,
    [0.54, 200] as const,
    [0.53, 200] as const,
  ],
  asks: [
    [0.57, 100] as const,
    [0.58, 100] as const,
    [0.59, 100] as const,
  ],
};

describe("computeEstimatedProbability", () => {
  it("clamps within 0.01-0.99", () => {
    expect(computeEstimatedProbability(0.02, -1, 0.06)).toBeGreaterThanOrEqual(0.01);
    expect(computeEstimatedProbability(0.98, 1, 0.06)).toBeLessThanOrEqual(0.99);
  });
});

describe("analyzeMarket", () => {
  it("valid TRADE case - order-book imbalance tilt creates edge above minEdge", () => {
    // bidDepth 600 vs askDepth 300 → imbalance = 0.333, k=0.06 → tilt 0.02 → edge 0.02 meets MIN_EDGE
    // Use top 3 levels: bids 200+200+200=600, asks 100+100+100=300
    const res = analyzeMarket(baseInput);
    expect(res.recommendation).toBe("TRADE");
    expect(res.direction).toBe("YES");
    expect(res.imbalance).toBeCloseTo(0.333, 2);
    expect(Math.abs(res.edge)).toBeGreaterThanOrEqual(ANALYSIS_CONFIG.MIN_EDGE);
    expect(res.reasons.join(" ")).toContain("order-book imbalance");
    expect(res.liquidity).toBe(900);
    expect(res.signalStrength).toBeCloseTo(0.333, 2);
  });

  it("NO_TRADE - insufficient edge (balanced book, edge < minEdge)", () => {
    const balanced = {
      ...baseInput,
      bids: [
        [0.55, 100] as const,
        [0.54, 100] as const,
        [0.53, 100] as const,
      ],
      asks: [
        [0.57, 100] as const,
        [0.58, 100] as const,
        [0.59, 100] as const,
      ],
    };
    const res = analyzeMarket(balanced);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.edge).toBeCloseTo(0, 3);
    expect(res.reasons.join(" ")).toContain("order-book imbalance");
    expect(res.reasons.join(" ")).toContain("minEdge");
  });

  it("NO_TRADE - insufficient liquidity", () => {
    const thin = {
      ...baseInput,
      bids: [[0.55, 10] as const],
      asks: [[0.57, 10] as const],
    };
    const res = analyzeMarket(thin);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.reasons.join(" ")).toContain("liquidity");
    expect(res.liquidity).toBe(20);
  });

  it("NO_TRADE - spread too wide", () => {
    const wide = {
      ...baseInput,
      bestBid: 0.4,
      bestAsk: 0.7,
      marketProbability: 0.55,
      bids: [
        [0.4, 200] as const,
        [0.39, 200] as const,
        [0.38, 200] as const,
      ],
      asks: [
        [0.7, 100] as const,
        [0.71, 100] as const,
        [0.72, 100] as const,
      ],
    };
    const res = analyzeMarket(wide);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.reasons.join(" ")).toContain("spread");
  });

  it("NO_TRADE - near expiry (below timeRemaining buffer)", () => {
    const nearExpiry = { ...baseInput, timeRemaining: 10 };
    const res = analyzeMarket(nearExpiry);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.reasons.join(" ")).toContain("timeRemaining");
  });

  it("malformed/missing market data → fails safe, not crash, not fabricated", () => {
    const malformed = {
      marketId: "",
      symbol: "",
      bids: [] as unknown as [number, number][],
      asks: [] as unknown as [number, number][],
      bestBid: undefined,
      bestAsk: undefined,
      marketProbability: undefined,
      timeRemaining: undefined,
    } as unknown as Parameters<typeof analyzeMarket>[0];
    const res = analyzeMarket(malformed);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.reasons[0]).toContain("no book depth to assess");
    // Must not throw and must not fabricate a TRADE
    expect(() => analyzeMarket(malformed)).not.toThrow();
  });

  it("empty book on one side → NO_TRADE with no book depth to assess, not hidden", () => {
    const oneSided = { ...baseInput, bids: [], asks: [[0.57, 100] as const] };
    const res = analyzeMarket(oneSided);
    expect(res.recommendation).toBe("NO_TRADE");
    expect(res.reasons.join(" ")).toContain("no book depth to assess");
  });
});
