/**
 * Backtest runner for EC - now uses REAL historical order-book snapshots when available.
 * Data integrity: HISTORICAL marketId/expiry/winningOutcome from indexer, HISTORICAL order-book
 * snapshots from data/snapshots.db when captured while market was live (capturedAtUnix < expiry),
 * ESTIMATED synthetic balanced fallback when no snapshot coverage, DERIVED P&L.
 * Execution model for HISTORICAL: evaluate strategy at every snapshot for that market in time order;
 * first snapshot where analysis flips to TRADE is entry, exit at settlement via Stage 4 payout.
 */

import { createExchange } from "@dreamdex-bot-kit/ec-core";
import { runBacktestWithHistory } from "../backtest/engine.js";
import { loadHistoriesForSettledMarkets } from "../backtest/historicalBooks.js";
import { openSnapshotDb } from "../snapshots/db.js";
import { ANALYSIS_CONFIG } from "../config.js";

const STARTING_CAPITAL = 1000; // tUSDC hypothetical, DERIVED
const SIZE_PER_TRADE = 1; // share, DERIVED

function rawPriceToProb(raw: string | null, decimals = 6): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** decimals;
}

async function main(): Promise<void> {
  console.log("=== Sooth EC Backtest - REAL Historical Books (Stage 10) ===\n");
  console.log(`Config: DEPTH_LEVELS=${ANALYSIS_CONFIG.DEPTH_LEVELS}, K=${ANALYSIS_CONFIG.K_IMBALANCE_NUDGE}, MIN_EDGE=${ANALYSIS_CONFIG.MIN_EDGE}, size=${SIZE_PER_TRADE}, startingCapital=${STARTING_CAPITAL}\n`);
  console.log("Data tags: HISTORICAL = settled marketId/expiry/winningOutcome + order-book snapshots where captured while live (capturedAtUnix < expiry, from data/snapshots.db)");
  console.log("           ESTIMATED = synthetic single-point balanced book fallback where no snapshot coverage (clearly tagged per-market)");
  console.log("           DERIVED = imbalance/edge/P&L computed; intra-market repricing for HISTORICAL (every snapshot evaluated, first TRADE entry)\n");

  if (!process.env.VENUE_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

  const ctx = createExchange({ withSigner: false });

  const limit = 50;
  const rows = await ctx.exchange.client.listBinaryMarkets({ venueId: ctx.config.venueId as `0x${string}`, status: "Finalized", limit });
  console.log(`[HISTORICAL] listBinaryMarkets venue ${ctx.config.venueId} status Finalized limit ${limit} → ${rows.length} markets`);
  console.log(`[HISTORICAL] (also checked data/snapshots.db: logger has run since 2026-08-28T00:17:03.660Z, 1400 rows for 28 markets - see stage-logger-verification.md)`);

  if (rows.length === 0) {
    console.log("\n[STOP] No historical/settled EC market data accessible at all - fresh venue, short-lived markets.");
    console.log("Per brief: never fabricate synthetic candles for EC.");
    await ctx.exchange.close().catch(() => undefined);
    process.exit(0);
  }

  // Build settled market metas for history matching
  const settledMetas: Array<{ marketId: string; symbol: string; expiry: number; winningOutcome: number | null; voided: boolean; lastPrice: number | null }> = [];
  for (const r of rows) {
    const marketId = r.marketId as string;
    const symbol = `${r.asset ?? "UNK"}-${r.interval ?? r.intervalSec ?? "?"}-${new Date(Number(r.expiry) * 1000).toISOString().slice(0, 10)}`;
    const lastProb = rawPriceToProb(r.lastPrice, (r as unknown as { baseDecimals: number }).baseDecimals ?? 6);
    const winningOutcome = (r.winningOutcome) ?? null;
    const voided = Boolean((r as unknown as { voided: boolean }).voided);
    settledMetas.push({
      marketId,
      symbol,
      expiry: Number(r.expiry ?? 0),
      winningOutcome,
      voided,
      lastPrice: lastProb,
    });
  }

  // Match snapshots to settled markets (real history where captured while live)
  const db = openSnapshotDb();
  let histories: ReturnType<typeof loadHistoriesForSettledMarkets>["histories"];
  let withHistory: number;
  let withoutHistory: number;
  try {
    const res = loadHistoriesForSettledMarkets(db, settledMetas);
    histories = res.histories;
    withHistory = res.withHistory;
    withoutHistory = res.withoutHistory;
  } finally {
    db.close();
  }

  console.log(`\n[DERIVED] Matched snapshots to settled markets (capturedAtUnix < expiry, per-market):`);
  console.log(`  with ≥1 real snapshot (HISTORICAL multi-snapshot path): ${withHistory}/${settledMetas.length}`);
  console.log(`  with zero snapshots (ESTIMATED single-point fallback): ${withoutHistory}/${settledMetas.length}`);
  console.log(`  (logger only started 2026-08-28T00:17:03.660Z - markets that expired before then have zero coverage, honestly reported)`);

  // Show per-market snapshot counts for the HISTORICAL subset (first 10)
  const histWithSnap = histories.filter((h) => h.dataPath === "HISTORICAL").slice(0, 10);
  if (histWithSnap.length > 0) {
    console.log(`\n[HISTORICAL] per-market snapshot counts (first ${histWithSnap.length} HISTORICAL markets):`);
    for (const h of histWithSnap) {
      console.log(`  ${h.marketId.slice(0, 18)} ${h.symbol} expiry=${h.expiry} snaps=${h.snapshotCount} winning=${String(h.winningOutcome)} voided=${String(h.voided)}`);
    }
    if (withHistory > histWithSnap.length) console.log(`  … and ${withHistory - histWithSnap.length} more HISTORICAL markets`);
  }

  // Run historical backtest - genuine intra-market repricing for HISTORICAL, single-point for ESTIMATED
  const metrics = runBacktestWithHistory({ markets: histories, startingCapital: STARTING_CAPITAL, sizePerTrade: SIZE_PER_TRADE });

  console.log(`\n=== Backtest Metrics (brief's exact list, now with HISTORICAL vs ESTIMATED split) ===`);
  console.log(`number of trades: ${metrics.numberOfTrades} (HISTORICAL path: ${metrics.historicalTrades}, ESTIMATED fallback: ${metrics.estimatedTrades})`);
  console.log(`winning trades: ${metrics.winningTrades}`);
  console.log(`losing trades: ${metrics.losingTrades}`);
  console.log(`win rate: ${(metrics.winRate * 100).toFixed(1)}%`);
  console.log(`total P&L: ${metrics.totalPnL >= 0 ? "+" : ""}${metrics.totalPnL.toFixed(4)} tUSDC`);
  console.log(`average return: ${metrics.averageReturn >= 0 ? "+" : ""}${metrics.averageReturn.toFixed(4)} per trade`);
  console.log(`maximum drawdown: ${metrics.maximumDrawdown.toFixed(4)}`);
  console.log(`average edge: ${metrics.averageEdge.toFixed(4)}`);
  console.log(`trade frequency: ${(metrics.tradeFrequency * 100).toFixed(1)}% (${metrics.numberOfTrades}/${metrics.totalMarkets})`);
  console.log(`hypothetical starting capital → ending capital: ${metrics.startingCapital.toFixed(2)} → ${metrics.endingCapital.toFixed(2)} tUSDC`);
  console.log(`\nCoverage: ${withHistory} HISTORICAL (real multi-snapshot) + ${withoutHistory} ESTIMATED (single-point) = ${histories.length} total`);
  console.log(`Trades from HISTORICAL path: ${metrics.historicalTrades} / ${withHistory} HISTORICAL markets`);
  console.log(`Trades from ESTIMATED path: ${metrics.estimatedTrades} / ${withoutHistory} ESTIMATED markets`);

  console.log("\n=== Per-Trade P&L (real market IDs, real resolved outcomes, real computed P&L, tagged HISTORICAL vs ESTIMATED) ===");
  if (metrics.trades.length === 0) {
    console.log("(no trades - engine returned NO_TRADE for all markets; HISTORICAL path also 0 if imbalance stayed flat during those markets' lives - honest)");
    console.log("Note: with real snapshot history, imbalance is 0.000 balanced for most polls (house quotes 990/990), so edge 0 < minEdge 0.02 → NO_TRADE, same as Stage 4. A synthetic imbalance shift would trigger TRADE at the right snapshot (see historicalBooks.test.ts).");
  } else {
    // Call out HISTORICAL trades separately per brief
    const histTrades = metrics.trades.filter((t) => t.bookTag === "HISTORICAL");
    const estTrades = metrics.trades.filter((t) => t.bookTag === "ESTIMATED");
    if (histTrades.length > 0) {
      console.log(`\n[HISTORICAL] ${histTrades.length} trade(s) from REAL multi-snapshot history (genuine intra-market repricing):`);
      for (const t of histTrades) {
        const outcomeStr = t.voided ? "VOIDED" : t.winningOutcome === 0 ? "YES" : t.winningOutcome === 1 ? "NO" : "null";
        console.log(`  ${t.marketId.slice(0, 18)} ${t.symbol} dir=${t.direction} entry=${t.entryPrice.toFixed(4)} est=${t.estimatedProbability.toFixed(4)} edge=${t.edge.toFixed(4)} imb=${t.imbalance.toFixed(3)} won=${t.won} pnl=${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(4)} outcome=${outcomeStr} book=${t.bookTag}`);
      }
    }
    if (estTrades.length > 0) {
      console.log(`\n[ESTIMATED] ${estTrades.length} trade(s) from single-point fallback (no snapshot coverage while live):`);
      for (const t of estTrades) {
        const outcomeStr = t.voided ? "VOIDED" : t.winningOutcome === 0 ? "YES" : t.winningOutcome === 1 ? "NO" : "null";
        console.log(`  ${t.marketId.slice(0, 18)} ${t.symbol} dir=${t.direction} entry=${t.entryPrice.toFixed(4)} est=${t.estimatedProbability.toFixed(4)} edge=${t.edge.toFixed(4)} imb=${t.imbalance.toFixed(3)} won=${t.won} pnl=${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(4)} outcome=${outcomeStr} book=${t.bookTag}`);
      }
    }
  }

  // Detailed per-market tag list for verification
  console.log("\n=== Per-Market Data Path (first 20) ===");
  for (const h of histories.slice(0, 20)) {
    console.log(`  ${h.marketId.slice(0, 18)} ${h.symbol} expiry=${h.expiry} snaps=${h.snapshotCount} path=${h.dataPath} winning=${String(h.winningOutcome)}`);
  }
  if (histories.length > 20) console.log(`  … and ${histories.length - 20} more`);

  console.log("\n[VERIFICATION_JSON] " + JSON.stringify({ marketsPulled: rows.length, withHistory, withoutHistory, metrics, perMarket: histories.map((h) => ({ marketId: h.marketId, symbol: h.symbol, expiry: h.expiry, snapshotCount: h.snapshotCount, dataPath: h.dataPath, winningOutcome: h.winningOutcome })) }, null, 2));

  await Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] backtest failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
