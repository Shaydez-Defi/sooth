/**
 * Reuse Stage 3's exact order-book depth/imbalance logic - don't reimplement divergent formula.
 * This module re-exports the same calculation as src/analysis/engine.ts:20-32 and helpers,
 * so the snapshot logger stores bidDepth/askDepth/imbalance identical to live analysis engine,
 * enabling later backtests to use genuine HISTORICAL book data with same DEPTH_LEVELS.
 *
 * Tag: DERIVED (bidDepth/askDepth/imbalance/mid from LIVE_INDEXER book).
 */
import { ANALYSIS_CONFIG } from "../config.js";

export interface DepthImbalance {
  readonly bidDepth: number; // DERIVED sum top DEPTH_LEVELS bid qtys
  readonly askDepth: number; // DERIVED sum top DEPTH_LEVELS ask qtys
  readonly imbalance: number; // DERIVED in [-1,1]
  readonly mid: number | null; // LIVE_INDEXER derived from best bid/ask
}

/**
 * Compute bidDepth, askDepth, imbalance, and mid exactly as src/analysis/engine.ts does.
 * - bidDepth = sum of top N bid quantities (N = DEPTH_LEVELS)
 * - askDepth = sum of top N ask quantities
 * - imbalance = (bidDepth - askDepth) / (bidDepth + askDepth) in [-1,1], 0 if no depth
 * - mid = (bestBid + bestAsk)/2 if both present, else bestBid ?? bestAsk ?? null
 *
 * Do NOT change this formula without updating src/analysis/engine.ts in lockstep.
 */
export function computeDepthImbalance(
  bids: ReadonlyArray<readonly [number, number]>,
  asks: ReadonlyArray<readonly [number, number]>,
): DepthImbalance {
  const depthN = ANALYSIS_CONFIG.DEPTH_LEVELS; // DERIVED config, not magic
  const topBids = bids.slice(0, depthN);
  const topAsks = asks.slice(0, depthN);
  const bidDepth = topBids.reduce((s, [, q]) => s + q, 0); // DERIVED
  const askDepth = topAsks.reduce((s, [, q]) => s + q, 0); // DERIVED
  const liquidity = bidDepth + askDepth;
  const imbalance = liquidity === 0 ? 0 : (bidDepth - askDepth) / liquidity; // DERIVED in [-1,1]

  // LIVE_INDEXER - same as snapshot() and analyze-markets.ts mid derivation
  const bestBid = bids[0]?.[0];
  const bestAsk = asks[0]?.[0];
  const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk ?? null);

  return { bidDepth, askDepth, imbalance, mid };
}
