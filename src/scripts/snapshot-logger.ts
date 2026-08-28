/**
 * Snapshot logger — continuously polls live EC order-book snapshots for all live markets.
 * Read-only, no funds, no private key needed.
 *
 * Polls every SNAPSHOT_CONFIG.POLL_INTERVAL_MS (default 45_000 ms) — discover live markets
 * via activeMarkets (LIVE_INDEXER venue scoping), for each fetchOrderBook(yes, DEPTH_LEVELS)
 * (LIVE_INDEXER, same depth as live analysis engine), compute bidDepth/askDepth/imbalance
 * via Stage 3's exact functions (src/snapshots/compute.ts reusing ANALYSIS_CONFIG.DEPTH_LEVELS),
 * insert a row per market per poll into SQLite snapshots.db (zero external service).
 *
 * Per-market fetch failure is skipped gracefully (log + continue), don't crash whole loop.
 * Logs each poll cycle to stdout with timestamp + market count for tail visibility.
 * Handles SIGINT/SIGTERM clean shutdown (close DB handle + exchange).
 *
 * Tags: LIVE_INDEXER (book levels/mid), DERIVED (depth/imbalance), LIVE_ONCHAIN (blockNumber/marketId)
 */
import { createExchange, activeMarkets, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { ANALYSIS_CONFIG, SNAPSHOT_CONFIG } from "../config.js";
import { openSnapshotDb, insertSnapshot } from "../snapshots/db.js";
import { computeDepthImbalance } from "../snapshots/compute.js";

const POLL_INTERVAL_MS = SNAPSHOT_CONFIG.POLL_INTERVAL_MS; // DERIVED config, not magic
const DEPTH_LEVELS = ANALYSIS_CONFIG.DEPTH_LEVELS; // DERIVED config, same as live engine
const DB_PATH = SNAPSHOT_CONFIG.DB_PATH; // DERIVED config

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log("=== Sooth Snapshot Logger — Continuous order-book capture ===\n");
  console.log(`Config: DEPTH_LEVELS=${DEPTH_LEVELS} (top N levels, same as live engine), POLL_INTERVAL_MS=${POLL_INTERVAL_MS} (~${(POLL_INTERVAL_MS / 1000).toFixed(0)}s), DB_PATH=${DB_PATH}`);
  console.log("Tags: LIVE_INDEXER (bidLevels/askLevels/mid), DERIVED (bidDepth/askDepth/imbalance), LIVE_ONCHAIN (blockNumber/marketId)");
  console.log("Mode: read-only, no funds, no private key needed — will run unattended in Codespace\n");

  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
    process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
  }

  const db = openSnapshotDb(DB_PATH);
  console.log(`[DB] opened ${DB_PATH} — table snapshots ready (WAL mode)`);

  const ctx = createExchange({ withSigner: false });
  console.log(`[EC] exchange created — network=${ctx.config.network} venue=${ctx.config.venueId ?? "(inferred)"} indexer=${ctx.config.indexerUrl}`);

  let shuttingDown = false;
  let pollCount = 0;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${new Date().toISOString()}] received ${signal} — shutting down gracefully...`);
    try {
      db.close();
      console.log("[DB] closed handle");
    } catch (err) {
      console.error(`[WARN] db.close failed: ${(err as Error).message}`);
    }
    try {
      await Promise.race([
        ctx.exchange.close().catch((e: unknown) => {
          console.error(`[WARN] exchange.close failed: ${(e as Error).message}`);
        }),
        new Promise<void>((r) => setTimeout(r, 3000)),
      ]);
      console.log("[EC] exchange closed");
    } catch (err) {
      console.error(`[WARN] shutdown exchange failed: ${(err as Error).message}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Poll loop — runs until SIGINT/SIGTERM
  while (!shuttingDown) {
    pollCount += 1;
    const cycleStartIso = new Date().toISOString();
    const capturedAtUnix = Math.floor(Date.now() / 1000);
    const capturedAtIso = new Date().toISOString();

    // LIVE_ONCHAIN — blockNumber once per cycle for all rows in this poll
    let blockNumber: number | null = null;
    try {
      const bn = await ctx.exchange.client.getViemClient().getBlockNumber();
      blockNumber = Number(bn);
      if (!Number.isFinite(blockNumber)) blockNumber = null;
    } catch (err) {
      console.error(`[WARN] getBlockNumber failed (cycle ${pollCount}): ${(err as Error).message} — continuing with null blockNumber`);
      blockNumber = null;
    }

    // LIVE_INDEXER — discover live markets (venue-scoped via ec-core activeMarkets)
    let markets: Awaited<ReturnType<typeof activeMarkets>>;
    try {
      markets = await activeMarkets(ctx);
    } catch (err) {
      console.error(`[${cycleStartIso}] poll #${pollCount} activeMarkets failed: ${(err as Error).message} — retry next cycle`);
      console.error((err as Error).stack);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(`[${cycleStartIso}] poll #${pollCount} — ${markets.length} live market(s), block=${blockNumber ?? "—"}, depth=${DEPTH_LEVELS}, interval=${POLL_INTERVAL_MS}ms`);

    if (markets.length === 0) {
      console.log(`[${cycleStartIso}] poll #${pollCount} — no live markets (markets expire on schedule) — waiting ${POLL_INTERVAL_MS}ms`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    let inserted = 0;
    let skipped = 0;

    for (const m of markets) {
      const info = m.info as unknown as { marketId: string };
      const marketId = String(info.marketId ?? m.symbol);
      const symbol = m.symbol;
      const { yes } = outcomeSymbols(m);

      // LIVE_INDEXER — fetch YES book at DEPTH_LEVELS (same depth as live analysis engine)
      let bids: [number, number][];
      let asks: [number, number][];
      try {
        const raw = await ctx.exchange.fetchOrderBook(yes, DEPTH_LEVELS);
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        bids = raw.bids as [number, number][];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        asks = raw.asks as [number, number][];
      } catch (err) {
        console.error(`[WARN] poll #${pollCount} fetchOrderBook failed for ${symbol} (${yes}): ${(err as Error).message} — skipping this market, continuing`);
        skipped += 1;
        continue;
      }

      // DERIVED — reuse Stage 3's exact functions (src/snapshots/compute.ts) — don't reimplement
      const { bidDepth, askDepth, imbalance, mid } = computeDepthImbalance(bids, asks);

      // Store exactly DEPTH_LEVELS levels (top N) as used for depth calculation
      const bidLevels = bids.slice(0, DEPTH_LEVELS);
      const askLevels = asks.slice(0, DEPTH_LEVELS);

      try {
        insertSnapshot(db, {
          marketId,
          symbol,
          capturedAtUnix,
          capturedAtIso,
          bidLevels,
          askLevels,
          mid,
          bidDepth,
          askDepth,
          imbalance,
          blockNumber,
        });
        inserted += 1;
        console.log(
          `  [LIVE_INDEXER] ${symbol} mid=${mid !== null ? mid.toFixed(4) : "—"} bidDepth=${bidDepth.toFixed(2)} askDepth=${askDepth.toFixed(2)} imbalance=${imbalance.toFixed(4)} block=${blockNumber ?? "—"} → inserted`,
        );
      } catch (err) {
        console.error(`[WARN] poll #${pollCount} insertSnapshot failed for ${symbol}: ${(err as Error).message} — skipping`);
        console.error((err as Error).stack);
        skipped += 1;
        continue;
      }
    }

    console.log(`[${new Date().toISOString()}] poll #${pollCount} done — inserted ${inserted}/${markets.length} (skipped ${skipped}), next in ${POLL_INTERVAL_MS}ms\n`);

    if (shuttingDown) break;
    await sleep(POLL_INTERVAL_MS);
  }

  // Fallback close if loop exits without signal
  try {
    db.close();
  } catch (err) {
    console.error(`[WARN] db.close on exit: ${(err as Error).message}`);
  }
  await Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] snapshot-logger failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
