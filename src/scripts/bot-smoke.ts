/**
 * Supervised bot smoke - start real runner briefly, several cycles, then stop.
 * Uses real execution enabled (withSigner true), default config MIN_EDGE=0.02, no test loosening.
 * Expect mostly SKIP (balanced books) - that's correct behavior.
 * Logs every tick to bot_events (persisted) and to stdout.
 * Stops manually once, confirms status() reflects it and loop halts.
 */

import { BotRunner } from "../bot/runner.js";
import { SNAPSHOT_CONFIG } from "../config.js";

async function main(): Promise<void> {
  console.log("=== Sooth Bot Smoke - Supervised Real Run (several cycles, then stop) ===\n");
  console.log(`DB: ${SNAPSHOT_CONFIG.DB_PATH} - snapshots + bot tables (events/fills/positions/config)`);
  console.log("Config: default MIN_EDGE=0.02, loop 10s for smoke (override), real execution enabled, no loosening\n");

  const runner = new BotRunner();
  // Override loop interval to 10s for faster smoke (persisted)
  runner.updateConfig({ loopIntervalMs: 10_000 });

  console.log(`[SMOKE] status before start: ${runner.status()}`);
  await runner.start({ withSigner: true, loopIntervalMs: 10_000 });
  console.log(`[SMOKE] status after start: ${runner.status()} - running, will tick every 10s`);

  // Let it run for ~25s (first immediate tick + 2 intervals = 3 ticks)
  const waitMs = 25_000;
  console.log(`[SMOKE] waiting ${waitMs / 1000}s for ~3 ticks (immediate + 2 intervals) - observe [BOT] tick logs...`);
  await new Promise((r) => setTimeout(r, waitMs));

  console.log(`\n[SMOKE] tickCount so far: ${runner.getTickCount()} - issuing manual stop`);
  const statusBeforeStop = runner.status();
  await runner.stop("smoke manual stop");
  const statusAfterStop = runner.status();
  console.log(`[SMOKE] status before stop: ${statusBeforeStop} → after stop: ${statusAfterStop}`);
  if (statusAfterStop !== "stopped") {
    console.error("[SMOKE] ERROR: status not stopped after stop()");
    process.exit(1);
  }

  // Confirm loop actually halts: wait 12s more, tickCount should not increase
  const countAfterStop = runner.getTickCount();
  console.log(`[SMOKE] tickCount after stop: ${countAfterStop} - waiting 12s to confirm halt...`);
  await new Promise((r) => setTimeout(r, 12_000));
  const countLater = runner.getTickCount();
  console.log(`[SMOKE] tickCount 12s later: ${countLater} - halted=${String(countLater === countAfterStop)}`);
  if (countLater !== countAfterStop) {
    console.error("[SMOKE] ERROR: tickCount still increasing after stop - loop not halted");
    process.exit(1);
  }

  // Dump recent bot_events for verification
  const db = runner.getDb();
  const events = db.prepare("SELECT id, createdAtIso, eventType, marketId, symbol, data, blockNumber FROM bot_events ORDER BY id DESC LIMIT 20").all() as Array<{
    id: number;
    createdAtIso: string;
    eventType: string;
    marketId: string | null;
    symbol: string | null;
    data: string;
    blockNumber: number | null;
  }>;
  const totalEvents = (db.prepare("SELECT COUNT(*) as c FROM bot_events").get() as { c: number }).c;
  console.log(`\n[SMOKE] recent bot_events (last 20, persisted) - total in DB: ${totalEvents}`);
  for (const e of events.reverse()) {
    const dataPreview = e.data.length > 200 ? `${e.data.slice(0, 200)}…` : e.data;
    console.log(`  #${e.id} ${e.createdAtIso} ${e.eventType} ${e.symbol ?? ""} block=${String(e.blockNumber ?? "-")} data=${dataPreview}`);
  }

  // Also show fills and positions (should be 0 unless a TRADE happened, which is rare with balanced books)
  const fills = db.prepare("SELECT COUNT(*) as c FROM bot_fills").get() as { c: number };
  const positions = db.prepare("SELECT COUNT(*) as c FROM bot_positions").get() as { c: number };
  console.log(`\n[SMOKE] fills count=${fills.c} positions count=${positions.c} (expected 0, unless live book shifted to trigger TRADE - not forced)`);

  // Mid-move observability: count MID_MOVE_OBSERVED events during this run
  const mids = db.prepare("SELECT COUNT(*) as c FROM bot_events WHERE eventType='MID_MOVE_OBSERVED'").get() as { c: number };
  console.log(`[SMOKE] MID_MOVE_OBSERVED count=${mids.c} - may be 0 if mids flat, or >0 if stage-logger data shows drift (threshold 0.025)`);

  runner.close();
  console.log("\n=== Smoke done - bot stopped, DB closed, no unattended execution left running ===");
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] bot-smoke failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
