/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/**
 * API Server — Fastify, minimal, well-typed. Keeps DreamDEX logic behind service modules
 * (routes call into src/analysis etc., no DreamDEX logic in routes).
 * Multi-bot reality: single instance for hackathon — :id is always "default"/"1", documented limitation.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerPositionRoutes } from "./routes/positions.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerStrategyRoutes } from "./routes/strategies.js";
import { registerBotRoutes } from "./routes/bots.js";
import { BotRunner } from "../bot/runner.js";
import { SNAPSHOT_CONFIG } from "../config.js";

// Single BotRunner for hackathon — :id always "default"
let globalRunner: BotRunner | null = null;

export function getRunner(): BotRunner {
  if (!globalRunner) {
    globalRunner = new BotRunner({ dbPath: SNAPSHOT_CONFIG.DB_PATH });
  }
  return globalRunner;
}

export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: true });

  // Health
  fastify.get("/health", async () => ({ status: "ok", dataIntegrity: "DERIVED" as const, timestamp: new Date().toISOString() }));

  await registerMarketRoutes(fastify);
  await registerPositionRoutes(fastify);
  await registerOrderRoutes(fastify);
  await registerStrategyRoutes(fastify);
  await registerBotRoutes(fastify);

  return fastify;
}

export async function startServer(port = Number(process.env.PORT ?? 3000), host = "0.0.0.0"): Promise<void> {
  const server = await buildServer();
  await server.listen({ port, host });
  console.log(`[API] listening on http://${host}:${port}`);
}

// Executable entry — `npm run api` (tsx src/api/server.ts)
if (process.argv[1]?.endsWith("server.ts")) {
  startServer().catch((err: Error) => {
    console.error(`[API] failed to start: ${err.message}`);
    process.exit(1);
  });
}
