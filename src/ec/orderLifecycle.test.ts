import { describe, it, expect } from "vitest";
import { createOrderState, simulatePlace } from "./orderLifecycle.js";
import type { UnifiedMarket, MarketOnchain } from "@somnia-chain/markets-sdk";

describe("orderLifecycle simulate", () => {
  it("rejects price outside (0,1)", () => {
    const fakeMarket = { symbol: "ETH-0-28AUG26/tUSDC", info: { marketId: "0x123", asset: "ETH" } } as unknown as UnifiedMarket;
    const fakeOnchain = { pool: "0x123", expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) } as unknown as MarketOnchain;
    const ctx = { config: { lot: 1n, decimals: 6 } } as unknown as import("@dreamdex-bot-kit/ec-core").EcContext;
    const res = simulatePlace({
      ctx,
      market: fakeMarket,
      onchain: fakeOnchain,
      outcome: "YES",
      side: "buy",
      price: 1.5,
      size: 1,
      yesSymbol: "ETH-0-28AUG26/tUSDC#YES",
      state: createOrderState(),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("outside (0,1)");
  });

  it("tracks open orders in state", () => {
    const state = createOrderState();
    expect(state.openOrders.size).toBe(0);
    state.openOrders.set("123", "0xabc");
    expect(state.openOrders.get("123")).toBe("0xabc");
    state.openOrders.delete("123");
    expect(state.openOrders.size).toBe(0);
  });
});
