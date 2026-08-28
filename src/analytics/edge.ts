/**
 * Edge Analytics — brief §10, computed from REAL bot_fills/bot_positions (not fabricated).
 * Metrics: Gross PnL, Net PnL after gas, Win rate, Average edge, Realized edge, Drawdown,
 * Gas cost, Execution quality, Adverse selection.
 * If 0 real fills, return insufficient-data, not fabricated numbers.
 * Tags: LIVE_ONCHAIN for fills/positions, DERIVED for computed, HISTORICAL for edge-at-decision captured at tick.
 */

import type Database from "better-sqlite3";
import { getTotalRealizedPnL, listBotFills, getBotPositions } from "../snapshots/db.js";

export interface EdgeMetrics {
  // DERIVED
  readonly grossPnL: number; // tUSDC, sum realizedPnL from bot_positions
  readonly gasCost: number; // tUSDC, sum gasCost from bot_fills where recorded (LIVE_ONCHAIN gasUsed*gasPrice)
  readonly netPnL: number; // gross - gasCost
  readonly winRate: number | null; // wins/trades, null if no edge-determinable wins
  readonly tradeCount: number;
  readonly winningTrades: number | null;
  readonly losingTrades: number | null;
  readonly averageEdge: number | null; // mean edgeAtDecision for fills where captured (HISTORICAL)
  readonly realizedEdge: number | null; // avg PnL per trade vs avg edge — null if not computable (needs winningOutcome which we don't have until settlement, so report gap)
  readonly maximumDrawdown: number | null; // Stage 4's peak-to-trough logic over cumulative realized PnL series — null when series unavailable, reason in gaps[]
  readonly executionQuality: number | null; // avg (fillPrice - midAtDecision) for fills where both present
  readonly adverseSelection: number | null; // null — not computable from captured data (see gaps[])
  readonly insufficientDataReason: string | null;
  /** Per STOP CONDITIONS: every metric that could not be computed, with the data reason. Never backfilled. */
  readonly gaps: string[];
}

export interface EdgeAnalyticsResult {
  readonly status: "ok" | "insufficient_data";
  readonly dataIntegrity: { fills: "LIVE_ONCHAIN"; positions: "LIVE_ONCHAIN"; edgeAtDecision: "HISTORICAL"; computed: "DERIVED" };
  readonly metrics: EdgeMetrics | null;
  readonly fillsCount: number;
  readonly positionsCount: number;
}

const UNSIGNED_INT_STRING = /^\d+$/;

/** Gas cost in native units from recorded gasUsed*gasPrice strings. Returns null when either field is missing/unparseable (caller records gap). */
function gasCostFromFields(gasUsed: string | null | undefined, gasPrice: string | null | undefined): number | null {
  if (gasUsed === null || gasUsed === undefined || gasPrice === null || gasPrice === undefined) return null;
  if (!UNSIGNED_INT_STRING.test(gasUsed) || !UNSIGNED_INT_STRING.test(gasPrice)) return null;
  const cost = Number(BigInt(gasUsed) * BigInt(gasPrice)) / 1e18;
  return Number.isFinite(cost) ? cost : null;
}

interface FillObservedPnlSeriesPoint {
  readonly eventId: number;
  readonly cumulativeRealizedPnL: number;
}

/**
 * Cumulative realized PnL time series from persisted FILL_OBSERVED bot_events
 * (`data.newRealizedPnL` recorded by the runner at each fill). This is real captured
 * data, not reconstructed. Parse failures are pushed into `gaps`, never silently dropped.
 */
function readRealizedPnlSeries(db: Database.Database, gaps: string[]): FillObservedPnlSeriesPoint[] {
  const rows = db.prepare("SELECT id, data FROM bot_events WHERE eventType='FILL_OBSERVED' ORDER BY id ASC").all() as Array<{ id: number; data: string }>;
  const series: FillObservedPnlSeriesPoint[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch (err) {
      gaps.push(`bot_events id=${row.id} FILL_OBSERVED data unparseable, excluded from PnL series: ${(err as Error).message}`);
      continue;
    }
    const pnl = (parsed as { newRealizedPnL?: unknown } | null)?.newRealizedPnL;
    if (typeof pnl === "number" && Number.isFinite(pnl)) {
      series.push({ eventId: row.id, cumulativeRealizedPnL: pnl });
    }
    // events without newRealizedPnL (e.g. raw-topic decode path) carry no PnL point — expected, not a gap
  }
  return series;
}

/**
 * Stage 4's drawdown logic (src/backtest/engine.ts:184-191) applied to a cumulative PnL series:
 * peak = max(peak, cum); dd = peak - cum; maxDrawdown = max(dd).
 */
function peakToTroughDrawdown(series: number[]): number {
  let peak = 0;
  let maxDrawdown = 0;
  for (const cum of series) {
    peak = Math.max(peak, cum);
    const dd = peak - cum;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  return maxDrawdown;
}

export function computeEdgeAnalytics(db: Database.Database): EdgeAnalyticsResult {
  const fills = listBotFills(db, 1000);
  const positions = getBotPositions(db);
  const grossPnL = getTotalRealizedPnL(db); // LIVE_ONCHAIN derived from fills via positions
  const fillsCount = fills.length;
  const positionsCount = positions.length;

  if (fillsCount === 0) {
    return {
      status: "insufficient_data",
      dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", computed: "DERIVED" },
      metrics: null,
      fillsCount,
      positionsCount,
    };
  }

  const gaps: string[] = [];

  // Gas cost: sum gasCost where recorded (LIVE_ONCHAIN). Fallback computes from gasUsed*gasPrice
  // only when both are well-formed unsigned-int strings — unparseable values are reported in gaps, not ignored.
  let gasCost = 0;
  let gasRecorded = 0;
  for (const f of fills) {
    if (f.gasCost !== null && f.gasCost !== undefined) {
      gasCost += Number(f.gasCost);
      gasRecorded += 1;
      continue;
    }
    const computed = gasCostFromFields(f.gasUsed, f.gasPrice);
    if (computed !== null) {
      gasCost += computed;
      gasRecorded += 1;
    } else if (f.gasUsed !== null || f.gasPrice !== null) {
      gaps.push(`fill tx=${f.txHash} has incomplete/unparseable gas fields (gasUsed=${String(f.gasUsed)}, gasPrice=${String(f.gasPrice)}) — excluded from gas cost`);
    }
  }
  const netPnL = grossPnL - gasCost;

  // Average edge: mean of edgeAtDecision where captured (HISTORICAL)
  const edges = fills.map((f) => f.edgeAtDecision).filter((e): e is number => e !== null && e !== undefined && Number.isFinite(e));
  const averageEdge = edges.length > 0 ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
  if (averageEdge === null) {
    gaps.push("averageEdge: no fill has edgeAtDecision recorded (Stage 6 capture was not active when these fills occurred)");
  }

  // Execution quality: fillPrice vs midAtDecision (for fills where both present)
  const eqSamples: number[] = [];
  for (const f of fills) {
    if (f.fillPrice !== null && f.midAtDecision !== null && Number.isFinite(f.fillPrice) && Number.isFinite(f.midAtDecision)) {
      eqSamples.push(f.fillPrice - f.midAtDecision);
    }
  }
  const executionQuality = eqSamples.length > 0 ? eqSamples.reduce((a, b) => a + b, 0) / eqSamples.length : null;
  if (executionQuality === null) {
    gaps.push("executionQuality: no fill has both fillPrice and midAtDecision recorded");
  }

  // Win rate / realized edge: require per-fill realized P&L outcome. The Stage 6 runner does not
  // compute realized PnL from real fills (updatePositionFromFill keeps the existing realizedPnL —
  // see runner.ts "realizedPnL not computed from fillPrice vs market"), and winningOutcome is
  // unknown until settlement. Per STOP CONDITIONS this is reported as a gap, never backfilled.
  const winRate: number | null = null;
  const winningTrades: number | null = null;
  const losingTrades: number | null = null;
  const realizedEdge: number | null = null;
  gaps.push("winRate/winningTrades/losingTrades: per-fill realized P&L is not computed by the runner for real fills and winningOutcome is unknown pre-settlement — not computable from captured data");
  gaps.push("realizedEdge: needs actual outcome P&L per trade vs edgeAtDecision — same missing data as winRate");

  // Drawdown: Stage 4's peak-to-trough over the cumulative realized PnL series recorded in
  // FILL_OBSERVED events (real captured data). Null + gap when no series points exist.
  const pnlSeries = readRealizedPnlSeries(db, gaps);
  const maximumDrawdown = pnlSeries.length > 0 ? peakToTroughDrawdown(pnlSeries.map((p) => p.cumulativeRealizedPnL)) : null;
  if (maximumDrawdown === null) {
    gaps.push("maximumDrawdown: no FILL_OBSERVED event carries newRealizedPnL — cumulative PnL series unavailable");
  }

  // Adverse selection: mid movement against the position shortly after fill requires the
  // post-fill mid (e.g. t+5m) linked per fill. Only the at-decision mid is stored per fill;
  // the generic snapshots table is not joined per fill. Reported as a gap, not approximated.
  const adverseSelection: number | null = null;
  gaps.push("adverseSelection: post-fill mid (t+5m) per fill is not captured — only midAtDecision is stored; not computable without approximating");

  const metrics: EdgeMetrics = {
    grossPnL,
    gasCost: gasRecorded > 0 ? gasCost : 0,
    netPnL,
    winRate,
    tradeCount: fillsCount,
    winningTrades,
    losingTrades,
    averageEdge,
    realizedEdge,
    maximumDrawdown,
    executionQuality,
    adverseSelection,
    insufficientDataReason: null,
    gaps,
  };

  // If we have fills but critical fields are all null, still return ok with nulls and gap strings (per stop condition: report gap rather than backfill)
  return {
    status: "ok",
    dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", computed: "DERIVED" },
    metrics,
    fillsCount,
    positionsCount,
  };
}
