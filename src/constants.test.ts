import { describe, it, expect } from "vitest";
import { CHAIN_IDS, NETWORK_DEFAULTS, NATIVE_SENTINEL } from "./constants.js";

describe("constants", () => {
  it("chain IDs are correct (LIVE_ONCHAIN)", () => {
    expect(CHAIN_IDS.TESTNET).toBe(50312);
    expect(CHAIN_IDS.MAINNET).toBe(5031);
  });

  it("native sentinel matches kit", () => {
    expect(NATIVE_SENTINEL).toBe("0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00");
  });

  it("network defaults are https and contain chainId", () => {
    expect(NETWORK_DEFAULTS.testnet.rpcUrl.startsWith("https://")).toBe(true);
    expect(NETWORK_DEFAULTS.testnet.restApi).toBe("https://stg.api.dreamdex.io/v0");
    expect(NETWORK_DEFAULTS.testnet.chainId).toBe(CHAIN_IDS.TESTNET);
    expect(NETWORK_DEFAULTS.mainnet.chainId).toBe(CHAIN_IDS.MAINNET);
  });
});
