import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UnifiedMarket } from "@somnia-chain/markets-sdk";
const state = vi.hoisted(() => ({ impl: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));

vi.mock("@dreamdex-bot-kit/ec-core", () => ({
  activeMarkets: (...args: unknown[]): Promise<unknown> => state.impl(...args),
}));

import { getActiveMarketsCached, clearRegistryCache, REGISTRY_CACHE_TTL_MS } from "./registryCache.js";

function fakeRows(): UnifiedMarket[] {
  return [{ symbol: "ETH-TEST/tUSDC", info: { marketId: "0xabc" } }] as unknown as UnifiedMarket[];
}

describe("registryCache - single-flight TTL with honest stale fallback", () => {
  beforeEach(() => {
    clearRegistryCache();
    state.impl.mockReset();
    state.impl.mockResolvedValue(fakeRows());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("primes once and serves fresh within TTL without refetching", async () => {
    const first = await getActiveMarketsCached({} as never);
    expect(first.stale).toBe(false);
    expect(first.cacheAgeSec).toBe(0);
    expect(first.markets).toHaveLength(1);
    const second = await getActiveMarketsCached({} as never);
    expect(second.stale).toBe(false);
    expect(state.impl).toHaveBeenCalledTimes(1);
  });

  it("serves stale labeled rows when refresh fails after TTL expiry", async () => {
    vi.useFakeTimers();
    await getActiveMarketsCached({} as never);
    vi.setSystemTime(Date.now() + REGISTRY_CACHE_TTL_MS + 1);
    state.impl.mockRejectedValueOnce(new Error("indexer down"));
    const res = await getActiveMarketsCached({} as never);
    expect(res.stale).toBe(true);
    expect(res.markets).toHaveLength(1);
    expect(res.cacheAgeSec).toBeGreaterThan(0);
  });

  it("throws when the indexer fails with an empty cache", async () => {
    state.impl.mockRejectedValueOnce(new Error("indexer down"));
    await expect(getActiveMarketsCached({} as never)).rejects.toThrow("indexer down");
  });
});

function kvEnvelope(fetchedAt: number): string {
  return JSON.stringify({ fetchedAt, rows: [{ symbol: "ETH-TEST/tUSDC", info: { marketId: "0xabc" } }] });
}

describe("registryCache KV tier - shared across instances", () => {
  const URL_KEY = "KV_REST_API_URL";
  const TOKEN_KEY = "KV_REST_API_TOKEN";
  let savedUrl: string | undefined;
  let savedToken: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearRegistryCache();
    state.impl.mockReset();
    state.impl.mockResolvedValue(fakeRows());
    savedUrl = process.env[URL_KEY];
    savedToken = process.env[TOKEN_KEY];
    process.env[URL_KEY] = "https://kv.example.upstash.io";
    process.env[TOKEN_KEY] = "test-token";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (savedUrl === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = savedUrl;
    if (savedToken === undefined) delete process.env[TOKEN_KEY];
    else process.env[TOKEN_KEY] = savedToken;
  });

  function kvResult(result: unknown): Response {
    return { ok: true, status: 200, json: () => Promise.resolve({ result }) } as unknown as Response;
  }

  it("serves a fresh KV hit without touching origin", async () => {
    fetchMock.mockResolvedValue(kvResult(kvEnvelope(Date.now())));
    const res = await getActiveMarketsCached({} as never);
    expect(state.impl).not.toHaveBeenCalled();
    expect(res.stale).toBe(false);
    expect(res.markets).toHaveLength(1);
  });

  it("flags a KV hit past the freshness window as stale", async () => {
    fetchMock.mockResolvedValue(kvResult(kvEnvelope(Date.now() - REGISTRY_CACHE_TTL_MS - 5_000)));
    const res = await getActiveMarketsCached({} as never);
    expect(state.impl).not.toHaveBeenCalled();
    expect(res.stale).toBe(true);
    expect(res.cacheAgeSec).toBeGreaterThan(0);
  });

  it("falls back to origin when KV fails", async () => {
    fetchMock.mockRejectedValue(new Error("KV down"));
    const res = await getActiveMarketsCached({} as never);
    expect(state.impl).toHaveBeenCalledTimes(1);
    expect(res.stale).toBe(false);
    expect(res.markets).toHaveLength(1);
  });
});
