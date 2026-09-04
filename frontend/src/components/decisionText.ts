import type { DecisionOutput } from "../lib/api";

function cents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

/** Plain-language summary of a decision - no math, no thresholds, no jargon. */
export function plainSummary(d: DecisionOutput): string[] {
  const first = d.reasons[0] ?? "";
  const r = first.toLowerCase();
  if (d.decision === "TRADE") {
    return [
      `Sooth values this at ${cents(d.fairValue)} against ${cents(d.marketPrice)} - a gap worth taking.`,
      `Costs leave ${cents(d.executableEdge)} executable after spread and slippage.`,
    ];
  }
  if (d.decision === "WATCH") {
    return [
      `Real edge of ${cents(d.rawEdge)}, but costs leave ${cents(d.executableEdge)} - below the trade bar.`,
      "Worth watching, not worth paying for yet.",
    ];
  }
  if (r.includes("liquidity")) return ["There isn't enough depth to trade this size safely."];
  if (r.includes("spread")) return ["The spread is too wide to enter safely."];
  if (r.includes("timeremaining") || r.includes("expir")) return ["Too close to expiry to enter."];
  if (r.includes("blocked") || r.includes("settlement")) return ["Settlement can't be verified for this market."];
  if (r.includes("fair value") || r.includes("market price unknown")) return ["Sooth couldn't price this market."];
  return ["The gap between Sooth's estimate and the market is too small to trade."];
}

