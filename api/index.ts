/**
 * Vercel serverless entry - reuses the Fastify app from src/api/server.ts.
 * No app.listen here (serverless); the platform invokes the handler per request.
 * NOTE: hobby execution caps apply (10s) - indexer-heavy endpoints can 504 while
 * the upstream indexer is slow. An always-on host has no such cap.
 *
 * Deploy note: bundled locally to api/index.js (npm run bundle:api). Only the
 * TS sources (this file, src/, vendor TS) are compiled in - every node_modules
 * package stays external and resolves at runtime. Only api/index.js is uploaded
 * (see .vercelignore).
 */
import { buildServer } from "../src/api/server.js";
import type { IncomingMessage, ServerResponse } from "node:http";

type FastifyApp = Awaited<ReturnType<typeof buildServer>>;

let app: FastifyApp | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!app) {
    app = await buildServer();
    await app.ready();
  }
  // Single-project routing serves the API under /api/* - strip the prefix
  // so Fastify sees its native routes (/health, /markets, ...).
  if (typeof req.url === "string" && req.url.startsWith("/api")) {
    req.url = req.url.slice("/api".length) || "/";
  }
  app.server.emit("request", req, res);
}
