/**
 * EIP-7702 × Event Contracts - interface-compatibility probe (Stage 8, Step 1-2).
 *
 * QUESTION: can advanced/batch-7702's DreamDexVolumeBatch7702.atomicRoundTrip be pointed at an
 * EC (binary) pool unmodified? It calls the SPOT entry:
 *   placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs,
 *              uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)
 * (contracts/DreamDexVolumeBatch7702.sol:14-26; abi mirrors @somnia-chain/markets-sdk tradeAbi.js:60),
 * and measures inventory via ERC-20 balanceOf/approve on base/quote tokens.
 *
 * EC pools expose placeBinaryOrder(uint8 kind, ...) instead - the generic placeOrder REVERTS
 * UseBinaryPlacement on a binary pool (tradeAbi.js:11-19 comment; orders.js:514-531 encodes
 * placeBinaryOrder). EC outcome tokens are ERC-6909 id-based, so IERC20.balanceOf cannot measure them.
 *
 * This probe is READ-ONLY: eth_call simulations against a live EC pool on testnet. No signer,
 * no transactions, no deployment, no funds. Results are reported verbatim - success OR revert.
 *
 * Tags: selectors/ABI = DERIVED (from SDK source), pool address + revert data = LIVE_ONCHAIN.
 */
import { createPublicClient, http, defineChain, toFunctionSelector, encodeFunctionData, parseAbi, decodeErrorResult } from "viem";
import { createExchange, activeMarkets, marketOnchain } from "@dreamdex-bot-kit/ec-core";
import { CHAIN_IDS, NETWORK_DEFAULTS } from "../constants.js";

// Minimal error ABI for decoding probe reverts. Selectors verified against the SDK's
// 418-error table (dist/contractErrorsAbi.js, not exported from the package root) and/or
// SDK source docs (tradeAbi.js:12-19):
// - UseBinaryPlacement(): the binary-placement gate the spot path hits on an EC pool
// - QuantityBelowMinimum(uint256,uint256): pool minimum-quantity gate (observed 1 < 1000)
// - OrderAlreadyExpired(): order-expiry gate (fixed +1h probe expiry exceeded market expiry)
// - ERC20InsufficientAllowance(address,uint256,uint256): escrow gate on the EC binary path
const PROBE_ERROR_ABI = parseAbi([
  "error UseBinaryPlacement()",
  "error QuantityBelowMinimum(uint256 expected, uint256 received)",
  "error OrderAlreadyExpired()",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

const SPOT_PLACE_ORDER_SIG = "placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)";
const BINARY_PLACE_ORDER_SIG = "placeBinaryOrder(uint8,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64)";

// Probe inputs (DERIVED - eth_call cannot move state either way).
// - Quantity must exceed the pool minimum: both probe calls initially reverted
//   QuantityBelowMinimum(1, 1000), so 2000 raw is used to get past that gate.
// - Expiry must be <= the market's own expiryNs: a fixed +1h reverted OrderAlreadyExpired()
//   on short-interval markets, so the market's LIVE_ONCHAIN expiry is used instead (same
//   default the SDK's binaryOrderCall applies when expireTimestampNs is omitted).
const PROBE_PRICE_YES = 999_000n; // 0.999 in 1e6 raw - deep IOC buy
const PROBE_QUANTITY_RAW = 2_000n; // > minimum 1000 raw observed on-chain
const NS_PER_SECOND = 1_000_000_000n;
const PROBE_ORDER_TYPE_IOC = 2;
const PROBE_SELF_MATCH_CANCEL_TAKER = 0;
const PROBE_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const PROBE_ZERO_UINT64 = 0n;
const VENUE_ID_TESTNET = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";

function logResult(label: string, err: unknown): void {
  // Report the revert verbatim + walk the viem error cause chain for the raw revert data hex,
  // so error selectors can be checked against known pool errors - never guess at a reason.
  const e = err as { message?: string; data?: unknown; cause?: unknown };
  const fullMessage = e.message ?? String(err);
  const firstLine = fullMessage.split("\n")[0] ?? fullMessage;
  const detail = firstLine.slice(0, 200);
  console.log(`[probe] ${label}: REVERTED - ${detail}`);
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur !== null && typeof cur === "object"; depth += 1) {
    const c = cur as { data?: unknown; cause?: unknown };
    if (typeof c.data === "string" && c.data.startsWith("0x")) {
      console.log(`[probe] ${label}: revert data (depth ${depth}): ${c.data}`);
      try {
        const decoded = decodeErrorResult({ abi: PROBE_ERROR_ABI, data: c.data as `0x${string}` });
        const args = decoded.args?.map((a: unknown) => String(a)).join(", ") ?? "";
        console.log(`[probe] ${label}: decoded error: ${decoded.errorName}(${args})`);
      } catch (decodeErr) {
        console.log(`[probe] ${label}: not in probe error ABI: ${(decodeErr as Error).message.slice(0, 120)}`);
      }
      return;
    }
    cur = c.cause;
  }
}

async function main(): Promise<void> {
  // ── 1. Selector comparison (DERIVED) ────────────────────────────────────────
  const spotSelector = toFunctionSelector(SPOT_PLACE_ORDER_SIG);
  const binarySelector = toFunctionSelector(BINARY_PLACE_ORDER_SIG);
  console.log(`[probe] spot   selector ${SPOT_PLACE_ORDER_SIG} = ${spotSelector}`);
  console.log(`[probe] binary selector ${BINARY_PLACE_ORDER_SIG} = ${binarySelector}`);
  console.log(`[probe] selectors identical: ${spotSelector === binarySelector}`);
  // Known pool errors from the SDK's ABI comments (tradeAbi.js:12-19) - DERIVED
  const useBinaryPlacementSelector = toFunctionSelector("UseBinaryPlacement()");
  console.log(`[probe] UseBinaryPlacement() selector = ${useBinaryPlacementSelector}`);

  // ── 2. Live EC pool address (LIVE_ONCHAIN) ──────────────────────────────────
  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = VENUE_ID_TESTNET;
  const ctx = createExchange({ withSigner: false });
  const markets = await activeMarkets(ctx);
  const first = markets[0];
  if (!first) throw new Error("no active EC markets found - cannot probe");
  const onchain = await marketOnchain(ctx, first);
  if (!onchain) throw new Error(`marketOnchain returned null for ${first.symbol}`);
  const poolAddress = onchain.pool;
  // LIVE_ONCHAIN market expiry in ns - same default the SDK's binaryOrderCall applies when
  // expireTimestampNs is omitted; a fixed +1h probe expiry reverted OrderAlreadyExpired().
  const marketExpiryNs = BigInt(Math.floor(Number(onchain.expiry))) * NS_PER_SECOND;
  console.log(`[probe] live EC pool: ${poolAddress} (market ${first.symbol}, LIVE_ONCHAIN)`);
  await ctx.exchange.close();

  const client = createPublicClient({
    chain: defineChain({
      id: CHAIN_IDS.TESTNET,
      name: "somnia-testnet",
      nativeCurrency: { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
      rpcUrls: { default: { http: [NETWORK_DEFAULTS.testnet.rpcUrl] } },
    }),
    transport: http(NETWORK_DEFAULTS.testnet.rpcUrl),
  });

  // ── 3. eth_call: SPOT placeOrder signature against the EC pool (LIVE_ONCHAIN result) ──
  // This is exactly what DreamDexVolumeBatch7702._placeIoc does. Read-only simulation.
  const spotAbi = parseAbi([
    "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)",
  ]);
  const spotData = encodeFunctionData({
    abi: spotAbi,
    functionName: "placeOrder",
    args: [true, PROBE_ZERO_UINT64, PROBE_PRICE_YES, PROBE_QUANTITY_RAW, marketExpiryNs, PROBE_ORDER_TYPE_IOC, PROBE_SELF_MATCH_CANCEL_TAKER, PROBE_ZERO_ADDRESS, 0n],
  });
  try {
    const res = await client.call({ to: poolAddress, data: spotData });
    console.log(`[probe] eth_call SPOT placeOrder on EC pool: NO REVERT, return data: ${res.data ?? "(empty)"}`);
  } catch (err) {
    logResult("eth_call SPOT placeOrder on EC pool", err);
  }

  // ── 4. eth_call: EC's real entry placeBinaryOrder against the same pool ─────
  // Expected NOT to revert with UseBinaryPlacement (it is the binary path) - likely reverts on
  // escrow/allowance instead (real on-chain state read), which itself confirms it is the live entry.
  const binaryAbi = parseAbi([
    "function placeBinaryOrder(uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k, uint64 userData) payable returns (bool success, uint128 id)",
  ]);
  const binaryData = encodeFunctionData({
    abi: binaryAbi,
    functionName: "placeBinaryOrder",
    args: [0, PROBE_PRICE_YES, PROBE_QUANTITY_RAW, marketExpiryNs, PROBE_ORDER_TYPE_IOC, PROBE_SELF_MATCH_CANCEL_TAKER, PROBE_ZERO_ADDRESS, 0n, PROBE_ZERO_UINT64],
  });
  try {
    const res = await client.call({ to: poolAddress, data: binaryData });
    console.log(`[probe] eth_call placeBinaryOrder on EC pool: NO REVERT, return data: ${res.data ?? "(empty)"}`);
  } catch (err) {
    logResult("eth_call placeBinaryOrder on EC pool", err);
  }

  console.log("[probe] done - read-only, no state changed, nothing deployed.");
}

main().catch((err: Error) => {
  console.error(`[probe] fatal: ${err.message}`);
  process.exit(1);
});

