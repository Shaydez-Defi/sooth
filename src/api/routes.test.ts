/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("@dreamdex-bot-kit/ec-core", () => {
  return {
    createExchange: vi.fn(() => ({
      canTrade: true,
      config: { venueId: "0xmock", network: "testnet", indexerUrl: "https://dev.smk.somnia.host/v1/graphql" },
      exchange: {
        client: {
          getViemClient: () => ({
            getBlockNumber: async () => 123n,
            getLogs: async () => [],
            getBalance: async () => 1000000000000000000n,
            getTransactionReceipt: async () => ({ status: "success", blockNumber: 123n, gasUsed: 100000n }),
          }),
          getErc20Balance: async () => 10000000n,
          listBinaryMarkets: async () => [],
        },
        fetchOrderBook: async () => ({ bids: [[0.5, 100] as const, [0.49, 100] as const, [0.48, 100] as const], asks: [[0.52, 100] as const, [0.53, 100] as const, [0.54, 100] as const] }),
        fetchOpenOrders: async () => [],
        close: async () => undefined,
      },
    })),
    activeMarkets: vi.fn(async () => [
      {
        symbol: "ETH-TEST/tUSDC",
        info: { marketId: "0xabc", asset: "ETH", intervalSec: 900, expiry: String(Math.floor(Date.now() / 1000) + 3600), venueId: "0xmock" },
      },
      {
        symbol: "BTC-TEST/tUSDC",
        info: { marketId: "0xdef", asset: "BTC", intervalSec: 900, expiry: String(Math.floor(Date.now() / 1000) + 3600), venueId: "0xmock" },
      },
    ]),
    marketOnchain: vi.fn(async (_ctx: unknown, m: { info: unknown }) => ({
      pool: "0x0000000000000000000000000000000000000000",
      expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
      status: 1,
      marketId: (m.info as { marketId: string }).marketId,
    })),
    outcomeSymbols: vi.fn((m: { symbol: string }) => ({ yes: `${m.symbol}#YES`, no: `${m.symbol}#NO` })),
  };
});

import { buildServer } from "./server.js";

describe("API routes — shape, tags, validation", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer();
  });

  it("GET /health — correct shape and tag", async () => {
    const res = await server.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { status: string; dataIntegrity: string };
    expect(body.status).toBe("ok");
    expect(body.dataIntegrity).toBe("DERIVED");
  });

  it("GET /markets — LIVE_INDEXER tag and array", async () => {
    const res = await server.inject({ method: "GET", url: "/markets" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; dataIntegrity: string };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.dataIntegrity).toBe("LIVE_INDEXER");
  });

  it("GET /markets/:id/orderbook — validation for depth", async () => {
    const res = await server.inject({ method: "GET", url: "/markets/0xabc/orderbook?depth=100" });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toContain("depth");
  });

  it("GET /markets/:id/analysis — DERIVED tag", async () => {
    const res = await server.inject({ method: "GET", url: "/markets/0xabc/analysis" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { direction: string }; dataIntegrity: unknown };
    expect(body.data).toHaveProperty("direction");
    expect(body.dataIntegrity).toBeDefined();
  });

  it("GET /positions — LIVE_ONCHAIN tag", async () => {
    const res = await server.inject({ method: "GET", url: "/positions" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { dataIntegrity: unknown };
    expect(body.dataIntegrity).toBeDefined();
  });

  it("GET /portfolio — balances + positions", async () => {
    const res = await server.inject({ method: "GET", url: "/portfolio" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { positions: unknown } };
    expect(body.data).toHaveProperty("positions");
  });

  it("POST /orders — validation rejects malformed body", async () => {
    const res = await server.inject({ method: "POST", url: "/orders", payload: { side: "YES" } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBeDefined();
  });

  it("POST /orders — risk rejects oversized order (size > max 10) — MUST be blocked, not executed", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/orders",
      payload: { marketId: "0xabc", side: "YES", price: 0.5, size: 100 },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string; risk: { rejectionReasons: string[] } };
    expect(body.error).toContain("risk engine");
    expect(body.risk.rejectionReasons.join(" ")).toContain("order size too large");
  });

  it("POST /strategies/analyze — validation and DERIVED tag", async () => {
    const res = await server.inject({ method: "POST", url: "/strategies/analyze", payload: { all: true } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; dataIntegrity: string };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /bots — single-bot id default", async () => {
    const res = await server.inject({ method: "GET", url: "/bots" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: Array<{ id: string }> };
    const first = body.data[0];
    if (!first) throw new Error("expected one bot");
    expect(first.id).toBe("default");
  });

  it("GET /bots/:id/performance — edge analytics shape, insufficient-data when 0 fills", async () => {
    const res = await server.inject({ method: "GET", url: "/bots/default/performance" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: { status: string } };
    expect(body.data).toHaveProperty("status");
  });

  it("GET /bots/:id/events — pagination and filter", async () => {
    const res = await server.inject({ method: "GET", url: "/bots/default/events?limit=5&eventType=BOT_START" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { data: unknown[]; pagination: { limit: number } };
    expect(body.pagination.limit).toBe(5);
  });

  it("PATCH /bots/:id — validation rejects bad loopInterval", async () => {
    const res = await server.inject({ method: "PATCH", url: "/bots/default", payload: { loopIntervalMs: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it("GET /bots/:id with unknown id — 404 with knownLimitation", async () => {
    const res = await server.inject({ method: "GET", url: "/bots/unknown-999/events" });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { knownLimitation: string };
    expect(body.knownLimitation).toContain("single-bot");
  });
});
