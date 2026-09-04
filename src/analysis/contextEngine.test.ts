import { describe, it, expect } from "vitest";
import { ANALYSIS_CONFIG, DECISION_CONFIG } from "../config.js";
import { collectVariables, type MarketVariables } from "./variables.js";
import { computeFairValue } from "./contextEngine.js";
import { computeDislocation } from "./dislocation.js";
import { checkSettlement } from "./settlementGate.js";
import { decideMarket, computePenalties, scoreOpportunity, agreementStats } from "./decision.js";

function baseVars(overrides: Partial<MarketVariables> = {}): MarketVariables {
  return {
    marketId: "0xtest",
    symbol: "BTC-TEST/tUSDC",
    asset: "BTC",
    marketProbability: 0.5,
    spread: 0.02,
    spreadBps: 400,
    imbalance: 0,
    liquidity: 2000,
    timeRemaining: 1800,
    referencePrice: 79705.445,
    referenceEma: 79709.278,
    momentum: null,
    momentumWindowSec: null,
    momentumSamples: 0,
    volatility: null,
    volatilitySamples: 0,
    strikeDistancePct: null,
    dislocationGap: null,
    dislocationWindowSec: null,
    underlyingRoC: null,
    contractRoC: null,
    venueId: "0xvenue",
    expiry: 1788000000,
    onchainStatus: 1,
    strikePresent: false,
    notes: [],
    ...overrides,
  };
}

function passingGate() {
  return checkSettlement({ marketId: "0xtest", symbol: "BTC-TEST/tUSDC", expiry: 1788000000, venueId: "0xvenue", onchainStatus: 1, strikePresent: false });
}

describe("contextEngine - contribution isolation", () => {
  it("imbalance-only matches the Stage 3 tilt exactly (migration link)", () => {
    const v = baseVars({ imbalance: 0.5 });
    const res = computeFairValue(v);
    expect(res.fairValue).toBeCloseTo(0.5 + ANALYSIS_CONFIG.K_IMBALANCE_NUDGE * 0.5, 10);
    expect(res.contributions).toHaveLength(1);
    const only = res.contributions[0];
    expect(only?.name).toBe("order-flow");
    expect(only?.delta).toBeCloseTo(0.03, 10);
  });

  it("null marketProbability fails safe with null fair value", () => {
    const res = computeFairValue(baseVars({ marketProbability: null }));
    expect(res.fairValue).toBeNull();
    expect(res.contributions).toHaveLength(0);
  });

  it("momentum delta caps at MOMENTUM_CAP", () => {
    const v = baseVars({ momentum: 0.5, momentumWindowSec: 600 });
    const res = computeFairValue(v);
    const mom = res.contributions.find((c) => c.name === "momentum");
    expect(mom?.delta).toBeCloseTo(DECISION_CONFIG.MOMENTUM_CAP, 10);
  });

  it("dislocation skipped when reference window missing", () => {
    const v = baseVars({ imbalance: 0.1 });
    const res = computeFairValue(v);
    expect(res.contributions.map((c) => c.name)).toEqual(["order-flow"]);
    expect(res.notes.join(" ")).toContain("dislocation skipped");
  });

  it("dislocation contributes a bounded delta when present", () => {
    const v = baseVars({ imbalance: 0, dislocationGap: 0.02, dislocationWindowSec: 600 });
    const res = computeFairValue(v);
    const dis = res.contributions.find((c) => c.name === "dislocation");
    expect(dis?.delta).toBeCloseTo(0.02 * DECISION_CONFIG.DISLOCATION_GAIN, 10);
  });
});

describe("dislocation - gap math", () => {
  it("computes the documented example shape", () => {
    const r = computeDislocation({
      underlyingThenPrice: 100,
      underlyingNowPrice: 101.2,
      contractThenProb: 0.5,
      contractNowProb: 0.503,
      windowSec: 600,
    });
    expect(r.sufficient).toBe(true);
    expect(r.underlyingRoC).toBeCloseTo(0.012, 10);
    expect(r.contractRoC).toBeCloseTo(0.006, 10);
    expect(r.gap).toBeCloseTo(0.006, 10);
  });

  it("returns N/A when the underlying window is missing", () => {
    const r = computeDislocation({ underlyingThenPrice: null, underlyingNowPrice: 101, contractThenProb: 0.5, contractNowProb: 0.5, windowSec: 600 });
    expect(r.sufficient).toBe(false);
    expect(r.gap).toBeNull();
  });
});

describe("variables - real collection and honest N/A", () => {
  const bids: ReadonlyArray<readonly [number, number]> = [
    [0.52, 500],
    [0.51, 500],
    [0.5, 500],
  ];
  const asks: ReadonlyArray<readonly [number, number]> = [
    [0.56, 100],
    [0.57, 100],
    [0.58, 100],
  ];

  it("computes momentum and volatility from real snapshot mids", () => {
    const history = [0.5, 0.51, 0.52, 0.53, 0.54, 0.55].map((mid, i) => ({ mid, capturedAtUnix: i * 60 }));
    const v = collectVariables({
      marketId: "0xtest",
      symbol: "S",
      asset: "BTC",
      strike: null,
      bids,
      asks,
      bestBid: 0.52,
      bestAsk: 0.56,
      marketProbability: 0.54,
      timeRemaining: 1800,
      referenceNow: { asset: "BTC", price: 79705, ema: null, blockTimestamp: 300 },
      referenceThen: { price: 79000, atUnix: 0 },
      contractHistory: history,
    });
    expect(v.momentum).toBeCloseTo(0.1, 10);
    expect(v.momentumSamples).toBe(6);
    expect(v.volatility).toBeGreaterThan(0);
    expect(v.imbalance).toBeCloseTo((1500 - 300) / 1800, 10);
    expect(v.liquidity).toBe(1800);
  });

  it("marks momentum N/A with too few snapshots", () => {
    const v = collectVariables({
      marketId: "0xtest",
      symbol: "S",
      asset: "BTC",
      strike: null,
      bids,
      asks,
      bestBid: 0.52,
      bestAsk: 0.56,
      marketProbability: 0.54,
      timeRemaining: 1800,
      referenceNow: null,
      referenceThen: null,
      contractHistory: [
        { mid: 0.5, capturedAtUnix: 0 },
        { mid: 0.51, capturedAtUnix: 60 },
      ],
    });
    expect(v.momentum).toBeNull();
    expect(v.volatility).toBeNull();
    expect(v.notes.join(" ")).toContain("only 2 real snapshots");
  });

  it("marks strike distance N/A for zero strike (Stage 1.5 finding)", () => {
    const v = collectVariables({
      marketId: "0xtest",
      symbol: "S",
      asset: "BTC",
      strike: "0",
      bids,
      asks,
      bestBid: 0.52,
      bestAsk: 0.56,
      marketProbability: 0.54,
      timeRemaining: 1800,
      referenceNow: { asset: "BTC", price: 79705, ema: null, blockTimestamp: 1 },
      referenceThen: null,
      contractHistory: [],
    });
    expect(v.strikePresent).toBe(false);
    expect(v.strikeDistancePct).toBeNull();
  });
});

describe("decision - penalties, boundaries, gate", () => {
  it("penalty math is exact and documented", () => {
    expect(computePenalties(0.04, 2000)).toEqual({ spreadPenalty: 0.02, slipPenalty: 0.0005 });
  });

  it("WATCH boundary: real edge below the trade bar with no hard failure", () => {
    const v = baseVars({ spread: 0.02, spreadBps: 400, liquidity: 2000 });
    const out = decideMarket({
      variables: v,
      fair: { fairValue: 0.515, contributions: [], notes: [] },
      gate: passingGate(),
    });
    // raw 0.015 ≥ WATCH 0.01, executable 0.015 - 0.01 - 0.0005 = 0.0045 < MIN 0.02
    expect(out.decision).toBe("WATCH");
    expect(out.executableEdge).toBeCloseTo(0.0045, 10);
    expect(out.reasons[0]).toContain("WATCH");
  });

  it("TRADE when executable edge clears the bar", () => {
    const v = baseVars({ spread: 0.02, spreadBps: 400, liquidity: 2000 });
    const out = decideMarket({
      variables: v,
      fair: { fairValue: 0.55, contributions: [], notes: [] },
      gate: passingGate(),
    });
    expect(out.decision).toBe("TRADE");
    expect(out.opportunityScore).toBeGreaterThan(0);
    const byName = new Map(out.signals.map((s) => [s.name, s.level]));
    expect(byName.get("settlement")).toBe("PASSED");
    expect(byName.get("risk")).toBe("PENDING");
    expect(byName.get("liquidity")).toBe("GOOD");
    expect(out.signals.length).toBe(9);
  });

  it("NO_TRADE below the watch bar with the specific blocker cited", () => {
    const v = baseVars({});
    const out = decideMarket({
      variables: v,
      fair: { fairValue: 0.505, contributions: [], notes: [] },
      gate: passingGate(),
    });
    expect(out.decision).toBe("NO_TRADE");
    expect(out.reasons[0]).toContain("watch bar");
  });

  it("settlement gate blocks on unreadable on-chain status", () => {
    const v = baseVars({});
    const gate = checkSettlement({ marketId: "0xtest", symbol: "S", expiry: 1788000000, venueId: null, onchainStatus: null, strikePresent: false });
    expect(gate.pass).toBe(false);
    const out = decideMarket({ variables: v, fair: { fairValue: 0.9, contributions: [], notes: [] }, gate });
    expect(out.decision).toBe("NO_TRADE");
    expect(out.reasons[0]).toContain("TRADE BLOCKED - SETTLEMENT RISK");
  });

  it("score normalizes custom weights", () => {
    const full = { edge: 1, agreement: 1, liquidity: 1, execution: 1, risk: 1, settlement: 1 };
    expect(scoreOpportunity(full, { edge: 1, agreement: 0, liquidity: 0, execution: 0, risk: 0, settlement: 0 })).toBe(100);
    expect(scoreOpportunity(full, {})).toBe(0);
  });

  it("agreement counts contributors matching edge sign", () => {
    expect(agreementStats(0.02, { imbalance: 0.5, momentum: -0.1, dislocationGap: 0.3 })).toEqual({ agree: 2, total: 3 });
    expect(agreementStats(0, { imbalance: 0.5, momentum: null, dislocationGap: null })).toEqual({ agree: 0, total: 1 });
  });
});
