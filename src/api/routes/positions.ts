/* eslint-disable @typescript-eslint/require-await */
import type { FastifyInstance } from "fastify";
import { createExchange, activeMarkets, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { openSnapshotDb, getBotPositions, getTotalRealizedPnL } from "../../snapshots/db.js";
import { SNAPSHOT_CONFIG } from "../../config.js";
import { readBalancesTagged } from "../../ec/orderLifecycle.js";

export async function registerPositionRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /positions — bot_positions table (real, LIVE_ONCHAIN derived)
  fastify.get("/positions", async (_request, reply) => {
    try {
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const positions = getBotPositions(db);
      const totalPnL = getTotalRealizedPnL(db);
      db.close();
      return reply.send({
        data: { positions, totalRealizedPnL: totalPnL, count: positions.length },
        dataIntegrity: { positions: "LIVE_ONCHAIN", totalRealizedPnL: "DERIVED" } as const,
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /positions failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // GET /orders — open orders (fetchOpenOrders or bot's tracked open orders), LIVE_ONCHAIN
  // NOTE: ec-core's fetchOpenOrders is authenticated (needs signer). We use withSigner:true when a
  // key is available (same pattern as /portfolio); without a key each market's error is reported
  // honestly per-market rather than fabricated as "no orders".
  fastify.get("/orders", async (_request, reply) => {
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const hasKey = Boolean(process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY);
      const ctx = createExchange({ withSigner: hasKey });
      const markets = await activeMarkets(ctx);
      const all: Array<{ marketId: string; symbol: string; yesSymbol: string; orders: unknown[]; dataIntegrity: string }> = [];
      for (const m of markets) {
        const { yes } = outcomeSymbols(m);
        const info = m.info as unknown as { marketId: string };
        try {
          const orders = await ctx.exchange.fetchOpenOrders(yes);
          all.push({ marketId: String(info.marketId), symbol: m.symbol, yesSymbol: yes, orders, dataIntegrity: "LIVE_ONCHAIN" });
        } catch (err) {
          all.push({ marketId: String(info.marketId), symbol: m.symbol, yesSymbol: yes, orders: [], dataIntegrity: `error: ${(err as Error).message}` });
        }
      }
      await ctx.exchange.close().catch(() => undefined);
      return reply.send({ data: all, dataIntegrity: "LIVE_ONCHAIN" as const });
    } catch (err) {
      return reply.status(500).send({ error: `GET /orders failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // GET /portfolio — aggregate: balances (LIVE_ONCHAIN) + positions + totalPnL (DERIVED)
  fastify.get("/portfolio", async (_request, reply) => {
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const positions = getBotPositions(db);
      const totalPnL = getTotalRealizedPnL(db);
      db.close();

      // Balances require private key, else report unavailable (honest)
      let balances: { nativeWei: string; tUsdcRaw: string; nativeHuman: number; tUsdcHuman: number; collateral: string; dataIntegrity: string } | null = null;
      let balancesDataIntegrity: string = "LIVE_ONCHAIN unavailable — no PRIVATE_KEY" as const;
      try {
        if (process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY) {
          const ctx = createExchange({ withSigner: true });
          const snap = await readBalancesTagged(ctx);
          balances = {
            nativeWei: String(snap.nativeWei),
            tUsdcRaw: String(snap.tUsdcRaw),
            nativeHuman: snap.nativeHuman,
            tUsdcHuman: snap.tUsdcHuman,
            collateral: snap.collateral,
            dataIntegrity: "LIVE_ONCHAIN",
          };
          balancesDataIntegrity = "LIVE_ONCHAIN";
          await ctx.exchange.close().catch(() => undefined);
        }
      } catch (err) {
        balances = null;
        balancesDataIntegrity = `LIVE_ONCHAIN error: ${(err as Error).message}`;
      }

      return reply.send({
        data: { balances, balancesDataIntegrity, positions, totalRealizedPnL: totalPnL, positionsCount: positions.length },
        dataIntegrity: { balances: balancesDataIntegrity, positions: "LIVE_ONCHAIN", totalRealizedPnL: "DERIVED" } as const,
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /portfolio failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });
}
