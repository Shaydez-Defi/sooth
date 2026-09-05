var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// vendor/dreamdex-bot-kit/packages/ec-core/src/markets.ts
function inVenue(scope, market) {
  if (market.info.marketType !== "BINARY") return false;
  const info = market.info;
  if (scope.venueId) return sameVenue(info.venueId, scope.venueId);
  if (scope.operatorId !== void 0) return info.operatorId === scope.operatorId;
  return true;
}
async function activeMarkets(ctx, opts = {}) {
  const { config } = ctx;
  const all = Object.values(await ctx.exchange.loadMarkets(true));
  let live = all.filter((m) => m.type === "binary" && m.active);
  const scope = config.venueId ? { venueId: config.venueId } : config.operatorId !== void 0 ? { operatorId: config.operatorId } : {};
  if (scope.venueId || scope.operatorId !== void 0) {
    live = live.filter((m) => inVenue(scope, m));
  } else {
    const venues = [...new Set(live.map((m) => String(venueOf(m) ?? "").toLowerCase()))];
    if (venues.length > 1) {
      const detail = venues.map((v) => {
        const m = live.find((x) => sameVenue(venueOf(x), v));
        return `${v} (operatorId ${m ? operatorOf(m) : "?"})`;
      }).join(", ");
      throw new Error(
        `Live markets span ${venues.length} venues: ${detail}. Set VENUE_ID (or OPERATOR_ID) in .env to scope to the DreamDEX venue.`
      );
    }
  }
  return live.filter((m) => opts.asset ? m.info.marketType === "BINARY" && m.info.asset === opts.asset : true).slice(0, opts.max ?? config.maxMarkets);
}
async function marketOnchain(ctx, market) {
  if (market.info.marketType !== "BINARY") return null;
  return ctx.exchange.client.getMarketOnchain(market.info.marketId);
}
function outcomeSymbols(market) {
  const outs = market.outcomes ?? [];
  return { yes: outs[0]?.symbol ?? `${market.symbol}#YES`, no: outs[1]?.symbol ?? `${market.symbol}#NO` };
}
var sameVenue, venueOf, operatorOf;
var init_markets = __esm({
  "vendor/dreamdex-bot-kit/packages/ec-core/src/markets.ts"() {
    "use strict";
    sameVenue = (a, b) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
    venueOf = (m) => m.info.marketType === "BINARY" ? m.info.venueId ?? null : null;
    operatorOf = (m) => m.info.marketType === "BINARY" ? m.info.operatorId ?? null : null;
  }
});

// src/api/server.ts
import Fastify from "fastify";
import cors from "@fastify/cors";

// vendor/dreamdex-bot-kit/packages/ec-core/src/exchange.ts
import { SomniaMarkets } from "@somnia-chain/markets-sdk";

// vendor/dreamdex-bot-kit/packages/ec-core/src/config.ts
import { defineChain } from "viem";
import { SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";

// vendor/dreamdex-bot-kit/packages/ec-core/src/addresses.ts
var CORE = {
  binaryModule: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  marketsCore: "0x2802504314685D89bF6C992CA5a8e7cC78bc0294",
  clobFactory: "0xb2BE8EE02F96379DB75f01802384593EBa9bfF04",
  binaryPoolImpl: "0x82A1FcdaA2daC2fC7D5f9909D43E68021eE966FD",
  binarySettlement: "0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23",
  collateralRouter: "0xbC0C9834B15ACE38bB50dDaa7d7f7C7CC4DC183C",
  marketCreatorFactory: "0xE6bEE93cE87c9E6e62aCb621caa7832EE47b4F6B",
  oracleHub: "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b"
};
var DEPLOYMENTS = {
  testnet: {
    chainId: 50312,
    decimals: 6,
    addresses: {
      ...CORE,
      // TestUSDC faucet (public `faucet(uint256)`, 6 dp)
      collateral: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
      testUsdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
      // venue 2's creator — the venue the LIVE markets sit on (venue 1's
      // creator 0x46fB24… is idle). Only used as an extra live-tail discovery
      // source; the module (which emits every MarketCreated) covers discovery
      // regardless, so a stale value here degrades nothing.
      marketCreator: "0x5Ce69567dB39C8fBAd7e048bEfdbcCdfE67B44e6"
    }
  },
  mainnet: {
    chainId: 5031,
    decimals: 18,
    addresses: {
      ...CORE,
      // USDso — a real stablecoin, 18 dp, no faucet
      collateral: "0x00000022dA000002656c64D9eA6011ea952D008A",
      testUsdc: "0x00000022dA000002656c64D9eA6011ea952D008A",
      marketCreator: "0x62627805965705Cc303A7F6282DD5059921980aD"
    }
  }
};

// vendor/dreamdex-bot-kit/packages/ec-core/src/config.ts
import { config as dotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
var envLoaded = false;
function loadEnv(startDir = process.cwd()) {
  if (envLoaded) return;
  envLoaded = true;
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return void dotenv({ path: candidate });
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dotenv();
}
var num = (name, def) => process.env[name] ? Number(process.env[name]) : def;
var ADDRESS_OVERRIDES = {
  COLLATERAL: "collateral",
  TEST_USDC: "testUsdc",
  BINARY_MODULE: "binaryModule",
  MARKETS_CORE: "marketsCore",
  MARKET_CREATOR: "marketCreator",
  CLOB_FACTORY: "clobFactory",
  BINARY_POOL_IMPL: "binaryPoolImpl",
  BINARY_SETTLEMENT: "binarySettlement",
  COLLATERAL_ROUTER: "collateralRouter",
  MARKET_CREATOR_FACTORY: "marketCreatorFactory",
  ORACLE_HUB: "oracleHub"
};
function resolvePriceFeed(net) {
  const url = (process.env.PRICE_FEED_URL ?? "").trim();
  const quote = (process.env.PRICE_FEED_QUOTE ?? "").trim();
  const base = net === "testnet" ? SOMNIA_TESTNET_PRICE_FEED : void 0;
  if (!url && !base) return void 0;
  return {
    url: url || base.url,
    quote: quote || base?.quote || "USDC"
  };
}
function resolveAddresses(net) {
  const out = { ...DEPLOYMENTS[net].addresses };
  for (const [envVar, key] of Object.entries(ADDRESS_OVERRIDES)) {
    const v = (process.env[envVar] ?? "").trim();
    if (v) out[key] = v;
  }
  return out;
}
var ENDPOINTS = {
  // One host per environment since the terraform migration (somnia-markets
  // PR #130): dev.smk = testnet, prd.smk = mainnet, chain at the ROOT path.
  testnet: {
    rpc: "https://api.infra.testnet.somnia.network",
    ws: "wss://api.infra.testnet.somnia.network/ws",
    indexer: "https://dev.smk.somnia.host/v1/graphql"
  },
  // Mainnet (chainId 5031) — the live USDso venue.
  mainnet: {
    rpc: "https://api.infra.mainnet.somnia.network",
    ws: "wss://api.infra.mainnet.somnia.network/ws",
    indexer: "https://prd.smk.somnia.host/v1/graphql"
  }
};
function loadConfig() {
  loadEnv();
  const raw = (process.env.NETWORK ?? process.env.DEPLOY_ENV ?? "testnet").toLowerCase();
  const network = raw === "mainnet" ? "mainnet" : "testnet";
  const deployment = DEPLOYMENTS[network];
  const ep = ENDPOINTS[network];
  const pk = (process.env.PRIVATE_KEY ?? process.env.TAKER_PRIVATE_KEY ?? "").trim();
  const venueId = (process.env.VENUE_ID ?? "").trim();
  const operatorId = (process.env.OPERATOR_ID ?? "").trim();
  return {
    network,
    chainId: num("CHAIN_ID", deployment.chainId),
    rpcUrl: process.env.RPC_URL ?? ep.rpc,
    wsRpcUrl: process.env.WS_RPC_URL ?? ep.ws,
    indexerUrl: process.env.INDEXER_URL ?? ep.indexer,
    addresses: resolveAddresses(network),
    decimals: num("DECIMALS", deployment.decimals),
    venueId: venueId ? venueId : void 0,
    operatorId: operatorId ? Number(operatorId) : void 0,
    privateKey: pk ? pk : void 0,
    priceFeed: resolvePriceFeed(network),
    // Book granularity. The binary venue's tick/lot are NOT discoverable through
    // the SDK (binary market rows carry no tickSize/lotSize, unlike spot/perp),
    // so they come from config.
    //   mainnet: 1e15 for both, per venues.json `bookParams` on the USDso venue.
    //   testnet: measured — the venue accepted orders down to 1 raw unit
    //            (0.000001 share), i.e. no lot constraint in practice.
    // Override if a venue tightens them.
    tick: BigInt(num("MM_TICK", network === "mainnet" ? 1e15 : 1e3)),
    lot: BigInt(num("MM_LOT", network === "mainnet" ? 1e15 : 1)),
    inventory: num("MM_INVENTORY", network === "mainnet" ? 1 : 200),
    maxMarkets: num("MM_MAX_MARKETS", 8),
    faucetEnabled: process.env.FAUCET_ENABLED !== void 0 ? process.env.FAUCET_ENABLED !== "false" : network !== "mainnet",
    dryRun: (process.env.DRY_RUN ?? "true") !== "false" && process.env.DRY_RUN !== "0"
  };
}
function makeChain(cfg) {
  return defineChain({
    id: cfg.chainId,
    name: `somnia-${cfg.chainId}`,
    nativeCurrency: cfg.chainId === 5031 ? { name: "Somnia", symbol: "SOMI", decimals: 18 } : { name: "Somnia Test Token", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl], webSocket: [cfg.wsRpcUrl] } }
  });
}

// vendor/dreamdex-bot-kit/packages/ec-core/src/exchange.ts
function createExchange(opts = {}) {
  loadEnv();
  const config = loadConfig();
  if (opts.withSigner && !config.privateKey) {
    throw new Error(
      "PRIVATE_KEY is required for trading. Set it in .env (a funded key that DIFFERS from any quoter's \u2014 self-matching is blocked), or run a read-only example."
    );
  }
  const exchange = new SomniaMarkets({
    indexerUrl: config.indexerUrl,
    chain: makeChain(config),
    wsRpcUrl: config.wsRpcUrl,
    addresses: config.addresses,
    // Underlying-asset price feed (BTC/ETH spot + EMA mark). Required by
    // exchange.fetchPrice / watchPrice; every other verb ignores it.
    priceFeed: config.priceFeed,
    // Only opened for writes. Signs locally with fixed fees + a tracked nonce,
    // confirming in one round-trip via realtime_sendRawTransaction.
    privateKey: opts.withSigner ? config.privateKey : void 0
  });
  return { exchange, config, canTrade: Boolean(config.privateKey) };
}
function assertTxOk(res, label = "transaction") {
  if (res?.receipt?.status === "reverted") {
    throw new Error(`${label} REVERTED on-chain (tx ${res.hash ?? "?"}) \u2014 the SDK does not throw on a reverted receipt; check market status / balances and retry deliberately.`);
  }
}

// vendor/dreamdex-bot-kit/packages/ec-core/src/index.ts
init_markets();

// vendor/dreamdex-bot-kit/packages/ec-core/src/inventory.ts
init_markets();

// vendor/dreamdex-bot-kit/packages/ec-core/src/orders.ts
import { ORDER_TYPE } from "@somnia-chain/markets-sdk";
var SIDES = {
  "YES-buy": "BUY_YES",
  "YES-sell": "SELL_YES",
  "NO-buy": "BUY_NO",
  "NO-sell": "SELL_NO"
};
function toSteps(human, one, step, mode) {
  const stepsPerOne = Number(one / step);
  const n = human * stepsPerOne;
  const steps = mode === "round" ? Math.round(n) : Math.floor(n + 1e-9);
  return BigInt(Math.max(0, steps)) * step;
}
async function placeLimit(ctx, args) {
  const { market, onchain, outcome, side, type = "post-only" } = args;
  const one = 10n ** BigInt(ctx.config.decimals);
  const quantity = toSteps(args.size, one, ctx.config.lot, "floor");
  const priceOwn = toSteps(args.price, one, ctx.config.tick, "round");
  if (quantity <= 0n) {
    return { rested: false, filled: 0, size: 0, price: Number(priceOwn) / Number(one) };
  }
  if (priceOwn <= 0n || priceOwn >= one) {
    throw new Error(`price ${args.price} is outside (0, 1) after snapping to the tick grid`);
  }
  const priceYes = outcome === "YES" ? priceOwn : one - priceOwn;
  const nowSec = Math.floor(Date.now() / 1e3);
  const wanted = nowSec + (args.expiresInSec ?? 300);
  const expiresAt = Math.min(wanted, Number(onchain.expiry));
  if (expiresAt <= nowSec) {
    return { rested: false, filled: 0, size: 0, price: Number(priceOwn) / Number(one) };
  }
  await assertFunded(ctx, onchain, outcome, side, priceOwn, quantity);
  const res = await ctx.exchange.trader.placeOrder({
    pool: onchain.pool,
    side: SIDES[`${outcome}-${side}`],
    price: priceYes,
    quantity,
    outcomeToken: onchain.outcomeToken,
    yesId: onchain.yesId,
    noId: onchain.noId,
    orderType: type === "post-only" ? ORDER_TYPE.POST_ONLY : type === "ioc" ? ORDER_TYPE.MARKET : ORDER_TYPE.LIMIT,
    expireTimestampNs: BigInt(expiresAt) * 1000000000n
  });
  assertTxOk(res, `${SIDES[`${outcome}-${side}`]} ${market.symbol}`);
  const filledRaw = (res.fills ?? []).reduce((acc, f) => acc + f.quantityFilled, 0n);
  const rested = res.orderId !== void 0 && filledRaw < quantity;
  if (rested) restingOrders.set(String(res.orderId), onchain);
  return {
    rested,
    orderId: res.orderId,
    filled: Number(filledRaw) / Number(one),
    size: Number(quantity) / Number(one),
    price: Number(priceOwn) / Number(one),
    hash: res.hash
  };
}
async function assertFunded(ctx, onchain, outcome, side, priceOwn, quantity) {
  const { client } = ctx.exchange;
  const me = ctx.exchange.walletAddress;
  if (!me) return;
  const gas = await client.getViemClient().getBalance({ address: me });
  if (gas === 0n) {
    throw new Error(`out of gas: ${me} holds 0 native token on ${ctx.config.network}. Fund it to trade.`);
  }
  if (side === "sell") {
    const id = outcome === "YES" ? onchain.yesId : onchain.noId;
    const held = await client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: me, id });
    if (held < quantity) {
      throw new Error(
        `not enough ${outcome} to sell: hold ${held}, need ${quantity} (raw). Selling needs inventory \u2014 mint a complete set first, there is no naked short.`
      );
    }
    return;
  }
  const need = priceOwn * quantity / 10n ** BigInt(ctx.config.decimals);
  const [wallet, vault] = await Promise.all([
    client.getErc20Balance(onchain.collateral, me),
    client.getVaultBalance({ vault: onchain.pool, owner: me, token: onchain.collateral }).catch(() => 0n)
  ]);
  if (wallet + vault < need) {
    throw new Error(
      `not enough collateral: have ${wallet + vault}, need ${need} (raw) for ${outcome} buy. Fund ${onchain.collateral} \u2192 ${me}.`
    );
  }
}
var restingOrders = /* @__PURE__ */ new Map();
async function cancelById(ctx, onchain, orderId) {
  const res = await ctx.exchange.trader.cancelOrder({ pool: onchain.pool, orderId });
  assertTxOk(res, `cancel ${orderId}`);
  return res;
}

// vendor/dreamdex-bot-kit/packages/ec-core/src/gotchas.ts
init_markets();

// vendor/dreamdex-bot-kit/packages/ec-core/src/settlement.ts
import { estPayoutFor, marketKey, binarySettlementAbi } from "@somnia-chain/markets-sdk";
import { parseAbi } from "viem";
var binaryPoolParamsAbi = parseAbi([
  "function getBinaryPoolParams() view returns ((address collateralToken, address market, address outcomeToken, uint256 yesId, uint256 noId, uint256 oneCollateral, uint256 setBacking, address feeRecipient, uint256 makerFeeBpsTimes1k, uint256 takerFeeBpsTimes1k, uint256 maxBuilderFeeBpsTimes1k, uint256 settlementFeeBpsTimes1k, address settlement, uint64 marketNonce, bool finalized))"
]);

// vendor/dreamdex-bot-kit/packages/ec-core/src/claim.ts
init_markets();

// vendor/dreamdex-bot-kit/packages/ec-core/src/index.ts
import {
  probabilityToPrice,
  priceToProbability,
  fromHuman,
  toHuman
} from "@somnia-chain/markets-sdk";

// src/api/kvStore.ts
var KV_OP_TIMEOUT_MS = 2500;
function kvConfigured() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return typeof url === "string" && url !== "" && typeof token === "string" && token !== "";
}
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
async function kvCommand(args) {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) {
    throw new Error("KV: missing KV_REST_API_URL / KV_REST_API_TOKEN.");
  }
  let res;
  try {
    res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(KV_OP_TIMEOUT_MS)
    });
  } catch (err) {
    throw new Error(`KV: request failed (${errorMessage(err)}).`);
  }
  if (!res.ok) {
    throw new Error(`KV: HTTP ${res.status}.`);
  }
  const body = await res.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("KV: invalid response shape.");
  }
  const rec = body;
  if (typeof rec.error === "string" && rec.error !== "") {
    throw new Error(`KV: ${rec.error}`);
  }
  if (!("result" in rec)) {
    throw new Error("KV: invalid response shape.");
  }
  return rec.result;
}
async function kvGet(key) {
  const result = await kvCommand(["GET", key]);
  return typeof result === "string" ? result : null;
}
async function kvSet(key, value, exSec) {
  await kvCommand(["SET", key, value, "EX", exSec]);
}

// src/api/registryCache.ts
var REGISTRY_CACHE_TTL_MS = 6e4;
var KV_REGISTRY_KEY = "sooth:registry:v1";
var KV_REGISTRY_TTL_SEC = 600;
var MS_PER_SEC = 1e3;
var BIGINT_MARKER = "$bigint";
var entry = null;
var inflight = null;
var sharedCtx = null;
function findMarketById(markets, id) {
  const deslug = id.includes("~") ? id.replaceAll("~", "/") : id;
  return markets.find((m) => String(m.info.marketId) === id || m.symbol === id || m.symbol === deslug);
}
function getSharedCtx() {
  if (!sharedCtx) {
    sharedCtx = createExchange({ withSigner: false });
  }
  return sharedCtx;
}
function errorMessage2(err) {
  return err instanceof Error ? err.message : String(err);
}
function fresh(now) {
  if (!entry) return null;
  if (now - entry.fetchedAt >= REGISTRY_CACHE_TTL_MS) return null;
  return {
    markets: entry.markets,
    cacheAgeSec: Math.floor((now - entry.fetchedAt) / MS_PER_SEC),
    stale: false
  };
}
function replacer(_key, value) {
  if (typeof value === "bigint") return { [BIGINT_MARKER]: value.toString() };
  return value;
}
function reviver(_key, value) {
  if (typeof value === "object" && value !== null && BIGINT_MARKER in value) {
    const inner = value[BIGINT_MARKER];
    if (typeof inner === "string") {
      try {
        return BigInt(inner);
      } catch {
        return value;
      }
    }
  }
  return value;
}
function isRecordArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
}
function parseEnvelope(raw) {
  const parsed = JSON.parse(raw, reviver);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("KV registry payload is not an object.");
  }
  const rec = parsed;
  if (typeof rec.fetchedAt !== "number" || !isRecordArray(rec.rows)) {
    throw new Error("KV registry payload has invalid shape.");
  }
  return { fetchedAt: rec.fetchedAt, markets: rec.rows };
}
function serializeEnvelope(markets) {
  return JSON.stringify({ fetchedAt: Date.now(), rows: markets }, replacer);
}
async function readKvTier() {
  if (!kvConfigured()) return null;
  try {
    const raw = await kvGet(KV_REGISTRY_KEY);
    if (!raw) return null;
    const { fetchedAt, markets } = parseEnvelope(raw);
    const ageSec = Math.floor((Date.now() - fetchedAt) / MS_PER_SEC);
    if (ageSec < 0) return null;
    entry = { markets, fetchedAt };
    return { markets, cacheAgeSec: ageSec, stale: ageSec * MS_PER_SEC >= REGISTRY_CACHE_TTL_MS };
  } catch (err) {
    console.warn(`[registryCache] KV read failed, falling back to origin: ${errorMessage2(err)}`);
    return null;
  }
}
async function writeKvTier(markets) {
  if (!kvConfigured()) return;
  try {
    await kvSet(KV_REGISTRY_KEY, serializeEnvelope(markets), KV_REGISTRY_TTL_SEC);
  } catch (err) {
    console.warn(`[registryCache] KV write failed, memory cache only: ${errorMessage2(err)}`);
  }
}
async function getActiveMarketsCached() {
  const now = Date.now();
  const hit = fresh(now);
  if (hit) return hit;
  const shared = await readKvTier();
  if (shared) return shared;
  if (!inflight) {
    const started = activeMarkets(getSharedCtx());
    inflight = started.then(
      (markets) => {
        entry = { markets, fetchedAt: Date.now() };
        inflight = null;
        return markets;
      },
      (err) => {
        inflight = null;
        throw err;
      }
    );
  }
  try {
    const markets = await inflight;
    await writeKvTier(markets);
    return { markets, cacheAgeSec: 0, stale: false };
  } catch (err) {
    if (entry) {
      return {
        markets: entry.markets,
        cacheAgeSec: Math.floor((Date.now() - entry.fetchedAt) / MS_PER_SEC),
        stale: true
      };
    }
    throw err;
  }
}

// src/config.ts
import { config as dotenvConfig } from "dotenv";

// src/constants.ts
var CHAIN_IDS = {
  MAINNET: 5031,
  TESTNET: 50312
};
var NETWORK_DEFAULTS = {
  testnet: {
    chainId: CHAIN_IDS.TESTNET,
    rpcUrl: "https://dream-rpc.somnia.network",
    restApi: "https://stg.api.dreamdex.io/v0",
    wsUrl: "wss://stg.api.dreamdex.io/v0/ws/public",
    explorer: "https://shannon-explorer.somnia.network"
  },
  mainnet: {
    chainId: CHAIN_IDS.MAINNET,
    rpcUrl: "https://api.infra.mainnet.somnia.network",
    restApi: "https://api.dreamdex.io/v0",
    wsUrl: "wss://api.dreamdex.io/v0/ws/public",
    explorer: "https://explorer.somnia.network"
  }
};

// src/config.ts
dotenvConfig();
var SNAPSHOT_CONFIG = {
  /** Poller interval in ms - env POLL_INTERVAL_MS overrides, must be >= 5_000. */
  POLL_INTERVAL_MS: (() => {
    const raw = process.env.POLL_INTERVAL_MS?.trim();
    if (raw === void 0 || raw === "") return 45e3;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 5e3) {
      throw new Error(`Invalid POLL_INTERVAL_MS="${raw}": must be a number >= 5000 (ms).`);
    }
    return n;
  })(),
  /** SQLite path - zero external service dependency (Codespace unattended). */
  DB_PATH: process.env.SNAPSHOT_DB_PATH?.trim() ? String(process.env.SNAPSHOT_DB_PATH?.trim()) : "data/snapshots.db"
};
var ANALYSIS_CONFIG = {
  /** Depth window: top N levels per side to compute imbalance/liquidity. */
  DEPTH_LEVELS: 3,
  /** Max nudge: k in estimatedProbability = clamp(marketProbability + k*imbalance, 0.01,0.99). Small tilt, not independent prediction. */
  K_IMBALANCE_NUDGE: 0.06,
  /** Minimum absolute edge to recommend TRADE (probability points). */
  MIN_EDGE: 0.02,
  /** Minimum liquidity (sum of bid+ask quantities in depth window, shares) to recommend TRADE. */
  MIN_LIQUIDITY: 100,
  /** Maximum spread (probability points, e.g. 0.05 = 5% points) to recommend TRADE. */
  MAX_SPREAD: 0.06,
  /** Maximum spread in bps (derived check, 600 bps = 6%). */
  MAX_SPREAD_BPS: 600,
  /** Minimum seconds remaining to expiry to recommend TRADE (buffer). */
  MIN_TIME_REMAINING: 300
};
var DECISION_CONFIG = {
  /** WATCH bar: |rawEdge| at/above this but executableEdge below MIN_EDGE → WATCH (probability points). */
  WATCH_MIN_EDGE: 0.01,
  /** Spread cost: spreadPenalty = spread * this (share of spread paid on entry, 0.5 = half). */
  SPREAD_PENALTY_FACTOR: 0.5,
  /** Slippage cost: slipPenalty = (orderSize / liquidity) * this (probability points per fill-ratio). */
  SLIPPAGE_FACTOR: 1,
  /** Reference order size (shares) for the slippage penalty - mirrors backtest sizePerTrade. */
  ORDER_SIZE_SHARES: 1,
  /** Momentum mapping: delta = clamp(momentumRoC * gain, ±cap), momentumRoC unitless (e.g. +0.02 = +2%). */
  MOMENTUM_GAIN: 1,
  /** Cap on |momentum delta| in probability points. */
  MOMENTUM_CAP: 0.03,
  /** Dislocation mapping: delta = clamp(gap * gain, ±cap), gap in rate-of-change points. */
  DISLOCATION_GAIN: 1,
  /** Cap on |dislocation delta| in probability points. */
  DISLOCATION_CAP: 0.03,
  /** Snapshot window: use up to this many recent real snapshots for momentum/volatility. */
  HISTORY_LOOKBACK_COUNT: 10,
  /** Minimum real snapshots with non-null mids to compute momentum/volatility. */
  HISTORY_MIN_SNAPSHOTS: 5,
  /** Minimum window span (seconds, first-to-last snapshot) for momentum/volatility. */
  HISTORY_MIN_SPAN_SEC: 120,
  /** Opportunity score weights (normalized in code, must be non-negative). */
  OPPORTUNITY_WEIGHTS: {
    /** |executableEdge| scaled by SCORE_EDGE_NORMALIZER. */
    edge: 0.35,
    /** Share of directional contributors agreeing with edge sign. */
    agreement: 0.2,
    /** Liquidity scaled by SCORE_LIQUIDITY_REF. */
    liquidity: 0.15,
    /** Execution quality from spread (1 - spreadBps/MAX_SPREAD_BPS). */
    execution: 0.1,
    /** Time buffer: timeRemaining scaled by RISK_TIME_REF_SEC. */
    risk: 0.1,
    /** Settlement gate pass (1) or fail (0). */
    settlement: 0.1
  },
  /** |executableEdge| that scores a full 1.0 on the edge component (probability points). */
  SCORE_EDGE_NORMALIZER: 0.05,
  /** Liquidity (shares) that scores a full 1.0 on the liquidity component. */
  SCORE_LIQUIDITY_REF: 5e3,
  /** timeRemaining (seconds) that scores a full 1.0 on the risk component. */
  RISK_TIME_REF_SEC: 3600
};
var BOT_CONFIG = {
  /** Bot enabled. */
  ENABLED: true,
  /** Max open positions (position limit). */
  MAX_POSITION: 5,
  /** Max cumulative loss in tUSDC before halt. */
  MAX_LOSS: 50,
  /** Min liquidity - mirrors ANALYSIS_CONFIG.MIN_LIQUIDITY. */
  MIN_LIQUIDITY: ANALYSIS_CONFIG.MIN_LIQUIDITY,
  /** Max spread - mirrors ANALYSIS_CONFIG.MAX_SPREAD. */
  MAX_SPREAD: ANALYSIS_CONFIG.MAX_SPREAD,
  /** Max spread bps - mirrors ANALYSIS_CONFIG.MAX_SPREAD_BPS. */
  MAX_SPREAD_BPS: ANALYSIS_CONFIG.MAX_SPREAD_BPS,
  /** Min seconds to expiry - mirrors ANALYSIS_CONFIG.MIN_TIME_REMAINING. */
  MIN_TIME_REMAINING: ANALYSIS_CONFIG.MIN_TIME_REMAINING,
  /** Min order size (shares). Must be >= EC lot (testnet 1 raw = 0.000001). */
  MIN_ORDER_SIZE: 1,
  /** Max order size (shares). */
  MAX_ORDER_SIZE: 10,
  /** Default order size for edge-threshold strategy. */
  DEFAULT_ORDER_SIZE: 1,
  /** Min native balance for gas (wei) - 0.01 STT. */
  MIN_NATIVE_WEI: 10000000000000000n,
  // 0.01 * 1e18
  /** Min collateral raw (tUSDC 6dp) loose check - 0.5 tUSDC. Precise check is price*size. */
  MIN_COLLATERAL_RAW: 500000n,
  // 0.5 * 1e6
  /** Loop interval for BotRunner (ms) - reuses snapshot logger's poll interval if env not set, min 5000. */
  LOOP_INTERVAL_MS: (() => {
    const raw = process.env.BOT_LOOP_INTERVAL_MS?.trim();
    if (raw === void 0 || raw === "") return 3e4;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 5e3) {
      throw new Error(`Invalid BOT_LOOP_INTERVAL_MS="${raw}": must be a number >= 5000 (ms).`);
    }
    return n;
  })()
};
var MID_MOVE_CONFIG = {
  /** Alert threshold in probability points (e.g. 0.025 = 2.5 cents). */
  MID_MOVE_ALERT_THRESHOLD: (() => {
    const raw = process.env.MID_MOVE_ALERT_THRESHOLD?.trim();
    if (raw === void 0 || raw === "") return 0.025;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n >= 1) {
      throw new Error(`Invalid MID_MOVE_ALERT_THRESHOLD="${raw}": must be a number in (0,1).`);
    }
    return n;
  })()
};
var SETTLEMENT_POLL_CONFIG = {
  /** Poll interval in ms - env SETTLEMENT_POLL_INTERVAL_MS overrides, must be >= 5000. */
  POLL_INTERVAL_MS: (() => {
    const raw = process.env.SETTLEMENT_POLL_INTERVAL_MS?.trim();
    if (raw === void 0 || raw === "") return 6e4;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 5e3) {
      throw new Error(`Invalid SETTLEMENT_POLL_INTERVAL_MS="${raw}": must be a number >= 5000 (ms).`);
    }
    return n;
  })()
};
var ADVERSE_SELECTION_CONFIG = {
  LOOKAHEAD_SECONDS: (() => {
    const raw = process.env.ADVERSE_SELECTION_LOOKAHEAD_SECONDS?.trim();
    if (raw === void 0 || raw === "") return 300;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid ADVERSE_SELECTION_LOOKAHEAD_SECONDS="${raw}": must be a positive integer (seconds).`);
    }
    return n;
  })(),
  MAX_DEVIATION_SECONDS: (() => {
    const raw = process.env.ADVERSE_SELECTION_DEVIATION_SECONDS?.trim();
    if (raw === void 0 || raw === "") return 120;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid ADVERSE_SELECTION_DEVIATION_SECONDS="${raw}": must be a positive integer (seconds).`);
    }
    return n;
  })()
};

// src/analysis/engine.ts
function computeEstimatedProbability(marketProbability, imbalance, k) {
  const raw = marketProbability + k * imbalance;
  return Math.min(0.99, Math.max(0.01, raw));
}
function clamp01(n) {
  return Math.min(0.99, Math.max(0.01, n));
}
function computeBookStats(bids, asks, depthLevels) {
  const topBids = bids.slice(0, depthLevels);
  const topAsks = asks.slice(0, depthLevels);
  const bidDepth = topBids.reduce((s, [, q]) => s + q, 0);
  const askDepth = topAsks.reduce((s, [, q]) => s + q, 0);
  const liquidity = bidDepth + askDepth;
  if (topBids.length === 0 || topAsks.length === 0 || liquidity === 0) {
    return { bidDepth, askDepth, liquidity, imbalance: 0, empty: true };
  }
  return { bidDepth, askDepth, liquidity, imbalance: (bidDepth - askDepth) / (bidDepth + askDepth), empty: false };
}
function analyzeMarket(input) {
  try {
    return analyzeMarketInner(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      marketId: input.marketId ?? "unknown",
      symbol: input.symbol ?? "unknown",
      direction: "NONE",
      marketProbability: input.marketProbability ?? 0,
      estimatedProbability: input.marketProbability !== void 0 ? clamp01(input.marketProbability) : 0.5,
      edge: 0,
      liquidity: 0,
      spread: 0,
      spreadBps: 0,
      timeRemaining: input.timeRemaining ?? 0,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: [`order-book imbalance: engine failed safe - ${msg}`],
      imbalance: 0
    };
  }
}
function analyzeMarketInner(input) {
  const { marketId, symbol, bids, asks, bestBid, bestAsk, marketProbability, timeRemaining } = input;
  if (!marketId || !symbol) {
    return {
      marketId: marketId ?? "unknown",
      symbol: symbol ?? "unknown",
      direction: "NONE",
      marketProbability: marketProbability ?? 0,
      estimatedProbability: marketProbability !== void 0 ? clamp01(marketProbability) : 0.5,
      edge: 0,
      liquidity: 0,
      spread: 0,
      spreadBps: 0,
      timeRemaining: timeRemaining ?? 0,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: ["order-book imbalance: missing marketId/symbol - no book depth to assess"],
      imbalance: 0
    };
  }
  const depthN = ANALYSIS_CONFIG.DEPTH_LEVELS;
  const stats = computeBookStats(bids, asks, depthN);
  const { liquidity } = stats;
  if (stats.empty) {
    const timeRem2 = timeRemaining ?? 0;
    return {
      marketId,
      symbol,
      direction: "NONE",
      marketProbability: marketProbability ?? 0,
      estimatedProbability: marketProbability !== void 0 ? clamp01(marketProbability) : 0.5,
      edge: 0,
      liquidity,
      spread: bestBid !== void 0 && bestAsk !== void 0 ? bestAsk - bestBid : 0,
      spreadBps: 0,
      timeRemaining: timeRem2,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: ["order-book imbalance: no book depth to assess (empty bid or ask side)"],
      imbalance: 0
    };
  }
  if (marketProbability === void 0 || !Number.isFinite(marketProbability)) {
    return {
      marketId,
      symbol,
      direction: "NONE",
      marketProbability: 0,
      estimatedProbability: 0.5,
      edge: 0,
      liquidity,
      spread: bestBid !== void 0 && bestAsk !== void 0 ? bestAsk - bestBid : 0,
      spreadBps: 0,
      timeRemaining: timeRemaining ?? 0,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: ["order-book imbalance: no book depth to assess (missing marketProbability)"],
      imbalance: 0
    };
  }
  const imbalance = stats.imbalance;
  const k = ANALYSIS_CONFIG.K_IMBALANCE_NUDGE;
  const estimatedProbability = computeEstimatedProbability(marketProbability, imbalance, k);
  const edge = estimatedProbability - marketProbability;
  const signalStrength = Math.abs(imbalance);
  const spread = bestBid !== void 0 && bestAsk !== void 0 ? bestAsk - bestBid : Infinity;
  const midForBps = marketProbability;
  const spreadBps = midForBps > 0 && Number.isFinite(spread) ? spread / midForBps * 1e4 : Infinity;
  const timeRem = timeRemaining !== void 0 && Number.isFinite(timeRemaining) ? timeRemaining : 0;
  let direction = "NONE";
  if (Math.abs(edge) >= ANALYSIS_CONFIG.MIN_EDGE) {
    direction = edge > 0 ? "YES" : "NO";
  }
  const reasons = [];
  const imbalanceSign = imbalance > 0 ? "bid-heavy" : imbalance < 0 ? "ask-heavy" : "balanced";
  const tilt = k * imbalance;
  reasons.push(
    `order-book imbalance ${imbalance.toFixed(3)} (${imbalanceSign}) \u2192 tilt ${tilt >= 0 ? "+" : ""}${tilt.toFixed(4)} (k=${k.toFixed(3)}) \u2192 estimated ${estimatedProbability.toFixed(4)} vs market ${marketProbability.toFixed(4)}`
  );
  const fails = [];
  if (liquidity < ANALYSIS_CONFIG.MIN_LIQUIDITY) {
    fails.push(`liquidity ${liquidity.toFixed(2)} < min ${ANALYSIS_CONFIG.MIN_LIQUIDITY}`);
  }
  if (spread > ANALYSIS_CONFIG.MAX_SPREAD || spreadBps > ANALYSIS_CONFIG.MAX_SPREAD_BPS) {
    fails.push(`spread ${Number.isFinite(spread) ? spread.toFixed(4) : "\u221E"} (${Number.isFinite(spreadBps) ? spreadBps.toFixed(1) : "\u221E"} bps) > max ${ANALYSIS_CONFIG.MAX_SPREAD.toFixed(4)} (${ANALYSIS_CONFIG.MAX_SPREAD_BPS} bps)`);
  }
  if (timeRem < ANALYSIS_CONFIG.MIN_TIME_REMAINING) {
    fails.push(`timeRemaining ${timeRem.toFixed(0)}s < buffer ${ANALYSIS_CONFIG.MIN_TIME_REMAINING}s`);
  }
  if (Math.abs(edge) < ANALYSIS_CONFIG.MIN_EDGE) {
    fails.push(`edge ${edge >= 0 ? "+" : ""}${edge.toFixed(4)} (|${Math.abs(edge).toFixed(4)}|) < minEdge ${ANALYSIS_CONFIG.MIN_EDGE.toFixed(4)}`);
  }
  let recommendation = "NO_TRADE";
  if (fails.length === 0) {
    recommendation = "TRADE";
    reasons.push(`TRADE: edge ${edge >= 0 ? "+" : ""}${edge.toFixed(4)} \u2265 minEdge, liquidity and spread within bounds`);
  } else {
    recommendation = "NO_TRADE";
    for (const f of fails) reasons.push(`NO_TRADE: ${f}`);
  }
  return {
    marketId,
    symbol,
    direction,
    marketProbability,
    estimatedProbability,
    edge,
    liquidity,
    spread: Number.isFinite(spread) ? spread : 0,
    spreadBps: Number.isFinite(spreadBps) ? spreadBps : 0,
    timeRemaining: timeRem,
    signalStrength,
    recommendation,
    reasons,
    imbalance
  };
}

// src/analysis/dislocation.ts
function rateOfChange(thenV, nowV) {
  if (thenV === null || nowV === null) return null;
  if (!Number.isFinite(thenV) || !Number.isFinite(nowV) || thenV <= 0) return null;
  return (nowV - thenV) / thenV;
}
function computeDislocation(input) {
  const underlyingRoC = rateOfChange(input.underlyingThenPrice, input.underlyingNowPrice);
  const contractRoC = rateOfChange(input.contractThenProb, input.contractNowProb);
  const w = input.windowSec;
  if (underlyingRoC === null || contractRoC === null || typeof w !== "number" || !(w > 0)) {
    const missing = [];
    if (underlyingRoC === null) missing.push("underlying window");
    if (contractRoC === null) missing.push("contract window");
    if (typeof w !== "number" || !(w > 0)) missing.push("window span");
    return {
      sufficient: false,
      underlyingRoC,
      contractRoC,
      gap: null,
      windowSec: input.windowSec,
      note: `dislocation N/A - missing ${missing.join(", ")}`
    };
  }
  const gap = underlyingRoC - contractRoC;
  const windowSec = w;
  return {
    sufficient: true,
    underlyingRoC,
    contractRoC,
    gap,
    windowSec,
    note: `underlying ${(underlyingRoC * 100).toFixed(2)}% vs contract ${(contractRoC * 100).toFixed(2)}% over ${windowSec.toFixed(0)}s \u2192 gap ${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(2)}%`
  };
}

// src/analysis/variables.ts
function finite(n) {
  return typeof n === "number" && Number.isFinite(n);
}
function isStrikePresent(strike) {
  if (strike === null) return false;
  const n = Number(strike);
  return Number.isFinite(n) && n !== 0;
}
function populationStddev(values) {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}
function collectVariables(input) {
  const notes = [];
  const book = computeBookStats(input.bids, input.asks, ANALYSIS_CONFIG.DEPTH_LEVELS);
  if (book.empty) notes.push("book empty on at least one side - imbalance/liquidity N/A");
  const marketProbability = finite(input.marketProbability) ? input.marketProbability : null;
  if (marketProbability === null) notes.push("marketProbability missing - fair value not computable");
  const spread = input.bestBid !== void 0 && input.bestAsk !== void 0 && finite(input.bestBid) && finite(input.bestAsk) ? input.bestAsk - input.bestBid : null;
  if (spread === null) notes.push("spread unknown - best bid/ask missing");
  const spreadBps = spread !== null && marketProbability !== null && marketProbability > 0 ? spread / marketProbability * 1e4 : null;
  const rawTime = input.timeRemaining;
  const timeRemaining = typeof rawTime === "number" && Number.isFinite(rawTime) ? rawTime : null;
  const mids = input.contractHistory.filter((p) => finite(p.mid) && finite(p.capturedAtUnix)).sort((a, b) => a.capturedAtUnix - b.capturedAtUnix).slice(-DECISION_CONFIG.HISTORY_LOOKBACK_COUNT);
  let momentum = null;
  let momentumWindowSec = null;
  let volatility = null;
  if (mids.length < DECISION_CONFIG.HISTORY_MIN_SNAPSHOTS) {
    notes.push(`momentum/volatility N/A - only ${mids.length} real snapshots (need ${DECISION_CONFIG.HISTORY_MIN_SNAPSHOTS})`);
  } else {
    const first = mids[0];
    const last = mids[mids.length - 1];
    if (first === void 0 || last === void 0) {
      notes.push("momentum/volatility N/A - window ends unreadable");
    } else {
      const span = last.capturedAtUnix - first.capturedAtUnix;
      if (span < DECISION_CONFIG.HISTORY_MIN_SPAN_SEC) {
        notes.push(`momentum/volatility N/A - window span ${span.toFixed(0)}s under ${DECISION_CONFIG.HISTORY_MIN_SPAN_SEC}s`);
      } else if (first.mid <= 0) {
        notes.push("momentum/volatility N/A - first window mid not positive");
      } else {
        momentum = (last.mid - first.mid) / first.mid;
        momentumWindowSec = span;
        volatility = populationStddev(mids.map((p) => p.mid));
      }
    }
  }
  const referencePrice = input.referenceNow ? input.referenceNow.price : null;
  const referenceEma = input.referenceNow ? input.referenceNow.ema : null;
  if (referencePrice === null) notes.push(`reference price N/A - no feed observation for ${input.asset}`);
  const firstBar = mids.length > 0 ? mids[0] : void 0;
  const lastBar = mids.length > 0 ? mids[mids.length - 1] : void 0;
  const contractThen = firstBar !== void 0 ? firstBar.mid : null;
  const contractNow = lastBar !== void 0 ? lastBar.mid : null;
  const dis = computeDislocation({
    underlyingThenPrice: input.referenceThen ? input.referenceThen.price : null,
    underlyingNowPrice: referencePrice,
    contractThenProb: contractThen,
    contractNowProb: contractNow,
    windowSec: momentumWindowSec
  });
  if (!dis.sufficient) notes.push(dis.note);
  const strikeNum = input.strike !== null ? Number(input.strike) : NaN;
  const strikePresent = isStrikePresent(input.strike);
  let strikeDistancePct = null;
  if (!strikePresent) {
    notes.push("strike distance N/A - strike absent or zero on this market");
  } else if (referencePrice === null) {
    notes.push("strike distance N/A - no reference price to compare");
  } else {
    strikeDistancePct = (referencePrice - strikeNum) / Math.abs(strikeNum) * 100;
  }
  return {
    marketId: input.marketId,
    symbol: input.symbol,
    asset: input.asset,
    marketProbability,
    spread,
    spreadBps,
    imbalance: book.empty ? null : book.imbalance,
    liquidity: book.empty ? null : book.liquidity,
    timeRemaining,
    referencePrice,
    referenceEma,
    momentum,
    momentumWindowSec,
    momentumSamples: mids.length,
    volatility,
    volatilitySamples: mids.length,
    strikeDistancePct,
    dislocationGap: dis.gap,
    dislocationWindowSec: dis.windowSec,
    underlyingRoC: dis.underlyingRoC,
    contractRoC: dis.contractRoC,
    venueId: input.venueId ?? null,
    expiry: typeof input.expiry === "number" && Number.isFinite(input.expiry) ? input.expiry : null,
    onchainStatus: typeof input.onchainStatus === "number" && Number.isFinite(input.onchainStatus) ? input.onchainStatus : null,
    strikePresent,
    notes
  };
}

// src/analysis/contextEngine.ts
function clamp012(n) {
  return Math.min(0.99, Math.max(0.01, n));
}
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
function signed(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(4)}`;
}
function computeFairValue(v) {
  const notes = [];
  const contributions = [];
  if (v.marketProbability === null) {
    return { fairValue: null, contributions, notes: ["fair value not computable - marketProbability missing"] };
  }
  const base = v.marketProbability;
  if (v.imbalance !== null) {
    const k = ANALYSIS_CONFIG.K_IMBALANCE_NUDGE;
    const delta = k * v.imbalance;
    contributions.push({
      name: "order-flow",
      signal: v.imbalance,
      weight: k,
      delta,
      detail: `order-flow imbalance ${v.imbalance.toFixed(3)} \xD7 k=${k.toFixed(3)} \u2192 ${signed(delta)}`
    });
  } else {
    notes.push("order-flow skipped - no book depth");
  }
  if (v.momentum !== null && v.momentumWindowSec !== null) {
    const delta = clamp(v.momentum * DECISION_CONFIG.MOMENTUM_GAIN, -DECISION_CONFIG.MOMENTUM_CAP, DECISION_CONFIG.MOMENTUM_CAP);
    contributions.push({
      name: "momentum",
      signal: v.momentum,
      weight: DECISION_CONFIG.MOMENTUM_GAIN,
      delta,
      detail: `momentum ${(v.momentum * 100).toFixed(2)}% over ${v.momentumWindowSec.toFixed(0)}s \xD7 gain=${DECISION_CONFIG.MOMENTUM_GAIN} (cap \xB1${DECISION_CONFIG.MOMENTUM_CAP}) \u2192 ${signed(delta)}`
    });
  } else {
    notes.push("momentum skipped - insufficient snapshot history");
  }
  if (v.dislocationGap !== null && v.dislocationWindowSec !== null) {
    const delta = clamp(v.dislocationGap * DECISION_CONFIG.DISLOCATION_GAIN, -DECISION_CONFIG.DISLOCATION_CAP, DECISION_CONFIG.DISLOCATION_CAP);
    contributions.push({
      name: "dislocation",
      signal: v.dislocationGap,
      weight: DECISION_CONFIG.DISLOCATION_GAIN,
      delta,
      detail: `repricing gap ${v.dislocationGap >= 0 ? "+" : ""}${(v.dislocationGap * 100).toFixed(2)}% over ${v.dislocationWindowSec.toFixed(0)}s \xD7 gain=${DECISION_CONFIG.DISLOCATION_GAIN} (cap \xB1${DECISION_CONFIG.DISLOCATION_CAP}) \u2192 ${signed(delta)}`
    });
  } else {
    notes.push("dislocation skipped - reference or contract window unavailable");
  }
  if (v.strikeDistancePct !== null && v.referencePrice !== null) {
    notes.push(`strike context: reference ${v.referencePrice} vs strike distance ${v.strikeDistancePct.toFixed(2)}% (reported, not weighted - direction unknowable from data)`);
  }
  if (v.volatility !== null) {
    notes.push(`volatility context: stddev ${v.volatility.toFixed(4)} over ${v.volatilitySamples} snapshots (reported, not weighted - non-directional)`);
  }
  const fairValue = clamp012(base + contributions.reduce((s, c) => s + c.delta, 0));
  return { fairValue, contributions, notes };
}

// src/analysis/settlementGate.ts
var SETTLEMENT_BLOCKED = "TRADE BLOCKED - SETTLEMENT RISK";
function checkSettlement(input) {
  const checks = [];
  checks.push({
    name: "event-identified",
    pass: input.marketId !== "",
    detail: input.marketId !== "" ? `marketId ${input.marketId.slice(0, 18)}\u2026 present` : "marketId missing"
  });
  checks.push({
    name: "contract-identified",
    pass: input.symbol !== "",
    detail: input.symbol !== "" ? `symbol ${input.symbol} present` : "symbol missing"
  });
  const expiry = input.expiry;
  const expiryOk = typeof expiry === "number" && Number.isFinite(expiry) && expiry > 0;
  checks.push({
    name: "expiry-identified",
    pass: expiryOk,
    detail: expiryOk ? `expiry ${expiry.toFixed(0)} (unix)` : "expiry missing or not positive"
  });
  const status = input.onchainStatus;
  const statusOk = typeof status === "number" && Number.isFinite(status);
  checks.push({
    name: "resolution-readable",
    pass: statusOk,
    detail: statusOk ? `on-chain status ${status} readable` : "on-chain status unreadable - resolution mechanism not identifiable"
  });
  checks.push({
    name: "strike",
    pass: true,
    detail: input.strikePresent ? "strike present (context only)" : input.venueId ? `strike N/A - venue ${input.venueId.slice(0, 18)}\u2026 markets resolve without it (informational)` : "strike N/A (informational, not blocking)"
  });
  return { pass: checks.every((c) => c.pass), checks };
}

// src/analysis/decision.ts
function computePenalties(spread, liquidity) {
  const spreadPenalty = spread * DECISION_CONFIG.SPREAD_PENALTY_FACTOR;
  const slipPenalty = DECISION_CONFIG.ORDER_SIZE_SHARES / Math.max(liquidity, 1e-9) * DECISION_CONFIG.SLIPPAGE_FACTOR;
  return { spreadPenalty, slipPenalty };
}
function clamp013(n) {
  return Math.min(1, Math.max(0, n));
}
function scoreOpportunity(components, weights) {
  const keys = ["edge", "agreement", "liquidity", "execution", "risk", "settlement"];
  let weighted = 0;
  let total = 0;
  for (const k of keys) {
    const w = weights[k] ?? 0;
    if (w < 0 || !Number.isFinite(w)) continue;
    weighted += w * clamp013(components[k]);
    total += w;
  }
  if (total <= 0) return 0;
  return Math.round(100 * weighted / total);
}
function directionOf(edge) {
  if (edge > 0) return "UP";
  if (edge < 0) return "DOWN";
  return "FLAT";
}
function buildSignals(v, fair, gate) {
  const byName = new Map(fair.contributions.map((c) => [c.name, c.delta]));
  const flowDelta = byName.get("order-flow");
  const momDelta = byName.get("momentum");
  const disDelta = byName.get("dislocation");
  const strong = (d) => d !== void 0 && Math.abs(d) >= DECISION_CONFIG.WATCH_MIN_EDGE;
  return [
    {
      name: "order-flow",
      level: flowDelta === void 0 ? "NONE" : strong(flowDelta) ? "STRONG" : "WEAK",
      detail: flowDelta === void 0 ? "no book depth" : `imbalance tilt ${flowDelta >= 0 ? "+" : ""}${flowDelta.toFixed(4)} ${flowDelta >= 0 ? "supports UP" : "supports DOWN"}`
    },
    {
      name: "momentum",
      level: momDelta === void 0 ? "NONE" : strong(momDelta) ? "STRONG" : "WEAK",
      detail: momDelta === void 0 ? "insufficient snapshot history" : v.momentum !== null ? `mid ${(v.momentum * 100).toFixed(2)}% over ${(v.momentumWindowSec ?? 0).toFixed(0)}s` : "no movement read"
    },
    {
      name: "dislocation",
      level: disDelta === void 0 ? "NONE" : Math.abs(disDelta) >= DECISION_CONFIG.WATCH_MIN_EDGE ? "DETECTED" : "NONE",
      detail: disDelta === void 0 || v.dislocationGap === null ? "no reference window" : `repricing gap ${v.dislocationGap >= 0 ? "+" : ""}${(v.dislocationGap * 100).toFixed(2)}%`
    },
    {
      name: "liquidity",
      level: v.liquidity !== null && v.liquidity >= ANALYSIS_CONFIG.MIN_LIQUIDITY ? "GOOD" : "POOR",
      detail: v.liquidity !== null ? `${v.liquidity.toFixed(0)} shares vs min ${ANALYSIS_CONFIG.MIN_LIQUIDITY}` : "unknown"
    },
    {
      name: "spread",
      level: v.spread !== null && v.spread <= ANALYSIS_CONFIG.MAX_SPREAD && (v.spreadBps ?? Infinity) <= ANALYSIS_CONFIG.MAX_SPREAD_BPS ? "GOOD" : "POOR",
      detail: v.spread !== null ? `${v.spread.toFixed(4)} (${Number.isFinite(v.spreadBps ?? NaN) ? v.spreadBps.toFixed(0) : "\u221E"} bps)` : "unknown"
    },
    {
      name: "time",
      level: (v.timeRemaining ?? 0) >= ANALYSIS_CONFIG.MIN_TIME_REMAINING * 2 ? "GOOD" : (v.timeRemaining ?? 0) >= ANALYSIS_CONFIG.MIN_TIME_REMAINING ? "WEAK" : "POOR",
      detail: v.timeRemaining !== null ? `${v.timeRemaining.toFixed(0)}s to expiry` : "unknown"
    },
    {
      name: "volatility",
      level: "CONTEXT",
      detail: v.volatility !== null ? `stddev ${v.volatility.toFixed(4)} over ${v.volatilitySamples} snapshots` : "insufficient history"
    },
    {
      name: "settlement",
      level: gate.pass ? "PASSED" : "FAILED",
      detail: gate.pass ? "event, expiry, and on-chain state verified" : gate.checks.filter((c) => !c.pass).map((c) => c.name).join(", ")
    },
    {
      name: "risk",
      level: "PENDING",
      detail: "runs at order placement"
    }
  ];
}
function agreementStats(rawEdge, v) {
  const signs = [];
  if (v.imbalance !== null && v.imbalance !== 0) signs.push(Math.sign(v.imbalance));
  if (v.momentum !== null && v.momentum !== 0) signs.push(Math.sign(v.momentum));
  if (v.dislocationGap !== null && v.dislocationGap !== 0) signs.push(Math.sign(v.dislocationGap));
  if (signs.length === 0 || rawEdge === 0) return { agree: 0, total: signs.length };
  const edgeSign = Math.sign(rawEdge);
  return { agree: signs.filter((s) => s === edgeSign).length, total: signs.length };
}
function fmtSigned(n, digits = 4) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}
function decideMarket(input) {
  const { variables: v, fair, gate } = input;
  const fail = (marketPrice2, fairValue2, rawEdge2, executableEdge2, reasons) => ({
    decision: "NO_TRADE",
    marketPrice: marketPrice2,
    fairValue: fairValue2,
    rawEdge: rawEdge2,
    executableEdge: executableEdge2,
    opportunityScore: 0,
    reasons,
    signals: []
  });
  if (v.marketProbability === null || !Number.isFinite(v.marketProbability)) {
    return fail(0, 0, 0, 0, ["NO_TRADE: market price unknown - fair value not computable"]);
  }
  const marketPrice = v.marketProbability;
  if (fair.fairValue === null || !Number.isFinite(fair.fairValue)) {
    return fail(marketPrice, marketPrice, 0, 0, [
      "NO_TRADE: fair value not computable",
      ...v.notes.map((n) => `context: ${n}`),
      ...fair.notes.map((n) => `context: ${n}`)
    ]);
  }
  const fairValue = fair.fairValue;
  const rawEdge = fairValue - marketPrice;
  const dir = directionOf(rawEdge);
  if (!gate.pass) {
    const failed = gate.checks.filter((c) => !c.pass);
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `${SETTLEMENT_BLOCKED}: ${failed.map((c) => `${c.name} - ${c.detail}`).join("; ")}`
    ]);
  }
  if (v.liquidity === null || v.liquidity < ANALYSIS_CONFIG.MIN_LIQUIDITY) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `NO_TRADE: liquidity ${v.liquidity === null ? "unknown" : v.liquidity.toFixed(2)} < min ${ANALYSIS_CONFIG.MIN_LIQUIDITY}`
    ]);
  }
  if (v.spread === null) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, ["NO_TRADE: spread unknown - best bid/ask missing"]);
  }
  const spread = v.spread;
  const spreadBps = v.spreadBps ?? Infinity;
  if (spread > ANALYSIS_CONFIG.MAX_SPREAD || spreadBps > ANALYSIS_CONFIG.MAX_SPREAD_BPS) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `NO_TRADE: spread ${spread.toFixed(4)} (${Number.isFinite(spreadBps) ? spreadBps.toFixed(1) : "\u221E"} bps) > max ${ANALYSIS_CONFIG.MAX_SPREAD.toFixed(4)} (${ANALYSIS_CONFIG.MAX_SPREAD_BPS} bps)`
    ]);
  }
  const timeRem = v.timeRemaining ?? 0;
  if (timeRem < ANALYSIS_CONFIG.MIN_TIME_REMAINING) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `NO_TRADE: timeRemaining ${timeRem.toFixed(0)}s < buffer ${ANALYSIS_CONFIG.MIN_TIME_REMAINING}s`
    ]);
  }
  const { spreadPenalty, slipPenalty } = computePenalties(spread, v.liquidity);
  const executableEdge = rawEdge - Math.sign(rawEdge) * (spreadPenalty + slipPenalty);
  const { agree, total } = agreementStats(rawEdge, v);
  const components = {
    edge: Math.abs(executableEdge) / DECISION_CONFIG.SCORE_EDGE_NORMALIZER,
    agreement: total > 0 ? agree / total : 0,
    liquidity: v.liquidity / DECISION_CONFIG.SCORE_LIQUIDITY_REF,
    execution: 1 - spreadBps / ANALYSIS_CONFIG.MAX_SPREAD_BPS,
    risk: timeRem / DECISION_CONFIG.RISK_TIME_REF_SEC,
    settlement: 1
  };
  const opportunityScore = scoreOpportunity(components, { ...DECISION_CONFIG.OPPORTUNITY_WEIGHTS });
  const contributionLines = fair.contributions.map(
    (c) => `${c.name}: ${c.detail} (supports ${directionOf(c.delta)})`
  );
  const scoreLine = `opportunity ${opportunityScore}/100 from edge|agree|liq|exec|risk|settle = ${components.edge.toFixed(2)}|${components.agreement.toFixed(2)}|${components.liquidity.toFixed(2)}|${components.execution.toFixed(2)}|${components.risk.toFixed(2)}|${components.settlement.toFixed(2)} (agree ${agree}/${total})`;
  if (Math.abs(executableEdge) >= ANALYSIS_CONFIG.MIN_EDGE) {
    return {
      decision: "TRADE",
      marketPrice,
      fairValue,
      rawEdge,
      executableEdge,
      opportunityScore,
      signals: buildSignals(v, fair, gate),
      reasons: [
        `TRADE ${dir}: executable edge ${fmtSigned(executableEdge)} \u2265 minEdge ${ANALYSIS_CONFIG.MIN_EDGE.toFixed(4)} (raw ${fmtSigned(rawEdge)} minus spread cost ${spreadPenalty.toFixed(4)} and slippage cost ${slipPenalty.toFixed(4)})`,
        ...contributionLines,
        scoreLine
      ]
    };
  }
  if (Math.abs(rawEdge) >= DECISION_CONFIG.WATCH_MIN_EDGE) {
    return {
      decision: "WATCH",
      marketPrice,
      fairValue,
      rawEdge,
      executableEdge,
      opportunityScore,
      signals: buildSignals(v, fair, gate),
      reasons: [
        `WATCH ${dir}: raw edge ${fmtSigned(rawEdge)} exists but executable ${fmtSigned(executableEdge)} below minEdge ${ANALYSIS_CONFIG.MIN_EDGE.toFixed(4)} (costs ${spreadPenalty.toFixed(4)} + ${slipPenalty.toFixed(4)})`,
        ...contributionLines,
        scoreLine
      ]
    };
  }
  return {
    decision: "NO_TRADE",
    marketPrice,
    fairValue,
    rawEdge,
    executableEdge,
    opportunityScore,
    signals: buildSignals(v, fair, gate),
    reasons: [
      `NO_TRADE: edge ${fmtSigned(rawEdge)} (|${Math.abs(rawEdge).toFixed(4)}|) < watch bar ${DECISION_CONFIG.WATCH_MIN_EDGE.toFixed(4)}`,
      ...contributionLines,
      scoreLine
    ]
  };
}

// src/analysis/referenceFeed.ts
function isFinitePrice(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
async function fetchReferenceNow(ctx, asset) {
  const normalized = asset.trim().toUpperCase();
  if (normalized === "") return null;
  try {
    const p = await ctx.exchange.client.fetchPrice(normalized);
    if (!p || !isFinitePrice(p.price)) return null;
    return {
      asset: normalized,
      price: p.price,
      ema: typeof p.ema === "number" && Number.isFinite(p.ema) && p.ema > 0 ? p.ema : null,
      blockTimestamp: typeof p.blockTimestamp === "number" && Number.isFinite(p.blockTimestamp) ? p.blockTimestamp : null
    };
  } catch {
    return null;
  }
}
function nearestReferenceTick(ticks, t) {
  let best = null;
  let bestDist = Infinity;
  for (const tick of ticks) {
    const d = Math.abs(tick.atUnix - t);
    if (d < bestDist) {
      bestDist = d;
      best = tick;
    }
  }
  return best;
}
async function fetchReferenceWindow(ctx, asset, fromUnix, toUnix, limit = 500) {
  const normalized = asset.trim().toUpperCase();
  if (normalized === "" || !Number.isFinite(fromUnix) || !Number.isFinite(toUnix) || toUnix <= fromUnix) return [];
  try {
    const ticks = await ctx.exchange.client.fetchPriceHistory(normalized, { limit, from: Math.floor(fromUnix), to: Math.floor(toUnix) });
    const out = [];
    for (const t of ticks) {
      if (!isFinitePrice(t.price)) continue;
      if (typeof t.blockTimestamp !== "number" || !Number.isFinite(t.blockTimestamp)) continue;
      out.push({ price: t.price, atUnix: t.blockTimestamp });
    }
    out.sort((a, b) => a.atUnix - b.atUnix);
    return out;
  } catch {
    return [];
  }
}

// src/snapshots/db.ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
function openSnapshotDb(dbPath = SNAPSHOT_CONFIG.DB_PATH) {
  seedDbIfMissing(dbPath);
  const dir = path.dirname(dbPath);
  if (dir !== "." && dir !== "") {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  initDb(db);
  return db;
}
var SEED_DB_PATH = "data/seed-snapshots.db";
function seedDbIfMissing(dbPath) {
  if (dbPath === ":memory:" || dbPath === "") return;
  if (fs.existsSync(dbPath)) return;
  const seed = path.resolve(SEED_DB_PATH);
  if (path.resolve(dbPath) === seed) return;
  if (!fs.existsSync(seed)) return;
  try {
    const dir = path.dirname(dbPath);
    if (dir !== "." && dir !== "") {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(seed, dbPath);
  } catch (err) {
    console.warn(`[snapshots] seed copy failed, starting fresh DB: ${err instanceof Error ? err.message : String(err)}`);
  }
}
function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketId TEXT NOT NULL,
      symbol TEXT NOT NULL,
      capturedAtUnix INTEGER NOT NULL,
      capturedAtIso TEXT NOT NULL,
      bidLevels TEXT NOT NULL,
      askLevels TEXT NOT NULL,
      mid REAL,
      bidDepth REAL NOT NULL,
      askDepth REAL NOT NULL,
      imbalance REAL NOT NULL,
      blockNumber INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_market_time ON snapshots(marketId, capturedAtUnix);
    CREATE INDEX IF NOT EXISTS idx_snapshots_captured ON snapshots(capturedAtUnix);

    CREATE TABLE IF NOT EXISTS bot_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAtUnix INTEGER NOT NULL,
      createdAtIso TEXT NOT NULL,
      marketId TEXT,
      symbol TEXT,
      eventType TEXT NOT NULL,
      data TEXT NOT NULL,
      blockNumber INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bot_events_time ON bot_events(createdAtUnix);
    CREATE INDEX IF NOT EXISTS idx_bot_events_type ON bot_events(eventType);
    CREATE INDEX IF NOT EXISTS idx_bot_events_market ON bot_events(marketId);

    CREATE TABLE IF NOT EXISTS bot_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capturedAtUnix INTEGER NOT NULL,
      capturedAtIso TEXT NOT NULL,
      txHash TEXT NOT NULL,
      blockNumber INTEGER NOT NULL,
      marketId TEXT NOT NULL,
      symbol TEXT NOT NULL,
      orderId TEXT,
      side TEXT,
      outcome TEXT,
      quantityFilled REAL,
      fillPrice REAL,
      realizedPnL REAL,
      edgeAtDecision REAL,
      midAtDecision REAL,
      gasUsed TEXT,
      gasPrice TEXT,
      gasCost REAL,
      rawData TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bot_fills_market ON bot_fills(marketId);
    CREATE INDEX IF NOT EXISTS idx_bot_fills_block ON bot_fills(blockNumber);

    CREATE TABLE IF NOT EXISTS bot_positions (
      marketId TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'YES',
      netPosition REAL NOT NULL,
      totalSize REAL NOT NULL DEFAULT 0,
      avgEntryPrice REAL,
      realizedPnL REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      realizationSource TEXT,
      realizedAtUnix INTEGER,
      updatedAtUnix INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updatedAtUnix INTEGER NOT NULL
    );
  `);
  for (const col of ["edgeAtDecision REAL", "midAtDecision REAL", "gasUsed TEXT", "gasPrice TEXT", "gasCost REAL"]) {
    try {
      db.exec(`ALTER TABLE bot_fills ADD COLUMN ${col}`);
    } catch {
    }
  }
  for (const col of ["side TEXT", "outcome TEXT", "realizedPnL REAL"]) {
    try {
      db.exec(`ALTER TABLE bot_fills ADD COLUMN ${col}`);
    } catch {
    }
  }
  for (const col of [
    "side TEXT NOT NULL DEFAULT 'YES'",
    "totalSize REAL NOT NULL DEFAULT 0",
    "avgEntryPrice REAL",
    "status TEXT NOT NULL DEFAULT 'OPEN'",
    "realizationSource TEXT",
    "realizedAtUnix INTEGER"
  ]) {
    try {
      db.exec(`ALTER TABLE bot_positions ADD COLUMN ${col}`);
    } catch {
    }
  }
}
function recentSnapshotsForMarket(db, marketId, limit = 10) {
  return db.prepare("SELECT * FROM snapshots WHERE marketId=? ORDER BY capturedAtUnix DESC, id DESC LIMIT ?").all(marketId, limit);
}
function insertBotEvent(db, params) {
  const nowUnix = Math.floor(Date.now() / 1e3);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const stmt = db.prepare(`
    INSERT INTO bot_events (createdAtUnix, createdAtIso, marketId, symbol, eventType, data, blockNumber)
    VALUES (@createdAtUnix, @createdAtIso, @marketId, @symbol, @eventType, @data, @blockNumber)
  `);
  const info = stmt.run({
    createdAtUnix: nowUnix,
    createdAtIso: nowIso,
    marketId: params.marketId ?? null,
    symbol: params.symbol ?? null,
    eventType: params.eventType,
    data: JSON.stringify(params.data),
    blockNumber: params.blockNumber ?? null
  });
  return Number(info.lastInsertRowid);
}
function insertBotFill(db, params) {
  const nowUnix = params.capturedAtUnix ?? Math.floor(Date.now() / 1e3);
  const nowIso = new Date(nowUnix * 1e3).toISOString();
  const stmt = db.prepare(`
    INSERT INTO bot_fills (capturedAtUnix, capturedAtIso, txHash, blockNumber, marketId, symbol, orderId, side, outcome, quantityFilled, fillPrice, realizedPnL, edgeAtDecision, midAtDecision, gasUsed, gasPrice, gasCost, rawData)
    VALUES (@capturedAtUnix, @capturedAtIso, @txHash, @blockNumber, @marketId, @symbol, @orderId, @side, @outcome, @quantityFilled, @fillPrice, @realizedPnL, @edgeAtDecision, @midAtDecision, @gasUsed, @gasPrice, @gasCost, @rawData)
  `);
  const info = stmt.run({
    capturedAtUnix: nowUnix,
    capturedAtIso: nowIso,
    txHash: params.txHash,
    blockNumber: params.blockNumber,
    marketId: params.marketId,
    symbol: params.symbol,
    orderId: params.orderId ?? null,
    side: params.side ?? null,
    outcome: params.outcome ?? null,
    quantityFilled: params.quantityFilled ?? null,
    fillPrice: params.fillPrice ?? null,
    realizedPnL: params.realizedPnL ?? null,
    edgeAtDecision: params.edgeAtDecision ?? null,
    midAtDecision: params.midAtDecision ?? null,
    gasUsed: params.gasUsed ?? null,
    gasPrice: params.gasPrice ?? null,
    gasCost: params.gasCost ?? null,
    rawData: params.rawData ? JSON.stringify(params.rawData) : null
  });
  return Number(info.lastInsertRowid);
}
function listBotFills(db, limit = 100) {
  return db.prepare("SELECT * FROM bot_fills ORDER BY capturedAtUnix DESC, id DESC LIMIT ?").all(limit);
}
function upsertBotPosition(db, params) {
  const nowUnix = Math.floor(Date.now() / 1e3);
  db.prepare(
    `INSERT INTO bot_positions (marketId, symbol, side, netPosition, totalSize, avgEntryPrice, realizedPnL, status, realizationSource, realizedAtUnix, updatedAtUnix)
     VALUES (@marketId, @symbol, @side, @netPosition, @totalSize, @avgEntryPrice, @realizedPnL, @status, @realizationSource, @realizedAtUnix, @updatedAtUnix)
     ON CONFLICT(marketId) DO UPDATE SET symbol=@symbol, side=@side, netPosition=@netPosition, totalSize=@totalSize, avgEntryPrice=@avgEntryPrice, realizedPnL=@realizedPnL, status=@status, realizationSource=@realizationSource, realizedAtUnix=@realizedAtUnix, updatedAtUnix=@updatedAtUnix`
  ).run({
    marketId: params.marketId,
    symbol: params.symbol,
    side: params.side ?? "YES",
    netPosition: params.netPosition,
    totalSize: params.totalSize ?? Math.abs(params.netPosition),
    avgEntryPrice: params.avgEntryPrice ?? null,
    realizedPnL: params.realizedPnL,
    status: params.status ?? "OPEN",
    realizationSource: params.realizationSource ?? null,
    realizedAtUnix: params.realizedAtUnix ?? null,
    updatedAtUnix: nowUnix
  });
}
function patchBotPosition(db, marketId, patch) {
  const sets = [];
  const bind = { marketId };
  for (const key of ["side", "netPosition", "totalSize", "avgEntryPrice", "realizedPnL", "status", "realizationSource", "realizedAtUnix"]) {
    if (patch[key] !== void 0) {
      sets.push(`${key}=@${key}`);
      bind[key] = patch[key];
    }
  }
  bind.updatedAtUnix = Math.floor(Date.now() / 1e3);
  sets.push("updatedAtUnix=@updatedAtUnix");
  db.prepare(`UPDATE bot_positions SET ${sets.join(", ")} WHERE marketId=@marketId`).run(bind);
}
function getBotPositions(db) {
  return db.prepare("SELECT * FROM bot_positions").all();
}
function getBotPosition(db, marketId) {
  return db.prepare("SELECT * FROM bot_positions WHERE marketId=?").get(marketId);
}
function getTotalRealizedPnL(db) {
  const row = db.prepare("SELECT COALESCE(SUM(realizedPnL),0) as sum FROM bot_positions").get();
  return row.sum;
}
function getLatestSnapshotMid(db, marketId) {
  const row = db.prepare("SELECT mid, capturedAtUnix, blockNumber FROM snapshots WHERE marketId=? ORDER BY capturedAtUnix DESC, id DESC LIMIT 1").get(marketId);
  return row;
}
function closestSnapshotMid(db, marketId, targetUnix, maxDeviationSeconds) {
  const row = db.prepare(
    "SELECT mid, capturedAtUnix, ABS(capturedAtUnix - ?) AS deviation FROM snapshots WHERE marketId=? AND mid IS NOT NULL ORDER BY deviation ASC LIMIT 1"
  ).get(targetUnix, marketId);
  if (row === void 0 || row.mid === null || row.deviation > maxDeviationSeconds) return null;
  return { mid: row.mid, capturedAtUnix: row.capturedAtUnix, deviationSeconds: row.deviation };
}

// src/api/routes/markets.ts
var HISTORY_DEFAULT_LIMIT = 100;
var HISTORY_MAX_LIMIT = 500;
var HISTORY_MIN_LIMIT = 1;
function jsonSafe(value) {
  if (typeof value === "bigint") return String(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}
async function registerMarketRoutes(fastify) {
  fastify.get("/markets", async (_request, reply) => {
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = getSharedCtx();
      const { markets, cacheAgeSec, stale } = await getActiveMarketsCached();
      const tagged = markets.map((m) => {
        const info = m.info;
        return {
          marketId: String(info.marketId),
          // LIVE_ONCHAIN
          symbol: m.symbol,
          // LIVE_INDEXER
          asset: String(info.asset ?? "?"),
          // LIVE_INDEXER
          expiry: info.expiry !== void 0 ? String(info.expiry) : null,
          // LIVE_ONCHAIN
          venueId: String(info.venueId ?? ctx.config.venueId ?? ""),
          // LIVE_ONCHAIN
          intervalSec: typeof info.intervalSec === "number" ? info.intervalSec : null,
          // LIVE_INDEXER
          interval: typeof info.interval === "string" ? info.interval : null,
          // LIVE_INDEXER
          question: typeof info.question === "string" && info.question.trim() !== "" ? info.question : null,
          // LIVE_INDEXER - genuine resolution description if available
          strike: info.strike !== void 0 && info.strike !== null ? String(info.strike) : null,
          // LIVE_INDEXER
          dataIntegrity: {
            marketId: "LIVE_ONCHAIN",
            symbol: "LIVE_INDEXER",
            asset: "LIVE_INDEXER",
            expiry: "LIVE_ONCHAIN",
            intervalSec: "LIVE_INDEXER",
            question: "LIVE_INDEXER"
          }
        };
      });
      return reply.send({ data: tagged, dataIntegrity: "LIVE_INDEXER", count: tagged.length, cacheAgeSec, stale });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/markets/:id", async (request, reply) => {
    const { id } = request.params;
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "market id required", dataIntegrity: "DERIVED" });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = getSharedCtx();
      const { markets } = await getActiveMarketsCached();
      const found = findMarketById(markets, id);
      if (!found) {
        return reply.status(404).send({ error: `market ${id} not found among active markets`, dataIntegrity: "LIVE_INDEXER" });
      }
      const onchain = await marketOnchain(ctx, found);
      if (!onchain) {
        return reply.status(404).send({ error: `market ${id} onchain not found`, dataIntegrity: "LIVE_ONCHAIN" });
      }
      return reply.send({
        data: {
          unified: { symbol: found.symbol, info: found.info, dataIntegrity: "LIVE_INDEXER" },
          // onchain payload contains BigInts (expiry, pool params) - serialize to strings, don't 500
          onchain: { ...jsonSafe(onchain), dataIntegrity: "LIVE_ONCHAIN" }
        },
        dataIntegrity: "LIVE_INDEXER/LIVE_ONCHAIN"
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets/:id failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/markets/:id/orderbook", async (request, reply) => {
    const { id } = request.params;
    const query = request.query;
    const depth = query.depth ? Number(query.depth) : ANALYSIS_CONFIG.DEPTH_LEVELS;
    if (Number.isNaN(depth) || depth < 1 || depth > 20) {
      return reply.status(400).send({ error: "depth must be integer in [1,20]", dataIntegrity: "DERIVED" });
    }
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "market id required", dataIntegrity: "DERIVED" });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = getSharedCtx();
      const { markets } = await getActiveMarketsCached();
      const found = findMarketById(markets, id);
      if (!found) {
        return reply.status(404).send({ error: `market ${id} not found`, dataIntegrity: "LIVE_INDEXER" });
      }
      const { yes } = outcomeSymbols(found);
      const book = await ctx.exchange.fetchOrderBook(yes, depth);
      return reply.send({
        data: { marketId: String(found.info.marketId), symbol: found.symbol, yesSymbol: yes, bids: book.bids, asks: book.asks },
        dataIntegrity: { marketId: "LIVE_ONCHAIN", symbol: "LIVE_INDEXER", bids: "LIVE_INDEXER", asks: "LIVE_INDEXER" }
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets/:id/orderbook failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/markets/:id/analysis", async (request, reply) => {
    const { id } = request.params;
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "market id required", dataIntegrity: "DERIVED" });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = getSharedCtx();
      const { markets } = await getActiveMarketsCached();
      const found = findMarketById(markets, id);
      if (!found) {
        return reply.status(404).send({ error: `market ${id} not found`, dataIntegrity: "LIVE_INDEXER" });
      }
      const onchain = await marketOnchain(ctx, found);
      if (!onchain) {
        return reply.status(404).send({ error: `market ${id} onchain not found`, dataIntegrity: "LIVE_ONCHAIN" });
      }
      const { yes } = outcomeSymbols(found);
      const raw = await ctx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
      const bids = raw.bids;
      const asks = raw.asks;
      const bestBid = bids[0]?.[0];
      const bestAsk = asks[0]?.[0];
      const mid = bestBid !== void 0 && bestAsk !== void 0 ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
      const timeRemaining = Number(onchain.expiry) - Math.floor(Date.now() / 1e3);
      const info = found.info;
      const analysis = analyzeMarket({
        marketId: String(info.marketId),
        symbol: found.symbol,
        bids,
        asks,
        bestBid,
        bestAsk,
        marketProbability: mid ?? void 0,
        timeRemaining
      });
      let decision = null;
      let gateChecks = [];
      try {
        const meta = found.info;
        const asset = typeof meta.asset === "string" && meta.asset !== "" ? meta.asset : "UNKNOWN";
        const strike = meta.strike !== void 0 && meta.strike !== null ? String(meta.strike) : null;
        const snapshotDb = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
        let history = [];
        try {
          history = recentSnapshotsForMarket(snapshotDb, String(info.marketId), DECISION_CONFIG.HISTORY_LOOKBACK_COUNT).filter((s) => s.mid !== null).map((s) => ({ mid: s.mid, capturedAtUnix: s.capturedAtUnix }));
        } finally {
          snapshotDb.close();
        }
        const referenceNow = await fetchReferenceNow(ctx, asset);
        let windowNow = referenceNow;
        let referenceThen = null;
        if (history.length > 0) {
          const times = history.map((h) => h.capturedAtUnix);
          const ticks = await fetchReferenceWindow(ctx, asset, Math.min(...times), Math.max(...times));
          if (ticks.length > 0) {
            const firstTick = nearestReferenceTick(ticks, Math.min(...times));
            const lastTick = nearestReferenceTick(ticks, Math.max(...times));
            if (firstTick) referenceThen = firstTick;
            if (lastTick) windowNow = { asset, price: lastTick.price, ema: null, blockTimestamp: lastTick.atUnix };
          }
        }
        const expiryNum = Number(onchain.expiry);
        const statusNum = onchain.status;
        const variables = collectVariables({
          marketId: String(info.marketId),
          symbol: found.symbol,
          asset,
          strike,
          venueId: ctx.config.venueId ?? null,
          expiry: Number.isFinite(expiryNum) ? expiryNum : null,
          onchainStatus: statusNum,
          bids,
          asks,
          bestBid,
          bestAsk,
          marketProbability: mid ?? void 0,
          timeRemaining,
          referenceNow: windowNow,
          referenceThen,
          contractHistory: history
        });
        const fair = computeFairValue(variables);
        const gate = checkSettlement({
          marketId: String(info.marketId),
          symbol: found.symbol,
          expiry: Number.isFinite(expiryNum) ? expiryNum : null,
          venueId: ctx.config.venueId ?? null,
          onchainStatus: statusNum,
          strikePresent: isStrikePresent(strike)
        });
        decision = decideMarket({ variables, fair, gate });
        gateChecks = gate.checks;
      } catch (err) {
        request.log.warn(`decision layer failed, serving analysis only: ${err.message}`);
      }
      return reply.send({
        data: analysis,
        dataIntegrity: { analysis: "DERIVED", marketProbability: "LIVE_INDEXER", timeRemaining: "LIVE_ONCHAIN" },
        decision,
        gateChecks
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets/:id/analysis failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/markets/:id/history", async (request, reply) => {
    const { id } = request.params;
    const query = request.query;
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "market id required", dataIntegrity: "DERIVED" });
    }
    const rawLimit = query.limit !== void 0 ? Number(query.limit) : HISTORY_DEFAULT_LIMIT;
    if (!Number.isInteger(rawLimit) || rawLimit < HISTORY_MIN_LIMIT || rawLimit > HISTORY_MAX_LIMIT) {
      return reply.status(400).send({ error: `limit must be integer in [${HISTORY_MIN_LIMIT},${HISTORY_MAX_LIMIT}]`, dataIntegrity: "DERIVED" });
    }
    const limit = rawLimit;
    const marketId = id.trim();
    let db = null;
    try {
      db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const queryRows = (mid) => db?.prepare(
        `SELECT capturedAtIso, mid, imbalance, blockNumber, capturedAtUnix FROM snapshots WHERE marketId = ? ORDER BY capturedAtUnix DESC LIMIT ?`
      ).all(mid, limit);
      let rows = queryRows(marketId);
      let resolvedId = marketId;
      if (rows.length === 0 && marketId.includes("~")) {
        try {
          const { markets } = await getActiveMarketsCached();
          const found = findMarketById(markets, marketId);
          if (found) {
            resolvedId = String(found.info.marketId);
            rows = queryRows(resolvedId);
          }
        } catch {
        }
      }
      const ordered = [...rows].reverse();
      const data = ordered.map((r) => ({
        capturedAtIso: r.capturedAtIso,
        mid: r.mid,
        imbalance: r.imbalance,
        blockNumber: r.blockNumber,
        dataIntegrity: "HISTORICAL"
      }));
      const hasHistory = data.length > 0;
      return reply.send({
        data,
        count: data.length,
        hasHistory,
        marketId: resolvedId,
        limit,
        dataIntegrity: "HISTORICAL",
        ...hasHistory ? {} : { note: "no history yet - logger hasn't captured this market" }
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /markets/:id/history failed: ${err.message}`, dataIntegrity: "DERIVED" });
    } finally {
      try {
        db?.close();
      } catch {
      }
    }
  });
}

// src/ec/orderLifecycle.ts
import { formatUnits } from "viem";
function createOrderState() {
  return { openOrders: /* @__PURE__ */ new Map() };
}
function simulatePlace(params) {
  const { price, size } = params;
  if (!(price > 0 && price < 1)) {
    return { ok: false, reason: `price ${price} outside (0,1) probability` };
  }
  if (!(size > 0)) {
    return { ok: false, reason: `size ${size} <= 0` };
  }
  return { ok: true };
}
async function placeRestingOrder(params) {
  const { ctx, market, onchain, outcome, side, price, size, yesSymbol, state } = params;
  const sim = simulatePlace(params);
  if (!sim.ok) {
    throw new Error(`[simulate] placeRestingOrder rejected: ${sim.reason}`);
  }
  let placed;
  try {
    placed = await placeLimit(ctx, {
      market,
      onchain,
      outcome,
      side,
      price,
      size,
      type: "limit",
      // GTC (rest) - not "post-only" nor "ioc"
      expiresInSec: 600
      // 10 min, capped at market expiry inside placeLimit
    });
  } catch (err) {
    throw new Error(`[broadcast] placeLimit failed for ${yesSymbol} ${outcome} ${side} ${price}@${size}: ${err.message}`, { cause: err });
  }
  const txHash = placed.hash;
  if (!txHash) {
    throw new Error(`[verify] placeLimit returned no tx hash - cannot verify receipt`);
  }
  const receipt = await ctx.exchange.client.getViemClient().getTransactionReceipt({ hash: txHash });
  const blockNumber = receipt.blockNumber;
  const status = receipt.status;
  const gasUsed = receipt.gasUsed;
  if (status !== "success") {
    throw new Error(`[verify] tx reverted: ${txHash} status=${status} block=${blockNumber.toString()}`);
  }
  const orderId = placed.orderId;
  const rested = placed.rested;
  const filled = placed.filled;
  if (!rested || orderId === void 0) {
    if (filled > 0) {
      throw new Error(
        `[verify] order did not rest - filled ${filled} (price may have been too aggressive for deep-book intent). tx=${txHash} block=${blockNumber}`
      );
    }
    throw new Error(`[verify] non-reverting unsuccessful placement: tx ${txHash} mined but no OrderPlaced event (orderId undefined, rested=${rested}). This matches brief's failure mode - not assuming success.`);
  }
  let confirmedInOpenOrders = false;
  const deadlineMs = Date.now() + 8e3;
  while (Date.now() < deadlineMs) {
    try {
      const open = await ctx.exchange.fetchOpenOrders(yesSymbol);
      confirmedInOpenOrders = open.some((o) => String(o.id) === String(orderId));
      if (confirmedInOpenOrders) break;
    } catch (err) {
      throw new Error(`[verify] fetchOpenOrders failed after place tx ${txHash}: ${err.message}`, { cause: err });
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  if (!confirmedInOpenOrders) {
    console.warn(`[verify] orderId ${orderId.toString()} not yet in fetchOpenOrders(${yesSymbol}) after 8s polling tx ${txHash} block ${blockNumber} - indexer lag, but OrderPlaced event confirmed so treating as placed`);
  }
  const marketId = market.info.marketId;
  state.openOrders.set(String(orderId), marketId);
  return {
    txHash,
    blockNumber,
    status,
    orderId,
    rested,
    filled,
    gasUsed,
    price: placed.price,
    size: placed.size,
    symbol: yesSymbol,
    marketId,
    confirmedInOpenOrders
  };
}
async function cancelOrderLifecycle(params) {
  const { ctx, onchain, orderId, yesSymbol, state } = params;
  let res;
  try {
    const raw = await cancelById(ctx, onchain, orderId);
    res = raw;
  } catch (err) {
    throw new Error(`[broadcast] cancelById ${orderId.toString()} failed: ${err.message}`, { cause: err });
  }
  const txHash = res.hash;
  const receiptStatus = String(res.receipt.status);
  const blockNumber = res.receipt.blockNumber;
  const gasUsed = res.receipt.gasUsed;
  if (receiptStatus !== "success") {
    throw new Error(`[verify] cancel tx reverted: ${txHash} status=${receiptStatus} block=${blockNumber}`);
  }
  let stillOpen = false;
  const deadlineMs = Date.now() + 8e3;
  while (Date.now() < deadlineMs) {
    try {
      const open = await ctx.exchange.fetchOpenOrders(yesSymbol);
      stillOpen = open.some((o) => String(o.id) === String(orderId));
      if (!stillOpen) break;
    } catch (err) {
      throw new Error(`[verify] fetchOpenOrders after cancel failed: ${err.message}`, { cause: err });
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  if (stillOpen) {
    throw new Error(`[verify] orderId ${orderId.toString()} still appears in open orders after cancel tx ${txHash} block ${blockNumber} (after 8s polling)`);
  }
  state.openOrders.delete(String(orderId));
  return {
    txHash,
    blockNumber,
    status: receiptStatus,
    orderId,
    gasUsed,
    stillOpen
  };
}
async function readBalancesTagged(ctx) {
  const addr = ctx.exchange.walletAddress;
  if (!addr) throw new Error("No wallet address (PRIVATE_KEY not set)");
  const client = ctx.exchange.client.getViemClient();
  const collateral = ctx.config.addresses.collateral;
  const [nativeWei, tUsdcRaw] = await Promise.all([
    client.getBalance({ address: addr }),
    // LIVE_ONCHAIN
    ctx.exchange.client.getErc20Balance(collateral, addr)
    // LIVE_ONCHAIN
  ]);
  return {
    nativeWei,
    tUsdcRaw,
    nativeHuman: Number(formatUnits(nativeWei, 18)),
    // DERIVED
    tUsdcHuman: Number(formatUnits(tUsdcRaw, ctx.config.decimals)),
    // DERIVED
    collateral
  };
}

// src/api/routes/positions.ts
async function registerPositionRoutes(fastify) {
  fastify.get("/positions", async (_request, reply) => {
    try {
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const positions = getBotPositions(db);
      const totalPnL = getTotalRealizedPnL(db);
      db.close();
      return reply.send({
        data: { positions, totalRealizedPnL: totalPnL, count: positions.length },
        dataIntegrity: { positions: "LIVE_ONCHAIN", totalRealizedPnL: "DERIVED" }
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /positions failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/orders", async (_request, reply) => {
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const hasKey = Boolean(process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY);
      const ctx = createExchange({ withSigner: hasKey });
      const markets = await activeMarkets(ctx);
      const all = [];
      for (const m of markets) {
        const { yes } = outcomeSymbols(m);
        const info = m.info;
        try {
          const orders = await ctx.exchange.fetchOpenOrders(yes);
          all.push({ marketId: String(info.marketId), symbol: m.symbol, yesSymbol: yes, orders, dataIntegrity: "LIVE_ONCHAIN" });
        } catch (err) {
          all.push({ marketId: String(info.marketId), symbol: m.symbol, yesSymbol: yes, orders: [], dataIntegrity: `error: ${err.message}` });
        }
      }
      await ctx.exchange.close().catch(() => void 0);
      return reply.send({ data: all, dataIntegrity: "LIVE_ONCHAIN" });
    } catch (err) {
      return reply.status(500).send({ error: `GET /orders failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/portfolio", async (_request, reply) => {
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const positions = getBotPositions(db);
      const totalPnL = getTotalRealizedPnL(db);
      db.close();
      let balances = null;
      let balancesDataIntegrity = "LIVE_ONCHAIN unavailable - no PRIVATE_KEY";
      try {
        if (process.env.PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY) {
          const ctx = createExchange({ withSigner: true });
          const snap = await readBalancesTagged(ctx);
          balances = {
            nativeWei: String(snap.nativeWei),
            tUsdcRaw: String(snap.tUsdcRaw),
            nativeHuman: snap.nativeHuman,
            tUsdcHuman: snap.tUsdcHuman,
            collateral: snap.collateral,
            dataIntegrity: "LIVE_ONCHAIN"
          };
          balancesDataIntegrity = "LIVE_ONCHAIN";
          await ctx.exchange.close().catch(() => void 0);
        }
      } catch (err) {
        balances = null;
        balancesDataIntegrity = `LIVE_ONCHAIN error: ${err.message}`;
      }
      return reply.send({
        data: { balances, balancesDataIntegrity, positions, totalRealizedPnL: totalPnL, positionsCount: positions.length },
        dataIntegrity: { balances: balancesDataIntegrity, positions: "LIVE_ONCHAIN", totalRealizedPnL: "DERIVED" }
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /portfolio failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
}

// src/risk/riskEngine.ts
var COLLATERAL_DECIMALS = 6;
var COLLATERAL_SCALE = 10 ** COLLATERAL_DECIMALS;
function checkOrder(decision, context) {
  const reasons = [];
  const { config, analysis, openPositions, currentLoss, balances } = context;
  if (!config.enabled) {
    reasons.push("risk: bot disabled (config.enabled=false)");
  }
  if (decision.action !== "PLACE_ORDER") {
    reasons.push("risk: decision is SKIP - risk check not applicable (should have short-circuited before risk)");
    return { approved: false, rejectionReasons: reasons };
  }
  const price = decision.price;
  const size = decision.size;
  if (analysis.timeRemaining <= 0) {
    reasons.push(`risk: market no longer active (timeRemaining ${analysis.timeRemaining.toFixed(0)}s <= 0 - expired/Locked)`);
  }
  if (analysis.timeRemaining < config.minTimeRemaining) {
    reasons.push(`risk: close to expiry (timeRemaining ${analysis.timeRemaining.toFixed(0)}s < buffer ${config.minTimeRemaining}s)`);
  }
  if (analysis.liquidity < config.minLiquidity) {
    reasons.push(`risk: liquidity insufficient (${analysis.liquidity.toFixed(1)} < min ${config.minLiquidity})`);
  }
  if (analysis.spread > config.maxSpread || analysis.spreadBps > config.maxSpreadBps) {
    const spreadStr = Number.isFinite(analysis.spread) ? analysis.spread.toFixed(4) : "\u221E";
    const bpsStr = Number.isFinite(analysis.spreadBps) ? analysis.spreadBps.toFixed(1) : "\u221E";
    reasons.push(`risk: spread too wide (${spreadStr} / ${bpsStr} bps > max ${config.maxSpread.toFixed(4)} / ${config.maxSpreadBps} bps)`);
  }
  if (openPositions.length >= config.maxPosition) {
    reasons.push(`risk: position limit reached (${openPositions.length} >= maxPosition ${config.maxPosition})`);
  }
  if (currentLoss >= config.maxLoss) {
    reasons.push(`risk: loss limit breached (currentLoss ${currentLoss.toFixed(4)} >= maxLoss ${config.maxLoss})`);
  }
  let sizeValid = true;
  if (size === void 0 || !Number.isFinite(size)) {
    reasons.push("risk: order size missing or not finite");
    sizeValid = false;
  } else {
    if (size < config.minOrderSize) {
      reasons.push(`risk: order size too small (${size} < min ${config.minOrderSize})`);
      sizeValid = false;
    }
    if (size > config.maxOrderSize) {
      reasons.push(`risk: order size too large (${size} > max ${config.maxOrderSize})`);
      sizeValid = false;
    }
    if (!(size > 0)) {
      reasons.push(`risk: order size not positive (${String(size)})`);
      sizeValid = false;
    }
  }
  if (price === void 0 || !Number.isFinite(price)) {
    reasons.push("risk: order price missing or not finite");
  } else {
    if (!(price > 0 && price < 1)) {
      reasons.push(`risk: order price outside (0,1) probability (${String(price)})`);
    }
  }
  if (!balances) {
    reasons.push("risk: wallet funded check unavailable (balances not provided)");
  } else {
    if (sizeValid && price !== void 0 && Number.isFinite(price) && price > 0 && price < 1 && size !== void 0 && Number.isFinite(size)) {
      const requiredRaw = BigInt(Math.ceil(price * size * COLLATERAL_SCALE));
      if (balances.tUsdcRaw < requiredRaw) {
        const haveHuman = Number(balances.tUsdcRaw) / COLLATERAL_SCALE;
        const needHuman = Number(requiredRaw) / COLLATERAL_SCALE;
        reasons.push(`risk: wallet collateral insufficient (have ${haveHuman.toFixed(6)} tUSDC < need ${needHuman.toFixed(6)} for price ${price.toFixed(4)} * size ${size})`);
      }
      if (balances.tUsdcRaw < config.minCollateralRaw) {
        reasons.push(`risk: wallet collateral below minCollateralRaw (${String(balances.tUsdcRaw)} < ${String(config.minCollateralRaw)})`);
      }
    } else if (balances.tUsdcRaw < config.minCollateralRaw) {
      reasons.push(`risk: wallet collateral below minCollateralRaw (${String(balances.tUsdcRaw)} < ${String(config.minCollateralRaw)})`);
    }
  }
  if (!balances) {
    reasons.push("risk: gas check unavailable (balances not provided)");
  } else {
    if (balances.nativeWei < config.minNativeWei) {
      reasons.push(`risk: gas insufficient (native ${String(balances.nativeWei)} wei < min ${String(config.minNativeWei)} wei)`);
    }
  }
  const approved = reasons.length === 0;
  return { approved, rejectionReasons: reasons };
}

// src/api/routes/orders.ts
async function registerOrderRoutes(fastify) {
  const orderState = createOrderState();
  fastify.post("/orders", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "body required: { marketId or symbol, side YES|NO, price in (0,1), size }", dataIntegrity: "DERIVED" });
    }
    const { marketId, symbol, side, price, size } = body;
    const sideNorm = typeof side === "string" ? side.toUpperCase() : "";
    if (sideNorm !== "YES" && sideNorm !== "NO") {
      return reply.status(400).send({ error: "side must be YES or NO", dataIntegrity: "DERIVED" });
    }
    if (typeof price !== "number" || !(price > 0 && price < 1)) {
      return reply.status(400).send({ error: "price must be number in (0,1) probability", dataIntegrity: "DERIVED" });
    }
    if (typeof size !== "number" || !(size > 0) || !Number.isFinite(size)) {
      return reply.status(400).send({ error: "size must be positive finite number", dataIntegrity: "DERIVED" });
    }
    const identifier = typeof marketId === "string" && marketId.trim() !== "" ? String(marketId).trim() : typeof symbol === "string" ? String(symbol).trim() : "";
    if (!identifier) {
      return reply.status(400).send({ error: "marketId or symbol required", dataIntegrity: "DERIVED" });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: true });
      if (!ctx.canTrade) {
        await ctx.exchange.close().catch(() => void 0);
        return reply.status(400).send({ error: "PRIVATE_KEY required for POST /orders", dataIntegrity: "DERIVED" });
      }
      const markets = await activeMarkets(ctx);
      const found = findMarketById(markets, identifier);
      if (!found) {
        await ctx.exchange.close().catch(() => void 0);
        return reply.status(404).send({ error: `market ${identifier} not found among active markets`, dataIntegrity: "LIVE_INDEXER" });
      }
      const onchain = await marketOnchain(ctx, found);
      if (!onchain) {
        await ctx.exchange.close().catch(() => void 0);
        return reply.status(404).send({ error: `market ${identifier} onchain not found`, dataIntegrity: "LIVE_ONCHAIN" });
      }
      const { yes } = outcomeSymbols(found);
      const decision = {
        action: "PLACE_ORDER",
        side: sideNorm,
        price,
        size,
        reasons: [`manual POST /orders for ${found.symbol} ${sideNorm} ${price} x${size}`]
      };
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const positions = getBotPositions(db).map((p) => ({ marketId: p.marketId, symbol: p.symbol, side: "YES", size: p.netPosition }));
      const totalPnL = getTotalRealizedPnL(db);
      const currentLoss = totalPnL < 0 ? -totalPnL : 0;
      db.close();
      let balances;
      try {
        const snap = await readBalancesTagged(ctx);
        balances = { nativeWei: snap.nativeWei, tUsdcRaw: snap.tUsdcRaw };
      } catch {
        balances = void 0;
      }
      let bookBids = [];
      let bookAsks = [];
      try {
        const raw = await ctx.exchange.fetchOrderBook(yes, 3);
        bookBids = raw.bids;
        bookAsks = raw.asks;
      } catch {
      }
      const bestBid = bookBids[0]?.[0];
      const bestAsk = bookAsks[0]?.[0];
      const mid = bestBid !== void 0 && bestAsk !== void 0 ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? 0.5;
      const timeRemaining = Number(onchain.expiry) - Math.floor(Date.now() / 1e3);
      const liquidity = bookBids.slice(0, 3).reduce((s, [, q]) => s + q, 0) + bookAsks.slice(0, 3).reduce((s, [, q]) => s + q, 0);
      const spread = bestBid !== void 0 && bestAsk !== void 0 ? bestAsk - bestBid : 0;
      const spreadBps = mid > 0 ? spread / mid * 1e4 : 0;
      const analysis = {
        marketId: String(found.info.marketId),
        symbol: found.symbol,
        direction: sideNorm,
        marketProbability: mid,
        estimatedProbability: mid,
        edge: 0,
        liquidity,
        spread,
        spreadBps,
        timeRemaining,
        signalStrength: 0,
        recommendation: "TRADE",
        reasons: [`manual order - book mid ${mid.toFixed(4)}`],
        imbalance: 0
      };
      const risk = checkOrder(decision, {
        config: {
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
          minCollateralRaw: BOT_CONFIG.MIN_COLLATERAL_RAW
        },
        openPositions: positions,
        currentLoss,
        balances,
        analysis
      });
      if (!risk.approved) {
        await ctx.exchange.close().catch(() => void 0);
        return reply.status(400).send({
          error: "manual order rejected by risk engine (risk checks are NOT bypassed for POST /orders)",
          dataIntegrity: "DERIVED",
          risk: { approved: false, rejectionReasons: risk.rejectionReasons },
          note: "POST /orders routes through Stage 2 orderLifecycle directly (user-initiated, not bot) but MUST still pass riskEngine.checkOrder first - documented here"
        });
      }
      const info = found.info;
      const result = await placeRestingOrder({
        ctx,
        market: found,
        onchain,
        outcome: sideNorm,
        side: "buy",
        price,
        size,
        yesSymbol: yes,
        state: orderState
      });
      await ctx.exchange.close().catch(() => void 0);
      return reply.status(201).send({
        data: { txHash: result.txHash, blockNumber: String(result.blockNumber), orderId: String(result.orderId ?? ""), price: result.price, size: result.size, symbol: found.symbol, marketId: String(info.marketId) },
        dataIntegrity: { txHash: "LIVE_ONCHAIN", blockNumber: "LIVE_ONCHAIN", orderId: "LIVE_ONCHAIN", price: "DERIVED", size: "DERIVED" },
        risk: { approved: true, rejectionReasons: [] }
      });
    } catch (err) {
      return reply.status(500).send({ error: `POST /orders failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.post("/orders/:id/cancel", async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    if (!id || id.trim() === "") {
      return reply.status(400).send({ error: "order id required", dataIntegrity: "DERIVED" });
    }
    let orderIdBig;
    try {
      orderIdBig = BigInt(id);
    } catch {
      return reply.status(400).send({ error: "order id must be bigint string", dataIntegrity: "DERIVED" });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: true });
      if (!ctx.canTrade) {
        await ctx.exchange.close().catch(() => void 0);
        return reply.status(400).send({ error: "PRIVATE_KEY required for cancel", dataIntegrity: "DERIVED" });
      }
      let found;
      let onchain = null;
      const identifier = body?.marketId ?? body?.symbol;
      if (typeof identifier === "string" && identifier.trim() !== "") {
        const markets = await activeMarkets(ctx);
        found = markets.find((m) => String(m.info.marketId) === identifier || m.symbol === identifier);
        if (found) onchain = await marketOnchain(ctx, found);
      } else {
        const markets = await activeMarkets(ctx);
        for (const m of markets) {
          const { yes: yes2 } = outcomeSymbols(m);
          try {
            const orders = await ctx.exchange.fetchOpenOrders(yes2);
            if (orders.some((o) => String(o.id) === String(orderIdBig))) {
              found = m;
              onchain = await marketOnchain(ctx, m);
              break;
            }
          } catch {
          }
        }
      }
      if (!found || !onchain) {
        await ctx.exchange.close().catch(() => void 0);
        return reply.status(404).send({ error: `market for order ${id} not found (provide marketId/symbol in body)`, dataIntegrity: "LIVE_INDEXER" });
      }
      const { yes } = outcomeSymbols(found);
      const result = await cancelOrderLifecycle({ ctx, onchain, orderId: orderIdBig, yesSymbol: yes, state: orderState });
      await ctx.exchange.close().catch(() => void 0);
      return reply.send({
        data: { txHash: result.txHash, blockNumber: String(result.blockNumber), orderId: String(result.orderId), stillOpen: result.stillOpen },
        dataIntegrity: { txHash: "LIVE_ONCHAIN", blockNumber: "LIVE_ONCHAIN", orderId: "LIVE_ONCHAIN" }
      });
    } catch (err) {
      return reply.status(500).send({ error: `POST /orders/:id/cancel failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
}

// src/backtest/historicalBooks.ts
function loadHistoriesForSettledMarkets(db, settledMarkets2) {
  const histories = [];
  let withHistory = 0;
  let withoutHistory = 0;
  const stmt = db.prepare(
    "SELECT capturedAtUnix, capturedAtIso, bidLevels, askLevels, mid, bidDepth, askDepth, imbalance, blockNumber FROM snapshots WHERE marketId=? AND capturedAtUnix < ? ORDER BY capturedAtUnix ASC, id ASC"
  );
  for (const m of settledMarkets2) {
    const rows = stmt.all(m.marketId, m.expiry);
    if (rows.length > 0) {
      withHistory += 1;
      const snapshots = rows.map((r) => {
        let bids;
        let asks;
        try {
          bids = JSON.parse(r.bidLevels);
        } catch {
          bids = [];
        }
        try {
          asks = JSON.parse(r.askLevels);
        } catch {
          asks = [];
        }
        return {
          capturedAtUnix: r.capturedAtUnix,
          capturedAtIso: r.capturedAtIso,
          bids,
          asks,
          mid: r.mid,
          bidDepth: r.bidDepth,
          askDepth: r.askDepth,
          imbalance: r.imbalance,
          blockNumber: r.blockNumber
        };
      });
      histories.push({
        marketId: m.marketId,
        symbol: m.symbol,
        expiry: m.expiry,
        winningOutcome: m.winningOutcome,
        voided: m.voided,
        lastPrice: m.lastPrice,
        snapshots,
        snapshotCount: snapshots.length,
        dataPath: "HISTORICAL"
      });
    } else {
      withoutHistory += 1;
      histories.push({
        marketId: m.marketId,
        symbol: m.symbol,
        expiry: m.expiry,
        winningOutcome: m.winningOutcome,
        voided: m.voided,
        lastPrice: m.lastPrice,
        snapshots: [],
        snapshotCount: 0,
        dataPath: "ESTIMATED"
      });
    }
  }
  return { histories, withHistory, withoutHistory };
}

// src/backtest/engine.ts
function computePnL(params) {
  const { direction, entryPrice, size, winningOutcome, voided } = params;
  if (voided) {
    return (0.5 - entryPrice) * size;
  }
  if (winningOutcome === null || winningOutcome === void 0) {
    return 0;
  }
  const won = direction === "YES" && winningOutcome === 0 || direction === "NO" && winningOutcome === 1;
  if (direction === "YES") {
    return won ? (1 - entryPrice) * size : -entryPrice * size;
  } else {
    return won ? (1 - entryPrice) * size : -entryPrice * size;
  }
}
function syntheticBookAround(mid) {
  return {
    bids: [
      [Math.max(0.01, mid - 0.015), 200],
      [Math.max(0.01, mid - 0.025), 330],
      [Math.max(0.01, mid - 0.035), 460]
    ],
    asks: [
      [Math.min(0.99, mid + 0.015), 200],
      [Math.min(0.99, mid + 0.025), 330],
      [Math.min(0.99, mid + 0.035), 460]
    ]
  };
}
function runBacktest(params) {
  const { markets, startingCapital, sizePerTrade = 1 } = params;
  const trades = [];
  let totalPnL = 0;
  let maxDrawdown = 0;
  let peak = 0;
  let sumEdge = 0;
  for (const m of markets) {
    const bestBid = m.bids[0]?.[0];
    const bestAsk = m.asks[0]?.[0];
    const mid = bestBid !== void 0 && bestAsk !== void 0 ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? m.lastPrice ?? void 0;
    const timeRemaining = 3600;
    const analysis = analyzeMarket({
      marketId: m.marketId,
      symbol: m.symbol,
      bids: m.bids,
      asks: m.asks,
      bestBid,
      bestAsk,
      marketProbability: mid,
      timeRemaining
    });
    if (analysis.recommendation !== "TRADE" || analysis.direction === "NONE") {
      continue;
    }
    const direction = analysis.direction;
    const entryPrice = direction === "YES" ? mid : 1 - mid;
    const pnl = computePnL({
      direction,
      entryPrice,
      size: sizePerTrade,
      winningOutcome: m.winningOutcome,
      voided: m.voided
    });
    const won = pnl > 0;
    const prevCumulative = totalPnL;
    totalPnL += pnl;
    sumEdge += Math.abs(analysis.edge);
    peak = Math.max(peak, totalPnL, prevCumulative);
    const dd = peak - totalPnL;
    if (dd > maxDrawdown) maxDrawdown = dd;
    trades.push({
      marketId: m.marketId,
      symbol: m.symbol,
      direction,
      entryPrice,
      estimatedProbability: analysis.estimatedProbability,
      edge: analysis.edge,
      imbalance: analysis.imbalance,
      size: sizePerTrade,
      winningOutcome: m.winningOutcome,
      voided: m.voided,
      pnl,
      won,
      bookTag: m.bookTag
    });
  }
  const numberOfTrades = trades.length;
  const winningTrades = trades.filter((t) => t.won).length;
  const losingTrades = numberOfTrades - winningTrades;
  const winRate = numberOfTrades > 0 ? winningTrades / numberOfTrades : 0;
  const averageReturn = numberOfTrades > 0 ? totalPnL / numberOfTrades : 0;
  const averageEdge = numberOfTrades > 0 ? sumEdge / numberOfTrades : 0;
  const tradeFrequency = markets.length > 0 ? numberOfTrades / markets.length : 0;
  const endingCapital = startingCapital + totalPnL;
  return {
    totalMarkets: markets.length,
    tradableMarkets: markets.length,
    // for settled, all are tradable in sense we attempted
    numberOfTrades,
    winningTrades,
    losingTrades,
    winRate,
    totalPnL,
    averageReturn,
    maximumDrawdown: maxDrawdown,
    averageEdge,
    tradeFrequency,
    startingCapital,
    endingCapital,
    trades
  };
}

// src/backtest/decisionReport.ts
function bucketRejection(decision, firstReason) {
  if (decision === "WATCH") return "watch-below-trade-bar";
  const r = firstReason.toLowerCase();
  if (r.includes("liquidity")) return "liquidity";
  if (r.includes("spread")) return "spread";
  if (r.includes("timeremaining") || r.includes("expir")) return "expiry";
  if (r.includes("blocked") || r.includes("settlement")) return "settlement";
  if (r.includes("watch bar") || r.includes("below threshold")) return "edge-below-threshold";
  if (r.includes("fair value") || r.includes("market price unknown")) return "no-fair-value";
  return "other";
}
function evaluateDecisions(markets) {
  const rejectionReasons = {};
  const predictions = [];
  let snapshotsEvaluated = 0;
  let tradesTaken = 0;
  let tradeSignalSnapshots = 0;
  let watchSnapshots = 0;
  let noTradeSnapshots = 0;
  let insufficientHistory = 0;
  let unevaluated = 0;
  let totalPnL = 0;
  let execEdgeSum = 0;
  let realizedEdgeSum = 0;
  let realizedEdgeCount = 0;
  let wins = 0;
  let decidedOutcomes = 0;
  const bump = (bucket) => {
    rejectionReasons[bucket] = (rejectionReasons[bucket] ?? 0) + 1;
  };
  for (const m of markets) {
    const snaps = [...m.snapshots].sort((a, b) => a.capturedAtUnix - b.capturedAtUnix);
    if (snaps.length < DECISION_CONFIG.HISTORY_MIN_SNAPSHOTS) insufficientHistory += 1;
    const points = snaps.length > 0 ? snaps.map((s) => ({ atUnix: s.capturedAtUnix, bids: s.bids, asks: s.asks, mid: s.mid })) : m.fallbackBook ? [{ atUnix: m.expiry - 3600, bids: m.fallbackBook.bids, asks: m.fallbackBook.asks, mid: null }] : [];
    if (points.length === 0) {
      unevaluated += 1;
      continue;
    }
    const firstPt = points[0];
    if (firstPt === void 0) {
      unevaluated += 1;
      continue;
    }
    const firstAt = firstPt.atUnix;
    let taken = false;
    const history = [];
    for (const pt of points) {
      if (pt.mid !== null && Number.isFinite(pt.mid)) history.push({ mid: pt.mid, capturedAtUnix: pt.atUnix });
      const [firstBid] = pt.bids;
      const [firstAsk] = pt.asks;
      const bestBid = firstBid?.[0];
      const bestAsk = firstAsk?.[0];
      const mid = bestBid !== void 0 && bestAsk !== void 0 ? (bestBid + bestAsk) / 2 : pt.mid ?? void 0;
      const refThen = nearestReferenceTick(m.referenceTicks, firstAt);
      const refNow = nearestReferenceTick(m.referenceTicks, pt.atUnix);
      const variables = collectVariables({
        marketId: m.marketId,
        symbol: m.symbol,
        asset: m.asset,
        strike: null,
        // settled metas carry no strike - N/A, never invented
        venueId: null,
        expiry: m.expiry,
        // Gate encoding (documented, not invented): a recorded winningOutcome proves
        // on-chain resolution (status Resolved=4); voided proves Voided=5; neither
        // means resolution is unverifiable here, so the gate honestly blocks.
        onchainStatus: m.voided ? 5 : m.winningOutcome !== null ? 4 : null,
        bids: pt.bids,
        asks: pt.asks,
        bestBid,
        bestAsk,
        marketProbability: mid,
        timeRemaining: m.expiry - pt.atUnix,
        referenceNow: refNow ? { asset: m.referenceAsset ?? "?", price: refNow.price, ema: null, blockTimestamp: refNow.atUnix } : null,
        referenceThen: refThen,
        contractHistory: history
      });
      const fair = computeFairValue(variables);
      const gate = checkSettlement({
        marketId: m.marketId,
        symbol: m.symbol,
        expiry: m.expiry,
        venueId: null,
        onchainStatus: m.voided ? 5 : m.winningOutcome !== null ? 4 : null,
        strikePresent: false
      });
      const out = decideMarket({ variables, fair, gate });
      snapshotsEvaluated += 1;
      if (out.decision === "TRADE") {
        tradeSignalSnapshots += 1;
        if (!taken) {
          taken = true;
          tradesTaken += 1;
          const predicted = out.executableEdge > 0 ? "YES" : "NO";
          const entryPrice = predicted === "YES" ? out.marketPrice : 1 - out.marketPrice;
          const pnl = computePnL({ direction: predicted, entryPrice, size: DECISION_CONFIG.ORDER_SIZE_SHARES, winningOutcome: m.winningOutcome, voided: m.voided });
          totalPnL += pnl;
          execEdgeSum += Math.abs(out.executableEdge);
          const actual = m.voided ? "VOID" : m.winningOutcome === 0 ? "YES" : m.winningOutcome === 1 ? "NO" : "UNKNOWN";
          const correct = actual === "UNKNOWN" ? null : actual === predicted;
          let realizedEdge = null;
          if (actual !== "UNKNOWN") {
            const actualProb = actual === "VOID" ? 0.5 : actual === "YES" ? 1 : 0;
            realizedEdge = predicted === "YES" ? actualProb - entryPrice : 1 - actualProb - entryPrice;
            realizedEdgeSum += realizedEdge;
            realizedEdgeCount += 1;
          }
          if (correct !== null) {
            decidedOutcomes += 1;
            if (correct) wins += 1;
          }
          predictions.push({ marketId: m.marketId, symbol: m.symbol, predicted, entryPrice, executableEdge: out.executableEdge, actual, correct, realizedEdge, pnl, bookTag: m.bookTag });
        }
      } else if (out.decision === "WATCH") {
        watchSnapshots += 1;
        bump(bucketRejection(out.decision, out.reasons[0] ?? ""));
      } else {
        noTradeSnapshots += 1;
        bump(bucketRejection(out.decision, out.reasons[0] ?? ""));
      }
    }
  }
  return {
    marketsEvaluated: markets.length - unevaluated,
    snapshotsEvaluated,
    tradesTaken,
    tradeSignalSnapshots,
    watchSnapshots,
    noTradeSnapshots,
    rejectionReasons,
    predictions,
    realizedEdgeAvg: realizedEdgeCount > 0 ? realizedEdgeSum / realizedEdgeCount : null,
    avgExecutableEdge: tradesTaken > 0 ? execEdgeSum / tradesTaken : null,
    totalPnL,
    winRate: decidedOutcomes > 0 ? wins / decidedOutcomes : null,
    insufficientHistory,
    unevaluated
  };
}

// src/backtest/decisionInputs.ts
function rawPriceToProb(raw, decimals = 6) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** decimals;
}
function isoDay(expiry) {
  return new Date(expiry * 1e3).toISOString().slice(0, 10);
}
function settledMetasFromRows(rows) {
  return rows.map((r) => {
    const marketId = String(r.marketId);
    const asset = typeof r.asset === "string" ? r.asset : "UNK";
    const interval = typeof r.interval === "string" ? r.interval : typeof r.intervalSec === "number" ? r.intervalSec : "?";
    const expiryNum = Number(r.expiry ?? 0);
    const expiry = Number.isFinite(expiryNum) ? expiryNum : 0;
    const decimals = typeof r.baseDecimals === "number" ? r.baseDecimals : 6;
    return {
      marketId,
      symbol: `${asset}-${interval}-${isoDay(expiry)}`,
      expiry,
      winningOutcome: typeof r.winningOutcome === "number" ? r.winningOutcome : null,
      voided: Boolean(r.voided),
      lastPrice: rawPriceToProb(typeof r.lastPrice === "string" ? r.lastPrice : null, decimals)
    };
  });
}
function assetOf(symbol) {
  const head = symbol.split("-")[0];
  return head !== void 0 && head !== "" ? head : "?";
}
async function buildDecisionInputs(histories, getTicks) {
  const out = [];
  for (const h of histories) {
    const asset = assetOf(h.symbol);
    if (h.snapshots.length > 0) {
      const times = h.snapshots.map((s) => s.capturedAtUnix);
      const from = Math.min(...times);
      const to = Math.max(...times);
      let ticks = [];
      try {
        ticks = await getTicks(asset, from, to);
      } catch {
        ticks = [];
      }
      out.push({
        marketId: h.marketId,
        symbol: h.symbol,
        asset,
        expiry: h.expiry,
        winningOutcome: h.winningOutcome,
        voided: h.voided,
        snapshots: h.snapshots.map((s) => ({ capturedAtUnix: s.capturedAtUnix, bids: s.bids, asks: s.asks, mid: s.mid })),
        fallbackBook: null,
        referenceTicks: ticks,
        referenceAsset: ticks.length > 0 ? asset : null,
        bookTag: "HISTORICAL"
      });
    } else {
      const book = syntheticBookAround(h.lastPrice ?? 0.5);
      out.push({
        marketId: h.marketId,
        symbol: h.symbol,
        asset,
        expiry: h.expiry,
        winningOutcome: h.winningOutcome,
        voided: h.voided,
        snapshots: [],
        fallbackBook: book,
        referenceTicks: [],
        referenceAsset: null,
        bookTag: "ESTIMATED"
      });
    }
  }
  return out;
}

// src/api/routes/strategies.ts
async function registerStrategyRoutes(fastify) {
  fastify.post("/strategies/analyze", async (request, reply) => {
    const body = request.body ?? {};
    const { marketId, symbol, all } = body;
    const wantAll = Boolean(all) || !marketId && !symbol;
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = getSharedCtx();
      const { markets, cacheAgeSec, stale } = await getActiveMarketsCached();
      let targets = markets;
      if (!wantAll) {
        const identifier = typeof marketId === "string" && String(marketId).trim() !== "" ? String(marketId).trim() : String(symbol ?? "").trim();
        if (!identifier) {
          return reply.status(400).send({ error: "provide marketId or symbol or all:true", dataIntegrity: "DERIVED" });
        }
        const found = findMarketById(markets, identifier);
        if (!found) {
          return reply.status(404).send({ error: `market ${identifier} not found`, dataIntegrity: "LIVE_INDEXER" });
        }
        targets = [found];
      }
      const results = [];
      for (const m of targets) {
        const info = m.info;
        const { yes } = outcomeSymbols(m);
        const onchain = await marketOnchain(ctx, m);
        if (!onchain) continue;
        const raw = await ctx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
        const bids = raw.bids;
        const asks = raw.asks;
        const bestBid = bids[0]?.[0];
        const bestAsk = asks[0]?.[0];
        const mid = bestBid !== void 0 && bestAsk !== void 0 ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk;
        const timeRemaining = Number(onchain.expiry) - Math.floor(Date.now() / 1e3);
        const analysis = analyzeMarket({
          marketId: String(info.marketId),
          symbol: m.symbol,
          bids,
          asks,
          bestBid,
          bestAsk,
          marketProbability: mid ?? void 0,
          timeRemaining
        });
        const meta = m.info;
        const assetName = typeof meta.asset === "string" && meta.asset !== "" ? meta.asset : "?";
        const strikeVal = meta.strike !== void 0 && meta.strike !== null ? String(meta.strike) : null;
        const expiryNum = Number(onchain.expiry);
        const decisionVariables = collectVariables({
          marketId: String(info.marketId),
          symbol: m.symbol,
          asset: assetName,
          strike: strikeVal,
          venueId: ctx.config.venueId ?? null,
          expiry: Number.isFinite(expiryNum) ? expiryNum : null,
          onchainStatus: onchain.status,
          bids,
          asks,
          bestBid,
          bestAsk,
          marketProbability: mid ?? void 0,
          timeRemaining,
          referenceNow: null,
          referenceThen: null,
          contractHistory: []
        });
        const decision = decideMarket({
          variables: decisionVariables,
          fair: computeFairValue(decisionVariables),
          gate: checkSettlement({
            marketId: String(info.marketId),
            symbol: m.symbol,
            expiry: Number.isFinite(expiryNum) ? expiryNum : null,
            venueId: ctx.config.venueId ?? null,
            onchainStatus: onchain.status,
            strikePresent: isStrikePresent(strikeVal)
          })
        });
        results.push({ marketId: String(info.marketId), symbol: m.symbol, analysis, decision, dataIntegrity: { analysis: "DERIVED", marketProbability: "LIVE_INDEXER", timeRemaining: "LIVE_ONCHAIN" } });
      }
      return reply.send({ data: results, dataIntegrity: "DERIVED on LIVE_INDEXER/LIVE_ONCHAIN", count: results.length, cacheAgeSec, stale });
    } catch (err) {
      return reply.status(500).send({ error: `POST /strategies/analyze failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.post("/strategies/backtest", async (request, reply) => {
    const body = request.body;
    if (body !== void 0 && typeof body !== "object") {
      return reply.status(400).send({ error: "body must be object if provided", dataIntegrity: "DERIVED" });
    }
    const limit = body?.limit !== void 0 ? Number(body.limit) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: "limit must be integer in [1,200]", dataIntegrity: "DERIVED" });
    }
    const startingCapital = body?.startingCapital !== void 0 ? Number(body.startingCapital) : 1e3;
    if (!Number.isFinite(startingCapital) || startingCapital <= 0) {
      return reply.status(400).send({ error: "startingCapital must be positive number", dataIntegrity: "DERIVED" });
    }
    const sizePerTrade = body?.sizePerTrade !== void 0 ? Number(body.sizePerTrade) : 1;
    if (!Number.isFinite(sizePerTrade) || sizePerTrade <= 0) {
      return reply.status(400).send({ error: "sizePerTrade must be positive number", dataIntegrity: "DERIVED" });
    }
    const thresholds = body?.thresholds;
    let patched = null;
    if (thresholds) {
      patched = {};
      for (const [k, v] of Object.entries(thresholds)) {
        if (!(k in ANALYSIS_CONFIG)) {
          return reply.status(400).send({ error: `unknown threshold ${k} - allowed: ${Object.keys(ANALYSIS_CONFIG).join(", ")}`, dataIntegrity: "DERIVED" });
        }
        if (typeof v !== "number" || !Number.isFinite(v)) {
          return reply.status(400).send({ error: `threshold ${k} must be finite number`, dataIntegrity: "DERIVED" });
        }
        patched[k] = v;
      }
    }
    const originalEntries = [];
    if (patched) {
      for (const [k, v] of Object.entries(patched)) {
        originalEntries.push([k, ANALYSIS_CONFIG[k]]);
        ANALYSIS_CONFIG[k] = v;
      }
    }
    try {
      let rawPriceToProb3 = function(raw, decimals = 6) {
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;
        return n / 10 ** decimals;
      }, syntheticBookAround3 = function(mid) {
        return {
          bids: [
            [Math.max(0.01, mid - 0.015), 200],
            [Math.max(0.01, mid - 0.025), 330],
            [Math.max(0.01, mid - 0.035), 460]
          ],
          asks: [
            [Math.min(0.99, mid + 0.015), 200],
            [Math.min(0.99, mid + 0.025), 330],
            [Math.min(0.99, mid + 0.035), 460]
          ]
        };
      };
      var rawPriceToProb2 = rawPriceToProb3, syntheticBookAround2 = syntheticBookAround3;
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      const venueId = ctx.config.venueId;
      const rows = await ctx.exchange.client.listBinaryMarkets({ venueId, status: "Finalized", limit });
      await ctx.exchange.close().catch(() => void 0);
      if (rows.length === 0) {
        return reply.send({ data: { metrics: null, note: "no settled markets - insufficient-data (fresh venue)", dataIntegrity: "HISTORICAL" }, dataIntegrity: "HISTORICAL/DERIVED" });
      }
      const markets = [];
      for (const r of rows) {
        const marketId = r.marketId;
        const symbol = `${r.asset ?? "UNK"}-${r.interval ?? r.intervalSec ?? "?"}-${new Date(Number(r.expiry) * 1e3).toISOString().slice(0, 10)}`;
        const lastProb = rawPriceToProb3(r.lastPrice, r.baseDecimals ?? 6);
        const mid = lastProb ?? 0.5;
        const { bids, asks } = syntheticBookAround3(mid);
        const winningOutcome = r.winningOutcome ?? null;
        const voided = Boolean(r.voided);
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
          bookTag: "ESTIMATED"
        });
      }
      const metrics = runBacktest({ markets, startingCapital, sizePerTrade });
      return reply.send({
        data: { metrics, count: rows.length, dataIntegrity: { marketId: "HISTORICAL", winningOutcome: "HISTORICAL", book: "ESTIMATED", metrics: "DERIVED" }, thresholdsOverride: patched ?? null },
        dataIntegrity: "HISTORICAL/ESTIMATED/DERIVED"
      });
    } catch (err) {
      return reply.status(500).send({ error: `POST /strategies/backtest failed: ${err.message}`, dataIntegrity: "DERIVED" });
    } finally {
      if (patched) {
        for (const [k, v] of originalEntries) {
          ANALYSIS_CONFIG[k] = v;
        }
      }
    }
  });
  fastify.post("/strategies/decision-report", async (request, reply) => {
    const body = request.body;
    if (body !== void 0 && typeof body !== "object") {
      return reply.status(400).send({ error: "body must be object if provided", dataIntegrity: "DERIVED" });
    }
    const limit = body?.limit !== void 0 ? Number(body.limit) : 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return reply.status(400).send({ error: "limit must be integer in [1,50]", dataIntegrity: "DERIVED" });
    }
    const startingCapital = body?.startingCapital !== void 0 ? Number(body.startingCapital) : 1e3;
    if (!Number.isFinite(startingCapital) || startingCapital <= 0) {
      return reply.status(400).send({ error: "startingCapital must be positive number", dataIntegrity: "DERIVED" });
    }
    const sizePerTrade = body?.sizePerTrade !== void 0 ? Number(body.sizePerTrade) : 1;
    if (!Number.isFinite(sizePerTrade) || sizePerTrade <= 0) {
      return reply.status(400).send({ error: "sizePerTrade must be positive number", dataIntegrity: "DERIVED" });
    }
    try {
      if (!process.env.NETWORK) process.env.NETWORK = "testnet";
      if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
      const ctx = createExchange({ withSigner: false });
      try {
        const venueId = ctx.config.venueId;
        const rows = await ctx.exchange.client.listBinaryMarkets({ venueId, status: "Finalized", limit });
        if (rows.length === 0) {
          return reply.send({
            data: { report: null, note: "no settled markets - insufficient-data (fresh venue)", dataIntegrity: "HISTORICAL" },
            dataIntegrity: "HISTORICAL/DERIVED"
          });
        }
        const metas = settledMetasFromRows(rows);
        const snapshotDb = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
        let histories;
        try {
          histories = loadHistoriesForSettledMarkets(snapshotDb, metas).histories;
        } finally {
          snapshotDb.close();
        }
        const inputs = await buildDecisionInputs(histories, (asset, from, to) => fetchReferenceWindow(ctx, asset, from, to));
        const report = evaluateDecisions(inputs);
        return reply.send({
          data: { report, count: rows.length, startingCapital, sizePerTrade, dataIntegrity: "HISTORICAL/DERIVED" },
          dataIntegrity: "HISTORICAL/DERIVED"
        });
      } finally {
        await ctx.exchange.close().catch(() => void 0);
      }
    } catch (err) {
      return reply.status(500).send({ error: `POST /strategies/decision-report failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
}

// src/analytics/edge.ts
var UNSIGNED_INT_STRING = /^\d+$/;
function gasCostFromFields(gasUsed, gasPrice) {
  if (gasUsed === null || gasUsed === void 0 || gasPrice === null || gasPrice === void 0) return null;
  if (!UNSIGNED_INT_STRING.test(gasUsed) || !UNSIGNED_INT_STRING.test(gasPrice)) return null;
  const cost = Number(BigInt(gasUsed) * BigInt(gasPrice)) / 1e18;
  return Number.isFinite(cost) ? cost : null;
}
function readRealizedPnlSeries(db, gaps) {
  const rows = db.prepare(
    "SELECT id, eventType, data FROM bot_events WHERE eventType IN ('FILL_OBSERVED','SETTLEMENT_REALIZED') ORDER BY id ASC"
  ).all();
  const series = [];
  for (const row of rows) {
    let parsed;
    try {
      parsed = JSON.parse(row.data);
    } catch (err) {
      gaps.push(`bot_events id=${row.id} ${row.eventType} data unparseable, excluded from PnL series: ${err.message}`);
      continue;
    }
    const obj = parsed;
    const raw = obj?.newRealizedPnL ?? obj?.cumulativeRealizedPnL ?? obj?.positionUpdate?.newRealizedPnL;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      series.push({ eventId: row.id, cumulativeRealizedPnL: raw });
      continue;
    }
  }
  return series;
}
function peakToTroughDrawdown(series) {
  let peak = 0;
  let maxDrawdown = 0;
  for (const cum of series) {
    peak = Math.max(peak, cum);
    const dd = peak - cum;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  return maxDrawdown;
}
function computeEdgeAnalytics(db) {
  const fills = listBotFills(db, 1e3);
  const positions = getBotPositions(db);
  const grossPnL = getTotalRealizedPnL(db);
  const fillsCount = fills.length;
  const positionsCount = positions.length;
  if (fillsCount === 0) {
    return {
      status: "insufficient_data",
      dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", snapshots: "HISTORICAL", computed: "DERIVED" },
      metrics: null,
      fillsCount,
      positionsCount
    };
  }
  const gaps = [];
  let gasCost = 0;
  let gasRecorded = 0;
  for (const f of fills) {
    if (f.gasCost !== null && f.gasCost !== void 0) {
      gasCost += Number(f.gasCost);
      gasRecorded += 1;
      continue;
    }
    const computed = gasCostFromFields(f.gasUsed, f.gasPrice);
    if (computed !== null) {
      gasCost += computed;
      gasRecorded += 1;
    } else if (f.gasUsed !== null || f.gasPrice !== null) {
      gaps.push(`fill tx=${f.txHash} has incomplete/unparseable gas fields (gasUsed=${String(f.gasUsed)}, gasPrice=${String(f.gasPrice)}) - excluded from gas cost`);
    }
  }
  const netPnL = grossPnL - gasCost;
  const edges = fills.map((f) => f.edgeAtDecision).filter((e) => e !== null && e !== void 0 && Number.isFinite(e));
  const averageEdge = edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
  if (averageEdge === null) {
    gaps.push("averageEdge: no fill has edgeAtDecision recorded (Stage 6 capture was not active when these fills occurred)");
  }
  const eqSamples = [];
  for (const f of fills) {
    if (f.fillPrice !== null && f.midAtDecision !== null && Number.isFinite(f.fillPrice) && Number.isFinite(f.midAtDecision)) {
      eqSamples.push(f.fillPrice - f.midAtDecision);
    }
  }
  const executionQuality = eqSamples.length > 0 ? eqSamples.reduce((a, b) => a + b, 0) / eqSamples.length : null;
  if (executionQuality === null) {
    gaps.push("executionQuality: no fill has both fillPrice and midAtDecision recorded");
  }
  const closedPositions = positions.filter((p) => p.status === "CLOSED");
  const openPositions = positions.filter((p) => p.status === "OPEN");
  const winningTrades = closedPositions.filter((p) => p.realizedPnL > 0).length;
  const losingTrades = closedPositions.filter((p) => p.realizedPnL < 0).length;
  const resolvedTrades = winningTrades + losingTrades;
  const winRate = resolvedTrades > 0 ? winningTrades / resolvedTrades : null;
  const realizedEdge = closedPositions.length > 0 ? closedPositions.reduce((a, p) => a + p.realizedPnL, 0) / closedPositions.length : null;
  if (closedPositions.length === 0) {
    const openDesc = openPositions.length === 0 ? "no positions exist - no fill has been applied to the position model" : `${openPositions.length} open position(s) still unrealized (cost basis built, no SETTLEMENT/EARLY_CLOSE realized yet)`;
    gaps.push(`winRate/winningTrades/losingTrades/realizedEdge: ${openDesc} - wins/losses only derivable from realized (CLOSED) positions`);
  } else if (openPositions.length > 0) {
    gaps.push(`winRate/winningTrades/losingTrades/realizedEdge: computed over ${closedPositions.length} closed position(s); ${openPositions.length} open position(s) excluded (still unrealized)`);
  }
  const pnlSeries = readRealizedPnlSeries(db, gaps);
  const maximumDrawdown = pnlSeries.length > 0 ? peakToTroughDrawdown(pnlSeries.map((p) => p.cumulativeRealizedPnL)) : null;
  if (maximumDrawdown === null) {
    gaps.push("maximumDrawdown: no FILL_OBSERVED event carries newRealizedPnL - cumulative PnL series unavailable");
  }
  const lookahead = ADVERSE_SELECTION_CONFIG.LOOKAHEAD_SECONDS;
  const maxDev = ADVERSE_SELECTION_CONFIG.MAX_DEVIATION_SECONDS;
  let adverseSamples = 0;
  let adverseSum = 0;
  for (const f of fills) {
    if (f.side === null || f.outcome === null) {
      gaps.push(`adverseSelection fill id=${f.id} (tx=${f.txHash.slice(0, 18)}\u2026): side/outcome not recorded (predates Stage 9 or raw-topic decode) - not computable`);
      continue;
    }
    if (f.fillPrice === null || !Number.isFinite(f.fillPrice) || !(f.capturedAtUnix > 0)) {
      gaps.push(`adverseSelection fill id=${f.id} (tx=${f.txHash.slice(0, 18)}\u2026): no fillPrice/capturedAt recorded - not computable`);
      continue;
    }
    const target = f.capturedAtUnix + lookahead;
    const snap = closestSnapshotMid(db, f.marketId, target, maxDev);
    if (snap === null) {
      gaps.push(
        `adverseSelection fill id=${f.id} (tx=${f.txHash.slice(0, 18)}\u2026, marketId=${f.marketId}): no snapshot within \xB1${maxDev}s of fill+${lookahead}s (fill time ${new Date(f.capturedAtUnix * 1e3).toISOString()}) - NOT COMPUTABLE, no interpolation`
      );
      continue;
    }
    const sign = f.side === "buy" ? 1 : -1;
    adverseSum += (f.fillPrice - snap.mid) * sign;
    adverseSamples += 1;
  }
  const adverseSelection = adverseSamples > 0 ? adverseSum / adverseSamples : null;
  if (adverseSelection === null) {
    gaps.push(`adverseSelection: no fill has a computable post-fill mid (needs a real snapshot within \xB1${maxDev}s of fill+${lookahead}s) - see per-fill reasons above`);
  }
  const metrics = {
    grossPnL,
    gasCost: gasRecorded > 0 ? gasCost : 0,
    netPnL,
    winRate,
    tradeCount: fillsCount,
    winningTrades,
    losingTrades,
    resolvedTrades,
    openPositions: openPositions.length,
    averageEdge,
    realizedEdge,
    maximumDrawdown,
    executionQuality,
    adverseSelection,
    insufficientDataReason: null,
    gaps
  };
  return {
    status: "ok",
    dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", snapshots: "HISTORICAL", computed: "DERIVED" },
    metrics,
    fillsCount,
    positionsCount
  };
}

// src/api/routes/bots.ts
var SINGLE_BOT_ID = "default";
var ALLOWED_IDS = /* @__PURE__ */ new Set([SINGLE_BOT_ID, "1", "default-1"]);
function serializeConfig(cfg) {
  return {
    ...cfg,
    bot: {
      ...cfg.bot,
      minNativeWei: String(cfg.bot.minNativeWei),
      minCollateralRaw: String(cfg.bot.minCollateralRaw)
    }
  };
}
function validateBotId(id, reply) {
  if (ALLOWED_IDS.has(id) || id === SINGLE_BOT_ID) return true;
  void reply.status(404).send({
    error: `bot ${id} not found - single-bot-for-hackathon limitation: only id "${SINGLE_BOT_ID}" (or "1") is supported. Runner is a single instance (see docs/stage6-verification.md). Multi-bot would require Map<id,BotRunner> but is not yet implemented.`,
    dataIntegrity: "DERIVED",
    knownLimitation: "single-bot-for-hackathon, :id is always default/1"
  });
  return false;
}
async function startBotWithFallback(runner) {
  try {
    await runner.start({ withSigner: true });
    return "trade";
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("PRIVATE_KEY")) throw err;
    await runner.start({ withSigner: false });
    return "watch";
  }
}
async function registerBotRoutes(fastify) {
  fastify.get("/bots", async (_request, reply) => {
    try {
      const runner = getRunner();
      const cfg = runner.getConfig();
      const status = runner.status();
      const tickCount = runner.getTickCount();
      return reply.send({
        data: [{ id: SINGLE_BOT_ID, config: serializeConfig(cfg), status, tickCount, dataIntegrity: { config: "DERIVED (persisted)", status: "DERIVED", tickCount: "DERIVED" } }],
        dataIntegrity: "DERIVED",
        note: "single-bot-for-hackathon: :id is always default/1 (see knownLimitation)",
        knownLimitation: "single-bot-for-hackathon, runner is single instance"
      });
    } catch (err) {
      return reply.status(500).send({ error: `GET /bots failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.post("/bots", async (request, reply) => {
    const body = request.body ?? {};
    if (body !== null && typeof body !== "object") {
      return reply.status(400).send({ error: "body must be object", dataIntegrity: "DERIVED" });
    }
    try {
      const runner = getRunner();
      const patch = {};
      if (typeof body.marketScope === "string") patch.marketScope = String(body.marketScope);
      if (typeof body.label === "string") patch.label = String(body.label);
      if (typeof body.loopIntervalMs === "number") {
        if (!Number.isFinite(body.loopIntervalMs) || body.loopIntervalMs < 5e3) {
          return reply.status(400).send({ error: "loopIntervalMs must be number >=5000", dataIntegrity: "DERIVED" });
        }
        patch.loopIntervalMs = body.loopIntervalMs;
      }
      if (typeof body.midMoveThreshold === "number") {
        if (!Number.isFinite(body.midMoveThreshold) || body.midMoveThreshold <= 0 || body.midMoveThreshold >= 1) {
          return reply.status(400).send({ error: "midMoveThreshold must be in (0,1)", dataIntegrity: "DERIVED" });
        }
        patch.midMoveThreshold = body.midMoveThreshold;
      }
      if (body.bot !== void 0) {
        if (typeof body.bot !== "object" || body.bot === null) {
          return reply.status(400).send({ error: "bot must be object", dataIntegrity: "DERIVED" });
        }
        patch.bot = body.bot;
      }
      const updated = runner.updateConfig(patch);
      return reply.status(201).send({ data: { id: SINGLE_BOT_ID, config: serializeConfig(updated) }, dataIntegrity: "DERIVED" });
    } catch (err) {
      return reply.status(500).send({ error: `POST /bots failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.patch("/bots/:id", async (request, reply) => {
    const { id } = request.params;
    if (!validateBotId(id, reply)) return;
    const body = request.body;
    if (!body || typeof body !== "object") {
      return reply.status(400).send({ error: "body must be object with fields to patch", dataIntegrity: "DERIVED" });
    }
    try {
      const runner = getRunner();
      const patch = {};
      if (typeof body.marketScope === "string") patch.marketScope = String(body.marketScope);
      if (typeof body.label === "string") patch.label = String(body.label);
      if (typeof body.loopIntervalMs === "number") {
        if (!Number.isFinite(body.loopIntervalMs) || body.loopIntervalMs < 5e3) {
          return reply.status(400).send({ error: "loopIntervalMs must be >=5000", dataIntegrity: "DERIVED" });
        }
        patch.loopIntervalMs = body.loopIntervalMs;
      }
      if (typeof body.midMoveThreshold === "number") patch.midMoveThreshold = body.midMoveThreshold;
      if (body.bot !== void 0) patch.bot = body.bot;
      if (typeof body.enabled === "boolean") {
        const cur = runner.getConfig();
        patch.bot = { ...cur.bot, enabled: body.enabled };
      }
      const updated = runner.updateConfig(patch);
      return reply.send({ data: { id: SINGLE_BOT_ID, config: serializeConfig(updated) }, dataIntegrity: "DERIVED" });
    } catch (err) {
      return reply.status(500).send({ error: `PATCH /bots/:id failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.post("/bots/:id/start", async (request, reply) => {
    const { id } = request.params;
    if (!validateBotId(id, reply)) return;
    try {
      const runner = getRunner();
      if (runner.status() === "running") {
        return reply.send({ data: { id: SINGLE_BOT_ID, status: "running", tickCount: runner.getTickCount() }, dataIntegrity: "DERIVED", note: "already running" });
      }
      const mode = await startBotWithFallback(runner);
      const base = { id: SINGLE_BOT_ID, status: runner.status(), tickCount: runner.getTickCount(), mode };
      if (mode === "watch") {
        return reply.send({ data: base, dataIntegrity: "DERIVED", note: "watch-only - no signing key configured, execution disabled" });
      }
      return reply.send({ data: base, dataIntegrity: "DERIVED" });
    } catch (err) {
      return reply.status(500).send({ error: `POST /bots/:id/start failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.post("/bots/:id/stop", async (request, reply) => {
    const { id } = request.params;
    if (!validateBotId(id, reply)) return;
    try {
      const runner = getRunner();
      if (runner.status() === "stopped") {
        return reply.send({ data: { id: SINGLE_BOT_ID, status: "stopped", tickCount: runner.getTickCount() }, dataIntegrity: "DERIVED", note: "already stopped" });
      }
      await runner.stop("api stop");
      return reply.send({ data: { id: SINGLE_BOT_ID, status: runner.status(), tickCount: runner.getTickCount() }, dataIntegrity: "DERIVED" });
    } catch (err) {
      return reply.status(500).send({ error: `POST /bots/:id/stop failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/bots/:id/performance", async (request, reply) => {
    const { id } = request.params;
    if (!validateBotId(id, reply)) return;
    try {
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      const result = computeEdgeAnalytics(db);
      db.close();
      return reply.send({ data: result, dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", snapshots: "HISTORICAL", computed: "DERIVED" } });
    } catch (err) {
      return reply.status(500).send({ error: `GET /bots/:id/performance failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
  fastify.get("/bots/:id/events", async (request, reply) => {
    const { id } = request.params;
    if (!validateBotId(id, reply)) return;
    const query = request.query;
    const limit = query.limit ? Number(query.limit) : 50;
    const offset = query.offset ? Number(query.offset) : 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ error: "limit must be integer 1..200", dataIntegrity: "DERIVED" });
    }
    if (!Number.isInteger(offset) || offset < 0) {
      return reply.status(400).send({ error: "offset must be integer >=0", dataIntegrity: "DERIVED" });
    }
    try {
      const db = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
      let rows;
      let total;
      if (query.eventType) {
        rows = db.prepare("SELECT * FROM bot_events WHERE eventType=? ORDER BY id DESC LIMIT ? OFFSET ?").all(query.eventType, limit, offset);
        const c = db.prepare("SELECT COUNT(*) as c FROM bot_events WHERE eventType=?").get(query.eventType);
        total = c.c;
      } else {
        rows = db.prepare("SELECT * FROM bot_events ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset);
        const c = db.prepare("SELECT COUNT(*) as c FROM bot_events").get();
        total = c.c;
      }
      const data = rows.map((r) => ({ ...r, dataJson: (() => {
        try {
          return JSON.parse(r.data);
        } catch {
          return r.data;
        }
      })() }));
      db.close();
      return reply.send({ data, pagination: { limit, offset, total }, dataIntegrity: "DERIVED (persisted bot_events)" });
    } catch (err) {
      return reply.status(500).send({ error: `GET /bots/:id/events failed: ${err.message}`, dataIntegrity: "DERIVED" });
    }
  });
}

// src/strategy/edgeThreshold.ts
var EDGE_THRESHOLD_STRATEGY_ID = "edge-threshold";
var edgeThresholdStrategy = {
  id: EDGE_THRESHOLD_STRATEGY_ID,
  decide(analysis, context) {
    if (analysis.recommendation !== "TRADE" || analysis.direction === "NONE") {
      return {
        action: "SKIP",
        reasons: [...analysis.reasons]
      };
    }
    const side = analysis.direction;
    const price = side === "YES" ? analysis.marketProbability : 1 - analysis.marketProbability;
    const size = context.config.defaultOrderSize;
    if (!(price > 0 && price < 1) || !Number.isFinite(price)) {
      return {
        action: "SKIP",
        reasons: [...analysis.reasons, `strategy: derived price ${String(price)} outside (0,1) - skip`]
      };
    }
    if (!(size > 0) || !Number.isFinite(size)) {
      return {
        action: "SKIP",
        reasons: [...analysis.reasons, `strategy: config defaultOrderSize ${String(size)} invalid - skip`]
      };
    }
    return {
      action: "PLACE_ORDER",
      side,
      price,
      size,
      reasons: [...analysis.reasons]
    };
  }
};

// src/strategy/pipeline.ts
async function runPipeline(input, overrides) {
  const { analysis, strategy, strategyContext, ecCtx, market, onchain, state, yesSymbol } = input;
  const checkOrderFn = overrides?.checkOrderFn ?? checkOrder;
  const placeOrderFn = overrides?.placeOrderFn ?? placeRestingOrder;
  const decision = strategy.decide(analysis, strategyContext);
  if (decision.action === "SKIP") {
    return { decision, risk: null, executed: false, placeResult: null };
  }
  const riskContext = {
    ...strategyContext,
    analysis
  };
  const risk = checkOrderFn(decision, riskContext);
  if (!risk.approved) {
    return { decision, risk, executed: false, placeResult: null };
  }
  const outcome = decision.side;
  const price = decision.price;
  const size = decision.size;
  const placeResult = await placeOrderFn({
    ctx: ecCtx,
    market,
    onchain,
    outcome,
    side: "buy",
    price,
    size,
    yesSymbol,
    state
  });
  return { decision, risk, executed: true, placeResult };
}

// src/bot/positions.ts
function weightedEntryPrice(currentAvg, currentSize, price, qty) {
  if (currentAvg === null || currentAvg === void 0 || !(currentSize > 0)) return price;
  return (currentAvg * currentSize + price * qty) / (currentSize + qty);
}
function tagFillRealizedPnl(db, fillId, realizedPnL) {
  if (fillId === null || fillId === void 0) return;
  db.prepare("UPDATE bot_fills SET realizedPnL=? WHERE id=?").run(realizedPnL, fillId);
}
function applyFillToPosition(db, input) {
  const { marketId, symbol, side, outcome, quantityFilled, fillPrice, fillId } = input;
  if (!Number.isFinite(quantityFilled) || quantityFilled <= 0) {
    return { kind: "error", reason: `fill qty ${String(quantityFilled)} is not a positive number - cannot build cost basis` };
  }
  if (!Number.isFinite(fillPrice) || !(fillPrice > 0 && fillPrice < 1)) {
    return { kind: "error", reason: `fill price ${String(fillPrice)} outside (0,1) probability - cannot build cost basis` };
  }
  const existing = getBotPosition(db, marketId);
  const priorRealized = existing?.realizedPnL ?? 0;
  const priorSize = existing?.totalSize ?? 0;
  if (side === "sell") {
    if (!existing || priorSize <= 0) {
      return { kind: "error", reason: `sell ${outcome} for ${marketId} but no open position exists to exit` };
    }
    if (existing.side !== outcome) {
      return { kind: "error", reason: `sell ${outcome} but open position holds ${existing.side} - sell the held side to exit` };
    }
    if (existing.avgEntryPrice === null) {
      return { kind: "error", reason: `position ${marketId} has size ${priorSize} but no avgEntryPrice - cannot compute exit P&L (data integrity), refused` };
    }
    if (quantityFilled > priorSize) {
      const fullDelta = (fillPrice - existing.avgEntryPrice) * priorSize;
      patchBotPosition(db, marketId, {
        realizedPnL: priorRealized + fullDelta,
        netPosition: 0,
        totalSize: 0,
        status: "CLOSED",
        realizationSource: "EARLY_CLOSE"
      });
      tagFillRealizedPnl(db, fillId, fullDelta);
      return { kind: "closed_early", avgEntryPrice: existing.avgEntryPrice, totalSize: 0, realizedPnLDelta: fullDelta, realizationSource: "EARLY_CLOSE" };
    }
    const realizedDelta2 = (fillPrice - existing.avgEntryPrice) * quantityFilled;
    const newSize = priorSize - quantityFilled;
    if (newSize > 0) {
      patchBotPosition(db, marketId, { netPosition: newSize, realizedPnL: priorRealized + realizedDelta2, totalSize: newSize });
      tagFillRealizedPnl(db, fillId, realizedDelta2);
      return { kind: "partially_closed", avgEntryPrice: existing.avgEntryPrice, totalSize: newSize, realizedPnLDelta: realizedDelta2, realizationSource: "EARLY_CLOSE" };
    }
    patchBotPosition(db, marketId, {
      realizedPnL: priorRealized + realizedDelta2,
      netPosition: 0,
      totalSize: 0,
      status: "CLOSED",
      realizationSource: "EARLY_CLOSE"
    });
    tagFillRealizedPnl(db, fillId, realizedDelta2);
    return { kind: "closed_early", avgEntryPrice: existing.avgEntryPrice, totalSize: 0, realizedPnLDelta: realizedDelta2, realizationSource: "EARLY_CLOSE" };
  }
  if (!existing || priorSize <= 0) {
    upsertBotPosition(db, {
      marketId,
      symbol,
      side: outcome,
      netPosition: quantityFilled,
      totalSize: quantityFilled,
      avgEntryPrice: fillPrice,
      realizedPnL: priorRealized,
      status: "OPEN",
      realizationSource: null,
      realizedAtUnix: null
    });
    return { kind: "opened", avgEntryPrice: fillPrice, totalSize: quantityFilled, realizedPnLDelta: 0 };
  }
  if (existing.side === outcome) {
    const newTotal = priorSize + quantityFilled;
    const newAvg = weightedEntryPrice(existing.avgEntryPrice, priorSize, fillPrice, quantityFilled);
    patchBotPosition(db, marketId, { netPosition: newTotal, totalSize: newTotal, avgEntryPrice: newAvg });
    return { kind: "added", avgEntryPrice: newAvg, totalSize: newTotal, realizedPnLDelta: 0 };
  }
  if (existing.avgEntryPrice === null) {
    return { kind: "error", reason: `position ${marketId} has size ${priorSize} but no avgEntryPrice - cannot compute implied exit (data integrity), refused` };
  }
  const impliedExit = 1 - fillPrice;
  const realizedDelta = (impliedExit - existing.avgEntryPrice) * priorSize;
  upsertBotPosition(db, {
    marketId,
    symbol,
    side: outcome,
    netPosition: quantityFilled,
    totalSize: quantityFilled,
    avgEntryPrice: fillPrice,
    realizedPnL: priorRealized + realizedDelta,
    status: "OPEN",
    realizationSource: null,
    realizedAtUnix: null
  });
  tagFillRealizedPnl(db, fillId, realizedDelta);
  return { kind: "closed_early", avgEntryPrice: fillPrice, totalSize: quantityFilled, realizedPnLDelta: realizedDelta, realizationSource: "EARLY_CLOSE" };
}

// src/bot/events.ts
function logEvent(db, params) {
  return insertBotEvent(db, {
    marketId: params.marketId ?? null,
    symbol: params.symbol ?? null,
    eventType: params.eventType,
    data: params.data,
    blockNumber: params.blockNumber ?? null
  });
}

// src/bot/config.ts
function defaultPersistedConfig() {
  return {
    bot: {
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
      minCollateralRaw: BOT_CONFIG.MIN_COLLATERAL_RAW
    },
    marketScope: "all",
    label: "default",
    midMoveThreshold: MID_MOVE_CONFIG.MID_MOVE_ALERT_THRESHOLD,
    loopIntervalMs: BOT_CONFIG.LOOP_INTERVAL_MS
  };
}
function loadPersistedConfig(db) {
  const row = db.prepare("SELECT data FROM bot_config WHERE id=1").get();
  if (!row) return defaultPersistedConfig();
  try {
    const parsed = JSON.parse(row.data);
    const bot = parsed.bot;
    if (typeof bot.minNativeWei === "string") bot.minNativeWei = BigInt(bot.minNativeWei);
    if (typeof bot.minCollateralRaw === "string") bot.minCollateralRaw = BigInt(bot.minCollateralRaw);
    return parsed;
  } catch {
    return defaultPersistedConfig();
  }
}
function savePersistedConfig(db, cfg) {
  const serializable = {
    ...cfg,
    bot: {
      ...cfg.bot,
      minNativeWei: String(cfg.bot.minNativeWei),
      minCollateralRaw: String(cfg.bot.minCollateralRaw)
    }
  };
  const nowUnix = Math.floor(Date.now() / 1e3);
  db.prepare(
    `INSERT INTO bot_config (id, data, updatedAtUnix) VALUES (1, @data, @updatedAtUnix)
     ON CONFLICT(id) DO UPDATE SET data=@data, updatedAtUnix=@updatedAtUnix`
  ).run({ data: JSON.stringify(serializable), updatedAtUnix: nowUnix });
}

// src/bot/midMove.ts
function checkMidMove(db, params) {
  const threshold = params.threshold ?? MID_MOVE_CONFIG.MID_MOVE_ALERT_THRESHOLD;
  const prior = getLatestSnapshotMid(db, params.marketId);
  if (prior === void 0 || prior.mid === null || params.currentMid === null) {
    return {
      moved: false,
      delta: null,
      priorMid: prior?.mid ?? null,
      currentMid: params.currentMid,
      threshold,
      priorBlockNumber: prior?.blockNumber ?? null,
      priorCapturedAtUnix: prior?.capturedAtUnix ?? null,
      overThreshold: false
    };
  }
  const delta = Math.abs(params.currentMid - prior.mid);
  const overThreshold = delta >= threshold;
  const elapsedSec = Math.floor(Date.now() / 1e3) - prior.capturedAtUnix;
  if (overThreshold) {
    const signedDelta = params.currentMid - prior.mid;
    const sign = signedDelta >= 0 ? "+" : "";
    const msg = `[MID_MOVE] ${params.symbol} mid ${prior.mid.toFixed(3)} \u2192 ${params.currentMid.toFixed(3)} (${sign}${signedDelta.toFixed(3)}) over ${elapsedSec}s (block ${String(prior.blockNumber ?? "-")} \u2192 ${String(params.currentBlockNumber ?? "-")})`;
    console.log(msg);
    logEvent(db, {
      marketId: params.marketId,
      symbol: params.symbol,
      eventType: "MID_MOVE_OBSERVED",
      data: {
        tag: "DERIVED mid-move observability, NOT a trading signal",
        priorMid: prior.mid,
        // LIVE_INDEXER
        currentMid: params.currentMid,
        // LIVE_INDEXER
        delta,
        // DERIVED
        signedDelta,
        // DERIVED
        threshold,
        // DERIVED
        priorBlockNumber: prior.blockNumber,
        // LIVE_ONCHAIN
        currentBlockNumber: params.currentBlockNumber,
        // LIVE_ONCHAIN
        priorCapturedAtUnix: prior.capturedAtUnix,
        elapsedSec,
        message: msg
      },
      blockNumber: params.currentBlockNumber
    });
  }
  return {
    moved: overThreshold,
    delta,
    priorMid: prior.mid,
    currentMid: params.currentMid,
    threshold,
    priorBlockNumber: prior.blockNumber,
    priorCapturedAtUnix: prior.capturedAtUnix,
    overThreshold
  };
}

// src/bot/runner.ts
var ORDER_FILLED_TOPIC = "0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399";
var BotRunner = class {
  db;
  ecCtx = null;
  statusValue = "stopped";
  timer = null;
  tickCount = 0;
  lastFillBlock = null;
  orderState = createOrderState();
  stopping = false;
  ecFactory = null;
  pendingOrderMeta = /* @__PURE__ */ new Map();
  constructor(opts = {}) {
    const dbPath = opts.dbPath ?? SNAPSHOT_CONFIG.DB_PATH;
    this.db = openSnapshotDb(dbPath);
    this.ecFactory = opts.ecFactory ?? null;
  }
  /** Test helper: inject mock EC context without network. */
  injectEcContextForTest(ctx, lastFillBlock) {
    this.ecCtx = ctx;
    if (lastFillBlock !== void 0) this.lastFillBlock = lastFillBlock;
  }
  /** Check auto-stop conditions (loss limit or disabled) - returns reason if should stop, else null. Used by tick and tests. */
  checkAutoStopReason() {
    const cfg = this.getConfig();
    if (!cfg.bot.enabled) return "auto-stop: bot disabled";
    const totalPnL = getTotalRealizedPnL(this.db);
    const currentLoss = totalPnL < 0 ? -totalPnL : 0;
    if (currentLoss >= cfg.bot.maxLoss) return `auto-stop: loss limit ${currentLoss.toFixed(2)} >= ${cfg.bot.maxLoss}`;
    return null;
  }
  status() {
    return this.statusValue;
  }
  getTickCount() {
    return this.tickCount;
  }
  getDb() {
    return this.db;
  }
  /** Programmatic config surface (brief §7) - so REST layer has something real to call. */
  getConfig() {
    return loadPersistedConfig(this.db);
  }
  setConfig(cfg) {
    savePersistedConfig(this.db, cfg);
  }
  /** Update loop interval or market scope without restart - persisted. */
  updateConfig(patch) {
    const cur = this.getConfig();
    const next = { ...cur, ...patch, bot: { ...cur.bot, ...patch.bot } };
    this.setConfig(next);
    return next;
  }
  async start(opts = {}) {
    if (this.statusValue === "running") return;
    if (opts.marketScope) {
      this.updateConfig({ marketScope: opts.marketScope });
    }
    if (opts.loopIntervalMs !== void 0) {
      this.updateConfig({ loopIntervalMs: opts.loopIntervalMs });
    }
    const cfg = this.getConfig();
    if (!cfg.bot.enabled) {
      logEvent(this.db, {
        eventType: "AUTO_STOP_DISABLED",
        data: { reason: "bot disabled via config.enabled=false - start() refused", config: { enabled: cfg.bot.enabled } }
      });
      return;
    }
    if (!process.env.NETWORK) process.env.NETWORK = "testnet";
    if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
      process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
    }
    this.ecCtx = this.ecFactory ? this.ecFactory(opts.withSigner ?? true) : createExchange({ withSigner: opts.withSigner ?? true });
    try {
      const bn = await this.ecCtx.exchange.client.getViemClient().getBlockNumber();
      this.lastFillBlock = bn;
    } catch {
      this.lastFillBlock = null;
    }
    this.statusValue = "running";
    this.stopping = false;
    this.tickCount = 0;
    logEvent(this.db, {
      eventType: "BOT_START",
      data: { marketScope: cfg.marketScope, loopIntervalMs: cfg.loopIntervalMs, venueId: this.ecCtx.config.venueId, withSigner: Boolean(this.ecCtx.canTrade) },
      blockNumber: this.lastFillBlock !== null ? Number(this.lastFillBlock) : null
    });
    console.log(`[BOT] started - scope=${cfg.marketScope} interval=${cfg.loopIntervalMs}ms venue=${String(this.ecCtx.config.venueId ?? "inferred")} withSigner=${String(this.ecCtx.canTrade)} block=${String(this.lastFillBlock ?? "-")}`);
    void this.tick().catch((err) => {
      console.error(`[BOT] tick failed: ${err.message}`);
    });
    const interval = this.getConfig().loopIntervalMs;
    this.timer = setInterval(() => {
      if (this.statusValue !== "running" || this.stopping) return;
      void this.tick().catch((err) => {
        console.error(`[BOT] tick failed: ${err.message}`);
      });
    }, interval);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }
  async stop(reason) {
    if (this.statusValue === "stopped") return;
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.statusValue = "stopped";
    logEvent(this.db, {
      eventType: "BOT_STOP",
      data: { reason: reason ?? "manual stop", tickCount: this.tickCount }
    });
    console.log(`[BOT] stopped - reason=${reason ?? "manual"} ticks=${this.tickCount}`);
    if (this.ecCtx) {
      try {
        await Promise.race([this.ecCtx.exchange.close().catch(() => void 0), new Promise((r) => setTimeout(r, 2e3))]);
      } catch {
      }
      this.ecCtx = null;
    }
    this.stopping = false;
  }
  /** Single tick: discover → analyze → strategy → risk → execution → fill poll → mid-move observability */
  async tick() {
    if (!this.ecCtx || this.statusValue !== "running") return;
    const cfg = this.getConfig();
    if (!cfg.bot.enabled) {
      logEvent(this.db, { eventType: "AUTO_STOP_DISABLED", data: { reason: "config.enabled became false during run - auto-stop", tickCount: this.tickCount } });
      await this.stop("auto-stop: bot disabled");
      return;
    }
    const totalPnL = getTotalRealizedPnL(this.db);
    const currentLoss = totalPnL < 0 ? -totalPnL : 0;
    if (currentLoss >= cfg.bot.maxLoss) {
      logEvent(this.db, { eventType: "AUTO_STOP_LOSS_LIMIT", data: { reason: `loss limit breached: currentLoss ${currentLoss.toFixed(4)} >= maxLoss ${cfg.bot.maxLoss}`, totalPnL, currentLoss, maxLoss: cfg.bot.maxLoss } });
      await this.stop(`auto-stop: loss limit ${currentLoss.toFixed(2)} >= ${cfg.bot.maxLoss}`);
      return;
    }
    this.tickCount += 1;
    const tickStartUnix = Math.floor(Date.now() / 1e3);
    const tickStartIso = (/* @__PURE__ */ new Date()).toISOString();
    let blockNumber = null;
    try {
      const bn = await this.ecCtx.exchange.client.getViemClient().getBlockNumber();
      blockNumber = Number(bn);
    } catch {
      blockNumber = null;
    }
    logEvent(this.db, {
      eventType: "TICK",
      data: { tick: this.tickCount, tickStartIso, marketScope: cfg.marketScope, blockNumber, totalPnL, currentLoss },
      blockNumber
    });
    let markets;
    try {
      markets = await activeMarkets(this.ecCtx);
    } catch (err) {
      logEvent(this.db, {
        eventType: "TICK",
        data: { tick: this.tickCount, error: `activeMarkets failed: ${err.message}` },
        blockNumber
      });
      return;
    }
    if (cfg.marketScope !== "all") {
      markets = markets.filter((m) => String(m.info.marketId) === cfg.marketScope);
    }
    console.log(`[BOT] tick #${this.tickCount} - ${markets.length} live market(s) block=${String(blockNumber ?? "-")} scope=${cfg.marketScope}`);
    let balances;
    try {
      if (this.ecCtx.canTrade) {
        const snap = await readBalancesTagged(this.ecCtx);
        balances = { nativeWei: snap.nativeWei, tUsdcRaw: snap.tUsdcRaw };
      }
    } catch {
    }
    const positions = getBotPositions(this.db).map((p) => ({ marketId: p.marketId, symbol: p.symbol, side: "YES", size: p.netPosition }));
    const strategyContextBase = {
      config: cfg.bot,
      openPositions: positions,
      currentLoss,
      balances,
      nowSec: tickStartUnix
    };
    for (const m of markets) {
      const info = m.info;
      const marketId = String(info.marketId);
      const symbol = m.symbol;
      const { yes } = outcomeSymbols(m);
      let onchain = null;
      try {
        onchain = await marketOnchain(this.ecCtx, m);
      } catch (err) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "MARKET_EVALUATED",
          data: { error: `marketOnchain failed: ${err.message}` },
          blockNumber
        });
        continue;
      }
      if (!onchain) {
        logEvent(this.db, { marketId, symbol, eventType: "MARKET_EVALUATED", data: { error: "marketOnchain returned null" }, blockNumber });
        continue;
      }
      let bids = [];
      let asks = [];
      try {
        const raw = await this.ecCtx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
        bids = raw.bids;
        asks = raw.asks;
      } catch (err) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "MARKET_EVALUATED",
          data: { error: `fetchOrderBook failed: ${err.message}` },
          blockNumber
        });
        continue;
      }
      const bestBid = bids[0]?.[0];
      const bestAsk = asks[0]?.[0];
      const mid = bestBid !== void 0 && bestAsk !== void 0 ? (bestBid + bestAsk) / 2 : bestBid ?? bestAsk ?? null;
      const timeRemaining = Number(onchain.expiry) - tickStartUnix;
      const analysis = analyzeMarket({
        marketId,
        symbol,
        bids,
        asks,
        bestBid,
        bestAsk,
        marketProbability: mid ?? void 0,
        timeRemaining
      });
      checkMidMove(this.db, {
        marketId,
        symbol,
        currentMid: mid,
        currentBlockNumber: blockNumber
      });
      logEvent(this.db, {
        marketId,
        symbol,
        eventType: "MARKET_EVALUATED",
        data: { analysis: { marketProbability: analysis.marketProbability, estimatedProbability: analysis.estimatedProbability, edge: analysis.edge, imbalance: analysis.imbalance, liquidity: analysis.liquidity, spread: analysis.spread, spreadBps: analysis.spreadBps, direction: analysis.direction, recommendation: analysis.recommendation, timeRemaining: analysis.timeRemaining, reasons: analysis.reasons }, mid, bids: bids.slice(0, 2), asks: asks.slice(0, 2) },
        blockNumber
      });
      let pipelineResult = null;
      try {
        pipelineResult = await runPipeline(
          {
            analysis,
            strategy: edgeThresholdStrategy,
            strategyContext: strategyContextBase,
            ecCtx: this.ecCtx,
            market: m,
            onchain,
            state: this.orderState,
            yesSymbol: yes
          }
        );
      } catch (err) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { error: `pipeline failed: ${err.message}`, analysis, tick: this.tickCount },
          blockNumber
        });
        continue;
      }
      const decision = pipelineResult.decision;
      const risk = pipelineResult.risk;
      logEvent(this.db, {
        marketId,
        symbol,
        eventType: "STRATEGY_DECISION",
        data: { decision, analysisReasons: analysis.reasons, tick: this.tickCount },
        blockNumber
      });
      if (risk === null) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "RISK_CHECK",
          data: { skipped: true, reason: "strategy SKIPs - risk not checked (short-circuit)" },
          blockNumber
        });
      } else {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "RISK_CHECK",
          data: { approved: risk.approved, rejectionReasons: risk.rejectionReasons },
          blockNumber
        });
      }
      if (pipelineResult.executed && pipelineResult.placeResult) {
        const pr = pipelineResult.placeResult;
        if (pr.orderId !== void 0 && pr.orderId !== null) {
          this.pendingOrderMeta.set(String(pr.orderId), {
            edgeAtDecision: analysis.edge,
            midAtDecision: mid,
            gasUsed: String(pr.gasUsed ?? ""),
            gasPrice: null,
            // Stage 5 pipeline always BUYS the decided outcome (see pipeline.ts side:"buy") - the
            // fill's side/outcome come from OUR order, not the OrderFilled log (which has no side).
            side: "buy",
            outcome: decision.side
          });
        }
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { executed: true, txHash: pr.txHash, blockNumber: String(pr.blockNumber), orderId: String(pr.orderId ?? ""), price: pr.price, size: pr.size, edgeAtDecision: analysis.edge, midAtDecision: mid, gasUsed: String(pr.gasUsed ?? "") },
          blockNumber: Number(pr.blockNumber)
        });
        console.log(`[BOT] tick #${this.tickCount} ${symbol} PLACED orderId=${String(pr.orderId ?? "?")} tx=${String(pr.txHash).slice(0, 18)}... block=${String(pr.blockNumber)}`);
      } else if (decision.action === "SKIP") {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { executed: false, reason: "SKIP - no execution", decision, risk },
          blockNumber
        });
      } else if (risk && !risk.approved) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { executed: false, reason: "blocked by risk", rejectionReasons: risk.rejectionReasons, decision },
          blockNumber
        });
      }
    }
    await this.pollFills(blockNumber);
    const postPnL = getTotalRealizedPnL(this.db);
    const postLoss = postPnL < 0 ? -postPnL : 0;
    if (postLoss >= cfg.bot.maxLoss) {
      logEvent(this.db, { eventType: "AUTO_STOP_LOSS_LIMIT", data: { reason: `post-tick loss limit: ${postLoss.toFixed(4)} >= ${cfg.bot.maxLoss}`, postPnL, postLoss } });
      await this.stop(`auto-stop: post-tick loss limit ${postLoss.toFixed(2)} >= ${cfg.bot.maxLoss}`);
    }
  }
  /** Poll on-chain OrderFilled logs for all live pools since lastFillBlock. */
  async pollFills(currentBlockNumber) {
    if (!this.ecCtx || currentBlockNumber === null || this.lastFillBlock === null) {
      if (currentBlockNumber !== null && this.lastFillBlock === null) this.lastFillBlock = BigInt(currentBlockNumber);
      return;
    }
    const fromBlock = this.lastFillBlock + 1n;
    const toBlock = BigInt(currentBlockNumber);
    if (fromBlock > toBlock) return;
    let markets = [];
    try {
      markets = await activeMarkets(this.ecCtx);
    } catch {
      return;
    }
    const cfg = this.getConfig();
    if (cfg.marketScope !== "all") {
      markets = markets.filter((m) => String(m.info.marketId) === cfg.marketScope);
    }
    for (const m of markets) {
      const info = m.info;
      const marketId = String(info.marketId);
      const symbol = m.symbol;
      let pool;
      try {
        const oc = await marketOnchain(this.ecCtx, m);
        pool = oc?.pool;
      } catch {
        continue;
      }
      if (!pool) continue;
      try {
        const logs = await this.ecCtx.exchange.client.getViemClient().getLogs({
          address: pool,
          events: [
            {
              type: "event",
              name: "OrderFilled",
              inputs: [
                { name: "takerOrderId", type: "uint128", indexed: true },
                { name: "makerOrderId", type: "uint128", indexed: true },
                { name: "quantityFilled", type: "uint256" },
                { name: "takerRemainingQuantity", type: "uint256" },
                { name: "makerRemainingQuantity", type: "uint256" },
                { name: "fillPrice", type: "uint256" }
              ]
            }
          ],
          fromBlock,
          toBlock
        });
        if (logs.length === 0) {
          const rawLogs = await this.ecCtx.exchange.client.getViemClient().getLogs({
            address: pool,
            fromBlock,
            toBlock
          });
          const filtered = rawLogs.filter((l) => String(l.topics[0]).toLowerCase() === ORDER_FILLED_TOPIC.toLowerCase());
          for (const l of filtered) {
            const txHash = String(l.transactionHash ?? "0x?");
            const blockNumber = Number(l.blockNumber ?? toBlock);
            const exists = this.db.prepare("SELECT id FROM bot_fills WHERE txHash=? AND blockNumber=?").get(txHash, blockNumber);
            if (exists) continue;
            insertBotFill(this.db, { txHash, blockNumber, marketId, symbol, rawData: l });
            logEvent(this.db, { marketId, symbol, eventType: "FILL_OBSERVED", data: { txHash, blockNumber, rawLog: l, source: "raw topic" }, blockNumber });
            this.applyPositionFromFill({ marketId, symbol, side: null, outcome: null, quantityFilled: 1, fillPrice: null });
          }
          continue;
        }
        for (const l of logs) {
          const txHash = String(l.transactionHash ?? "0x?");
          const blockNumber = Number(l.blockNumber ?? toBlock);
          const exists = this.db.prepare("SELECT id FROM bot_fills WHERE txHash=? AND blockNumber=?").get(txHash, blockNumber);
          if (exists) continue;
          const args = l.args;
          const qty = args?.quantityFilled !== void 0 ? Number(args.quantityFilled) / 1e6 : 1;
          const price = args?.fillPrice !== void 0 ? Number(args.fillPrice) / 1e6 : null;
          const pending = this.pendingOrderMeta.get(String(args?.makerOrderId ?? "")) ?? this.pendingOrderMeta.get(String(args?.takerOrderId ?? ""));
          const edgeAtDecision = pending?.edgeAtDecision ?? null;
          const midAtDecision = pending?.midAtDecision ?? null;
          const gasUsed = pending?.gasUsed ?? null;
          const gasPrice = pending?.gasPrice ?? null;
          const gasCost = gasUsed && gasPrice ? Number(BigInt(gasUsed) * BigInt(gasPrice)) / 1e18 : null;
          const side = pending?.side ?? null;
          const outcome = pending?.outcome ?? null;
          const fillId = insertBotFill(this.db, {
            txHash,
            blockNumber,
            marketId,
            symbol,
            orderId: String(args?.takerOrderId ?? args?.makerOrderId ?? ""),
            side,
            outcome,
            quantityFilled: qty,
            fillPrice: price,
            edgeAtDecision,
            midAtDecision,
            gasUsed,
            gasPrice,
            gasCost,
            rawData: l
          });
          logEvent(this.db, { marketId, symbol, eventType: "FILL_OBSERVED", data: { txHash, blockNumber, args, qty, price, side, outcome, edgeAtDecision, midAtDecision, gasUsed, gasPrice, gasCost }, blockNumber });
          this.applyPositionFromFill({ marketId, symbol, side, outcome, quantityFilled: qty, fillPrice: price, fillId });
          if (pending) {
            this.pendingOrderMeta.delete(String(args?.makerOrderId ?? ""));
            this.pendingOrderMeta.delete(String(args?.takerOrderId ?? ""));
          }
        }
      } catch (err) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "FILL_OBSERVED",
          data: { error: `pollFills getLogs failed for ${symbol}: ${err.message}` },
          blockNumber: Number(toBlock)
        });
      }
    }
    this.lastFillBlock = toBlock;
  }
  /** Apply a real (or simulated) fill to the position model - cost basis on buys, EARLY_CLOSE on sells. */
  applyPositionFromFill(input) {
    const { marketId, symbol } = input;
    if (input.side === null || input.outcome === null || input.fillPrice === null) {
      logEvent(this.db, {
        marketId,
        symbol,
        eventType: "FILL_OBSERVED",
        data: {
          positionUpdate: {
            skipped: true,
            reason: `fill has no decoded side/outcome/price (side=${String(input.side)}, outcome=${String(input.outcome)}, price=${String(input.fillPrice)}) - position NOT updated, would require guessing`
          }
        }
      });
      return;
    }
    const result = applyFillToPosition(this.db, {
      marketId,
      symbol,
      side: input.side,
      outcome: input.outcome,
      quantityFilled: input.quantityFilled,
      fillPrice: input.fillPrice,
      fillId: input.fillId
    });
    if (result.kind === "error") {
      logEvent(this.db, {
        marketId,
        symbol,
        eventType: "FILL_OBSERVED",
        data: { positionUpdate: { error: result.reason, quantityFilled: input.quantityFilled }, fillSide: input.side, outcome: input.outcome }
      });
      return;
    }
    const updated = getBotPosition(this.db, marketId);
    const newRealizedPnL = updated?.realizedPnL ?? 0;
    logEvent(this.db, {
      marketId,
      symbol,
      eventType: "FILL_OBSERVED",
      data: {
        newRealizedPnL,
        cumulativeRealizedPnL: newRealizedPnL,
        positionUpdate: {
          marketId,
          symbol,
          result,
          note: "position cost basis / EARLY_CLOSE realization from OrderFilled event (LIVE_ONCHAIN fills \u2192 DERIVED basis)"
        }
      }
    });
  }
  /**
   * For tests: simulate a real fill through the SAME position model used for live data - builds
   * cost basis on buys, realizes EARLY_CLOSE P&L on sells. P&L is COMPUTED, never passed in.
   */
  simulateFill(marketId, symbol, quantityFilled, fillPrice, opts) {
    const txHash = `0x${"a".repeat(64)}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const blockNumber = 999999999;
    const fillId = insertBotFill(this.db, {
      txHash,
      blockNumber,
      marketId,
      symbol,
      orderId: "test",
      side: opts?.side ?? "buy",
      outcome: opts?.outcome ?? "YES",
      quantityFilled,
      fillPrice,
      edgeAtDecision: opts?.edgeAtDecision ?? null,
      midAtDecision: opts?.midAtDecision ?? null,
      gasUsed: opts?.gasUsed ?? null,
      gasPrice: opts?.gasPrice ?? null,
      gasCost: opts?.gasCost ?? null,
      rawData: { simulated: true }
    });
    this.applyPositionFromFill({
      marketId,
      symbol,
      side: opts?.side ?? "buy",
      outcome: opts?.outcome ?? "YES",
      quantityFilled,
      fillPrice,
      fillId
    });
    const pos = getBotPosition(this.db, marketId);
    logEvent(this.db, {
      marketId,
      symbol,
      eventType: "FILL_OBSERVED",
      data: {
        simulated: true,
        quantityFilled,
        fillPrice,
        side: opts?.side ?? "buy",
        outcome: opts?.outcome ?? "YES",
        newNet: pos?.netPosition ?? 0,
        newRealizedPnL: pos?.realizedPnL ?? 0,
        newStatus: pos?.status ?? "OPEN",
        edgeAtDecision: opts?.edgeAtDecision ?? null,
        midAtDecision: opts?.midAtDecision ?? null
      },
      blockNumber
    });
    return fillId;
  }
  close() {
    try {
      this.db.close();
    } catch {
    }
  }
};

// src/api/server.ts
var globalRunner = null;
function getRunner() {
  if (!globalRunner) {
    globalRunner = new BotRunner({ dbPath: SNAPSHOT_CONFIG.DB_PATH });
  }
  return globalRunner;
}
async function buildServer() {
  const fastify = Fastify({ logger: true });
  await fastify.register(cors, { origin: true });
  fastify.get("/health", async () => ({ status: "ok", dataIntegrity: "DERIVED", timestamp: (/* @__PURE__ */ new Date()).toISOString() }));
  await registerMarketRoutes(fastify);
  await registerPositionRoutes(fastify);
  await registerOrderRoutes(fastify);
  await registerStrategyRoutes(fastify);
  await registerBotRoutes(fastify);
  return fastify;
}
async function startServer(port = Number(process.env.PORT ?? 3e3), host = "0.0.0.0") {
  const server = await buildServer();
  await server.listen({ port, host });
  console.log(`[API] listening on http://${host}:${port}`);
}
if (process.argv[1]?.endsWith("server.ts")) {
  startServer().catch((err) => {
    console.error(`[API] failed to start: ${err.message}`);
    process.exit(1);
  });
}

// api/index.ts
var app = null;
async function handler(req, res) {
  if (!app) {
    app = await buildServer();
    await app.ready();
  }
  if (typeof req.url === "string" && req.url.startsWith("/api")) {
    req.url = req.url.slice("/api".length) || "/";
  }
  app.server.emit("request", req, res);
}
export {
  handler as default
};
/**
 * @license
 * Copyright DreamDEX S.A.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://github.com/somnia-chain/dreamdex-bot-kit/blob/main/LICENSE
 */
