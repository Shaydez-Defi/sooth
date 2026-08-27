/**
 * Market Intelligence Engine — deterministic, explainable, DreamDEX-only.
 * Only signal source is order-book imbalance on YES book (bid vs ask depth).
 * No external data, no historical, no fallback to other venues.
 */

import { ANALYSIS_CONFIG } from "../config.js";
import type { MarketAnalysis } from "./types.js";

export interface EngineInput {
  // LIVE_ONCHAIN
  readonly marketId: string; // LIVE_ONCHAIN
  readonly symbol: string; // LIVE_INDEXER
  // LIVE_INDEXER — YES book levels as [price (prob), quantity (shares)]
  readonly bids: ReadonlyArray<readonly [number, number]>; // LIVE_INDEXER
  readonly asks: ReadonlyArray<readonly [number, number]>; // LIVE_INDEXER
  // LIVE_INDEXER — derived from book but considered market price
  readonly bestBid: number | undefined; // LIVE_INDEXER
  readonly bestAsk: number | undefined; // LIVE_INDEXER
  readonly marketProbability: number | undefined; // LIVE_INDEXER — YES mid
  // LIVE_ONCHAIN
  readonly timeRemaining: number | undefined; // LIVE_ONCHAIN seconds
}

/**
 * Core transform: order-book imbalance → estimatedProbability.
 *
 * imbalance = (bidDepth - askDepth) / (bidDepth + askDepth)  in [-1, 1]
 *   where bidDepth = sum of top N bid quantities, askDepth = sum of top N ask quantities (N = DEPTH_LEVELS)
 *
 * estimatedProbability = clamp(marketProbability + k * imbalance, 0.01, 0.99)
 *   where k = K_IMBALANCE_NUDGE (small tilt, e.g. 0.06), marketProbability is YES mid
 *
 * This is a tilt, not an independent prediction — at most k away from market.
 */
export function computeEstimatedProbability(marketProbability: number, imbalance: number, k: number): number {
  const raw = marketProbability + k * imbalance;
  return Math.min(0.99, Math.max(0.01, raw));
}

function clamp01(n: number): number {
  return Math.min(0.99, Math.max(0.01, n));
}

export function analyzeMarket(input: EngineInput): MarketAnalysis {
  // Fail-safe wrapper — never throw, never fabricate, return NO_TRADE with reasons
  try {
    return analyzeMarketInner(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      marketId: input.marketId ?? "unknown",
      symbol: input.symbol ?? "unknown",
      direction: "NONE",
      marketProbability: input.marketProbability ?? 0,
      estimatedProbability: input.marketProbability !== undefined ? clamp01(input.marketProbability) : 0.5,
      edge: 0,
      liquidity: 0,
      spread: 0,
      spreadBps: 0,
      timeRemaining: input.timeRemaining ?? 0,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: [`order-book imbalance: engine failed safe — ${msg}`],
      imbalance: 0,
    };
  }
}

function analyzeMarketInner(input: EngineInput): MarketAnalysis {
  const { marketId, symbol, bids, asks, bestBid, bestAsk, marketProbability, timeRemaining } = input;

  // Validate required fields — missing → NO_TRADE fail-safe
  if (!marketId || !symbol) {
    return {
      marketId: marketId ?? "unknown",
      symbol: symbol ?? "unknown",
      direction: "NONE",
      marketProbability: marketProbability ?? 0,
      estimatedProbability: marketProbability !== undefined ? clamp01(marketProbability) : 0.5,
      edge: 0,
      liquidity: 0,
      spread: 0,
      spreadBps: 0,
      timeRemaining: timeRemaining ?? 0,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: ["order-book imbalance: missing marketId/symbol — no book depth to assess"],
      imbalance: 0,
    };
  }

  // Empty book on either side → NO_TRADE (brief stop condition)
  const depthN = ANALYSIS_CONFIG.DEPTH_LEVELS; // DERIVED config, not magic
  const topBids = bids.slice(0, depthN);
  const topAsks = asks.slice(0, depthN);
  const bidDepth = topBids.reduce((s, [, q]) => s + q, 0); // DERIVED
  const askDepth = topAsks.reduce((s, [, q]) => s + q, 0); // DERIVED
  const liquidity = bidDepth + askDepth; // DERIVED

  if (topBids.length === 0 || topAsks.length === 0 || liquidity === 0) {
    const timeRem = timeRemaining ?? 0;
    return {
      marketId,
      symbol,
      direction: "NONE",
      marketProbability: marketProbability ?? 0,
      estimatedProbability: marketProbability !== undefined ? clamp01(marketProbability) : 0.5,
      edge: 0,
      liquidity,
      spread: bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : 0,
      spreadBps: 0,
      timeRemaining: timeRem,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: ["order-book imbalance: no book depth to assess (empty bid or ask side)"],
      imbalance: 0,
    };
  }

  // At this point marketProbability must be defined (mid); if not, derive from best bid/ask or fail
  if (marketProbability === undefined || !Number.isFinite(marketProbability)) {
    return {
      marketId,
      symbol,
      direction: "NONE",
      marketProbability: 0,
      estimatedProbability: 0.5,
      edge: 0,
      liquidity,
      spread: bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : 0,
      spreadBps: 0,
      timeRemaining: timeRemaining ?? 0,
      signalStrength: 0,
      recommendation: "NO_TRADE",
      reasons: ["order-book imbalance: no book depth to assess (missing marketProbability)"],
      imbalance: 0,
    };
  }

  // Compute imbalance in [-1,1]
  const imbalance = (bidDepth - askDepth) / (bidDepth + askDepth); // DERIVED
  const k = ANALYSIS_CONFIG.K_IMBALANCE_NUDGE; // DERIVED config
  const estimatedProbability = computeEstimatedProbability(marketProbability, imbalance, k); // DERIVED
  const edge = estimatedProbability - marketProbability; // DERIVED
  const signalStrength = Math.abs(imbalance); // DERIVED 0-1

  // Spread
  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : Infinity; // DERIVED
  const midForBps = marketProbability;
  const spreadBps = midForBps > 0 && Number.isFinite(spread) ? (spread / midForBps) * 10000 : Infinity; // DERIVED

  // Time remaining — if missing, treat as 0 → will trigger NO_TRADE
  const timeRem = timeRemaining !== undefined && Number.isFinite(timeRemaining) ? timeRemaining : 0;

  // Direction from edge
  let direction: "YES" | "NO" | "NONE" = "NONE";
  if (Math.abs(edge) >= ANALYSIS_CONFIG.MIN_EDGE) {
    direction = edge > 0 ? "YES" : "NO";
  }

  // Gating checks — all thresholds from config, no inline magic numbers
  const reasons: string[] = [];
  // Primary derivation reason — must always be present and name source
  const imbalanceSign = imbalance > 0 ? "bid-heavy" : imbalance < 0 ? "ask-heavy" : "balanced";
  const tilt = k * imbalance;
  reasons.push(
    `order-book imbalance ${imbalance.toFixed(3)} (${imbalanceSign}) → tilt ${tilt >= 0 ? "+" : ""}${tilt.toFixed(4)} (k=${k.toFixed(3)}) → estimated ${estimatedProbability.toFixed(4)} vs market ${marketProbability.toFixed(4)}`,
  );

  // Check each gate, collect failing reasons with real numbers
  const fails: string[] = [];
  if (liquidity < ANALYSIS_CONFIG.MIN_LIQUIDITY) {
    fails.push(`liquidity ${liquidity.toFixed(2)} < min ${ANALYSIS_CONFIG.MIN_LIQUIDITY}`);
  }
  if (spread > ANALYSIS_CONFIG.MAX_SPREAD || spreadBps > ANALYSIS_CONFIG.MAX_SPREAD_BPS) {
    fails.push(`spread ${Number.isFinite(spread) ? spread.toFixed(4) : "∞"} (${Number.isFinite(spreadBps) ? spreadBps.toFixed(1) : "∞"} bps) > max ${ANALYSIS_CONFIG.MAX_SPREAD.toFixed(4)} (${ANALYSIS_CONFIG.MAX_SPREAD_BPS} bps)`);
  }
  if (timeRem < ANALYSIS_CONFIG.MIN_TIME_REMAINING) {
    fails.push(`timeRemaining ${timeRem.toFixed(0)}s < buffer ${ANALYSIS_CONFIG.MIN_TIME_REMAINING}s`);
  }
  if (Math.abs(edge) < ANALYSIS_CONFIG.MIN_EDGE) {
    fails.push(`edge ${edge >= 0 ? "+" : ""}${edge.toFixed(4)} (|${Math.abs(edge).toFixed(4)}|) < minEdge ${ANALYSIS_CONFIG.MIN_EDGE.toFixed(4)}`);
  }

  let recommendation: "TRADE" | "NO_TRADE" = "NO_TRADE";
  if (fails.length === 0) {
    recommendation = "TRADE";
    reasons.push(`TRADE: edge ${edge >= 0 ? "+" : ""}${edge.toFixed(4)} ≥ minEdge, liquidity and spread within bounds`);
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
    imbalance,
  };
}
