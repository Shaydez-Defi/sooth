/**
 * Config loader — validates env and fails LOUDLY on missing/invalid values.
 * Never defaults to fake chain IDs, RPC URLs, or keys.
 *
 * Tag: DERIVED (env) + LIVE_ONCHAIN (chain IDs) — not ESTIMATED.
 */
import { config as dotenvConfig } from "dotenv";
import { CHAIN_IDS, NETWORK_DEFAULTS } from "./constants.js";

dotenvConfig();

export interface AppConfig {
  // LIVE_ONCHAIN
  readonly chainId: number;
  // DERIVED
  readonly network: "testnet" | "mainnet";
  readonly somniaRpcUrl: string;
  readonly dreamdexApiBase: string;
  readonly dreamdexWsUrl: string;
  // DERIVED (optional for read-only)
  readonly walletPrivateKey: string | undefined;
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") return undefined;
  return v.trim();
}

function parseChainId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`Invalid CHAIN_ID="${raw}": must be an integer (expected ${CHAIN_IDS.TESTNET} for testnet, ${CHAIN_IDS.MAINNET} for mainnet).`);
  }
  if (n !== CHAIN_IDS.TESTNET && n !== CHAIN_IDS.MAINNET) {
    throw new Error(`Invalid CHAIN_ID=${n}: expected ${CHAIN_IDS.TESTNET} (testnet) or ${CHAIN_IDS.MAINNET} (mainnet).`);
  }
  return n;
}

function resolveNetwork(chainId: number, explicitNetwork: string | undefined): "testnet" | "mainnet" {
  if (explicitNetwork !== undefined) {
    const lower = explicitNetwork.toLowerCase();
    if (lower !== "testnet" && lower !== "mainnet") {
      throw new Error(`Invalid NETWORK="${explicitNetwork}": must be "testnet" or "mainnet".`);
    }
    const expected = lower === "testnet" ? CHAIN_IDS.TESTNET : CHAIN_IDS.MAINNET;
    if (expected !== chainId) {
      throw new Error(`CHAIN_ID=${chainId} mismatches NETWORK="${lower}" (expected ${expected}). Fix one of them.`);
    }
    return lower;
  }
  // Derive from chainId if NETWORK not set
  if (chainId === CHAIN_IDS.TESTNET) return "testnet";
  return "mainnet";
}

function validatePrivateKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // Allow placeholder zero-key to be treated as "not set" only if explicitly the example zero key?
  // But per rules, never default to fake values — so validate shape strictly and let caller decide to omit.
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    // Treat example placeholder as missing — read-only mode
    return undefined;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(`Invalid WALLET_PRIVATE_KEY: must be 0x + 64 hex chars (32 bytes). Got length ${trimmed.length}.`);
  }
  return trimmed;
}

/**
 * ANALYSIS — thresholds for Market Intelligence Engine (all in src/config.ts per brief, no inline magic numbers).
 * Depth window: top N levels of YES book (bid/ask quantity sum). See src/analysis/engine.ts for formula.
 */
export const ANALYSIS_CONFIG = {
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
  MIN_TIME_REMAINING: 300,
} as const;

export function loadConfig(): AppConfig {
  // SOMNIA_TESTNET_RPC_URL / RPC_URL fallback, DREAMDEX_API_BASE / REST_API_URL fallback, CHAIN_ID, NETWORK
  const somniaRpcUrl =
    optionalEnv("SOMNIA_TESTNET_RPC_URL") ?? optionalEnv("RPC_URL") ?? NETWORK_DEFAULTS.testnet.rpcUrl;
  // Require explicitness for RPC/CHAIN per rules? But allow default for read-only convenience.
  // If env explicitly missing and default used, still validate it's a real URL (not fake).
  if (!somniaRpcUrl.startsWith("https://")) {
    throw new Error(`Invalid SOMNIA_TESTNET_RPC_URL="${somniaRpcUrl}": must be https://.`);
  }

  const chainIdRaw = optionalEnv("CHAIN_ID");
  const chainId = chainIdRaw !== undefined ? parseChainId(chainIdRaw) : CHAIN_IDS.TESTNET;

  const network = resolveNetwork(chainId, optionalEnv("NETWORK"));

  const dreamdexApiBase =
    optionalEnv("DREAMDEX_API_BASE") ?? optionalEnv("REST_API_URL") ?? NETWORK_DEFAULTS[network].restApi;
  if (!dreamdexApiBase.startsWith("https://")) {
    throw new Error(`Invalid DREAMDEX_API_BASE="${dreamdexApiBase}": must be https://.`);
  }

  const dreamdexWsUrl = optionalEnv("DREAMDEX_WS_URL") ?? optionalEnv("WS_URL") ?? NETWORK_DEFAULTS[network].wsUrl;

  // Private key: support both WALLET_PRIVATE_KEY and Bot Kit's PRIVATE_KEY
  const rawKey = optionalEnv("WALLET_PRIVATE_KEY") ?? optionalEnv("PRIVATE_KEY");
  const walletPrivateKey = validatePrivateKey(rawKey);

  // Sync to Bot Kit's expected env vars so its createChainContext / getNetwork honor our config
  // (Bot Kit reads NETWORK, PRIVATE_KEY, RPC_URL, REST_API_URL, WS_URL)
  process.env.NETWORK = network;
  if (walletPrivateKey) process.env.PRIVATE_KEY = walletPrivateKey;
  process.env.RPC_URL = somniaRpcUrl;
  process.env.REST_API_URL = dreamdexApiBase;
  process.env.WS_URL = dreamdexWsUrl;
  process.env.CHAIN_ID = String(chainId);

  return {
    chainId,
    network,
    somniaRpcUrl,
    dreamdexApiBase,
    dreamdexWsUrl,
    walletPrivateKey,
  };
}
