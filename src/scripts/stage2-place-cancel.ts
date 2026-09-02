/**
 * Stage 2 - One real Event Contract order lifecycle on Shannon testnet.
 * Precondition → discover longest-expiry ETH market → place deep GTC (limit) → verify → cancel → verify.
 * Uses src/ec/orderLifecycle.ts (simulate→broadcast→verify receipt→confirm event→update state).
 * Tags: LIVE_ONCHAIN = chain reads/receipts/events, DERIVED = computed, HISTORICAL not used.
 */

import { createExchange, activeMarkets, marketOnchain, snapshot, outcomeSymbols, MARKET_STATUS } from "@dreamdex-bot-kit/ec-core";
import { createOrderState, placeRestingOrder, cancelOrderLifecycle, readBalancesTagged } from "../ec/orderLifecycle.js";

async function main(): Promise<void> {
  console.log("=== Stage 2 - EC Order Lifecycle - Precondition Check ===\n");

  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
    process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
  }

  const ctx = createExchange({ withSigner: true });
  const addr = ctx.exchange.walletAddress;
  if (!addr) throw new Error("PRIVATE_KEY not set in .env - cannot run Stage 2 (needs funded wallet)");

  console.log(`Wallet: ${addr}`);
  console.log(`Network: ${ctx.config.network} chainId=${ctx.config.chainId} venue=${ctx.config.venueId ?? "(unset)"}`);

  // Precondition: read balances via viem (LIVE_ONCHAIN)
  const beforeBal = await readBalancesTagged(ctx);
  console.log(`\n[Precondition LIVE_ONCHAIN] Balances before:`);
  console.log(`  native STT: ${beforeBal.nativeWei.toString()} wei = ${beforeBal.nativeHuman.toFixed(6)} STT`);
  console.log(`  tUSDC: ${beforeBal.tUsdcRaw.toString()} raw = ${beforeBal.tUsdcHuman.toFixed(6)} tUSDC (collateral ${beforeBal.collateral})`);

  // STOP if either zero - do not simulate funding, report exactly what's missing
  if (beforeBal.nativeWei === 0n) {
    console.error("\n[STOP] native gas balance is 0 - cannot broadcast. Fund STT via https://testnet.somnia.network");
    await ctx.exchange.close().catch(() => undefined);
    process.exit(2);
  }
  // Require at least 5 tUSDC per brief (small test amount)
  const minTUsdcRaw = BigInt(5 * 10 ** ctx.config.decimals);
  if (beforeBal.tUsdcRaw < minTUsdcRaw) {
    console.error(
      `\n[STOP] tUSDC balance ${beforeBal.tUsdcHuman} < 5 - need ≥5 tUSDC to place test order. Mint via ec-core faucet/mint helper:`,
    );
    console.error("  - tUSDC faucet on testnet: ctx.exchange.trader.faucet() (when FAUCET_ENABLED, default true on testnet)");
    console.error("  - then mint a YES/NO set: ctx.exchange.mintSet(symbol, inventory) or seedInventory(ctx, market, onchain)");
    console.error("  See docs/event-contracts.md and packages/ec-core/src/inventory.ts:22-54");
    await ctx.exchange.close().catch(() => undefined);
    process.exit(2);
  }
  console.log(`[Precondition] PASS - both balances sufficient (native>0, tUSDC≥5)`);

  // Discover live EC markets (LIVE_INDEXER)
  const markets = await activeMarkets(ctx);
  console.log(`\n[LIVE_INDEXER] activeMarkets venue ${ctx.config.venueId} → ${markets.length} markets`);
  if (markets.length === 0) throw new Error("No active markets - cannot place order (venue may have moved, check VENUE_ID)");

  // Filter ETH markets and pick longest time-to-expiry (LIVE_ONCHAIN per market)
  const ethMarkets = markets.filter((m) => {
    const asset = (m.info as { asset?: string }).asset;
    return asset === "ETH";
  });
  const candidates = ethMarkets.length > 0 ? ethMarkets : markets;
  console.log(`  candidates (ETH preferred): ${candidates.length} markets`);

  let best: { market: typeof markets[number]; onchain: NonNullable<Awaited<ReturnType<typeof marketOnchain>>>; remaining: number } | null = null;
  for (const m of candidates) {
    const onchain = await marketOnchain(ctx, m);
    if (!onchain) continue;
    if (onchain.status !== MARKET_STATUS.Trading) continue;
    const remaining = Number(onchain.expiry) - Math.floor(Date.now() / 1000);
    if (remaining <= 0) continue;
    if (!best || remaining > best.remaining) best = { market: m, onchain, remaining };
  }
  if (!best) throw new Error("No tradable ETH market with time remaining - cannot place");
  const { market: target, onchain: targetOnchain, remaining } = best;
  const info = target.info as unknown as { marketId: string; expiry?: number | bigint; intervalSec?: number };
  const { yes } = outcomeSymbols(target);
  console.log(`\n[Selected] ${target.symbol} marketId=${info.marketId} expiry=${targetOnchain.expiry.toString()} remaining=${remaining}s (${(remaining / 60).toFixed(1)} min) pool=${targetOnchain.pool}`);

  // Read current YES book to price deep (LIVE_INDEXER)
  const snap = await snapshot(ctx, yes, 5);
  const rawBook = await ctx.exchange.fetchOrderBook(yes, 5);
  console.log(`\n[LIVE_INDEXER] snapshot ${yes}:`);
  console.log(`  bestYesBid=${snap.bestYesBid?.toFixed(4) ?? "-"} bestYesAsk=${snap.bestYesAsk?.toFixed(4) ?? "-"} mid=${snap.yesMid?.toFixed(4) ?? "-"}`);
  console.log(`  bids: ${rawBook.bids.map(([p, q]) => `${p.toFixed(4)}x${q.toFixed(2)}`).join(", ")}`);
  console.log(`  asks: ${rawBook.asks.map(([p, q]) => `${p.toFixed(4)}x${q.toFixed(2)}`).join(", ")}`);

  if (snap.bestYesBid === undefined) throw new Error(`No bids on ${yes} - cannot price deep resting order (book empty side)`);

  // Price 10% below best bid, away from touch, GTC (limit). Use DERIVED computation.
  const rawPrice = snap.bestYesBid * 0.9; // DERIVED - 10% below best bid
  // Clamp to (0.01,0.99) per gotchas
  const price = Math.min(0.99, Math.max(0.01, rawPrice)); // DERIVED
  console.log(`\n[DERIVED] deep price: bestBid ${snap.bestYesBid.toFixed(4)} *0.9 = ${price.toFixed(4)} (tick-snapped by placeLimit as integer)`);

  // Size at minimum lot - quantize to lot grid (DERIVED). Use 1 share or min lot whichever larger.
  // Testnet lot=1 raw (0.000001), so 1 share is safely above lot. Use lot-aware size.
  const lotHuman = Number(ctx.config.lot) / 10 ** ctx.config.decimals; // DERIVED
  const wantSize = Math.max(lotHuman * 2, 1); // DERIVED - 1 share, at least 2*lots
  console.log(`[DERIVED] wantSize ${wantSize} (lotHuman=${lotHuman})`);

  // Internal state tracker
  const state = createOrderState();

  // Snapshot open orders before (LIVE_ONCHAIN)
  const openBefore = await ctx.exchange.fetchOpenOrders(yes).catch(() => []);
  console.log(`\n[LIVE_ONCHAIN] open orders before on ${yes}: ${openBefore.length}`);

  // Place resting order (GTC limit) - lifecycle does simulate→broadcast→verify receipt→confirm event→update state
  console.log(`\n[Lifecycle] placeRestingOrder ${yes} YES buy ${wantSize}@${price.toFixed(4)} type=limit (GTC) …`);
  const placed = await placeRestingOrder({
    ctx,
    market: target,
    onchain: targetOnchain,
    outcome: "YES",
    side: "buy",
    price,
    size: wantSize,
    yesSymbol: yes,
    state,
  });

  console.log(`[LIVE_ONCHAIN] Place verified:`);
  console.log(`  txHash: ${placed.txHash}`);
  console.log(`  block: ${placed.blockNumber.toString()} status=${placed.status} gasUsed=${placed.gasUsed.toString()}`);
  console.log(`  orderId: ${placed.orderId?.toString() ?? "(none)"} rested=${placed.rested} filled=${placed.filled}`);
  console.log(`  snapped price=${placed.price.toFixed(4)} size=${placed.size} symbol=${placed.symbol}`);
  console.log(`  confirmedInOpenOrders: ${placed.confirmedInOpenOrders}`);

  // Verify order appears in open orders (LIVE_ONCHAIN second check)
  const openAfterPlace = await ctx.exchange.fetchOpenOrders(yes);
  console.log(`[LIVE_ONCHAIN] open orders after place: ${openAfterPlace.length} ids=${openAfterPlace.map((o) => String(o.id)).join(", ")}`);
  const foundAfter = openAfterPlace.some((o) => String(o.id) === String(placed.orderId));
  console.log(`[DERIVED] order still resting after place: ${foundAfter}`);

  if (!placed.orderId) throw new Error("Placed order missing orderId - unexpected for resting GTC");

  // Snapshot balances after place (LIVE_ONCHAIN) - escrow should have locked collateral
  const afterPlaceBal = await readBalancesTagged(ctx);
  console.log(`\n[LIVE_ONCHAIN] balances after place:`);
  console.log(`  native: ${afterPlaceBal.nativeWei.toString()} (${afterPlaceBal.nativeHuman.toFixed(6)})`);
  console.log(`  tUSDC: ${afterPlaceBal.tUsdcRaw.toString()} (${afterPlaceBal.tUsdcHuman.toFixed(6)})`);
  console.log(`  delta native: ${(afterPlaceBal.nativeHuman - beforeBal.nativeHuman).toFixed(6)} (gas)`);
  console.log(`  delta tUSDC: ${(afterPlaceBal.tUsdcHuman - beforeBal.tUsdcHuman).toFixed(6)} (escrow locked, wallet+vault)`);
  // EC buy escrow leaves wallet (collateral locked) - wallet balance should decrease by price*size approx
  const expectedEscrow = placed.price * placed.size;
  console.log(`[DERIVED] expected escrow ~${expectedEscrow.toFixed(6)} tUSDC (price*size)`);

  // Cancel the resting order - lifecycle verifies receipt and absence from open orders
  console.log(`\n[Lifecycle] cancelOrder ${placed.orderId.toString()} on ${yes} …`);
  const cancelled = await cancelOrderLifecycle({
    ctx,
    onchain: targetOnchain,
    orderId: placed.orderId,
    yesSymbol: yes,
    state,
  });

  console.log(`[LIVE_ONCHAIN] Cancel verified:`);
  console.log(`  txHash: ${cancelled.txHash}`);
  console.log(`  block: ${cancelled.blockNumber.toString()} status=${cancelled.status} gasUsed=${cancelled.gasUsed.toString()}`);
  console.log(`  orderId: ${cancelled.orderId.toString()} stillOpen=${cancelled.stillOpen}`);

  // Verify no open orders remain for this venue (LIVE_ONCHAIN)
  const openAfterCancel = await ctx.exchange.fetchOpenOrders(yes);
  console.log(`[LIVE_ONCHAIN] open orders after cancel: ${openAfterCancel.length} ids=${openAfterCancel.map((o) => String(o.id)).join(", ")}`);

  const stillOpen = openAfterCancel.some((o) => String(o.id) === String(placed.orderId));
  console.log(`[DERIVED] cancelled order still resting: ${stillOpen}`);

  // Final balances (LIVE_ONCHAIN) - escrow should have returned to wallet, wallet back near before (minus gas)
  const finalBal = await readBalancesTagged(ctx);
  console.log(`\n[LIVE_ONCHAIN] balances final (after cancel):`);
  console.log(`  native: ${finalBal.nativeWei.toString()} (${finalBal.nativeHuman.toFixed(6)})`);
  console.log(`  tUSDC: ${finalBal.tUsdcRaw.toString()} (${finalBal.tUsdcHuman.toFixed(6)})`);
  console.log(`  delta vs before native: ${(finalBal.nativeHuman - beforeBal.nativeHuman).toFixed(6)} (gas spent)`);
  console.log(`  delta vs before tUSDC: ${(finalBal.tUsdcHuman - beforeBal.tUsdcHuman).toFixed(6)} (should be ~0, escrow returned)`);

  // Check state cleanliness (DERIVED mirror of LIVE_ONCHAIN)
  console.log(`\n[DERIVED] internal state openOrders size: ${state.openOrders.size} (expected 0)`);
  const isClean = state.openOrders.size === 0 && !stillOpen;
  console.log(`[DERIVED] wallet clean: ${isClean}`);

  if (!isClean) throw new Error("Wallet not clean at end - order still tracked or resting");

  // Prepare data for verification file - print JSON for capture by runner
  const verificationPayload = {
    wallet: addr,
    market: {
      symbol: target.symbol,
      marketId: (target.info as { marketId: string }).marketId,
      yesSymbol: yes,
      pool: targetOnchain.pool,
      marketAddress: targetOnchain.marketAddress,
      expiry: targetOnchain.expiry.toString(),
      isoExpiry: new Date(Number(targetOnchain.expiry) * 1000).toISOString(),
      venueId: (target.info as { venueId?: string }).venueId,
    },
    balances: {
      before: { nativeWei: beforeBal.nativeWei.toString(), tUsdcRaw: beforeBal.tUsdcRaw.toString() },
      afterPlace: { nativeWei: afterPlaceBal.nativeWei.toString(), tUsdcRaw: afterPlaceBal.tUsdcRaw.toString() },
      final: { nativeWei: finalBal.nativeWei.toString(), tUsdcRaw: finalBal.tUsdcRaw.toString() },
    },
    place: {
      txHash: placed.txHash,
      blockNumber: placed.blockNumber.toString(),
      orderId: placed.orderId?.toString(),
      price: placed.price,
      size: placed.size,
      status: placed.status,
      gasUsed: placed.gasUsed.toString(),
      confirmedInOpenOrders: placed.confirmedInOpenOrders,
    },
    cancel: {
      txHash: cancelled.txHash,
      blockNumber: cancelled.blockNumber.toString(),
      orderId: cancelled.orderId.toString(),
      status: cancelled.status,
      gasUsed: cancelled.gasUsed.toString(),
      stillOpen: cancelled.stillOpen,
    },
  };
  console.log("\n[VERIFICATION_JSON] " + JSON.stringify(verificationPayload, null, 2));

  await Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  console.log("\n=== Stage 2 verified: one resting order round-tripped, wallet clean ===");
  process.exit(0);
}

main().catch((err: unknown) => {
  const e = err as Error & { cause?: unknown };
  console.error(`\n[FATAL] stage2 failed: ${e.message}`);
  if (e.cause !== undefined && e.cause !== null) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const msg = e.cause instanceof Error ? e.cause.message : String(e.cause);
    console.error(`Cause: ${msg}`);
  }
  console.error(e.stack);
  process.exit(1);
});
