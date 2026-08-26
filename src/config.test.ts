import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";
import { CHAIN_IDS } from "./constants.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean Bot Kit shim vars
    delete process.env.SOMNIA_TESTNET_RPC_URL;
    delete process.env.RPC_URL;
    delete process.env.DREAMDEX_API_BASE;
    delete process.env.REST_API_URL;
    delete process.env.WALLET_PRIVATE_KEY;
    delete process.env.PRIVATE_KEY;
    delete process.env.CHAIN_ID;
    delete process.env.NETWORK;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads defaults for read-only mode without private key", () => {
    const cfg = loadConfig();
    expect(cfg.chainId).toBe(CHAIN_IDS.TESTNET);
    expect(cfg.network).toBe("testnet");
    expect(cfg.somniaRpcUrl).toBe("https://dream-rpc.somnia.network");
    expect(cfg.dreamdexApiBase).toBe("https://stg.api.dreamdex.io/v0");
    expect(cfg.walletPrivateKey).toBeUndefined();
  });

  it("validates CHAIN_ID mismatch with NETWORK", () => {
    process.env.CHAIN_ID = String(CHAIN_IDS.MAINNET);
    process.env.NETWORK = "testnet";
    expect(() => loadConfig()).toThrow(/mismatches NETWORK/);
  });

  it("accepts valid WALLET_PRIVATE_KEY", () => {
    process.env.WALLET_PRIVATE_KEY = "0x" + "a".repeat(64);
    const cfg = loadConfig();
    expect(cfg.walletPrivateKey).toBe("0x" + "a".repeat(64));
  });

  it("rejects invalid WALLET_PRIVATE_KEY", () => {
    process.env.WALLET_PRIVATE_KEY = "0x123";
    expect(() => loadConfig()).toThrow(/Invalid WALLET_PRIVATE_KEY/);
  });

  it("treats placeholder zero-key as undefined (read-only)", () => {
    process.env.WALLET_PRIVATE_KEY = "0x" + "0".repeat(64);
    const cfg = loadConfig();
    expect(cfg.walletPrivateKey).toBeUndefined();
  });
});
