/**
 * Steps 4-6 - fair value → edges → opportunity score → three-state decision.
 *
 * rawEdge        = fairValue - marketPrice
 * executableEdge = rawEdge - sign(rawEdge) × (spreadPenalty + slipPenalty)
 *   spreadPenalty = spread × SPREAD_PENALTY_FACTOR (half the spread paid on entry)
 *   slipPenalty   = (ORDER_SIZE_SHARES / liquidity) × SLIPPAGE_FACTOR
 * Both penalties are computed from real book numbers with config constants.
 *
 * TRADE: |executableEdge| ≥ MIN_EDGE and every hard gate passes (liquidity,
 *   spread, time, settlement).
 * WATCH: genuine middle - |rawEdge| ≥ WATCH_MIN_EDGE but executable edge does
 *   not clear the TRADE bar, with no hard failure. Real edge, not executable.
 * NO_TRADE: anything else, with the specific blocker cited.
 *
 * opportunityScore (0-100) = 100 × Σ wᵢcᵢ / Σwᵢ over:
 *   edge (|executableEdge| / SCORE_EDGE_NORMALIZER), agreement (share of
 *   directional contributors matching edge sign), liquidity (liquidity /
 *   SCORE_LIQUIDITY_REF), execution (1 - spreadBps / MAX_SPREAD_BPS),
 *   risk (timeRemaining / RISK_TIME_REF_SEC), settlement (gate 1/0).
 * Each component clamped to [0,1]. Weights from DECISION_CONFIG.
 */
import { ANALYSIS_CONFIG, DECISION_CONFIG } from "../config.js";
import type { MarketVariables } from "./variables.js";
import type { FairValueResult } from "./contextEngine.js";
import { SETTLEMENT_BLOCKED, type SettlementGateResult } from "./settlementGate.js";

export interface DecisionSignal {
  readonly name: "order-flow" | "momentum" | "dislocation" | "liquidity" | "spread" | "time" | "volatility" | "settlement" | "risk";
  readonly level: "STRONG" | "GOOD" | "WEAK" | "POOR" | "DETECTED" | "NONE" | "PASSED" | "FAILED" | "PENDING" | "CONTEXT";
  readonly detail: string;
}

export interface DecisionOutput {
  readonly decision: "TRADE" | "WATCH" | "NO_TRADE";
  readonly marketPrice: number;
  readonly fairValue: number;
  readonly rawEdge: number;
  readonly executableEdge: number;
  readonly opportunityScore: number;
  readonly reasons: string[];
  readonly signals: DecisionSignal[];
}

export interface PenaltyBreakdown {
  readonly spreadPenalty: number;
  readonly slipPenalty: number;
}

export function computePenalties(spread: number, liquidity: number): PenaltyBreakdown {
  const spreadPenalty = spread * DECISION_CONFIG.SPREAD_PENALTY_FACTOR;
  const slipPenalty = (DECISION_CONFIG.ORDER_SIZE_SHARES / Math.max(liquidity, 1e-9)) * DECISION_CONFIG.SLIPPAGE_FACTOR;
  return { spreadPenalty, slipPenalty };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export interface ScoreComponents {
  readonly edge: number;
  readonly agreement: number;
  readonly liquidity: number;
  readonly execution: number;
  readonly risk: number;
  readonly settlement: number;
}

export function scoreOpportunity(components: ScoreComponents, weights: Record<string, number>): number {
  const keys = ["edge", "agreement", "liquidity", "execution", "risk", "settlement"] as const;
  let weighted = 0;
  let total = 0;
  for (const k of keys) {
    const w = weights[k] ?? 0;
    if (w < 0 || !Number.isFinite(w)) continue;
    weighted += w * clamp01(components[k]);
    total += w;
  }
  if (total <= 0) return 0;
  return Math.round((100 * weighted) / total);
}

export function directionOf(edge: number): "UP" | "DOWN" | "FLAT" {
  if (edge > 0) return "UP";
  if (edge < 0) return "DOWN";
  return "FLAT";
}

/** Per-signal levels for UI why-lists - derived from the same numbers as the decision. */
export function buildSignals(v: MarketVariables, fair: FairValueResult, gate: SettlementGateResult): DecisionSignal[] {
  const byName = new Map(fair.contributions.map((c) => [c.name, c.delta]));
  const flowDelta = byName.get("order-flow");
  const momDelta = byName.get("momentum");
  const disDelta = byName.get("dislocation");
  const strong = (d: number | undefined): boolean => d !== undefined && Math.abs(d) >= DECISION_CONFIG.WATCH_MIN_EDGE;
  return [
    {
      name: "order-flow",
      level: flowDelta === undefined ? "NONE" : strong(flowDelta) ? "STRONG" : "WEAK",
      detail:
        flowDelta === undefined
          ? "no book depth"
          : `imbalance tilt ${flowDelta >= 0 ? "+" : ""}${flowDelta.toFixed(4)} ${flowDelta >= 0 ? "supports UP" : "supports DOWN"}`,
    },
    {
      name: "momentum",
      level: momDelta === undefined ? "NONE" : strong(momDelta) ? "STRONG" : "WEAK",
      detail:
        momDelta === undefined
          ? "insufficient snapshot history"
          : v.momentum !== null
            ? `mid ${(v.momentum * 100).toFixed(2)}% over ${(v.momentumWindowSec ?? 0).toFixed(0)}s`
            : "no movement read",
    },
    {
      name: "dislocation",
      level: disDelta === undefined ? "NONE" : Math.abs(disDelta) >= DECISION_CONFIG.WATCH_MIN_EDGE ? "DETECTED" : "NONE",
      detail:
        disDelta === undefined || v.dislocationGap === null
          ? "no reference window"
          : `repricing gap ${v.dislocationGap >= 0 ? "+" : ""}${(v.dislocationGap * 100).toFixed(2)}%`,
    },
    {
      name: "liquidity",
      level: v.liquidity !== null && v.liquidity >= ANALYSIS_CONFIG.MIN_LIQUIDITY ? "GOOD" : "POOR",
      detail: v.liquidity !== null ? `${v.liquidity.toFixed(0)} shares vs min ${ANALYSIS_CONFIG.MIN_LIQUIDITY}` : "unknown",
    },
    {
      name: "spread",
      level:
        v.spread !== null && v.spread <= ANALYSIS_CONFIG.MAX_SPREAD && (v.spreadBps ?? Infinity) <= ANALYSIS_CONFIG.MAX_SPREAD_BPS
          ? "GOOD"
          : "POOR",
      detail: v.spread !== null ? `${v.spread.toFixed(4)} (${Number.isFinite(v.spreadBps ?? NaN) ? (v.spreadBps as number).toFixed(0) : "∞"} bps)` : "unknown",
    },
    {
      name: "time",
      level: (v.timeRemaining ?? 0) >= ANALYSIS_CONFIG.MIN_TIME_REMAINING * 2 ? "GOOD" : (v.timeRemaining ?? 0) >= ANALYSIS_CONFIG.MIN_TIME_REMAINING ? "WEAK" : "POOR",
      detail: v.timeRemaining !== null ? `${v.timeRemaining.toFixed(0)}s to expiry` : "unknown",
    },
    {
      name: "volatility",
      level: "CONTEXT",
      detail: v.volatility !== null ? `stddev ${v.volatility.toFixed(4)} over ${v.volatilitySamples} snapshots` : "insufficient history",
    },
    {
      name: "settlement",
      level: gate.pass ? "PASSED" : "FAILED",
      detail: gate.pass ? "event, expiry, and on-chain state verified" : gate.checks.filter((c) => !c.pass).map((c) => c.name).join(", "),
    },
    {
      name: "risk",
      level: "PENDING",
      detail: "runs at order placement",
    },
  ];
}

/** Directional contributors and their signs - agreement denominator/numerator. */
export function agreementStats(
  rawEdge: number,
  v: Pick<MarketVariables, "imbalance" | "momentum" | "dislocationGap">,
): { agree: number; total: number } {
  const signs: number[] = [];
  if (v.imbalance !== null && v.imbalance !== 0) signs.push(Math.sign(v.imbalance));
  if (v.momentum !== null && v.momentum !== 0) signs.push(Math.sign(v.momentum));
  if (v.dislocationGap !== null && v.dislocationGap !== 0) signs.push(Math.sign(v.dislocationGap));
  if (signs.length === 0 || rawEdge === 0) return { agree: 0, total: signs.length };
  const edgeSign = Math.sign(rawEdge);
  return { agree: signs.filter((s) => s === edgeSign).length, total: signs.length };
}

function fmtSigned(n: number, digits = 4): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
}

export function decideMarket(input: {
  variables: MarketVariables;
  fair: FairValueResult;
  gate: SettlementGateResult;
}): DecisionOutput {
  const { variables: v, fair, gate } = input;
  const fail = (
    marketPrice: number,
    fairValue: number,
    rawEdge: number,
    executableEdge: number,
    reasons: string[],
  ): DecisionOutput => ({
    decision: "NO_TRADE",
    marketPrice,
    fairValue,
    rawEdge,
    executableEdge,
    opportunityScore: 0,
    reasons,
    signals: [],
  });

  if (v.marketProbability === null || !Number.isFinite(v.marketProbability)) {
    return fail(0, 0, 0, 0, ["NO_TRADE: market price unknown - fair value not computable"]);
  }
  const marketPrice = v.marketProbability;
  if (fair.fairValue === null || !Number.isFinite(fair.fairValue)) {
    return fail(marketPrice, marketPrice, 0, 0, [
      "NO_TRADE: fair value not computable",
      ...v.notes.map((n) => `context: ${n}`),
      ...fair.notes.map((n) => `context: ${n}`),
    ]);
  }
  const fairValue = fair.fairValue;
  const rawEdge = fairValue - marketPrice;
  const dir = directionOf(rawEdge);

  if (!gate.pass) {
    const failed = gate.checks.filter((c) => !c.pass);
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `${SETTLEMENT_BLOCKED}: ${failed.map((c) => `${c.name} - ${c.detail}`).join("; ")}`,
    ]);
  }

  if (v.liquidity === null || v.liquidity < ANALYSIS_CONFIG.MIN_LIQUIDITY) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `NO_TRADE: liquidity ${v.liquidity === null ? "unknown" : v.liquidity.toFixed(2)} < min ${ANALYSIS_CONFIG.MIN_LIQUIDITY}`,
    ]);
  }
  if (v.spread === null) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, ["NO_TRADE: spread unknown - best bid/ask missing"]);
  }
  const spread = v.spread;
  const spreadBps = v.spreadBps ?? Infinity;
  if (spread > ANALYSIS_CONFIG.MAX_SPREAD || spreadBps > ANALYSIS_CONFIG.MAX_SPREAD_BPS) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `NO_TRADE: spread ${spread.toFixed(4)} (${Number.isFinite(spreadBps) ? spreadBps.toFixed(1) : "∞"} bps) > max ${ANALYSIS_CONFIG.MAX_SPREAD.toFixed(4)} (${ANALYSIS_CONFIG.MAX_SPREAD_BPS} bps)`,
    ]);
  }
  const timeRem = v.timeRemaining ?? 0;
  if (timeRem < ANALYSIS_CONFIG.MIN_TIME_REMAINING) {
    return fail(marketPrice, fairValue, rawEdge, rawEdge, [
      `NO_TRADE: timeRemaining ${timeRem.toFixed(0)}s < buffer ${ANALYSIS_CONFIG.MIN_TIME_REMAINING}s`,
    ]);
  }

  const { spreadPenalty, slipPenalty } = computePenalties(spread, v.liquidity);
  const executableEdge = rawEdge - Math.sign(rawEdge) * (spreadPenalty + slipPenalty);

  const { agree, total } = agreementStats(rawEdge, v);
  const components: ScoreComponents = {
    edge: Math.abs(executableEdge) / DECISION_CONFIG.SCORE_EDGE_NORMALIZER,
    agreement: total > 0 ? agree / total : 0,
    liquidity: v.liquidity / DECISION_CONFIG.SCORE_LIQUIDITY_REF,
    execution: 1 - spreadBps / ANALYSIS_CONFIG.MAX_SPREAD_BPS,
    risk: timeRem / DECISION_CONFIG.RISK_TIME_REF_SEC,
    settlement: 1,
  };
  const opportunityScore = scoreOpportunity(components, { ...DECISION_CONFIG.OPPORTUNITY_WEIGHTS });

  const contributionLines = fair.contributions.map(
    (c) => `${c.name}: ${c.detail} (supports ${directionOf(c.delta)})`,
  );
  const scoreLine =
    `opportunity ${opportunityScore}/100 from edge|agree|liq|exec|risk|settle = ` +
    `${components.edge.toFixed(2)}|${components.agreement.toFixed(2)}|${components.liquidity.toFixed(2)}|` +
    `${components.execution.toFixed(2)}|${components.risk.toFixed(2)}|${components.settlement.toFixed(2)}` +
    ` (agree ${agree}/${total})`;

  if (Math.abs(executableEdge) >= ANALYSIS_CONFIG.MIN_EDGE) {
    return {
      decision: "TRADE",
      marketPrice,
      fairValue,
      rawEdge,
      executableEdge,
      opportunityScore,
      signals: buildSignals(v, fair, gate),
      reasons: [
        `TRADE ${dir}: executable edge ${fmtSigned(executableEdge)} ≥ minEdge ${ANALYSIS_CONFIG.MIN_EDGE.toFixed(4)} (raw ${fmtSigned(rawEdge)} minus spread cost ${spreadPenalty.toFixed(4)} and slippage cost ${slipPenalty.toFixed(4)})`,
        ...contributionLines,
        scoreLine,
      ],
    };
  }

  if (Math.abs(rawEdge) >= DECISION_CONFIG.WATCH_MIN_EDGE) {
    return {
      decision: "WATCH",
      marketPrice,
      fairValue,
      rawEdge,
      executableEdge,
      opportunityScore,
      signals: buildSignals(v, fair, gate),
      reasons: [
        `WATCH ${dir}: raw edge ${fmtSigned(rawEdge)} exists but executable ${fmtSigned(executableEdge)} below minEdge ${ANALYSIS_CONFIG.MIN_EDGE.toFixed(4)} (costs ${spreadPenalty.toFixed(4)} + ${slipPenalty.toFixed(4)})`,
        ...contributionLines,
        scoreLine,
      ],
    };
  }

  return {
    decision: "NO_TRADE",
    marketPrice,
    fairValue,
    rawEdge,
    executableEdge,
    opportunityScore,
    signals: buildSignals(v, fair, gate),
    reasons: [
      `NO_TRADE: edge ${fmtSigned(rawEdge)} (|${Math.abs(rawEdge).toFixed(4)}|) < watch bar ${DECISION_CONFIG.WATCH_MIN_EDGE.toFixed(4)}`,
      ...contributionLines,
      scoreLine,
    ],
  };
}
