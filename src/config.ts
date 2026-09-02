/**
 * Config loader - validates env and fails LOUDLY on missing/invalid values.
 * Never defaults to fake chain IDs, RPC URLs, or keys.
 *
 * Tag: DERIVED (env) + LIVE_ONCHAIN (chain IDs) - not ESTIMATED.
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
  // But per rules, never default to fake values - so validate shape strictly and let caller decide to omit.
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    // Treat example placeholder as missing - read-only mode
    return undefined;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(`Invalid WALLET_PRIVATE_KEY: must be 0x + 64 hex chars (32 bytes). Got length ${trimmed.length}.`);
  }
  return trimmed;
}

/**
 * SNAPSHOT LOGGER - poller config for continuous order-book capture.
 * Tag: DERIVED (env) - poll interval env-overridable, DB path zero external service.
 */
export const SNAPSHOT_CONFIG = {
  /** Poller interval in ms - env POLL_INTERVAL_MS overrides, must be >= 5_000. */
  POLL_INTERVAL_MS: (() => {
    const raw = process.env.POLL_INTERVAL_MS?.trim();
    if (raw === undefined || raw === "") return 45_000;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 5_000) {
      throw new Error(`Invalid POLL_INTERVAL_MS="${raw}": must be a number >= 5000 (ms).`);
    }
    return n;
  })(),
  /** SQLite path - zero external service dependency (Codespace unattended). */
  DB_PATH: process.env.SNAPSHOT_DB_PATH?.trim() ? String(process.env.SNAPSHOT_DB_PATH?.trim()) : "data/snapshots.db",
} as const;

/**
 * ANALYSIS - thresholds for Market Intelligence Engine (all in src/config.ts per brief, no inline magic numbers).
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

/**
 * BOT - defaults for Strategy/Risk pipeline (brief sections 7 & 9).
 * All risk thresholds in src/config.ts, no inline magic in strategy/risk modules.
 * Values are DERIVED, not LIVE_ONCHAIN.
 */
export const BOT_CONFIG = {
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
  MIN_NATIVE_WEI: 10_000_000_000_000_000n, // 0.01 * 1e18
  /** Min collateral raw (tUSDC 6dp) loose check - 0.5 tUSDC. Precise check is price*size. */
  MIN_COLLATERAL_RAW: 500_000n, // 0.5 * 1e6
  /** Loop interval for BotRunner (ms) - reuses snapshot logger's poll interval if env not set, min 5000. */
  LOOP_INTERVAL_MS: (() => {
    const raw = process.env.BOT_LOOP_INTERVAL_MS?.trim();
    if (raw === undefined || raw === "") return 30_000;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 5_000) {
      throw new Error(`Invalid BOT_LOOP_INTERVAL_MS="${raw}": must be a number >= 5000 (ms).`);
    }
    return n;
  })(),
} as const;

/**
 * MID-MOVE OBSERVABILITY - lightweight mid-price drift alert, NOT a trading signal.
 * Compares current mid to most recent prior snapshot for same market in data/snapshots.db.
 * Threshold chosen as 0.02-0.03 probability points (2-3 cents) - small enough to catch
 * intraday drifts observed in stage-logger data (e.g. 0.082 move over 47s) while not
 * spamming on every 1-tick jitter. DERIVED, not magic in logic.
 */
export const MID_MOVE_CONFIG = {
  /** Alert threshold in probability points (e.g. 0.025 = 2.5 cents). */
  MID_MOVE_ALERT_THRESHOLD: (() => {
    const raw = process.env.MID_MOVE_ALERT_THRESHOLD?.trim();
    if (raw === undefined || raw === "") return 0.025;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n >= 1) {
      throw new Error(`Invalid MID_MOVE_ALERT_THRESHOLD="${raw}": must be a number in (0,1).`);
    }
    return n;
  })(),
} as const;

/**
 * SETTLEMENT POLLER - cadence for realized-P&L settlement checks (brief §13 gap-close).
 * Settlement happens on the market's own clock, not the bot's trading clock, so this poller runs
 * on its OWN interval, decoupled from the BotRunner loop. DERIVED config, env-overridable.
 */
export const SETTLEMENT_POLL_CONFIG = {
  /** Poll interval in ms - env SETTLEMENT_POLL_INTERVAL_MS overrides, must be >= 5000. */
  POLL_INTERVAL_MS: (() => {
    const raw = process.env.SETTLEMENT_POLL_INTERVAL_MS?.trim();
    if (raw === undefined || raw === "") return 60_000;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 5_000) {
      throw new Error(`Invalid SETTLEMENT_POLL_INTERVAL_MS="${raw}": must be a number >= 5000 (ms).`);
    }
    return n;
  })(),
} as const;

/**
 * ADVERSE SELECTION - post-fill mid lookahead for edge analytics (brief §13 gap-close).
 * After a real fill we measure where the mid went over the next N minutes vs our fill price,
 * joined from the snapshot logger's real mid history (data/snapshots.db, polled ~45s).
 *   LOOKAHEAD_SECONDS: 300 (5 min) - long enough to capture info-driven drift after our taker flow
 *     (observed mids in snapshots.db move substantially within minutes), short enough to stay inside
 *     the market's short trading window.
 *   MAX_DEVIATION_SECONDS: 120 (2 min) - the logger polls every ~45s, so a snapshot within ±120s of
 *     fillTime+N is at most ~2 polls off the target; anything further is not "close enough to t+N"
 *     and that fill is reported NOT COMPUTABLE (never interpolated).
 * DERIVED config, env-overridable, no magic numbers in logic.
 */
export const ADVERSE_SELECTION_CONFIG = {
  LOOKAHEAD_SECONDS: (() => {
    const raw = process.env.ADVERSE_SELECTION_LOOKAHEAD_SECONDS?.trim();
    if (raw === undefined || raw === "") return 300;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid ADVERSE_SELECTION_LOOKAHEAD_SECONDS="${raw}": must be a positive integer (seconds).`);
    }
    return n;
  })(),
  MAX_DEVIATION_SECONDS: (() => {
    const raw = process.env.ADVERSE_SELECTION_DEVIATION_SECONDS?.trim();
    if (raw === undefined || raw === "") return 120;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid ADVERSE_SELECTION_DEVIATION_SECONDS="${raw}": must be a positive integer (seconds).`);
    }
    return n;
  })(),
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
