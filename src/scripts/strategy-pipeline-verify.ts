/**
 * Step 5 — One real order through full pipeline (controlled, min lot).
 * Picks one live market (longest expiry), runs runPipeline for real (with private key).
 * If risk engine approves, it will call placeRestingOrder (LIVE_ONCHAIN); if not, it honestly reports blocked.
 * This is the gated proof after dry-run — do NOT loosen thresholds here (honest).
 */

import { createExchange, activeMarkets, marketOnchain, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { analyzeMarket } from "../analysis/engine.js";
import { ANALYSIS_CONFIG, BOT_CONFIG } from "../config.js";
import { edgeThresholdStrategy } from "../strategy/edgeThreshold.js";
import { runPipeline } from "../strategy/pipeline.js";
import type { BotConfig, StrategyContext } from "../strategy/types.js";
import { readBalancesTagged, createOrderState } from "../ec/orderLifecycle.js";

function buildBotConfig(): BotConfig {
  return {
    enabled: BOT_CONFIG.ENABLED,
    maxPosition: BOT_CONFIG.MAX_POSITION,
    maxLoss: BOT_CONFIG.MAX_LOSS,
    minLiquidity: BOT_CONFIG.MIN_LIQUIDITY,
    maxSpread: BOT_CONFIG.MAX_SPREAD,
    maxSpreadBps: BOT_CONFIG.MAX_SPREAD_BPS,
    minTimeRemaining: BOT_CONFIG.MIN_TIME_REMAINING,
    minOrderSize: BOT_CONFIG.MIN_ORDER_SIZE,
    maxOrderSize: BOT_CONFIG.MAX_ORDER_SIZE,
    defaultOrderSize: BOT_CONFIG.DEFAULT_ORDER_SIZE,
    minNativeWei: BOT_CONFIG.MIN_NATIVE_WEI,
    minCollateralRaw: BOT_CONFIG.MIN_COLLATERAL_RAW,
  };
}

async function main(): Promise<void> {
  console.log("=== Step 5 — One Real Order Through Pipeline (controlled, min lot, honest) ===\n");
  console.log(`Config: MIN_EDGE=${ANALYSIS_CONFIG.MIN_EDGE} MIN_LIQUIDITY=${ANALYSIS_CONFIG.MIN_LIQUIDITY} MAX_SPREAD=${ANALYSIS_CONFIG.MAX_SPREAD} MIN_TIME_REMAINING=${ANALYSIS_CONFIG.MIN_TIME_REMAINING}s defaultSize=${BOT_CONFIG.DEFAULT_ORDER_SIZE}\n`);

  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

  const ecCtx = createExchange({ withSigner: true });
  const markets = await activeMarkets(ecCtx);
  console.log(`[LIVE_INDEXER] activeMarkets → ${markets.length}`);
  if (markets.length === 0) {
    console.log("No live markets");
    await ecCtx.exchange.close().catch(() => undefined);
    process.exit(0);
  }

  // Pick longest expiry market for best chance to pass timeRemaining, but still honest if SKIPs
  let chosen: typeof markets[number] | undefined;
  let maxExpiry = -1;
  let chosenOnchain: Awaited<ReturnType<typeof marketOnchain>> | undefined;
  for (const m of markets) {
    try {
      const oc = await marketOnchain(ecCtx, m);
      if (!oc) continue;
      const exp = Number(oc.expiry);
      if (exp > maxExpiry) {
        maxExpiry = exp;
        chosen = m;
        chosenOnchain = oc;
      }
    } catch {
      // ignore
    }
  }
  if (!chosen || !chosenOnchain) {
    console.log("No tradable market found");
    await ecCtx.exchange.close().catch(() => undefined);
    process.exit(0);
  }

  const { yes } = outcomeSymbols(chosen);
  console.log(`[Chosen] ${chosen.symbol} marketId=${(chosen.info as unknown as { marketId: string }).marketId} expiry=${chosenOnchain.expiry} timeRemaining=${Number(chosenOnchain.expiry) - Math.floor(Date.now() / 1000)}s yes=${yes}`);

  let book: { bids: [number, number][]; asks: [number, number][] };
  try {
    const raw = await ecCtx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    book = { bids: raw.bids as unknown as [number, number][], asks: raw.asks as unknown as [number, number][] };
  } catch (err) {
    console.error(`[WARN] fetchOrderBook failed: ${(err as Error).message}`);
    book = { bids: [], asks: [] };
  }
  const bestBid = book.bids[0]?.[0];
  const bestAsk = book.asks[0]?.[0];
  const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
  const timeRemaining = Number(chosenOnchain.expiry) - Math.floor(Date.now() / 1000);
  const analysis = analyzeMarket({
    marketId: String((chosen.info as unknown as { marketId: string }).marketId),
    symbol: chosen.symbol,
    bids: book.bids,
    asks: book.asks,
    bestBid,
    bestAsk,
    marketProbability: mid,
    timeRemaining,
  });

  console.log(`[DERIVED] analysis ${analysis.recommendation} ${analysis.direction} edge ${analysis.edge.toFixed(4)} imbalance ${analysis.imbalance.toFixed(3)} liq ${analysis.liquidity.toFixed(1)} spread ${analysis.spread.toFixed(4)} timeRem ${analysis.timeRemaining.toFixed(0)}s`);
  for (const r of analysis.reasons) console.log(`  - ${r}`);

  let balances: { nativeWei: bigint; tUsdcRaw: bigint } | undefined;
  try {
    if (ecCtx.canTrade) {
      const snap = await readBalancesTagged(ecCtx);
      balances = { nativeWei: snap.nativeWei, tUsdcRaw: snap.tUsdcRaw };
      console.log(`[LIVE_ONCHAIN] balances native ${snap.nativeHuman.toFixed(6)} tUSDC ${snap.tUsdcHuman.toFixed(6)}`);
    }
  } catch (err) {
    console.error(`[WARN] balances failed: ${(err as Error).message}`);
  }

  // Build openPositions (LIVE_ONCHAIN)
  const mutablePositions: Array<{ marketId: string; symbol: string; side: "YES" | "NO"; size: number }> = [];
  try {
    const orders = await ecCtx.exchange.fetchOpenOrders(yes);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _o of orders) {
      mutablePositions.push({ marketId: String((chosen.info as unknown as { marketId: string }).marketId), symbol: chosen.symbol, side: "YES", size: 1 });
    }
  } catch {
    // ignore
  }

  const botConfig = buildBotConfig();
  const openPositions: StrategyContext["openPositions"] = mutablePositions;
  const strategyContext: StrategyContext = { config: botConfig, openPositions, currentLoss: 0, balances, nowSec: Math.floor(Date.now() / 1000) };
  const state = createOrderState();

  console.log("\n[Pipeline] Running runPipeline (Strategy → Risk → Execution if approved) ...");
  const result = await runPipeline(
    { analysis, strategy: edgeThresholdStrategy, strategyContext, ecCtx, market: chosen, onchain: chosenOnchain, state, yesSymbol: yes },
  );

  console.log(`\nResult: decision ${result.decision.action}${result.decision.side ? ` ${result.decision.side} ${result.decision.price?.toFixed(4)} x${result.decision.size}` : ""}`);
  for (const r of result.decision.reasons) console.log(`  decision reason: ${r}`);
  if (result.risk === null) {
    console.log("Risk: (not checked — strategy SKIPs, short-circuit)");
    console.log("Execution: BLOCKED — no on-chain order placed (honest, as expected with balanced books)");
  } else {
    console.log(`Risk: ${result.risk.approved ? "APPROVED" : "REJECTED"}`);
    for (const rr of result.risk.rejectionReasons) console.log(`  risk: ${rr}`);
    if (result.risk.approved) {
      console.log(`Execution: PLACED tx ${result.placeResult?.txHash} block ${String(result.placeResult?.blockNumber)} orderId ${String(result.placeResult?.orderId)}`);
      // Clean up: cancel the just-placed order so wallet stays clean (like Stage 2)
      if (result.placeResult?.orderId !== undefined) {
        try {
          const { cancelOrderLifecycle } = await import("../ec/orderLifecycle.js");
          const c = await cancelOrderLifecycle({ ctx: ecCtx, onchain: chosenOnchain, orderId: result.placeResult.orderId, yesSymbol: yes, state });
          console.log(`Cleanup: cancelled orderId ${String(c.orderId)} tx ${c.txHash} block ${String(c.blockNumber)}`);
        } catch (err) {
          console.error(`Cleanup cancel failed: ${(err as Error).message}`);
        }
      }
    } else {
      console.log("Execution: BLOCKED by risk — no on-chain order placed (honest)");
    }
  }

  console.log(`\n[VERIFICATION_JSON] ${JSON.stringify({ symbol: chosen.symbol, analysis, decision: result.decision, risk: result.risk, executed: result.executed, txHash: result.placeResult?.txHash ?? null }, null, 2)}`);

  await Promise.race([ecCtx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] pipeline-verify failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
