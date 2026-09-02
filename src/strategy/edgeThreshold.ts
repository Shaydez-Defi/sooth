/**
 * Edge-threshold strategy - IS Stage 3's engine.
 * Action PLACE_ORDER only when recommendation===TRADE; otherwise SKIP with analysis reasons carried unchanged.
 * No inline magic numbers; price/size derived from config/analysis.
 */

import type { MarketAnalysis } from "../analysis/types.js";
import type { Strategy, StrategyContext, StrategyDecision } from "./types.js";

export const EDGE_THRESHOLD_STRATEGY_ID = "edge-threshold" as const;

export const edgeThresholdStrategy: Strategy = {
  id: EDGE_THRESHOLD_STRATEGY_ID,

  decide(analysis: MarketAnalysis, context: StrategyContext): StrategyDecision {
    // SKIP path - carry through analysis reasons unchanged (don't re-derive or restate differently).
    if (analysis.recommendation !== "TRADE" || analysis.direction === "NONE") {
      return {
        action: "SKIP",
        reasons: [...analysis.reasons],
      };
    }

    // TRADE path - direction maps to side, price/size from config (not hardcoded).
    // Price is DERIVED from marketProbability (LIVE_INDEXER mid), not a magic constant.
    // For YES: price = YES mid (marketProbability); for NO: price = NO mid = 1 - YES mid.
    const side: "YES" | "NO" = analysis.direction;
    const price: number = side === "YES" ? analysis.marketProbability : 1 - analysis.marketProbability;
    const size: number = context.config.defaultOrderSize;

    // Guard: price must be in (0,1) probability, size >0 - if not, SKIP with reasons (don't throw).
    if (!(price > 0 && price < 1) || !Number.isFinite(price)) {
      return {
        action: "SKIP",
        reasons: [...analysis.reasons, `strategy: derived price ${String(price)} outside (0,1) - skip`],
      };
    }
    if (!(size > 0) || !Number.isFinite(size)) {
      return {
        action: "SKIP",
        reasons: [...analysis.reasons, `strategy: config defaultOrderSize ${String(size)} invalid - skip`],
      };
    }

    return {
      action: "PLACE_ORDER",
      side,
      price,
      size,
      reasons: [...analysis.reasons],
    };
  },
};
