/**
 * Step 2 - context engine: combine real variables into a fair value (0-1 probability).
 * Deterministic and explainable. fairValue = clamp01(marketProbability + Σ deltas):
 *   imbalance   : K_IMBALANCE_NUDGE * imbalance (Stage 3 tilt, unchanged semantics)
 *   momentum    : clamp(momentumRoC * MOMENTUM_GAIN, ±MOMENTUM_CAP)
 *   dislocation : clamp(gap * DISLOCATION_GAIN, ±DISLOCATION_CAP)
 * Strike distance is reported as context, not weighted: question semantics
 * (above/below) are not machine-readable, so weighting it would invent direction.
 * Volatility is reported, not weighted: it is non-directional by nature.
 * Every contribution carries its own numbers for reasons[] (Step 4).
 */
import { ANALYSIS_CONFIG, DECISION_CONFIG } from "../config.js";
import type { MarketVariables } from "./variables.js";

export interface Contribution {
  readonly name: string;
  readonly signal: number | null; // raw input signal (null = unavailable)
  readonly weight: number; // applied gain
  readonly delta: number; // signed probability-point contribution
  readonly detail: string; // numbers, traceable
}

export interface FairValueResult {
  readonly fairValue: number | null;
  readonly contributions: Contribution[];
  readonly notes: string[];
}

function clamp01(n: number): number {
  return Math.min(0.99, Math.max(0.01, n));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(4)}`;
}

export function computeFairValue(v: MarketVariables): FairValueResult {
  const notes: string[] = [];
  const contributions: Contribution[] = [];
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
      detail: `order-flow imbalance ${v.imbalance.toFixed(3)} × k=${k.toFixed(3)} → ${signed(delta)}`,
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
      detail: `momentum ${(v.momentum * 100).toFixed(2)}% over ${v.momentumWindowSec.toFixed(0)}s × gain=${DECISION_CONFIG.MOMENTUM_GAIN} (cap ±${DECISION_CONFIG.MOMENTUM_CAP}) → ${signed(delta)}`,
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
      detail: `repricing gap ${v.dislocationGap >= 0 ? "+" : ""}${(v.dislocationGap * 100).toFixed(2)}% over ${v.dislocationWindowSec.toFixed(0)}s × gain=${DECISION_CONFIG.DISLOCATION_GAIN} (cap ±${DECISION_CONFIG.DISLOCATION_CAP}) → ${signed(delta)}`,
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

  const fairValue = clamp01(base + contributions.reduce((s, c) => s + c.delta, 0));
  return { fairValue, contributions, notes };
}
