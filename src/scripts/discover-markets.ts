/**
 * Read-only proof of connection to DreamDEX on Somnia testnet.
 * Uses the Bot Kit client (public RPC + REST) - no private key required.
 *
 * Steps:
 *  1. Connect to Somnia testnet (RPC + REST) using @dreamdex-bot-kit/core config
 *  2. List real available DreamDEX markets (LIVE_ONCHAIN via REST and on-chain)
 *  3. For one real contract, print metadata, market state, best bid/ask, spread, mid, tick/lot
 *
 * Data tags: LIVE_ONCHAIN = direct chain/REST read, DERIVED = computed from live, HISTORICAL = cached candles, ESTIMATED = synthetic.
 */

import { createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../config.js";
import { CHAIN_IDS } from "../constants.js";
import { getNetwork, toViemChain, DreamDexRest, readPoolParams, readBookLevels, type MarketInfo } from "@dreamdex-bot-kit/core";

// Explicit return type per global rules
async function main(): Promise<void> {
  const cfg = loadConfig();
  console.log("=== DreamDEX Trading Intelligence - Stage 1 Discovery ===\n");
  console.log(`Network    : ${cfg.network} (chainId=${cfg.chainId})`);
  console.log(`RPC URL    : ${cfg.somniaRpcUrl}`); // DERIVED from env / default
  console.log(`REST API   : ${cfg.dreamdexApiBase}`);
  console.log(`WS URL     : ${cfg.dreamdexWsUrl}`);

  // Validate chain ID constant usage (no magic numbers)
  if (cfg.chainId !== CHAIN_IDS.TESTNET && cfg.chainId !== CHAIN_IDS.MAINNET) {
    throw new Error(`Unsupported CHAIN_ID=${cfg.chainId}. Expected ${CHAIN_IDS.TESTNET} or ${CHAIN_IDS.MAINNET}.`);
  }

  const net = getNetwork(); // LIVE_ONCHAIN config derived from NETWORK env synced by loadConfig()
  console.log(`Bot Kit net: ${net.name} (chainId=${net.chainId}, rpc=${net.rpcUrl})\n`);

  // --- Public client (LIVE_ONCHAIN) - no wallet needed for reads ---
  const chain = toViemChain(net);
  const publicClient = createPublicClient({ chain, transport: http(net.rpcUrl) });

  // Verify RPC connectivity by fetching chain ID + block number
  let rpcChainId: number;
  let blockNumber: bigint;
  try {
    rpcChainId = await publicClient.getChainId(); // LIVE_ONCHAIN
    blockNumber = await publicClient.getBlockNumber(); // LIVE_ONCHAIN
    console.log(`[RPC] Connected - chainId=${rpcChainId}, block=${blockNumber}`);
    if (rpcChainId !== net.chainId) {
      console.warn(`[WARN] RPC chainId ${rpcChainId} != configured ${net.chainId}. Check RPC_URL / NETWORK.`);
    }
  } catch (err) {
    throw new Error(`Failed to connect to Somnia RPC ${net.rpcUrl}: ${(err as Error).message}`, { cause: err });
  }

  // --- REST: list markets (LIVE_ONCHAIN) ---
  // DreamDexRest requires an Account even for public endpoints (constructor param).
  // For read-only proof, use a deterministic dummy account - fetchMarkets() uses auth:false so no SIWE.
  const dummyAccount = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
  const rest = new DreamDexRest(net, dummyAccount);

  let markets: MarketInfo[];
  try {
    markets = await rest.fetchMarkets(); // LIVE_ONCHAIN - GET /v0/markets
    console.log(`\n[REST] GET ${net.restApi}/markets → ${markets.length} market(s)`);
    for (const m of markets) {
      console.log(
        `  - ${m.symbol} pool=${m.contract} base=${m.base} quote=${m.quote} ` +
          `tick=${m.tickSize} lot=${m.lotSize} minQty=${m.minQuantity} ` +
          `baseDecimals=${m.baseDecimals} quoteDecimals=${m.quoteDecimals}`,
      );
    }
    if (markets.length === 0) {
      throw new Error("No markets returned from REST - cannot proceed to market detail.");
    }
  } catch (err) {
    throw new Error(`Failed to fetch markets from ${net.restApi}/markets: ${(err as Error).message}`, { cause: err });
  }

  // Also try raw fetch to show HTTP-level verification (same LIVE_ONCHAIN data)
  try {
    const rawRes = await fetch(`${net.restApi}/markets`);
    console.log(`[REST raw] GET /markets status=${rawRes.status}`);
  } catch (err) {
    console.warn(`[WARN] Raw fetch failed (non-fatal): ${(err as Error).message}`);
  }

  // --- Pick one real contract for deep inspection ---
  // Prefer SOMI:USDso if present (most liquid), else first returned
  const target = markets.find((m) => m.symbol === "SOMI:USDso") ?? markets[0];
  if (!target) throw new Error("Target market selection failed (no markets).");

  console.log(`\n=== Deep inspection: ${target.symbol} (${target.contract}) ===`);

  // LIVE_ONCHAIN - on-chain pool params
  let poolParams: Awaited<ReturnType<typeof readPoolParams>>;
  try {
    poolParams = await readPoolParams(publicClient, target.contract);
    console.log(`[LIVE_ONCHAIN] getPoolParams:`);
    console.log(`  baseToken  = ${poolParams.baseToken}`);
    console.log(`  quoteToken = ${poolParams.quoteToken}`);
    console.log(`  makerFee   = ${poolParams.makerFeeBpsTimes1k} (bps*1000)`);
    console.log(`  takerFee   = ${poolParams.takerFeeBpsTimes1k} (bps*1000)`);
    console.log(`  tickSize   = ${poolParams.tickSize.toString()} raw = ${formatUnits(poolParams.tickSize, target.quoteDecimals)} quote`);
    console.log(`  lotSize    = ${poolParams.lotSize.toString()} raw = ${formatUnits(poolParams.lotSize, target.baseDecimals)} base`);
    console.log(`  minQuantity= ${poolParams.minQuantity.toString()} raw = ${formatUnits(poolParams.minQuantity, target.baseDecimals)} base`);
  } catch (err) {
    throw new Error(`getPoolParams failed for ${target.symbol} ${target.contract}: ${(err as Error).message}`, { cause: err });
  }

  // LIVE_ONCHAIN - order book levels (on-chain, canonical)
  let bids: Awaited<ReturnType<typeof readBookLevels>>;
  let asks: Awaited<ReturnType<typeof readBookLevels>>;
  try {
    [bids, asks] = await Promise.all([
      readBookLevels(publicClient, target.contract, true, 5), // LIVE_ONCHAIN
      readBookLevels(publicClient, target.contract, false, 5), // LIVE_ONCHAIN
    ]);
  } catch (err) {
    throw new Error(`getBookLevels failed for ${target.contract}: ${(err as Error).message}`, { cause: err });
  }

  const formatLevel = (priceRaw: bigint, sizeRaw: bigint): string => {
    const price = Number(formatUnits(priceRaw, target.quoteDecimals));
    const size = Number(formatUnits(sizeRaw, target.baseDecimals));
    return `${price.toFixed(6)} x ${size.toFixed(4)}`;
  };

  console.log(`[LIVE_ONCHAIN] getBookLevels (depth 5):`);
  console.log(`  bids (${bids.length} levels): ${bids.length === 0 ? "(empty)" : ""}`);
  for (const l of bids) console.log(`    BID ${formatLevel(l.priceRaw, l.sizeRaw)}`);
  console.log(`  asks (${asks.length} levels): ${asks.length === 0 ? "(empty)" : ""}`);
  for (const l of asks) console.log(`    ASK ${formatLevel(l.priceRaw, l.sizeRaw)}`);

  // DERIVED - best bid/ask, mid, spread
  const bestBidRaw = bids[0]?.priceRaw;
  const bestAskRaw = asks[0]?.priceRaw;
  const bestBid = bestBidRaw !== undefined ? Number(formatUnits(bestBidRaw, target.quoteDecimals)) : undefined;
  const bestAsk = bestAskRaw !== undefined ? Number(formatUnits(bestAskRaw, target.quoteDecimals)) : undefined;
  const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : undefined;
  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : undefined;
  const spreadBps = mid !== undefined && spread !== undefined && mid > 0 ? (spread / mid) * 10_000 : undefined;

  console.log(`[DERIVED] Market state:`);
  console.log(`  bestBid = ${bestBid !== undefined ? bestBid.toFixed(6) : "- (no bids)"}`);
  console.log(`  bestAsk = ${bestAsk !== undefined ? bestAsk.toFixed(6) : "- (no asks)"}`);
  console.log(`  mid     = ${mid !== undefined ? mid.toFixed(6) : "-"}`);
  console.log(`  spread  = ${spread !== undefined ? spread.toFixed(6) : "-"} ${spreadBps !== undefined ? `(${spreadBps.toFixed(2)} bps)` : ""}`);
  console.log(`  expiry  : N/A for spot - spot pools have no market expiry (orders carry expireTimestampNs per order; see gotchas.md #2)`);
  console.log(`  pool    : ${target.contract}`);
  console.log(`  REST base/quote decimals: ${target.baseDecimals}/${target.quoteDecimals}`);

  // LIVE_ONCHAIN - REST orderbook snapshot (DERIVED comparison, can lag per gotchas #16)
  try {
    const ob = await rest.fetchOrderbooks([target.symbol], 5); // LIVE_ONCHAIN via REST (may lag)
    console.log(`\n[LIVE_ONCHAIN via REST] fetchOrderbooks depth 5 (may lag on-chain by seconds):`);
    console.log(JSON.stringify(ob, null, 2).slice(0, 2000));
  } catch (err) {
    console.warn(`[WARN] REST fetchOrderbooks failed: ${(err as Error).message}`);
  }

  // Verify SIWE auth not needed for reads
  console.log(`\n[INFO] Read-only proof completed without WALLET_PRIVATE_KEY - REST + RPC reads require no funds or signature.`);
  if (cfg.walletPrivateKey) {
    console.log(`[INFO] WALLET_PRIVATE_KEY is set (length ${cfg.walletPrivateKey.length}) - would be used for Stage 2 order placement.`);
  } else {
    console.log(`[INFO] WALLET_PRIVATE_KEY not set - expected for Stage 1 read-only.`);
  }

  console.log(`\n=== Verification: hit real Somnia testnet chain ${rpcChainId}, block ${blockNumber}, pool ${target.contract} ===`);
}

main().catch((err: unknown) => {
  // No silent catch - surface with context and exit non-zero
  const e = err as Error & { cause?: unknown };
  console.error(`\n[FATAL] discover-markets failed: ${e.message}`);
  if (e.cause !== undefined && e.cause !== null) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const causeMsg = e.cause instanceof Error ? e.cause.message : String(e.cause);
    console.error(`Cause: ${causeMsg}`);
  }
  console.error(e.stack);
  process.exit(1);
});
