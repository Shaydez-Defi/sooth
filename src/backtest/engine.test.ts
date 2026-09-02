import { describe, it, expect } from "vitest";
import { computePnL, runBacktest, type SettledMarket } from "./engine.js";

describe("computePnL - payout formula (documented in engine.ts)", () => {
  it("YES buy at P=0.6, YES wins → (1-P)*S", () => {
    expect(computePnL({ direction: "YES", entryPrice: 0.6, size: 1, winningOutcome: 0, voided: false })).toBeCloseTo(0.4, 6);
  });
  it("YES buy at P=0.6, NO wins → -P*S", () => {
    expect(computePnL({ direction: "YES", entryPrice: 0.6, size: 1, winningOutcome: 1, voided: false })).toBeCloseTo(-0.6, 6);
  });
  it("NO buy at P_no=0.4 (YES 0.6), NO wins → (1-0.4)*S", () => {
    expect(computePnL({ direction: "NO", entryPrice: 0.4, size: 1, winningOutcome: 1, voided: false })).toBeCloseTo(0.6, 6);
  });
  it("voided → (0.5-P)*S", () => {
    expect(computePnL({ direction: "YES", entryPrice: 0.6, size: 2, winningOutcome: null, voided: true })).toBeCloseTo((0.5 - 0.6) * 2, 6);
  });
  it("size scales", () => {
    expect(computePnL({ direction: "YES", entryPrice: 0.5, size: 3, winningOutcome: 0, voided: false })).toBeCloseTo(1.5, 6);
  });
});

function synthMarket(overrides: Partial<SettledMarket> & { marketId: string }): SettledMarket {
  return {
    symbol: overrides.symbol ?? "SYNTH-TEST",
    asset: "SYNTH",
    expiry: 9999999999,
    winningOutcome: overrides.winningOutcome ?? 0,
    voided: overrides.voided ?? false,
    lastPrice: 0.5,
     
    bids: [[0.55, 200], [0.54, 200], [0.53, 200]] as unknown as [number, number][],
     
    asks: [[0.57, 100], [0.58, 100], [0.59, 100]] as unknown as [number, number][],
    bookTag: "ESTIMATED",
    ...overrides,
  };
}

describe("runBacktest metrics - synthetic, clearly labeled, not claimed as live", () => {
  it("known winning sequence - 3 trades, 2 wins, 1 loss", () => {
    // All three use same book imbalance 0.333 → edge 0.02 → TRADE YES
    // WinningOutcome pattern: YES, YES, NO → P&L: +0.44, +0.44, -0.56 (entry 0.56 mid, k 0.06)
    const markets: SettledMarket[] = [
      synthMarket({ marketId: "0x01", winningOutcome: 0 }),
      synthMarket({ marketId: "0x02", winningOutcome: 0 }),
      synthMarket({ marketId: "0x03", winningOutcome: 1 }),
    ];
    const m = runBacktest({ markets, startingCapital: 1000, sizePerTrade: 1 });
    expect(m.numberOfTrades).toBe(3);
    expect(m.winningTrades).toBe(2);
    expect(m.losingTrades).toBe(1);
    expect(m.winRate).toBeCloseTo(2 / 3, 6);
    // P&L: entry mid 0.56 (from 0.55/0.57), YES buy at 0.56 → wins give (1-0.56)=0.44, loss gives -0.56 → total 0.32
    expect(m.totalPnL).toBeCloseTo(0.32, 2);
    expect(m.endingCapital).toBeCloseTo(1000.32, 2);
    expect(m.averageReturn).toBeCloseTo(0.32 / 3, 6);
    expect(m.tradeFrequency).toBeCloseTo(1, 6);
  });

  it("maximum drawdown calculation", () => {
    // Sequence: win (+0.44), loss (-0.56), win (+0.44) → cumulative: 0.44, -0.12, 0.32 → peak 0.44, trough -0.12 → dd 0.56
    const markets: SettledMarket[] = [
      synthMarket({ marketId: "0x10", winningOutcome: 0 }),
      synthMarket({ marketId: "0x11", winningOutcome: 1 }),
      synthMarket({ marketId: "0x12", winningOutcome: 0 }),
    ];
    const m = runBacktest({ markets, startingCapital: 1000, sizePerTrade: 1 });
    expect(m.maximumDrawdown).toBeCloseTo(0.56, 2);
  });

  it("no trades when engine returns NO_TRADE (balanced book, edge < minEdge)", () => {
    const balanced: SettledMarket = {
      marketId: "0x99",
      symbol: "BALANCED",
      asset: "BAL",
      expiry: 9999999999,
      winningOutcome: 0,
      voided: false,
      lastPrice: 0.5,
       
      bids: [[0.5, 100], [0.49, 100], [0.48, 100]] as unknown as [number, number][],
       
      asks: [[0.52, 100], [0.53, 100], [0.54, 100]] as unknown as [number, number][],
      bookTag: "ESTIMATED",
    };
    // Balanced 100 vs 100 → imbalance 0 → edge 0 < 0.02 → NO_TRADE
    const m = runBacktest({ markets: [balanced], startingCapital: 1000, sizePerTrade: 1 });
    expect(m.numberOfTrades).toBe(0);
    expect(m.totalPnL).toBe(0);
    expect(m.winRate).toBe(0);
    expect(m.endingCapital).toBe(1000);
  });

  it("average edge computed", () => {
    const markets: SettledMarket[] = [
      synthMarket({ marketId: "0xa", winningOutcome: 0 }),
      synthMarket({ marketId: "0xb", winningOutcome: 0 }),
    ];
    const m = runBacktest({ markets, startingCapital: 1000, sizePerTrade: 1 });
    // Each trade edge ~0.02 (k=0.06 * imb 0.333)
    expect(m.averageEdge).toBeCloseTo(0.02, 2);
  });
});
