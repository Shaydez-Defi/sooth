/**
 * Dry-run proof - pull live markets → Stage 3 analysis → edgeThreshold.decide() → riskEngine.checkOrder()
 * Prints what WOULD happen (approved/rejected + reasons) without calling orderLifecycle.
 * Data integrity: LIVE_INDEXER (order book mid/probability) + LIVE_ONCHAIN (expiry, balances, open orders) + DERIVED.
 */

import { createExchange, activeMarkets, marketOnchain, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { analyzeMarket } from "../analysis/engine.js";
import { ANALYSIS_CONFIG, BOT_CONFIG } from "../config.js";
import { edgeThresholdStrategy } from "../strategy/edgeThreshold.js";
import { dryRunPipeline } from "../strategy/pipeline.js";
import type { BotConfig, StrategyContext } from "../strategy/types.js";
import { readBalancesTagged } from "../ec/orderLifecycle.js";

function buildBotConfig(overrides?: Partial<BotConfig>): BotConfig {
  return {
    enabled: overrides?.enabled ?? BOT_CONFIG.ENABLED,
    maxPosition: overrides?.maxPosition ?? BOT_CONFIG.MAX_POSITION,
    maxLoss: overrides?.maxLoss ?? BOT_CONFIG.MAX_LOSS,
    minLiquidity: overrides?.minLiquidity ?? BOT_CONFIG.MIN_LIQUIDITY,
    maxSpread: overrides?.maxSpread ?? BOT_CONFIG.MAX_SPREAD,
    maxSpreadBps: overrides?.maxSpreadBps ?? BOT_CONFIG.MAX_SPREAD_BPS,
    minTimeRemaining: overrides?.minTimeRemaining ?? BOT_CONFIG.MIN_TIME_REMAINING,
    minOrderSize: overrides?.minOrderSize ?? BOT_CONFIG.MIN_ORDER_SIZE,
    maxOrderSize: overrides?.maxOrderSize ?? BOT_CONFIG.MAX_ORDER_SIZE,
    defaultOrderSize: overrides?.defaultOrderSize ?? BOT_CONFIG.DEFAULT_ORDER_SIZE,
    minNativeWei: overrides?.minNativeWei ?? BOT_CONFIG.MIN_NATIVE_WEI,
    minCollateralRaw: overrides?.minCollateralRaw ?? BOT_CONFIG.MIN_COLLATERAL_RAW,
  };
}

async function main(): Promise<void> {
  // TEST-ONLY override per brief Step 5 - only when env STRATEGY_TEST_LOOSEN=1, never in default config.
  const testLoosen = process.env.STRATEGY_TEST_LOOSEN === "1";
  const loosenNote = testLoosen ? " [TEST-ONLY: MIN_EDGE loosened 0.02→0.005 for verification proof, will revert after]" : "";

  console.log("=== Sooth Strategy Dry-Run - Pipeline Wiring Proof (no real orders) ===\n");
  console.log(`Config: ANALYSIS DEPTH_LEVELS=${ANALYSIS_CONFIG.DEPTH_LEVELS} K=${ANALYSIS_CONFIG.K_IMBALANCE_NUDGE} MIN_EDGE=${ANALYSIS_CONFIG.MIN_EDGE}${loosenNote} MIN_LIQUIDITY=${ANALYSIS_CONFIG.MIN_LIQUIDITY} MAX_SPREAD=${ANALYSIS_CONFIG.MAX_SPREAD} (${ANALYSIS_CONFIG.MAX_SPREAD_BPS} bps) MIN_TIME_REMAINING=${ANALYSIS_CONFIG.MIN_TIME_REMAINING}s`);
  console.log(`        BOT maxPosition=${BOT_CONFIG.MAX_POSITION} maxLoss=${BOT_CONFIG.MAX_LOSS} minOrderSize=${BOT_CONFIG.MIN_ORDER_SIZE} maxOrderSize=${BOT_CONFIG.MAX_ORDER_SIZE} defaultSize=${BOT_CONFIG.DEFAULT_ORDER_SIZE}\n`);

  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
    process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
  }

  // For TEST-ONLY proof: temporarily loosen edge threshold via monkey-patch of ANALYSIS_CONFIG.
  // We do not mutate default config - we pass overridden context? Instead we mutate the imported object for this run only.
  // This is explicitly labeled TEST-ONLY and reverted after (process exits).
  let restoreMinEdge: (() => void) | undefined;
  if (testLoosen) {
    const original = ANALYSIS_CONFIG.MIN_EDGE;
    // ANALYSIS_CONFIG is const but its property is writable at runtime - we mutate for this dry-run only.
    (ANALYSIS_CONFIG as unknown as Record<string, unknown>).MIN_EDGE = 0.005;
    restoreMinEdge = (): void => {
      (ANALYSIS_CONFIG as unknown as Record<string, unknown>).MIN_EDGE = original;
    };
    console.log("[TEST-ONLY] Loosened MIN_EDGE 0.02 → 0.005 for this verification run only (not persisted)\n");
  }

  const botConfig: BotConfig = buildBotConfig(testLoosen ? { minLiquidity: 1, minTimeRemaining: 1 } : undefined);
  // For test-loosen, we also loosen bot-level copy of minLiquidity/minTimeRemaining so risk doesn't block.
  // Normal run keeps defaults.

  const ctx = createExchange({ withSigner: true });
  const markets = await activeMarkets(ctx);
  console.log(`[LIVE_INDEXER] activeMarkets venue ${ctx.config.venueId ?? "(inferred)"} → ${markets.length} live market(s)`);
  if (markets.length === 0) {
    console.log("No live markets - nothing to analyze");
    await ctx.exchange.close().catch(() => undefined);
    if (restoreMinEdge) restoreMinEdge();
    process.exit(0);
  }

  // Try to read live balances for funded/gas checks (LIVE_ONCHAIN). If no signer, balances undefined → risk will flag unavailable (honest).
  let balances: { nativeWei: bigint; tUsdcRaw: bigint } | undefined;
  try {
    if (ctx.canTrade) {
      const snap = await readBalancesTagged(ctx);
      balances = { nativeWei: snap.nativeWei, tUsdcRaw: snap.tUsdcRaw };
      console.log(`[LIVE_ONCHAIN] balances native ${snap.nativeHuman.toFixed(6)} STT tUSDC ${snap.tUsdcHuman.toFixed(6)}`);
    } else {
      console.log("[LIVE_ONCHAIN] balances unavailable - no PRIVATE_KEY (read-only), risk checks for funded/gas will report unavailable (honest)");
    }
  } catch (err) {
    console.error(`[WARN] readBalancesTagged failed: ${(err as Error).message} - risk funded/gas checks will report unavailable`);
  }

  // Build openPositions from live open orders per market (LIVE_ONCHAIN mirror).
  // We aggregate across all live markets' fetchOpenOrders.
  const openPositions: { marketId: string; symbol: string; side: "YES" | "NO"; size: number }[] = [];
  for (const m of markets) {
    const { yes } = outcomeSymbols(m);
    try {
      const orders = await ctx.exchange.fetchOpenOrders(yes);
      for (const o of orders) {
        const info = m.info as unknown as { marketId: string };
        openPositions.push({
          marketId: String(info.marketId ?? m.symbol),
          symbol: m.symbol,
          side: "YES",
          size: Number((o as unknown as { quantity?: number }).quantity ?? 1),
        });
      }
    } catch {
      // ignore per-market fetch failure - not fatal for dry-run
    }
  }
  console.log(`[LIVE_ONCHAIN] openPositions count ${openPositions.length}\n`);

  const strategyContext: StrategyContext = {
    config: botConfig,
    openPositions,
    currentLoss: 0, // DERIVED: no realized loss yet in dry-run (would be tracked live)
    balances,
    nowSec: Math.floor(Date.now() / 1000),
  };

  const rows: Array<ReturnType<typeof dryRunPipeline> & { symbol: string; analysis: ReturnType<typeof analyzeMarket> }> = [];

  for (const m of markets) {
    const info = m.info as unknown as { marketId: string };
    const { yes } = outcomeSymbols(m);
    let onchain: Awaited<ReturnType<typeof marketOnchain>>;
    try {
      onchain = await marketOnchain(ctx, m);
      if (!onchain) throw new Error("marketOnchain null");
    } catch (err) {
      console.error(`[WARN] marketOnchain failed for ${m.symbol}: ${(err as Error).message}`);
      continue;
    }
    let book: { bids: [number, number][]; asks: [number, number][] };
    try {
      const raw = await ctx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      book = { bids: raw.bids as unknown as [number, number][], asks: raw.asks as unknown as [number, number][] };
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
      marketProbability: mid,
      timeRemaining,
    });

    const { decision, risk } = dryRunPipeline({ analysis, strategy: edgeThresholdStrategy, strategyContext });
    rows.push({ analysis, decision, risk, symbol: m.symbol });
  }

  // Print summary table: Market Data → Strategy → Risk → Execution (would-be)
  console.log("\n=== Dry-Run Results (Market Data → Strategy → Signal → Risk Checks → Execution) ===");
  console.log("symbol | mktProb | estProb | edge | dir | rec (analysis) | decision | risk | wouldExecute");
  console.log("--- | --- | --- | --- | --- | --- | --- | --- | ---");
  for (const r of rows) {
    const a = r.analysis;
    const d = r.decision;
    const riskStr = r.risk === null ? "SKIP (not checked)" : r.risk.approved ? "APPROVED" : `REJECTED (${r.risk.rejectionReasons.length})`;
    const wouldExec = r.risk?.approved === true && d.action === "PLACE_ORDER" ? "YES (would place)" : "NO";
    console.log(
      [
        a.symbol,
        a.marketProbability.toFixed(4),
        a.estimatedProbability.toFixed(4),
        `${a.edge >= 0 ? "+" : ""}${a.edge.toFixed(4)}`,
        a.direction,
        a.recommendation,
        `${d.action}${d.side ? ` ${d.side} ${d.price?.toFixed(4)} x${d.size}` : ""}`,
        riskStr,
        wouldExec,
      ].join(" | "),
    );
  }

  // Detailed per-market trace: must cite order-book imbalance as source, then risk reasons
  console.log("\n=== Per-Market Trace (reasons) ===");
  for (const r of rows) {
    const a = r.analysis;
    const d = r.decision;
    const risk = r.risk;
    console.log(`\n${a.symbol} [analysis ${a.recommendation} ${a.direction}] market ${a.marketProbability.toFixed(4)} est ${a.estimatedProbability.toFixed(4)} edge ${a.edge.toFixed(4)} imbalance ${a.imbalance.toFixed(3)} liq ${a.liquidity.toFixed(1)} spread ${a.spread.toFixed(4)} timeRem ${a.timeRemaining.toFixed(0)}s`);
    console.log(`  Strategy [${d.action}${d.side ? ` ${d.side}` : ""}]:`);
    for (const s of d.reasons) console.log(`    - ${s}`);
    if (risk === null) {
      console.log("  Risk: (not checked - strategy SKIPs, short-circuit proven)");
    } else {
      console.log(`  Risk [${risk.approved ? "APPROVED" : "REJECTED"}]:`);
      if (risk.rejectionReasons.length === 0) {
        console.log("    - approved - all 10 checks passed");
      } else {
        for (const rr of risk.rejectionReasons) console.log(`    - ${rr}`);
      }
      console.log(`  Execution: ${risk.approved && d.action === "PLACE_ORDER" ? "WOULD CALL placeRestingOrder (dry-run, not called)" : "BLOCKED - no execution"}`);
    }
  }

  const approvedCount = rows.filter((r) => r.risk?.approved).length;
  const skipCount = rows.filter((r) => r.decision.action === "SKIP").length;
  const rejectedCount = rows.filter((r) => r.risk && !r.risk.approved).length;
  console.log(`\nSummary: ${rows.length} markets → ${skipCount} SKIP (strategy) ${rejectedCount} REJECTED (risk) ${approvedCount} APPROVED (would execute) - no real orders placed`);
  if (testLoosen) console.log("Note: TEST-ONLY loosening active this run - thresholds restored on exit, not persisted to config.ts");

  console.log(
    "\n[VERIFICATION_JSON] " +
      JSON.stringify(
        { config: { analysis: ANALYSIS_CONFIG, bot: { ...BOT_CONFIG, MIN_NATIVE_WEI: String(BOT_CONFIG.MIN_NATIVE_WEI), MIN_COLLATERAL_RAW: String(BOT_CONFIG.MIN_COLLATERAL_RAW) }, testLoosen }, rows: rows.map((r) => ({ symbol: r.symbol, analysis: r.analysis, decision: r.decision, risk: r.risk })) },
        null,
        2,
      ),
  );

  await Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  if (restoreMinEdge) restoreMinEdge();
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] strategy-dry-run failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
