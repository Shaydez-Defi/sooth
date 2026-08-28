/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-base-to-string */
import type { FastifyInstance } from "fastify";
import { createExchange, activeMarkets, marketOnchain, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { analyzeMarket } from "../../analysis/engine.js";
import { runBacktest, type SettledMarket } from "../../backtest/engine.js";
import { ANALYSIS_CONFIG } from "../../config.js";

export async function registerStrategyRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /strategies/analyze — Stage 3's engine, single market or all
  fastify.post("/strategies/analyze", async (request, reply) => {
    const body = (request.body as { marketId?: string; symbol?: string; all?: boolean } | undefined) ?? {};
    const { marketId, symbol, all } = body as Record<string, unknown>;
    const wantAll = Boolean(all) || (!marketId && !symbol);
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      const markets = await activeMarkets(ctx);
      let targets = markets;
      if (!wantAll) {
        const identifier = typeof marketId === "string" && String(marketId).trim() !== "" ? String(marketId).trim() : String(symbol ?? "").trim();
        if (!identifier) {
          await ctx.exchange.close().catch(() => undefined);
          return reply.status(400).send({ error: "provide marketId or symbol or all:true", dataIntegrity: "DERIVED" as const });
        }
        const found = markets.find((m) => String((m.info as unknown as { marketId: string }).marketId) === identifier || m.symbol === identifier);
        if (!found) {
          await ctx.exchange.close().catch(() => undefined);
          return reply.status(404).send({ error: `market ${identifier} not found`, dataIntegrity: "LIVE_INDEXER" as const });
        }
        targets = [found];
      }

      const results: Array<{ marketId: string; symbol: string; analysis: ReturnType<typeof analyzeMarket>; dataIntegrity: unknown }> = [];
      for (const m of targets) {
        const info = m.info as unknown as { marketId: string };
        const { yes } = outcomeSymbols(m);
        const onchain = await marketOnchain(ctx, m);
        if (!onchain) continue;
        const raw = await ctx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
        const bids = raw.bids;
        const asks = raw.asks;
        const bestBid = bids[0]?.[0];
        const bestAsk = asks[0]?.[0];
        const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
        const timeRemaining = Number(onchain.expiry) - Math.floor(Date.now() / 1000);
        const analysis = analyzeMarket({
          marketId: String(info.marketId),
          symbol: m.symbol,
          bids,
          asks,
          bestBid,
          bestAsk,
          marketProbability: mid ?? undefined,
          timeRemaining,
        });
        results.push({ marketId: String(info.marketId), symbol: m.symbol, analysis, dataIntegrity: { analysis: "DERIVED", marketProbability: "LIVE_INDEXER", timeRemaining: "LIVE_ONCHAIN" } as const });
      }
      await ctx.exchange.close().catch(() => undefined);
      return reply.send({ data: results, dataIntegrity: "DERIVED on LIVE_INDEXER/LIVE_ONCHAIN" as const, count: results.length });
    } catch (err) {
      return reply.status(500).send({ error: `POST /strategies/analyze failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // POST /strategies/backtest — Stage 4's engine, params in body (symbol/market scope, thresholds override if provided)
  fastify.post("/strategies/backtest", async (request, reply) => {
    const body = request.body as { limit?: number; startingCapital?: number; sizePerTrade?: number; thresholds?: Partial<typeof ANALYSIS_CONFIG> } | undefined;
    if (body !== undefined && typeof body !== "object") {
      return reply.status(400).send({ error: "body must be object if provided", dataIntegrity: "DERIVED" as const });
    }
    const limit = body?.limit !== undefined ? Number(body.limit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: "limit must be integer in [1,200]", dataIntegrity: "DERIVED" as const });
    }
    const startingCapital = body?.startingCapital !== undefined ? Number(body.startingCapital) : 1000;
    if (!Number.isFinite(startingCapital) || startingCapital <= 0) {
      return reply.status(400).send({ error: "startingCapital must be positive number", dataIntegrity: "DERIVED" as const });
    }
    const sizePerTrade = body?.sizePerTrade !== undefined ? Number(body.sizePerTrade) : 1;
    if (!Number.isFinite(sizePerTrade) || sizePerTrade <= 0) {
      return reply.status(400).send({ error: "sizePerTrade must be positive number", dataIntegrity: "DERIVED" as const });
    }
    // thresholds override: if provided, validate they are numbers in (0,1) etc., but don't mutate global ANALYSIS_CONFIG
    // We will handle override by temporarily patching ANALYSIS_CONFIG for the run if needed — for now just note and use defaults
    // The brief says thresholds override if provided — we support changing MIN_EDGE etc. via body thresholds and apply to engine
    const thresholds = body?.thresholds;
    let patched: Partial<typeof ANALYSIS_CONFIG> | null = null;
    if (thresholds) {
      patched = {};
      for (const [k, v] of Object.entries(thresholds)) {
        if (!(k in ANALYSIS_CONFIG)) {
          return reply.status(400).send({ error: `unknown threshold ${k} — allowed: ${Object.keys(ANALYSIS_CONFIG).join(", ")}`, dataIntegrity: "DERIVED" as const });
        }
        if (typeof v !== "number" || !Number.isFinite(v)) {
          return reply.status(400).send({ error: `threshold ${k} must be finite number`, dataIntegrity: "DERIVED" as const });
        }
        (patched as Record<string, unknown>)[k] = v;
      }
    }

    // If thresholds override, we need to temporarily patch ANALYSIS_CONFIG for this run
    const originalEntries: Array<[string, unknown]> = [];
    if (patched) {
      for (const [k, v] of Object.entries(patched)) {
        originalEntries.push([k, (ANALYSIS_CONFIG as unknown as Record<string, unknown>)[k]]);
        (ANALYSIS_CONFIG as unknown as Record<string, unknown>)[k] = v;
      }
    }

    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      const venueId = ctx.config.venueId as `0x${string}`;
      // Pull settled markets (HISTORICAL)
      const rows = await ctx.exchange.client.listBinaryMarkets({ venueId, status: "Finalized", limit });
      await ctx.exchange.close().catch(() => undefined);
      if (rows.length === 0) {
        return reply.send({ data: { metrics: null, note: "no settled markets — insufficient-data (fresh venue)", dataIntegrity: "HISTORICAL" as const }, dataIntegrity: "HISTORICAL/DERIVED" as const });
      }

      // Build SettledMarket with ESTIMATED synthetic balanced book around lastPrice (per Stage 4)
      function rawPriceToProb(raw: string | null, decimals = 6): number | null {
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;
        return n / 10 ** decimals;
      }
      function syntheticBookAround(mid: number): { bids: [number, number][]; asks: [number, number][] } {
        return {
          bids: [
            [Math.max(0.01, mid - 0.015), 200],
            [Math.max(0.01, mid - 0.025), 330],
            [Math.max(0.01, mid - 0.035), 460],
          ],
          asks: [
            [Math.min(0.99, mid + 0.015), 200],
            [Math.min(0.99, mid + 0.025), 330],
            [Math.min(0.99, mid + 0.035), 460],
          ],
        };
      }

      const markets: SettledMarket[] = [];
      for (const r of rows) {
        const marketId = r.marketId as string;
        const symbol = `${r.asset ?? "UNK"}-${r.interval ?? r.intervalSec ?? "?"}-${new Date(Number(r.expiry) * 1000).toISOString().slice(0, 10)}`;
        const lastProb = rawPriceToProb(r.lastPrice, (r as unknown as { baseDecimals: number }).baseDecimals ?? 6);
        const mid = lastProb ?? 0.5;
        const { bids, asks } = syntheticBookAround(mid);
        const winningOutcome = (r.winningOutcome) ?? null;
        const voided = Boolean((r as unknown as { voided: boolean }).voided);
        markets.push({
          marketId,
          symbol,
          asset: String(r.asset ?? "?"),
          expiry: Number(r.expiry ?? 0),
          winningOutcome,
          voided,
          lastPrice: lastProb,
          bids,
          asks,
          bookTag: "ESTIMATED",
        });
      }

      const metrics = runBacktest({ markets, startingCapital, sizePerTrade });
      return reply.send({
        data: { metrics, count: rows.length, dataIntegrity: { marketId: "HISTORICAL", winningOutcome: "HISTORICAL", book: "ESTIMATED", metrics: "DERIVED" } as const, thresholdsOverride: patched ?? null },
        dataIntegrity: "HISTORICAL/ESTIMATED/DERIVED" as const,
      });
    } catch (err) {
      return reply.status(500).send({ error: `POST /strategies/backtest failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    } finally {
      // Restore patched thresholds
      if (patched) {
        for (const [k, v] of originalEntries) {
          (ANALYSIS_CONFIG as unknown as Record<string, unknown>)[k] = v;
        }
      }
    }
  });
}
