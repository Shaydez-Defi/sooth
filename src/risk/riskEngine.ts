/**
 * Risk Checks module — brief section 9, must NOT be skippable.
 * StrategyDecision → riskEngine.check → only then → orderLifecycle.placeRestingOrder (via pipeline).
 * All thresholds from src/config.ts (BOT_CONFIG / ANALYSIS_CONFIG), no inline magic.
 * Tags: DERIVED checks on LIVE_INDEXER/LIVE_ONCHAIN inputs.
 */

import type { StrategyDecision, StrategyContext } from "../strategy/types.js";
import type { MarketAnalysis } from "../analysis/types.js";

// Collateral decimals for tUSDC on testnet (6) — DERIVED from vendor config, not magic in logic.
// Mainnet uses 18, but risk check uses raw collateral math with 6dp for testnet; mainnet would need 18dp.
// We keep 6dp as default and note the derivation; risk check uses price*size*1e6 which matches EcContext decimals.
const COLLATERAL_DECIMALS = 6;
const COLLATERAL_SCALE = 10 ** COLLATERAL_DECIMALS;

export interface RiskCheckContext extends StrategyContext {
  readonly analysis: MarketAnalysis; // LIVE_INDEXER/LIVE_ONCHAIN from Stage 3 engine
}

export interface RiskResult {
  readonly approved: boolean;
  readonly rejectionReasons: string[];
}

/**
 * Implements every check from the brief's list.
 * 1 bot enabled, 2 market still active, 3 close-to-expiry buffer,
 * 4 liquidity sufficient, 5 spread acceptable, 6 position limit,
 * 7 loss limit, 8 order size valid, 9 wallet funded, 10 gas sufficient.
 */
export function checkOrder(decision: StrategyDecision, context: RiskCheckContext): RiskResult {
  const reasons: string[] = [];
  const { config, analysis, openPositions, currentLoss, balances } = context;

  // 1) Bot enabled — config.enabled
  if (!config.enabled) {
    reasons.push("risk: bot disabled (config.enabled=false)");
  }

  // If decision is SKIP, risk engine should not have been called (pipeline short-circuit).
  // We keep it as a rejection to enforce pipeline ordering, but don't add redundant reasons.
  if (decision.action !== "PLACE_ORDER") {
    reasons.push("risk: decision is SKIP — risk check not applicable (should have short-circuited before risk)");
    return { approved: false, rejectionReasons: reasons };
  }

  // Need price/size for remaining checks — if missing, order size valid will fail but we guard here.
  const price = decision.price;
  const size = decision.size;

  // 2) Market still active — timeRemaining >0 (LIVE_ONCHAIN). If expired, market Locked/Resolved.
  // We treat analysis.timeRemaining <=0 as not active. LIVE_ONCHAIN expiry already in analysis.
  if (analysis.timeRemaining <= 0) {
    reasons.push(`risk: market no longer active (timeRemaining ${analysis.timeRemaining.toFixed(0)}s <= 0 — expired/Locked)`);
  }

  // 3) Close-to-expiry buffer — timeRemaining < minTimeRemaining (config)
  if (analysis.timeRemaining < config.minTimeRemaining) {
    reasons.push(`risk: close to expiry (timeRemaining ${analysis.timeRemaining.toFixed(0)}s < buffer ${config.minTimeRemaining}s)`);
  }

  // 4) Liquidity sufficient — analysis.liquidity < minLiquidity
  if (analysis.liquidity < config.minLiquidity) {
    reasons.push(`risk: liquidity insufficient (${analysis.liquidity.toFixed(1)} < min ${config.minLiquidity})`);
  }

  // 5) Spread acceptable — analysis.spread > maxSpread or spreadBps > maxSpreadBps
  if (analysis.spread > config.maxSpread || analysis.spreadBps > config.maxSpreadBps) {
    const spreadStr = Number.isFinite(analysis.spread) ? analysis.spread.toFixed(4) : "∞";
    const bpsStr = Number.isFinite(analysis.spreadBps) ? analysis.spreadBps.toFixed(1) : "∞";
    reasons.push(`risk: spread too wide (${spreadStr} / ${bpsStr} bps > max ${config.maxSpread.toFixed(4)} / ${config.maxSpreadBps} bps)`);
  }

  // 6) Position limit — openPositions.length >= maxPosition
  if (openPositions.length >= config.maxPosition) {
    reasons.push(`risk: position limit reached (${openPositions.length} >= maxPosition ${config.maxPosition})`);
  }

  // 7) Loss limit — currentLoss >= maxLoss (tUSDC) — halt further risk
  if (currentLoss >= config.maxLoss) {
    reasons.push(`risk: loss limit breached (currentLoss ${currentLoss.toFixed(4)} >= maxLoss ${config.maxLoss})`);
  }

  // 8) Order size valid — size in [minOrderSize, maxOrderSize] and price in (0,1)
  let sizeValid = true;
  if (size === undefined || !Number.isFinite(size)) {
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
  if (price === undefined || !Number.isFinite(price)) {
    reasons.push("risk: order price missing or not finite");
  } else {
    if (!(price > 0 && price < 1)) {
      reasons.push(`risk: order price outside (0,1) probability (${String(price)})`);
    }
  }

  // 9) Wallet funded — need price*size collateral (tUSDC) available.
  // Precise: requiredRaw = ceil(price * size * 1e6). Loose: also check minCollateralRaw threshold.
  if (!balances) {
    reasons.push("risk: wallet funded check unavailable (balances not provided)");
  } else {
    // Only check collateral amount if we have valid price/size
    if (sizeValid && price !== undefined && Number.isFinite(price) && price > 0 && price < 1 && size !== undefined && Number.isFinite(size)) {
      // DERIVED: required collateral for EC buy at price probability (escrow = price*size)
      const requiredRaw = BigInt(Math.ceil(price * size * COLLATERAL_SCALE));
      if (balances.tUsdcRaw < requiredRaw) {
        const haveHuman = Number(balances.tUsdcRaw) / COLLATERAL_SCALE;
        const needHuman = Number(requiredRaw) / COLLATERAL_SCALE;
        reasons.push(`risk: wallet collateral insufficient (have ${haveHuman.toFixed(6)} tUSDC < need ${needHuman.toFixed(6)} for price ${price.toFixed(4)} * size ${size})`);
      }
      if (balances.tUsdcRaw < config.minCollateralRaw) {
        // Also enforce loose minCollateral threshold from config (DERIVED)
        reasons.push(`risk: wallet collateral below minCollateralRaw (${String(balances.tUsdcRaw)} < ${String(config.minCollateralRaw)})`);
      }
    } else if (balances.tUsdcRaw < config.minCollateralRaw) {
      reasons.push(`risk: wallet collateral below minCollateralRaw (${String(balances.tUsdcRaw)} < ${String(config.minCollateralRaw)})`);
    }
  }

  // 10) Gas sufficient — nativeWei >= minNativeWei
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
