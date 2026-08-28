import { describe, it, expect, vi } from "vitest";
import { runPipeline } from "./pipeline.js";
import type { Strategy, StrategyContext, StrategyDecision, BotConfig } from "./types.js";
import type { MarketAnalysis } from "../analysis/types.js";
import { BOT_CONFIG } from "../config.js";

function makeBotConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    enabled: true,
    maxPosition: BOT_CONFIG.MAX_POSITION,
    maxLoss: BOT_CONFIG.MAX_LOSS,
    minLiquidity: BOT_CONFIG.MIN_LIQUIDITY,
    maxSpread: BOT_CONFIG.MAX_SPREAD,
    maxSpreadBps: BOT_CONFIG.MAX_SPREAD_BPS,
    minTimeRemaining: BOT_CONFIG.MIN_TIME_REMAINING,
    minOrderSize: BOT_CONFIG.MIN_ORDER_SIZE,
    maxOrderSize: BOT_CONFIG.MAX_ORDER_SIZE,
    defaultOrderSize: BOT_CONFIG.DEFAULT_ORDER_SIZE,
    minNativeWei: BOT_CONFIG.MIN_NATIVE_WEI,
    minCollateralRaw: BOT_CONFIG.MIN_COLLATERAL_RAW,
    ...overrides,
  };
}

function makeGoodAnalysis(overrides?: Partial<MarketAnalysis>): MarketAnalysis {
  return {
    marketId: "0xabc",
    symbol: "ETH-TEST/tUSDC",
    direction: "YES",
    marketProbability: 0.5,
    estimatedProbability: 0.52,
    edge: 0.02,
    liquidity: 1000,
    spread: 0.02,
    spreadBps: 400,
    timeRemaining: 1000,
    signalStrength: 0.333,
    recommendation: "TRADE",
    reasons: ["order-book imbalance 0.333 (bid-heavy) → tilt +0.0200 (k=0.060) → estimated 0.5200 vs market 0.5000"],
    imbalance: 0.333,
    ...overrides,
  };
}

function makeGoodContext(overrides?: Partial<StrategyContext>): StrategyContext {
  return {
    config: makeBotConfig(),
    openPositions: [],
    currentLoss: 0,
    balances: { nativeWei: 100_000_000_000_000_000n, tUsdcRaw: 10_000_000n }, // 0.1 STT, 10 tUSDC
    nowSec: 1_700_000_000,
    ...overrides,
  };
}

// Minimal mock market/onchain/state/ecCtx for pipeline execution tests
const mockMarket = { symbol: "ETH-TEST/tUSDC", info: { marketId: "0xabc" } } as unknown as import("@somnia-chain/markets-sdk").UnifiedMarket;
const mockOnchain = { expiry: BigInt(1_800_000_000), status: 1 } as unknown as import("@somnia-chain/markets-sdk").MarketOnchain;
const mockState = { openOrders: new Map<string, string>() } as import("../ec/orderLifecycle.js").OrderState;
const mockEcCtx = { exchange: { client: { getViemClient: () => ({}) } } } as unknown as import("@dreamdex-bot-kit/ec-core").EcContext;

const alwaysPlaceStrategy: Strategy = {
  id: "test-always-place",
  decide: (): StrategyDecision => ({
    action: "PLACE_ORDER",
    side: "YES",
    price: 0.5,
    size: 1,
    reasons: ["order-book imbalance 0.333 (bid-heavy) → tilt +0.0200 (k=0.060) → estimated 0.5200 vs market 0.5000"],
  }),
};

const alwaysSkipStrategy: Strategy = {
  id: "test-always-skip",
  decide: (_a: MarketAnalysis): StrategyDecision => ({
    action: "SKIP",
    reasons: [..._a.reasons],
  }),
};

describe("pipeline — Market Data → Strategy → Risk → Execution", () => {
  it("strategy approves + risk approves → executes (calls placeOrder)", async () => {
    const execSpy = vi.fn(() => Promise.resolve({ txHash: "0xabc", blockNumber: 1n, status: "success", orderId: 1n, rested: true, filled: 0, gasUsed: 100n, price: 0.5, size: 1, symbol: "x", marketId: "0xabc", confirmedInOpenOrders: true } as unknown as import("../ec/orderLifecycle.js").PlaceResultTagged));
    const result = await runPipeline(
      {
        analysis: makeGoodAnalysis(),
        strategy: alwaysPlaceStrategy,
        strategyContext: makeGoodContext(),
        ecCtx: mockEcCtx,
        market: mockMarket,
        onchain: mockOnchain,
        state: mockState,
        yesSymbol: "ETH-TEST/tUSDC#YES",
      },
      { placeOrderFn: execSpy },
    );
    expect(result.decision.action).toBe("PLACE_ORDER");
    expect(result.risk?.approved).toBe(true);
    expect(result.executed).toBe(true);
    expect(execSpy).toHaveBeenCalledOnce();
    expect(result.placeResult).not.toBeNull();
  });

  it("strategy approves + risk rejects (each individual check) → blocked, never reaches execution", async () => {
    const cases: Array<{ name: string; analysis?: Partial<MarketAnalysis>; context?: Partial<StrategyContext>; decision?: Partial<StrategyDecision>; reasonMatch: string }> = [
      { name: "1 bot disabled", context: { config: makeBotConfig({ enabled: false }) }, reasonMatch: "bot disabled" },
      { name: "2 market still active (expired)", analysis: { timeRemaining: 0 }, reasonMatch: "no longer active" },
      { name: "3 close-to-expiry buffer", analysis: { timeRemaining: 10 }, reasonMatch: "close to expiry" },
      { name: "4 liquidity insufficient", analysis: { liquidity: 10 }, reasonMatch: "liquidity insufficient" },
      { name: "5 spread acceptable (wide)", analysis: { spread: 0.1, spreadBps: 1000 }, reasonMatch: "spread too wide" },
      { name: "6 position limit", context: { openPositions: Array.from({ length: BOT_CONFIG.MAX_POSITION }, (_, i) => ({ marketId: `0x${i}`, symbol: "x", side: "YES" as const, size: 1 })) }, reasonMatch: "position limit" },
      { name: "7 loss limit", context: { currentLoss: BOT_CONFIG.MAX_LOSS }, reasonMatch: "loss limit" },
      { name: "8 order size valid (too large)", decision: { size: BOT_CONFIG.MAX_ORDER_SIZE + 10 }, reasonMatch: "order size too large" },
      { name: "9 wallet funded", context: { balances: { nativeWei: 100_000_000_000_000_000n, tUsdcRaw: 1n } }, reasonMatch: "wallet collateral insufficient" },
      { name: "10 gas sufficient", context: { balances: { nativeWei: 1n, tUsdcRaw: 10_000_000n } }, reasonMatch: "gas insufficient" },
    ];

    for (const c of cases) {
      const execSpy = vi.fn(() => Promise.resolve({ txHash: "0xabc", blockNumber: 1n, status: "success", orderId: 1n, rested: true, filled: 0, gasUsed: 100n, price: 0.5, size: 1, symbol: "x", marketId: "0xabc", confirmedInOpenOrders: true } as unknown as import("../ec/orderLifecycle.js").PlaceResultTagged));

      // For case 8 we need to override decision price/size via a custom strategy
      let strategy: Strategy = alwaysPlaceStrategy;
      if (c.decision) {
        const override = c.decision;
        strategy = {
          id: "test-override-decision",
          decide: (): StrategyDecision => ({
            action: "PLACE_ORDER",
            side: "YES",
            price: 0.5,
            size: 1,
            reasons: ["order-book imbalance 0.333 (bid-heavy) → tilt +0.0200"],
            ...override,
          }),
        };
      }

      const result = await runPipeline(
        {
          analysis: makeGoodAnalysis(c.analysis),
          strategy,
          strategyContext: makeGoodContext(c.context),
          ecCtx: mockEcCtx,
          market: mockMarket,
          onchain: mockOnchain,
          state: mockState,
          yesSymbol: "ETH-TEST/tUSDC#YES",
        },
        { placeOrderFn: execSpy },
      );
      expect(result.decision.action, `case ${c.name}: decision should be PLACE_ORDER`).toBe("PLACE_ORDER");
      expect(result.risk?.approved, `case ${c.name}: risk should reject`).toBe(false);
      expect(result.risk?.rejectionReasons.join(" "), `case ${c.name}: reason should contain ${c.reasonMatch}`).toContain(c.reasonMatch);
      expect(result.executed, `case ${c.name}: should not execute`).toBe(false);
      expect(execSpy, `case ${c.name}: execution must not be called`).not.toHaveBeenCalled();
    }
  });

  it("strategy SKIPs → never reaches risk engine (short-circuit proven)", async () => {
    const riskSpy = vi.fn(() => ({ approved: true, rejectionReasons: [] }));
    const execSpy = vi.fn(() => Promise.resolve({ txHash: "0xabc", blockNumber: 1n, status: "success", orderId: 1n, rested: true, filled: 0, gasUsed: 100n, price: 0.5, size: 1, symbol: "x", marketId: "0xabc", confirmedInOpenOrders: true } as unknown as import("../ec/orderLifecycle.js").PlaceResultTagged));
    const result = await runPipeline(
      {
        analysis: makeGoodAnalysis({ recommendation: "NO_TRADE", direction: "NONE" }),
        strategy: alwaysSkipStrategy,
        strategyContext: makeGoodContext(),
        ecCtx: mockEcCtx,
        market: mockMarket,
        onchain: mockOnchain,
        state: mockState,
        yesSymbol: "ETH-TEST/tUSDC#YES",
      },
      { checkOrderFn: riskSpy, placeOrderFn: execSpy },
    );
    expect(result.decision.action).toBe("SKIP");
    expect(result.risk).toBeNull();
    expect(riskSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(result.executed).toBe(false);
  });
});
