/* eslint-disable @typescript-eslint/require-await */
import type { FastifyInstance } from "fastify";
import { createExchange, activeMarkets, marketOnchain, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { analyzeMarket } from "../../analysis/engine.js";
import { ANALYSIS_CONFIG } from "../../config.js";

/** Recursively convert BigInt values to strings so Fastify can serialize the payload. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}

export async function registerMarketRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /markets — activeMarkets, LIVE_INDEXER
  fastify.get("/markets", async (_request, reply) => {
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      const markets = await activeMarkets(ctx);
      const tagged = markets.map((m) => {
        const info = m.info as unknown as { marketId: string; asset?: string; intervalSec?: number; expiry?: number | string; venueId?: string };
        return {
          marketId: String(info.marketId), // LIVE_ONCHAIN
          symbol: m.symbol, // LIVE_INDEXER
          asset: String(info.asset ?? "?"), // LIVE_INDEXER
          expiry: info.expiry !== undefined ? String(info.expiry) : null, // LIVE_ONCHAIN
          venueId: String(info.venueId ?? ctx.config.venueId ?? ""), // LIVE_ONCHAIN
          dataIntegrity: { marketId: "LIVE_ONCHAIN", symbol: "LIVE_INDEXER", asset: "LIVE_INDEXER", expiry: "LIVE_ONCHAIN" } as const,
        };
      });
      await ctx.exchange.close().catch(() => undefined);
      return reply.send({ data: tagged, dataIntegrity: "LIVE_INDEXER" as const, count: tagged.length });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // GET /markets/:id — marketOnchain + indexer meta, LIVE_ONCHAIN + LIVE_INDEXER
  fastify.get("/markets/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "market id required", dataIntegrity: "DERIVED" as const });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      const markets = await activeMarkets(ctx);
      const found = markets.find((m) => String((m.info as unknown as { marketId: string }).marketId) === id || m.symbol === id);
      if (!found) {
        await ctx.exchange.close().catch(() => undefined);
        // Also try settled via listBinaryMarkets? For now return 404
        return reply.status(404).send({ error: `market ${id} not found among active markets`, dataIntegrity: "LIVE_INDEXER" as const });
      }
      const onchain = await marketOnchain(ctx, found);
      await ctx.exchange.close().catch(() => undefined);
      if (!onchain) {
        return reply.status(404).send({ error: `market ${id} onchain not found`, dataIntegrity: "LIVE_ONCHAIN" as const });
      }
      return reply.send({
        data: {
          unified: { symbol: found.symbol, info: found.info, dataIntegrity: "LIVE_INDEXER" as const },
          // onchain payload contains BigInts (expiry, pool params) — serialize to strings, don't 500
          onchain: { ...(jsonSafe(onchain) as Record<string, unknown>), dataIntegrity: "LIVE_ONCHAIN" as const },
        },
        dataIntegrity: "LIVE_INDEXER/LIVE_ONCHAIN" as const,
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets/:id failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // GET /markets/:id/orderbook — fetchOrderBook, tagged LIVE_INDEXER
  fastify.get("/markets/:id/orderbook", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { depth?: string };
    const depth = query.depth ? Number(query.depth) : ANALYSIS_CONFIG.DEPTH_LEVELS;
    if (Number.isNaN(depth) || depth < 1 || depth > 20) {
      return reply.status(400).send({ error: "depth must be integer in [1,20]", dataIntegrity: "DERIVED" as const });
    }
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "market id required", dataIntegrity: "DERIVED" as const });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      const markets = await activeMarkets(ctx);
      const found = markets.find((m) => String((m.info as unknown as { marketId: string }).marketId) === id || m.symbol === id);
      if (!found) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(404).send({ error: `market ${id} not found`, dataIntegrity: "LIVE_INDEXER" as const });
      }
      const { yes } = outcomeSymbols(found);
      const book = await ctx.exchange.fetchOrderBook(yes, depth);
      await ctx.exchange.close().catch(() => undefined);
      return reply.send({
        data: { marketId: String((found.info as unknown as { marketId: string }).marketId), symbol: found.symbol, yesSymbol: yes, bids: book.bids, asks: book.asks },
        dataIntegrity: { marketId: "LIVE_ONCHAIN", symbol: "LIVE_INDEXER", bids: "LIVE_INDEXER", asks: "LIVE_INDEXER" } as const,
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets/:id/orderbook failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // GET /markets/:id/analysis — Stage 3's analyzeMarket, live, DERIVED on LIVE_INDEXER/LIVE_ONCHAIN
  fastify.get("/markets/:id/analysis", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "market id required", dataIntegrity: "DERIVED" as const });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      const markets = await activeMarkets(ctx);
      const found = markets.find((m) => String((m.info as unknown as { marketId: string }).marketId) === id || m.symbol === id);
      if (!found) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(404).send({ error: `market ${id} not found`, dataIntegrity: "LIVE_INDEXER" as const });
      }
      const onchain = await marketOnchain(ctx, found);
      if (!onchain) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(404).send({ error: `market ${id} onchain not found`, dataIntegrity: "LIVE_ONCHAIN" as const });
      }
      const { yes } = outcomeSymbols(found);
      const raw = await ctx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
      const bids = raw.bids;
      const asks = raw.asks;
      const bestBid = bids[0]?.[0];
      const bestAsk = asks[0]?.[0];
      const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
      const timeRemaining = Number(onchain.expiry) - Math.floor(Date.now() / 1000);
      const info = found.info as unknown as { marketId: string };
      const analysis = analyzeMarket({
        marketId: String(info.marketId),
        symbol: found.symbol,
        bids,
        asks,
        bestBid,
        bestAsk,
        marketProbability: mid ?? undefined,
        timeRemaining,
      });
      await ctx.exchange.close().catch(() => undefined);
      return reply.send({ data: analysis, dataIntegrity: { analysis: "DERIVED", marketProbability: "LIVE_INDEXER", timeRemaining: "LIVE_ONCHAIN" } as const });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets/:id/analysis failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });
}
