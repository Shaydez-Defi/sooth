/**
 * Read-only proof of Event Contracts on Somnia Shannon testnet.
 * Uses @dreamdex-bot-kit/ec-core over @somnia-chain/markets-sdk - no private key required.
 *
 * Steps (EC, not spot):
 *  1. Connect via createExchange({withSigner:false}) - RPC + indexer + chain from EcConfig
 *  2. List real available Event Contracts (binary) via activeMarkets()
 *  3. For one real contract, print: metadata, market state (status/probability/liquidity), order book, time-to-expiry
 *
 * Data tags: LIVE_ONCHAIN = chain read via getMarketOnchain, LIVE_INDEXER = indexer via loadMarkets/fetchOrderBook, DERIVED = mid/spread/headroom
 */

// EC config uses its own env loader (NETWORK, VENUE_ID, RPC_URL, INDEXER_URL). Mirror our spot env for convenience.
import { createExchange, activeMarkets, marketOnchain, snapshot, outcomeSymbols, explainEmptyScope, resolveVenue, MARKET_STATUS, headroomSec } from "@dreamdex-bot-kit/ec-core";
import { formatUnits } from "viem";

async function main(): Promise<void> {
  console.log("=== DreamDEX Trading Intelligence - Stage 1.5 EC Discovery ===\n");

  // EC's createExchange reads NETWORK (default testnet), VENUE_ID, RPC_URL, INDEXER_URL, etc. from env.
  // For read-only we do NOT need PRIVATE_KEY. Set NETWORK=testnet explicitly to avoid mainnet fallback.
  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  // VENUE_ID scoping - docs say it moves, but without it multi-venue deployments throw.
  // Default to documented testnet DreamDEX venue (operator 2) so read-only discovery works out-of-box.
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
    process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
  }

  const ctx = createExchange({ withSigner: false });
  const cfg = ctx.config;

  console.log(`Network      : ${cfg.network} (chainId=${cfg.chainId})`); // LIVE_ONCHAIN deployment
  console.log(`RPC URL      : ${cfg.rpcUrl}`);
  console.log(`WS RPC URL   : ${cfg.wsRpcUrl}`);
  console.log(`Indexer      : ${cfg.indexerUrl}`);
  console.log(`VENUE_ID     : ${cfg.venueId ?? "(unset - will infer from live markets)"}`);
  console.log(`OPERATOR_ID  : ${cfg.operatorId ?? "(unset)"}`);
  console.log(`Collateral   : ${cfg.addresses.collateral} (decimals=${cfg.decimals})`);
  console.log(`Tick/Lot     : ${cfg.tick.toString()} / ${cfg.lot.toString()} (raw)`);
  console.log(`DryRun       : ${cfg.dryRun}`);

  // Resolve venue diagnostic
  try {
    const venueInfo = await resolveVenue(ctx);
    console.log(`\n[LIVE_INDEXER] resolveVenue: source=${venueInfo.source} markets=${venueInfo.markets} scope=${JSON.stringify(venueInfo.scope)}`);
  } catch (err) {
    console.warn(`[WARN] resolveVenue failed: ${(err as Error).message}`);
  }

  // Verify RPC connectivity via viem client (LIVE_ONCHAIN)
  try {
    const chainId = await ctx.exchange.client.getViemClient().getChainId();
    const block = await ctx.exchange.client.getViemClient().getBlockNumber();
    console.log(`[RPC] Connected - chainId=${chainId}, block=${block}`);
    if (chainId !== cfg.chainId) {
      console.warn(`[WARN] RPC chainId ${chainId} != config ${cfg.chainId}`);
    }
  } catch (err) {
    throw new Error(`RPC connect failed at ${cfg.rpcUrl}: ${(err as Error).message}`, { cause: err });
  }

  // List live Event Contracts (binary) - LIVE_INDEXER + venue scoping
  let markets: Awaited<ReturnType<typeof activeMarkets>>;
  try {
    markets = await activeMarkets(ctx);
    console.log(`\n[LIVE_INDEXER] activeMarkets (via venue ${cfg.venueId ?? "inferred"}) → ${markets.length} market(s)`);
  } catch (err) {
    // Multi-venue ambiguity throws (markets.ts:86-96) - dump diagnostics
    console.error(`[FATAL] activeMarkets threw (likely multi-venue without VENUE_ID): ${(err as Error).message}`);
    try {
      const all = Object.values(await ctx.exchange.loadMarkets(true));
      const binary = all.filter((m) => (m as unknown as { type: string }).type === "binary");
      const byVenue = new Map<string, number>();
      for (const m of binary as unknown as Array<{ info: { venueId?: string } }>) {
        const v = (m.info.venueId ?? "(none)").toLowerCase();
        byVenue.set(v, (byVenue.get(v) ?? 0) + 1);
      }
      console.log(`[DIAG] total binary rows (any status): ${binary.length}`);
      for (const [v, n] of byVenue) console.log(`  venue ${v}: ${n} rows`);
    } catch (e2) {
      console.warn(`[WARN] loadMarkets diagnostic failed: ${(e2 as Error).message}`);
    }
    throw err;
  }

  if (markets.length === 0) {
    const hint = await explainEmptyScope(ctx);
    console.log(`[LIVE_INDEXER] explainEmptyScope: ${hint}`);
    // Also dump raw binary count for proof
    try {
      const all = Object.values(await ctx.exchange.loadMarkets(true));
      const binaryAll = all.filter((m) => (m as unknown as { type: string }).type === "binary") as unknown as Array<{ active: boolean; symbol: string; info: { venueId?: string; operatorId?: number; asset?: string; intervalSec?: number } }>;
      const activeBinary = binaryAll.filter((m) => m.active);
      console.log(`[DIAG] binary total=${binaryAll.length} active=${activeBinary.length}`);
      if (activeBinary.length > 0) {
        for (const m of activeBinary.slice(0, 5)) {
          console.log(`  active: ${m.symbol} venue=${m.info.venueId} op=${m.info.operatorId} asset=${m.info.asset} interval=${m.info.intervalSec}`);
        }
      }
    } catch (e) {
      console.warn(`[WARN] diag loadMarkets failed: ${(e as Error).message}`);
    }
    console.log("\n[RESULT] No live Event Contracts in current venue scope - report as empty (not fabricated).");
    await ctx.exchange.close().catch(() => undefined);
    return;
  }

  // Print summary of all live markets (first 10)
  console.log(`\n[LIVE_INDEXER] Live binary markets (first ${Math.min(10, markets.length)}):`);
  for (const m of markets.slice(0, 10)) {
    const info = m.info as unknown as { marketId: string; venueId?: string; operatorId?: number; asset?: string; intervalSec?: number; expiry?: number | string };
    console.log(`  - ${m.symbol} marketId=${info.marketId.slice(0, 18)}… venue=${info.venueId?.slice(0, 18)}… op=${info.operatorId} asset=${info.asset} interval=${info.intervalSec}s active=${m.active}`);
  }

  // Deep inspection of one real contract (first)
  const target = markets[0]!;
  const info = target.info as unknown as {
    marketId: string;
    venueId?: string;
    operatorId?: number;
    asset?: string;
    intervalSec?: number;
    strike?: number | string;
    expiry?: number | string;
    marketType: string;
  };
  const { yes, no } = outcomeSymbols(target);

  console.log(`\n=== Deep inspection: ${target.symbol} (${yes} / ${no}) ===`);
  console.log(`[LIVE_INDEXER] UnifiedMarket metadata:`);
  console.log(`  symbol     = ${target.symbol}`);
  console.log(`  marketId   = ${info.marketId}`);
  console.log(`  venueId    = ${info.venueId ?? "(none)"}`);
  console.log(`  operatorId = ${info.operatorId ?? "(none)"}`);
  console.log(`  asset      = ${info.asset ?? "(none)"} intervalSec=${info.intervalSec ?? "(none)"}`);
  console.log(`  strike     = ${String(info.strike ?? "(none)")}`);
  console.log(`  outcomes   = YES:${yes} NO:${no}`);
  console.log(`  active     = ${target.active}`);

  // LIVE_ONCHAIN authoritative snapshot
  let onchain: Awaited<ReturnType<typeof marketOnchain>>;
  try {
    onchain = await marketOnchain(ctx, target);
  } catch (err) {
    throw new Error(`marketOnchain failed for ${info.marketId}: ${(err as Error).message}`, { cause: err });
  }
  if (!onchain) {
    throw new Error(`marketOnchain returned null for non-binary market ${target.symbol}`);
  }

  console.log(`\n[LIVE_ONCHAIN] marketOnchain (by marketId):`);
  console.log(`  pool         = ${onchain.pool}`);
  console.log(`  market       = ${onchain.marketAddress}`);
  console.log(`  outcomeToken = ${onchain.outcomeToken} yesId=${onchain.yesId.toString()} noId=${onchain.noId.toString()}`);
  console.log(`  collateral   = ${onchain.collateral} decimals=${onchain.decimals}`);
  console.log(`  status       = ${onchain.status} (${Object.keys(MARKET_STATUS).find((k) => MARKET_STATUS[k as keyof typeof MARKET_STATUS] === onchain.status) ?? "?"}) isTradable=${onchain.status === MARKET_STATUS.Trading}`);
  console.log(`  expiry       = ${onchain.expiry.toString()} (unix sec) → ${new Date(Number(onchain.expiry) * 1000).toISOString()}`);
  console.log(`  isResolved   = ${onchain.isResolved} isVoided=${onchain.isVoided} winningOutcome=${onchain.winningOutcome} finalized=${onchain.finalized}`);
  console.log(`  nonce        = ${onchain.nonce.toString()} backing=${onchain.backing.toString()} raw`);

  const nowSec = Math.floor(Date.now() / 1000);
  const expirySec = Number(onchain.expiry);
  const remainingSec = expirySec - nowSec;
  const headroom = headroomSec(Number(info.intervalSec ?? 0));
  console.log(`[DERIVED] Time remaining: ${remainingSec}s (${(remainingSec / 60).toFixed(1)} min) headroom=${headroom}s tradable=${remainingSec > headroom && onchain.status === MARKET_STATUS.Trading}`);

  // LIVE_INDEXER order book (human units) - price is YES probability
  let snap: Awaited<ReturnType<typeof snapshot>>;
  let rawBook: Awaited<ReturnType<typeof ctx.exchange.fetchOrderBook>>;
  try {
    snap = await snapshot(ctx, yes, 5);
    rawBook = await ctx.exchange.fetchOrderBook(yes, 5);
  } catch (err) {
    throw new Error(`fetchOrderBook failed for ${yes}: ${(err as Error).message}`, { cause: err });
  }

  console.log(`\n[LIVE_INDEXER] snapshot ${yes} (depth 5, price=YES prob):`);
  console.log(`  bestYesBid = ${snap.bestYesBid !== undefined ? snap.bestYesBid.toFixed(4) : "-"} (implied prob ${snap.bestYesBid !== undefined ? (snap.bestYesBid * 100).toFixed(1) + "%" : "-"})`);
  console.log(`  bestYesAsk = ${snap.bestYesAsk !== undefined ? snap.bestYesAsk.toFixed(4) : "-"} (implied ${snap.bestYesAsk !== undefined ? (snap.bestYesAsk * 100).toFixed(1) + "%" : "-"})`);
  console.log(`  yesMid     = ${snap.yesMid !== undefined ? snap.yesMid.toFixed(4) : "-"} (${snap.yesMid !== undefined ? (snap.yesMid * 100).toFixed(1) + "%" : "-"})`);
  const spread = snap.bestYesBid !== undefined && snap.bestYesAsk !== undefined ? snap.bestYesAsk - snap.bestYesBid : undefined;
  const spreadBps = spread !== undefined && snap.yesMid !== undefined && snap.yesMid > 0 ? (spread / snap.yesMid) * 10000 : undefined;
  console.log(`  spread     = ${spread !== undefined ? spread.toFixed(4) : "-"} ${spreadBps !== undefined ? `(${spreadBps.toFixed(1)} bps)` : ""}`);

  console.log(`\n[LIVE_INDEXER] fetchOrderBook ${yes} (raw, human units):`);
  console.log(`  bids (${rawBook.bids.length}):`);
  for (const [price, qty] of rawBook.bids.slice(0, 5)) {
    const notional = price * qty;
    const priceStr = price.toFixed(4);
    const probStr = (price * 100).toFixed(1) + "%";
    const qtyStr = qty.toFixed(4);
    console.log(`    BID ${priceStr} (${probStr}) x ${qtyStr} → notional ${notional.toFixed(4)} collateral`);
  }
  if (rawBook.bids.length === 0) console.log("    (empty)");
  console.log(`  asks (${rawBook.asks.length}):`);
  for (const [price, qty] of rawBook.asks.slice(0, 5)) {
    const notional = price * qty;
    console.log(`    ASK ${price.toFixed(4)} (${(price * 100).toFixed(1)}%) x ${qty.toFixed(4)} → notional ${notional.toFixed(4)}`);
  }
  if (rawBook.asks.length === 0) console.log("    (empty)");

  // Also show NO side book for completeness (NO price = 1 - YES complement, but book is quoted per outcome)
  try {
    const noBook = await ctx.exchange.fetchOrderBook(no, 3);
    console.log(`\n[LIVE_INDEXER] fetchOrderBook ${no} (3 levels, for reference): bids=${noBook.bids.length} asks=${noBook.asks.length}`);
    if (noBook.bids.length > 0) console.log(`  NO best bid=${noBook.bids[0]![0].toFixed(4)} x ${noBook.bids[0]![1].toFixed(4)}`);
    if (noBook.asks.length > 0) console.log(`  NO best ask=${noBook.asks[0]![0].toFixed(4)} x ${noBook.asks[0]![1].toFixed(4)}`);
  } catch (err) {
    console.warn(`[WARN] NO book fetch failed: ${(err as Error).message}`);
  }

  // Show raw onchain fee/collateral context (LIVE_ONCHAIN)
  const collateralOne = 10n ** BigInt(onchain.decimals);
  const oneHuman = Number(collateralOne) / Number(collateralOne);
  void oneHuman;
  console.log(`\n[LIVE_ONCHAIN] Collateral context:`);
  console.log(`  backing (raw) = ${onchain.backing.toString()} → ${formatUnits(onchain.backing, onchain.decimals)} collateral`);
  console.log(`  pool status finalized=${onchain.finalized}`);

  // Settlement / venue note
  console.log(`\n[INFO] EC order placement uses ec-core placeLimit (tick/lot as ints, via trader.placeOrder), not spot Pool.place. See docs/bot-kit-summary.md §8h.`);
  console.log(`[INFO] Settlement via redeemOutcome/settledMarkets; this script is read-only - no mint/claim sent.`);

  console.log(`\n=== Verification: hit real EC venue ${info.venueId ?? "?"} on chain ${cfg.chainId}, market ${info.marketId}, pool ${onchain.pool} ===`);

  await Promise.race([
    ctx.exchange.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error & { cause?: unknown };
  console.error(`\n[FATAL] discover-event-contracts failed: ${e.message}`);
  if (e.cause !== undefined && e.cause !== null) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const causeMsg = e.cause instanceof Error ? e.cause.message : String(e.cause);
    console.error(`Cause: ${causeMsg}`);
  }
  console.error(e.stack);
  process.exit(1);
});
