/**
 * Settlement poller - standalone lightweight script (Stage 9, brief §13 gap-close).
 *
 * Runs the settlement poll on its OWN interval (SETTLEMENT_POLL_CONFIG.POLL_INTERVAL_MS, default
 * 60s), decoupled from the BotRunner loop: settlement happens on the market's own clock, not the
 * bot's trading clock, so piggybacking the runner would either delay realization or add a second
 * responsibility to the trading loop for no reason.
 *
 * Read-only w.r.t. trading: creates the exchange WITHOUT a signer (only indexer + on-chain reads).
 * For each open position in bot_positions whose market settled on-chain it writes the REAL realized
 * P&L (Stage 4 payout formula) and marks the position CLOSED (realizationSource "SETTLEMENT").
 * Markets that have not settled are left OPEN - nothing is guessed.
 *
 * Tags: LIVE_ONCHAIN (isResolved/isVoided/winningOutcome), LIVE_INDEXER (Finalized shortlist),
 * DERIVED (payout). Errors are logged, never swallowed.
 */
import { createExchange } from "@dreamdex-bot-kit/ec-core";
import { openSnapshotDb } from "../snapshots/db.js";
import { SNAPSHOT_CONFIG, SETTLEMENT_POLL_CONFIG } from "../config.js";
import { createEcSettlementResolver, startSettlementPoller } from "../bot/settlementPoller.js";

function main(): void {
  console.log("=== Sooth Settlement Poller - realized P&L from on-chain settlement ===\n");
  console.log(
    `Config: interval=${SETTLEMENT_POLL_CONFIG.POLL_INTERVAL_MS}ms, DB_PATH=${SNAPSHOT_CONFIG.DB_PATH}. Payout: Stage 4 exact formula (YES win (1-P)*S, NO win -P*S, voided (0.5-P)*S).`,
  );
  console.log("Tags: LIVE_ONCHAIN (isResolved/isVoided/winningOutcome), LIVE_INDEXER (Finalized shortlist), DERIVED (payout)\n");

  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
    process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
  }

  const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
  const ctx = createExchange({ withSigner: false });
  console.log(`[SETTLE] exchange created - network=${ctx.config.network} venue=${String(ctx.config.venueId ?? "inferred")} indexer=${ctx.config.indexerUrl}`);

  const poller = startSettlementPoller({
    db,
    resolve: createEcSettlementResolver(ctx),
    intervalMs: SETTLEMENT_POLL_CONFIG.POLL_INTERVAL_MS,
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[${new Date().toISOString()}] received ${signal} - stopping poller...`);
    poller.stop();
    try {
      db.close();
    } catch (err) {
      console.error(`[WARN] db.close failed: ${(err as Error).message}`);
    }
    void Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]).then(() => {
      console.log("[SETTLE] closed - bye");
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

try {
  main();
} catch (err) {
  const e = err as Error;
  console.error(`[FATAL] settlement poller failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
}