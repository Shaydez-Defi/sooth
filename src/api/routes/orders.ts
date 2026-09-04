/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion */
import type { FastifyInstance } from "fastify";
import { createExchange, activeMarkets, marketOnchain, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { findMarketById } from "../registryCache.js";
import { placeRestingOrder, cancelOrderLifecycle, createOrderState, readBalancesTagged } from "../../ec/orderLifecycle.js";
import { checkOrder } from "../../risk/riskEngine.js";
import { openSnapshotDb, getBotPositions, getTotalRealizedPnL } from "../../snapshots/db.js";
import { SNAPSHOT_CONFIG, BOT_CONFIG } from "../../config.js";
import type { StrategyDecision } from "../../strategy/types.js";

export async function registerOrderRoutes(fastify: FastifyInstance): Promise<void> {
  const orderState = createOrderState();

  // POST /orders - manual order placement, MUST pass through riskEngine.checkOrder first
  fastify.post("/orders", async (request, reply) => {
    const body = request.body as { marketId?: string; symbol?: string; side?: string; price?: number; size?: number } | undefined;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "body required: { marketId or symbol, side YES|NO, price in (0,1), size }", dataIntegrity: "DERIVED" as const });
    }
    const { marketId, symbol, side, price, size } = body as Record<string, unknown>;
    const sideNorm = typeof side === "string" ? side.toUpperCase() : "";
    if (sideNorm !== "YES" && sideNorm !== "NO") {
      return reply.status(400).send({ error: "side must be YES or NO", dataIntegrity: "DERIVED" as const });
    }
    if (typeof price !== "number" || !(price > 0 && price < 1)) {
      return reply.status(400).send({ error: "price must be number in (0,1) probability", dataIntegrity: "DERIVED" as const });
    }
    if (typeof size !== "number" || !(size > 0) || !Number.isFinite(size)) {
      return reply.status(400).send({ error: "size must be positive finite number", dataIntegrity: "DERIVED" as const });
    }
    const identifier = typeof marketId === "string" && marketId.trim() !== "" ? String(marketId).trim() : typeof symbol === "string" ? String(symbol).trim() : "";
    if (!identifier) {
      return reply.status(400).send({ error: "marketId or symbol required", dataIntegrity: "DERIVED" as const });
    }

    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: true });
      if (!ctx.canTrade) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(400).send({ error: "PRIVATE_KEY required for POST /orders", dataIntegrity: "DERIVED" as const });
      }
      const markets = await activeMarkets(ctx);
      const found = findMarketById(markets, identifier);
      if (!found) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(404).send({ error: `market ${identifier} not found among active markets`, dataIntegrity: "LIVE_INDEXER" as const });
      }
      const onchain = await marketOnchain(ctx, found);
      if (!onchain) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(404).send({ error: `market ${identifier} onchain not found`, dataIntegrity: "LIVE_ONCHAIN" as const });
      }
      const { yes } = outcomeSymbols(found);
      // Build a StrategyDecision-shaped object for risk check (manual order is user-initiated, not bot, but MUST still pass risk)
      const decision: StrategyDecision = {
        action: "PLACE_ORDER",
        side: sideNorm,
        price,
        size,
        reasons: [`manual POST /orders for ${found.symbol} ${sideNorm} ${price} x${size}`],
      };

      // Risk check - MUST not skip, document that manual orders don't bypass risk
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const positions = getBotPositions(db).map((p) => ({ marketId: p.marketId, symbol: p.symbol, side: "YES" as const, size: p.netPosition }));
      const totalPnL = getTotalRealizedPnL(db);
      const currentLoss = totalPnL < 0 ? -totalPnL : 0;
      db.close();
      let balances: { nativeWei: bigint; tUsdcRaw: bigint } | undefined;
      try {
        const snap = await readBalancesTagged(ctx);
        balances = { nativeWei: snap.nativeWei, tUsdcRaw: snap.tUsdcRaw };
      } catch {
        balances = undefined;
      }
      // Build minimal MarketAnalysis for risk checks that need liquidity/spread/timeRemaining
      // For manual orders we still enforce those checks via analysis derived from current book
      let bookBids: [number, number][] = [];
      let bookAsks: [number, number][] = [];
      try {
        const raw = await ctx.exchange.fetchOrderBook(yes, 3);
        bookBids = raw.bids;
        bookAsks = raw.asks;
      } catch {
        // leave empty - risk will handle liquidity check
      }
      const bestBid = bookBids[0]?.[0];
      const bestAsk = bookAsks[0]?.[0];
      const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk ?? 0.5);
      const timeRemaining = Number(onchain.expiry) - Math.floor(Date.now() / 1000);
      const liquidity = bookBids.slice(0, 3).reduce((s, [, q]) => s + q, 0) + bookAsks.slice(0, 3).reduce((s, [, q]) => s + q, 0);
      const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : 0;
      const spreadBps = mid > 0 ? (spread / mid) * 10000 : 0;
      const analysis = {
        marketId: String((found.info as unknown as { marketId: string }).marketId),
        symbol: found.symbol,
        direction: sideNorm as "YES" | "NO",
        marketProbability: mid,
        estimatedProbability: mid,
        edge: 0,
        liquidity,
        spread,
        spreadBps,
        timeRemaining,
        signalStrength: 0,
        recommendation: "TRADE" as const,
        reasons: [`manual order - book mid ${mid.toFixed(4)}`],
        imbalance: 0,
      };

      const risk = checkOrder(decision, {
        config: {
          enabled: BOT_CONFIG.ENABLED,
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
        },
        openPositions: positions,
        currentLoss,
        balances,
        analysis: analysis,
      });

      if (!risk.approved) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(400).send({
          error: "manual order rejected by risk engine (risk checks are NOT bypassed for POST /orders)",
          dataIntegrity: "DERIVED" as const,
          risk: { approved: false, rejectionReasons: risk.rejectionReasons },
          note: "POST /orders routes through Stage 2 orderLifecycle directly (user-initiated, not bot) but MUST still pass riskEngine.checkOrder first - documented here",
        });
      }

      // Only then → Stage 2's orderLifecycle
      const info = found.info as unknown as { marketId: string };
      const result = await placeRestingOrder({
        ctx,
        market: found,
        onchain,
        outcome: sideNorm,
        side: "buy",
        price,
        size,
        yesSymbol: yes,
        state: orderState,
      });
      await ctx.exchange.close().catch(() => undefined);
      return reply.status(201).send({
        data: { txHash: result.txHash, blockNumber: String(result.blockNumber), orderId: String(result.orderId ?? ""), price: result.price, size: result.size, symbol: found.symbol, marketId: String(info.marketId) },
        dataIntegrity: { txHash: "LIVE_ONCHAIN", blockNumber: "LIVE_ONCHAIN", orderId: "LIVE_ONCHAIN", price: "DERIVED", size: "DERIVED" } as const,
        risk: { approved: true, rejectionReasons: [] },
      });
    } catch (err) {
      return reply.status(500).send({ error: `POST /orders failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // POST /orders/:id/cancel - Stage 2's cancel path
  fastify.post("/orders/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { marketId?: string; symbol?: string } | undefined;
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "order id required", dataIntegrity: "DERIVED" as const });
    }
    let orderIdBig: bigint;
    try {
      orderIdBig = BigInt(id);
    } catch {
      return reply.status(400).send({ error: "order id must be bigint string", dataIntegrity: "DERIVED" as const });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: true });
      if (!ctx.canTrade) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(400).send({ error: "PRIVATE_KEY required for cancel", dataIntegrity: "DERIVED" as const });
      }
      // Need market for cancel - resolve via body marketId/symbol or search all
      let found: import("@somnia-chain/markets-sdk").UnifiedMarket | undefined;
      let onchain: import("@somnia-chain/markets-sdk").MarketOnchain | null = null;
      const identifier = body?.marketId ?? body?.symbol;
      if (typeof identifier === "string" && identifier.trim() !== "") {
        const markets = await activeMarkets(ctx);
        found = markets.find((m) => String((m.info as unknown as { marketId: string }).marketId) === identifier || m.symbol === identifier);
        if (found) onchain = await marketOnchain(ctx, found);
      } else {
        // Try find by scanning all active markets for orderId in open orders
        const markets = await activeMarkets(ctx);
        for (const m of markets) {
          const { yes } = outcomeSymbols(m);
          try {
            const orders = await ctx.exchange.fetchOpenOrders(yes);
            if (orders.some((o) => String((o as unknown as { id: string | number | bigint }).id) === String(orderIdBig))) {
              found = m;
              onchain = await marketOnchain(ctx, m);
              break;
            }
          } catch {
            // continue
          }
        }
      }
      if (!found || !onchain) {
        await ctx.exchange.close().catch(() => undefined);
        return reply.status(404).send({ error: `market for order ${id} not found (provide marketId/symbol in body)`, dataIntegrity: "LIVE_INDEXER" as const });
      }
      const { yes } = outcomeSymbols(found);
      const result = await cancelOrderLifecycle({ ctx, onchain, orderId: orderIdBig, yesSymbol: yes, state: orderState });
      await ctx.exchange.close().catch(() => undefined);
      return reply.send({
        data: { txHash: result.txHash, blockNumber: String(result.blockNumber), orderId: String(result.orderId), stillOpen: result.stillOpen },
        dataIntegrity: { txHash: "LIVE_ONCHAIN", blockNumber: "LIVE_ONCHAIN", orderId: "LIVE_ONCHAIN" } as const,
      });
    } catch (err) {
      return reply.status(500).send({ error: `POST /orders/:id/cancel failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });
}
