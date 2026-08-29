/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import type { FastifyInstance } from "fastify";
import { getRunner } from "../server.js";
import { computeEdgeAnalytics } from "../../analytics/edge.js";
import { openSnapshotDb } from "../../snapshots/db.js";
import { SNAPSHOT_CONFIG } from "../../config.js";

// Multi-bot reality check (brief Step 3):
// Stage 6's BotRunner was built as a single instance. For hackathon we confirm single-bot is acceptable
// and API models :id as always "default"/"1". This endpoint documents that limitation explicitly —
// it does NOT fake multi-bot support. If time allows we could extend to Map<id, BotRunner> but for now
// every :id that is not "default" returns 404 with this note.

const SINGLE_BOT_ID = "default";
const ALLOWED_IDS = new Set([SINGLE_BOT_ID, "1", "default-1"]);

function serializeConfig(cfg: import("../../bot/config.js").PersistedBotConfig): unknown {
  return {
    ...cfg,
    bot: {
      ...cfg.bot,
      minNativeWei: String(cfg.bot.minNativeWei),
      minCollateralRaw: String(cfg.bot.minCollateralRaw),
    },
  };
}

function validateBotId(id: string, reply: import("fastify").FastifyReply): boolean {
  if (ALLOWED_IDS.has(id) || id === SINGLE_BOT_ID) return true;
  void reply.status(404).send({
    error: `bot ${id} not found — single-bot-for-hackathon limitation: only id "${SINGLE_BOT_ID}" (or "1") is supported. Runner is a single instance (see docs/stage6-verification.md). Multi-bot would require Map<id,BotRunner> but is not yet implemented.`,
    dataIntegrity: "DERIVED" as const,
    knownLimitation: "single-bot-for-hackathon, :id is always default/1",
  });
  return false;
}

export async function registerBotRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /bots — list persisted bot configs/status (single)
  fastify.get("/bots", async (_request, reply) => {
    try {
      const runner = getRunner();
      const cfg = runner.getConfig();
      const status = runner.status();
      const tickCount = runner.getTickCount();
      return reply.send({
        data: [{ id: SINGLE_BOT_ID, config: serializeConfig(cfg), status, tickCount, dataIntegrity: { config: "DERIVED (persisted)", status: "DERIVED", tickCount: "DERIVED" } as const }],
        dataIntegrity: "DERIVED" as const,
        note: "single-bot-for-hackathon: :id is always default/1 (see knownLimitation)",
        knownLimitation: "single-bot-for-hackathon, runner is single instance",
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /bots failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // POST /bots — create a bot config (persist, don't auto-start)
  fastify.post("/bots", async (request, reply) => {
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    // Basic validation
    if (body !== null && typeof body !== "object") {
      return reply.status(400).send({ error: "body must be object", dataIntegrity: "DERIVED" as const });
    }
    try {
      const runner = getRunner();
      // Allow patching marketScope, label, loopIntervalMs, midMoveThreshold, bot.enabled etc.
      const patch: Record<string, unknown> = {};
      if (typeof body.marketScope === "string") patch.marketScope = String(body.marketScope);
      if (typeof body.label === "string") patch.label = String(body.label);
      if (typeof body.loopIntervalMs === "number") {
        if (!Number.isFinite(body.loopIntervalMs) || body.loopIntervalMs < 5000) {
          return reply.status(400).send({ error: "loopIntervalMs must be number >=5000", dataIntegrity: "DERIVED" as const });
        }
        patch.loopIntervalMs = body.loopIntervalMs;
      }
      if (typeof body.midMoveThreshold === "number") {
        if (!Number.isFinite(body.midMoveThreshold) || body.midMoveThreshold <= 0 || body.midMoveThreshold >= 1) {
          return reply.status(400).send({ error: "midMoveThreshold must be in (0,1)", dataIntegrity: "DERIVED" as const });
        }
        patch.midMoveThreshold = body.midMoveThreshold;
      }
      if (body.bot !== undefined) {
        if (typeof body.bot !== "object" || body.bot === null) {
          return reply.status(400).send({ error: "bot must be object", dataIntegrity: "DERIVED" as const });
        }
        patch.bot = body.bot;
      }
      const updated = runner.updateConfig(patch);
      return reply.status(201).send({ data: { id: SINGLE_BOT_ID, config: serializeConfig(updated) }, dataIntegrity: "DERIVED" as const });
    } catch (err) {
      return reply.status(500).send({ error: `POST /bots failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // PATCH /bots/:id — update config (Stage 6's updateConfig)
  fastify.patch("/bots/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!validateBotId(id, reply)) return;
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "body must be object with fields to patch", dataIntegrity: "DERIVED" as const });
    }
    try {
      const runner = getRunner();
      const patch: Record<string, unknown> = {};
      if (typeof body.marketScope === "string") patch.marketScope = String(body.marketScope);
      if (typeof body.label === "string") patch.label = String(body.label);
      if (typeof body.loopIntervalMs === "number") {
        if (!Number.isFinite(body.loopIntervalMs) || body.loopIntervalMs < 5000) {
          return reply.status(400).send({ error: "loopIntervalMs must be >=5000", dataIntegrity: "DERIVED" as const });
        }
        patch.loopIntervalMs = body.loopIntervalMs;
      }
      if (typeof body.midMoveThreshold === "number") patch.midMoveThreshold = body.midMoveThreshold;
      if (body.bot !== undefined) patch.bot = body.bot;
      // Also allow enabled flag at top level for convenience
      if (typeof body.enabled === "boolean") {
        const cur = runner.getConfig();
        patch.bot = { ...cur.bot, enabled: body.enabled };
      }
      const updated = runner.updateConfig(patch);
      return reply.send({ data: { id: SINGLE_BOT_ID, config: serializeConfig(updated) }, dataIntegrity: "DERIVED" as const });
    } catch (err) {
      return reply.status(500).send({ error: `PATCH /bots/:id failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // POST /bots/:id/start — BotRunner.start()
  fastify.post("/bots/:id/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!validateBotId(id, reply)) return;
    try {
      const runner = getRunner();
      if (runner.status() === "running") {
        return reply.send({ data: { id: SINGLE_BOT_ID, status: "running", tickCount: runner.getTickCount() }, dataIntegrity: "DERIVED" as const, note: "already running" });
      }
      await runner.start({ withSigner: true });
      return reply.send({ data: { id: SINGLE_BOT_ID, status: runner.status(), tickCount: runner.getTickCount() }, dataIntegrity: "DERIVED" as const });
    } catch (err) {
      return reply.status(500).send({ error: `POST /bots/:id/start failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // POST /bots/:id/stop — BotRunner.stop()
  fastify.post("/bots/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!validateBotId(id, reply)) return;
    try {
      const runner = getRunner();
      if (runner.status() === "stopped") {
        return reply.send({ data: { id: SINGLE_BOT_ID, status: "stopped", tickCount: runner.getTickCount() }, dataIntegrity: "DERIVED" as const, note: "already stopped" });
      }
      await runner.stop("api stop");
      return reply.send({ data: { id: SINGLE_BOT_ID, status: runner.status(), tickCount: runner.getTickCount() }, dataIntegrity: "DERIVED" as const });
    } catch (err) {
      return reply.status(500).send({ error: `POST /bots/:id/stop failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // GET /bots/:id/performance — edge analytics, from REAL bot_fills/bot_positions
  fastify.get("/bots/:id/performance", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!validateBotId(id, reply)) return;
    try {
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const result = computeEdgeAnalytics(db);
      db.close();
      // Edge analytics tags per spec
      return reply.send({ data: result, dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", snapshots: "HISTORICAL", computed: "DERIVED" } as const });
    } catch (err) {
      return reply.status(500).send({ error: `GET /bots/:id/performance failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });

  // GET /bots/:id/events — bot_events table, paginated, filterable by eventType
  fastify.get("/bots/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!validateBotId(id, reply)) return;
    const query = request.query as { limit?: string; offset?: string; eventType?: string };
    const limit = query.limit ? Number(query.limit) : 50;
    const offset = query.offset ? Number(query.offset) : 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: "limit must be integer 1..200", dataIntegrity: "DERIVED" as const });
    }
    if (!Number.isInteger(offset) || offset < 0) {
      return reply.status(400).send({ error: "offset must be integer >=0", dataIntegrity: "DERIVED" as const });
    }
    try {
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      let rows: Array<{ id: number; createdAtUnix: number; createdAtIso: string; marketId: string | null; symbol: string | null; eventType: string; data: string; blockNumber: number | null }>;
      let total: number;
      if (query.eventType) {
        rows = db.prepare("SELECT * FROM bot_events WHERE eventType=? ORDER BY id DESC LIMIT ? OFFSET ?").all(query.eventType, limit, offset) as typeof rows;
        const c = db.prepare("SELECT COUNT(*) as c FROM bot_events WHERE eventType=?").get(query.eventType) as { c: number };
        total = c.c;
      } else {
        rows = db.prepare("SELECT * FROM bot_events ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset) as typeof rows;
        const c = db.prepare("SELECT COUNT(*) as c FROM bot_events").get() as { c: number };
        total = c.c;
      }
      // Parse data JSON for response (but keep raw string also)
      const data = rows.map((r) => ({ ...r, dataJson: (() => { try { return JSON.parse(r.data); } catch { return r.data; } })() }));
      db.close();
      return reply.send({ data, pagination: { limit, offset, total }, dataIntegrity: "DERIVED (persisted bot_events)" as const });
    } catch (err) {
      return reply.status(500).send({ error: `GET /bots/:id/events failed: ${(err as Error).message}`, dataIntegrity: "DERIVED" as const });
    }
  });
}
