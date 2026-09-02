/**
 * Market Intelligence output contract - deterministic, explainable, DreamDEX-only.
 * Read-only/compute-only, no funds at risk.
 * Never use the term "implied probability" for estimatedProbability - that term is reserved for the market's own price.
 */

export interface MarketAnalysis {
  // LIVE_INDEXER/LIVE_ONCHAIN - market identity
  readonly marketId: string; // LIVE_ONCHAIN (bytes32 marketId)
  readonly symbol: string; // LIVE_INDEXER (UnifiedMarket symbol)
  // DERIVED - direction from edge sign
  readonly direction: "YES" | "NO" | "NONE";
  // LIVE_INDEXER - current YES mid price from YES book (not estimated)
  readonly marketProbability: number; // LIVE_INDEXER/LIVE_ONCHAIN - YES mid in [0,1]
  // DERIVED - OUR model's output, tilted from marketProbability, never called "implied probability"
  readonly estimatedProbability: number; // DERIVED - clamp(marketProbability + k*imbalance, 0.01,0.99)
  // DERIVED - signed edge
  readonly edge: number; // DERIVED - estimatedProbability - marketProbability
  // DERIVED - from order book depth
  readonly liquidity: number; // DERIVED - sum of bid+ask quantities in depth window
  // DERIVED - probability points and bps
  readonly spread: number; // DERIVED - ask - bid in probability points
  readonly spreadBps: number; // DERIVED - spread/mid*10000
  // LIVE_ONCHAIN
  readonly timeRemaining: number; // LIVE_ONCHAIN - seconds until expiry
  // DERIVED - magnitude of imbalance
  readonly signalStrength: number; // DERIVED - abs(imbalance) in [0,1]
  // DERIVED - recommendation gated on thresholds
  readonly recommendation: "TRADE" | "NO_TRADE";
  // DERIVED - must cite actual numbers and name "order-book imbalance" as signal source
  readonly reasons: string[]; // DERIVED - explain every gating check + imbalance→edge derivation
  // DERIVED - raw imbalance for explainability (not in brief interface but useful for reasons)
  readonly imbalance: number; // DERIVED - (bidDepth-askDepth)/(bidDepth+askDepth) in [-1,1]
}
