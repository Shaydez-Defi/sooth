/**
 * Strategy abstraction - Market Data → Strategy → Signal → Risk → Execution.
 * Sits on Stage 3's MarketAnalysis and Stage 2's order lifecycle. Does NOT run unattended (no loop).
 * Data tags: DERIVED for decisions, LIVE_INDEXER/LIVE_ONCHAIN from analysis.
 */

import type { MarketAnalysis } from "../analysis/types.js";

/**
 * Bot Configuration shape (brief section 7).
 * All thresholds from config, no inline magic - defaults derive from ANALYSIS_CONFIG.
 */
export interface BotConfig {
  /** Bot enabled - risk check 1. */
  readonly enabled: boolean;
  /** Max open positions (position limit - risk check 6). */
  readonly maxPosition: number;
  /** Max cumulative loss in tUSDC before halt (loss limit - risk check 7). */
  readonly maxLoss: number;
  /** Minimum liquidity (shares) to allow order (risk check 4). Mirrors ANALYSIS_CONFIG.MIN_LIQUIDITY. */
  readonly minLiquidity: number;
  /** Maximum spread in probability points (risk check 5). Mirrors ANALYSIS_CONFIG.MAX_SPREAD. */
  readonly maxSpread: number;
  /** Maximum spread in bps (risk check 5). Mirrors ANALYSIS_CONFIG.MAX_SPREAD_BPS. */
  readonly maxSpreadBps: number;
  /** Minimum seconds to expiry buffer (risk check 3). Mirrors ANALYSIS_CONFIG.MIN_TIME_REMAINING. */
  readonly minTimeRemaining: number;
  /** Minimum order size in shares (risk check 8). */
  readonly minOrderSize: number;
  /** Maximum order size in shares (risk check 8). */
  readonly maxOrderSize: number;
  /** Default order size for edge-threshold strategy (DERIVED, not hardcoded in strategy). */
  readonly defaultOrderSize: number;
  /** Minimum native balance (wei) required for gas (risk check 10). */
  readonly minNativeWei: bigint;
  /** Minimum collateral raw balance (tUSDC 6dp) to consider wallet funded - loose; precise check is price*size (risk check 9). */
  readonly minCollateralRaw: bigint;
}

/**
 * Single open position (DERIVED mirror of LIVE_ONCHAIN open orders).
 */
export interface Position {
  readonly marketId: string; // LIVE_ONCHAIN
  readonly symbol: string; // LIVE_INDEXER
  readonly side: "YES" | "NO"; // DERIVED
  readonly size: number; // DERIVED human shares
}

export interface StrategyContext {
  /** Bot config - all thresholds. */
  readonly config: BotConfig;
  /** Current open positions (DERIVED mirror of LIVE_ONCHAIN). */
  readonly openPositions: readonly Position[];
  /** Cumulative realized loss in tUSDC (DERIVED, positive = loss). For loss-limit check. */
  readonly currentLoss: number;
  /** Wallet balances for funded/gas checks (LIVE_ONCHAIN if present). Optional - if missing, funded/gas checks reject. */
  readonly balances?: Readonly<{ nativeWei: bigint; tUsdcRaw: bigint }>;
  /** Current unix seconds for expiry checks (DERIVED, default Date.now()/1000). */
  readonly nowSec?: number;
}

export interface StrategyDecision {
  /** PLACE_ORDER only when analysis.recommendation===TRADE; otherwise SKIP. */
  readonly action: "PLACE_ORDER" | "SKIP";
  /** Side for PLACE_ORDER - maps direction YES/NO. Undefined for SKIP. */
  readonly side?: "YES" | "NO";
  /** Limit price in (0,1) probability for PLACE_ORDER. Derived from analysis.marketProbability, not hardcoded. */
  readonly price?: number;
  /** Size in shares for PLACE_ORDER. Derived from config.defaultOrderSize, not hardcoded. */
  readonly size?: number;
  /** Must trace back to MarketAnalysis reasons - carried through unchanged for SKIP. */
  readonly reasons: string[];
}

export interface Strategy {
  readonly id: string;
  decide(analysis: MarketAnalysis, context: StrategyContext): StrategyDecision;
}
