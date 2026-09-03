import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { kvConfigured, kvGet, kvSet } from "./kvStore.js";

const URL_KEY = "KV_REST_API_URL";
const TOKEN_KEY = "KV_REST_API_TOKEN";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as unknown as Response;
}

describe("kvStore - Upstash REST over fetch", () => {
  let savedUrl: string | undefined;
  let savedToken: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedUrl = process.env[URL_KEY];
    savedToken = process.env[TOKEN_KEY];
    process.env[URL_KEY] = "https://kv.example.upstash.io";
    process.env[TOKEN_KEY] = "test-token";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedUrl === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = savedUrl;
    if (savedToken === undefined) delete process.env[TOKEN_KEY];
    else process.env[TOKEN_KEY] = savedToken;
  });

  it("kvConfigured is true only with both env vars", () => {
    expect(kvConfigured()).toBe(true);
    delete process.env[TOKEN_KEY];
    expect(kvConfigured()).toBe(false);
  });

  it("kvGet returns the stored string", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: "hello" }));
    await expect(kvGet("k")).resolves.toBe("hello");
  });

  it("kvGet returns null on miss", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: null }));
    await expect(kvGet("missing")).resolves.toBeNull();
  });

  it("kvGet throws on upstream error payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: null, error: "READONLY" }));
    await expect(kvGet("k")).rejects.toThrow("READONLY");
  });

  it("kvGet throws on HTTP failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false));
    await expect(kvGet("k")).rejects.toThrow("HTTP 500");
  });

  it("kvSet posts SET with key, value and EX", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: "OK" }));
    await kvSet("k", "v", 600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [unknown, { headers?: Record<string, string>; body?: unknown }] | undefined;
    expect(call?.[0]).toBe("https://kv.example.upstash.io");
    expect(call?.[1].headers?.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(String(call?.[1].body)) as unknown).toEqual(["SET", "k", "v", "EX", 600]);
  });
});
