/**
 * Analyze all live EC markets with the Market Intelligence Engine - read-only/compute-only.
 * Uses real order-book depth (LIVE_INDEXER) and onchain expiry (LIVE_ONCHAIN), no external data.
 */

import { createExchange, activeMarkets, marketOnchain, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { analyzeMarket } from "../analysis/engine.js";
import { ANALYSIS_CONFIG } from "../config.js";

async function main(): Promise<void> {
  console.log("=== Sooth Market Intelligence - Stage 3 Live Analysis ===\n");
  console.log(`Config: DEPTH_LEVELS=${ANALYSIS_CONFIG.DEPTH_LEVELS} (top N levels), K=${ANALYSIS_CONFIG.K_IMBALANCE_NUDGE}, MIN_EDGE=${ANALYSIS_CONFIG.MIN_EDGE}, MIN_LIQUIDITY=${ANALYSIS_CONFIG.MIN_LIQUIDITY}, MAX_SPREAD=${ANALYSIS_CONFIG.MAX_SPREAD} (${ANALYSIS_CONFIG.MAX_SPREAD_BPS} bps), MIN_TIME_REMAINING=${ANALYSIS_CONFIG.MIN_TIME_REMAINING}s\n`);

  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
    process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
  }

  const ctx = createExchange({ withSigner: false });
  const markets = await activeMarkets(ctx);
  console.log(`[LIVE_INDEXER] activeMarkets venue ${ctx.config.venueId ?? "(inferred)"} → ${markets.length} live market(s)`);
  if (markets.length === 0) {
    console.log("No live markets - nothing to analyze (markets expire on schedule)");
    await ctx.exchange.close().catch(() => undefined);
    process.exit(0);
  }

  const results: ReturnType<typeof analyzeMarket>[] = [];

  for (const m of markets) {
    const info = m.info as unknown as { marketId: string; expiry?: number | string };
    const { yes } = outcomeSymbols(m);
    let onchain: Awaited<ReturnType<typeof marketOnchain>>;
    try {
      onchain = await marketOnchain(ctx, m);
      if (!onchain) throw new Error("marketOnchain returned null");
    } catch (err) {
      // Fail-safe: analyze with missing data → engine will return NO_TRADE with reasons
      const fallback = analyzeMarket({
        marketId: String(info.marketId ?? m.symbol),
        symbol: m.symbol,
        bids: [],
        asks: [],
        bestBid: undefined,
        bestAsk: undefined,
        marketProbability: undefined,
        timeRemaining: undefined,
      });
      console.error(`[WARN] marketOnchain failed for ${m.symbol}: ${(err as Error).message} → ${fallback.recommendation}`);
      results.push(fallback);
      continue;
    }

    let book: { bids: [number, number][]; asks: [number, number][] };
    try {
      const raw = await ctx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      book = { bids: raw.bids as [number, number][], asks: raw.asks as [number, number][] };
    } catch (err) {
      console.error(`[WARN] fetchOrderBook failed for ${yes}: ${(err as Error).message}`);
      book = { bids: [], asks: [] };
    }

    const bestBid = book.bids[0]?.[0];
    const bestAsk = book.asks[0]?.[0];
    const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
    const nowSec = Math.floor(Date.now() / 1000);
    const expirySec = Number(onchain.expiry);
    const timeRemaining = expirySec - nowSec; // LIVE_ONCHAIN

    const analysis = analyzeMarket({
      marketId: String(info.marketId),
      symbol: m.symbol,
      bids: book.bids,
      asks: book.asks,
      bestBid,
      bestAsk,
      marketProbability: mid, // LIVE_INDEXER mid
      timeRemaining, // LIVE_ONCHAIN
    });
    results.push(analysis);
  }

  // Print results table
  console.log("\n=== Analysis Results ===");
  const header = ["symbol", "mktProb", "estProb", "edge", "imb", "liq", "spread", "bps", "timeRem", "sig", "dir", "rec"];
  console.log(header.join(" | "));
  console.log(header.map(() => "---").join(" | "));

  let tradeCount = 0;
  for (const r of results) {
    if (r.recommendation === "TRADE") tradeCount++;
    const line = [
      r.symbol,
      r.marketProbability.toFixed(4),
      r.estimatedProbability.toFixed(4),
      `${r.edge >= 0 ? "+" : ""}${r.edge.toFixed(4)}`,
      r.imbalance.toFixed(3),
      r.liquidity.toFixed(1),
      r.spread.toFixed(4),
      r.spreadBps.toFixed(1),
      `${r.timeRemaining.toFixed(0)}s`,
      r.signalStrength.toFixed(3),
      r.direction,
      r.recommendation,
    ].join(" | ");
    console.log(line);
  }

  console.log(`\nSummary: ${tradeCount}/${results.length} TRADE (${((tradeCount / results.length) * 100).toFixed(1)}%) - expected minority`);

  // Detailed reasons per market
  console.log("\n=== Reasons (must cite order-book imbalance as source) ===");
  for (const r of results) {
    console.log(`\n${r.symbol} [${r.recommendation} ${r.direction}] market ${r.marketProbability.toFixed(4)} est ${r.estimatedProbability.toFixed(4)} edge ${r.edge.toFixed(4)} imbalance ${r.imbalance.toFixed(3)} liq ${r.liquidity.toFixed(1)} spread ${r.spread.toFixed(4)} timeRem ${r.timeRemaining.toFixed(0)}s`);
    for (const reason of r.reasons) console.log(`  - ${reason}`);
  }

  // Verify TRADE is minority - if not, warn that thresholds may be mistuned
  if (results.length > 0 && tradeCount === results.length) {
    console.warn("\n[WARN] All markets returned TRADE - thresholds may be too permissive (k/minEdge). Consider tightening MIN_EDGE or reducing K per brief.");
  } else if (tradeCount > results.length / 2) {
    console.warn(`\n[WARN] Majority TRADE (${tradeCount}/${results.length}) - consider tightening`);
  }

  // Emit JSON for verification capture
  console.log("\n[VERIFICATION_JSON] " + JSON.stringify({ config: ANALYSIS_CONFIG, results }, null, 2));

  await Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] analyze-markets failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
