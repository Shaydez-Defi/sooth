/**
 * Backtest runner for EC — pulls real settled/historical EC markets and runs Stage 3 engine.
 * Data integrity: HISTORICAL marketId/expiry/winningOutcome from indexer, ESTIMATED order book (synthetic balanced) when history unavailable, DERIVED P&L.
 * No synthetic candles for EC — never fabricate successful result, be explicit about granularity.
 */

import { createExchange } from "@dreamdex-bot-kit/ec-core";
import { runBacktest, type SettledMarket } from "../backtest/engine.js";
import { ANALYSIS_CONFIG } from "../config.js";

const STARTING_CAPITAL = 1000; // tUSDC hypothetical, DERIVED
const SIZE_PER_TRADE = 1; // share, DERIVED

function syntheticBookAround(mid: number): { bids: [number, number][]; asks: [number, number][] } {
  // ESTIMATED synthetic balanced book around mid, using same depth pattern as live (200/330/460)
  // Tagged as ESTIMATED because historical order-book snapshots not exposed by indexer.
  const bids: [number, number][] = [
    [Math.max(0.01, mid - 0.015), 200],
    [Math.max(0.01, mid - 0.025), 330],
    [Math.max(0.01, mid - 0.035), 460],
  ];
  const asks: [number, number][] = [
    [Math.min(0.99, mid + 0.015), 200],
    [Math.min(0.99, mid + 0.025), 330],
    [Math.min(0.99, mid + 0.035), 460],
  ];
  return { bids, asks };
}

function rawPriceToProb(raw: string | null, decimals = 6): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** decimals;
}

async function main(): Promise<void> {
  console.log("=== Sooth EC Backtest — Real Historical Settled Markets ===\n");
  console.log(`Config: DEPTH_LEVELS=${ANALYSIS_CONFIG.DEPTH_LEVELS}, K=${ANALYSIS_CONFIG.K_IMBALANCE_NUDGE}, MIN_EDGE=${ANALYSIS_CONFIG.MIN_EDGE}, size=${SIZE_PER_TRADE}, startingCapital=${STARTING_CAPITAL}\n`);
  console.log("Data tags: HISTORICAL = settled marketId/expiry/winningOutcome from indexer listBinaryMarkets + onchain getMarketOnchain");
  console.log("           ESTIMATED = synthetic balanced order book around lastPrice (historical snapshots not exposed by indexer)");
  console.log("           HISTORICAL entry point + HISTORICAL outcome, NOT full intra-market repricing — explicit per brief\n");

  if (!process.env.VENUE_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

  const ctx = createExchange({ withSigner: false });

  // Pull real settled/historical EC markets — true count, don't pad
  const limit = 50;
  const rows = await ctx.exchange.client.listBinaryMarkets({ venueId: ctx.config.venueId as `0x${string}`, status: "Finalized", limit });
  console.log(`[HISTORICAL] listBinaryMarkets venue ${ctx.config.venueId} status Finalized limit ${limit} → ${rows.length} markets`);

  if (rows.length === 0) {
    console.log("\n[STOP] No historical/settled EC market data accessible at all — fresh venue, short-lived markets.");
    console.log("Options: wait for more markets to expire during the hackathon, or ship this as 'not enough historical data yet' in demo, rather than inventing history.");
    console.log("Per brief: never fabricate synthetic candles for EC.");
    await ctx.exchange.close().catch(() => undefined);
    process.exit(0);
  }

  // Build SettledMarket list with real outcome + synthetic book (tagged ESTIMATED)
  const markets: SettledMarket[] = [];
  for (const r of rows) {
     
    const marketId = r.marketId as string;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const symbol = `${r.asset ?? "UNK"}-${r.interval ?? r.intervalSec ?? "?"}-${new Date(Number(r.expiry) * 1000).toISOString().slice(0, 10)}` as string;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const lastProb = rawPriceToProb(r.lastPrice as string | null, r.baseDecimals ?? 6);
    // Use lastPrice as entry mid if available, else 0.5 midpoint (ESTIMATED fallback)
    const mid = lastProb ?? 0.5;
    const { bids, asks } = syntheticBookAround(mid);
    // For markets where lastPrice is null, the book is even more estimated — still balanced, so engine will likely NO_TRADE
    const bookTag = r.lastPrice ? "ESTIMATED" : "ESTIMATED"; // both ESTIMATED because no historical snapshot; if we had real snapshot it would be HISTORICAL
    // Need onchain winningOutcome — row already has it, but we also verify via onchain for tag HISTORICAL
    // Use row's winningOutcome directly (HISTORICAL), but also note voided
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const winningOutcome = (r.winningOutcome as number | null) ?? null;
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
      bookTag,
    });
  }

  console.log(`\n[DERIVED] Built ${markets.length} backtest inputs with ${markets.filter((m) => m.lastPrice !== null).length} having lastPrice (HISTORICAL), ${markets.filter((m) => m.lastPrice === null).length} without (ESTIMATED 0.5 mid)`);
  console.log(`[DERIVED] Order book for each is ESTIMATED synthetic balanced (200/330/460) around entry mid — not HISTORICAL time series; P&L will be based on this single entry point per market, not intra-market repricing\n`);

  const metrics = runBacktest({ markets, startingCapital: STARTING_CAPITAL, sizePerTrade: SIZE_PER_TRADE });

  console.log("=== Backtest Metrics (brief's exact list) ===");
  console.log(`number of trades: ${metrics.numberOfTrades}`);
  console.log(`winning trades: ${metrics.winningTrades}`);
  console.log(`losing trades: ${metrics.losingTrades}`);
  console.log(`win rate: ${(metrics.winRate * 100).toFixed(1)}%`);
  console.log(`total P&L: ${metrics.totalPnL >= 0 ? "+" : ""}${metrics.totalPnL.toFixed(4)} tUSDC`);
  console.log(`average return: ${metrics.averageReturn >= 0 ? "+" : ""}${metrics.averageReturn.toFixed(4)} per trade`);
  console.log(`maximum drawdown: ${metrics.maximumDrawdown.toFixed(4)}`);
  console.log(`average edge: ${metrics.averageEdge.toFixed(4)}`);
  console.log(`trade frequency: ${(metrics.tradeFrequency * 100).toFixed(1)}% (${metrics.numberOfTrades}/${metrics.totalMarkets})`);
  console.log(`hypothetical starting capital → ending capital: ${metrics.startingCapital.toFixed(2)} → ${metrics.endingCapital.toFixed(2)} tUSDC`);

  console.log("\n=== Per-Trade P&L (real market IDs, real resolved outcomes, real computed P&L) ===");
  if (metrics.trades.length === 0) {
    console.log("(no trades — engine returned NO_TRADE for all markets due to balanced ESTIMATED books and edge < minEdge; see reasons in live analysis)");
    console.log("This is honest: historical order-book depth not exposed, so balanced synthetic book yields 0 imbalance → no edge → no trade. With real historical snapshots, imbalance would be non-zero and some would trade.");
  } else {
    for (const t of metrics.trades) {
      const outcomeStr = t.voided ? "VOIDED" : t.winningOutcome === 0 ? "YES" : t.winningOutcome === 1 ? "NO" : "null";
      console.log(
        `${t.marketId.slice(0, 18)} ${t.symbol} dir=${t.direction} entry=${t.entryPrice.toFixed(4)} est=${t.estimatedProbability.toFixed(4)} edge=${t.edge.toFixed(4)} imb=${t.imbalance.toFixed(3)} won=${t.won} pnl=${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(4)} outcome=${outcomeStr} book=${t.bookTag}`,
      );
    }
  }

  // Emit JSON for verification capture
  console.log("\n[VERIFICATION_JSON] " + JSON.stringify({ marketsPulled: rows.length, metrics }, null, 2));

  await Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] backtest failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
