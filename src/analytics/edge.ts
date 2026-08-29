/**
 * Edge Analytics — brief §10, computed from REAL bot_fills/bot_positions (not fabricated).
 * Metrics: Gross PnL, Net PnL after gas, Win rate, Average edge, Realized edge, Drawdown,
 * Gas cost, Execution quality, Adverse selection.
 * If 0 real fills, return insufficient-data, not fabricated numbers.
 * Tags: LIVE_ONCHAIN for fills/positions/settlement, HISTORICAL for edge-at-decision captured at
 * tick and for the snapshot mid history joined per fill (adverse selection), DERIVED for computed.
 */

import type Database from "better-sqlite3";
import { getTotalRealizedPnL, listBotFills, getBotPositions, closestSnapshotMid } from "../snapshots/db.js";
import { ADVERSE_SELECTION_CONFIG } from "../config.js";

export interface EdgeMetrics {
  // DERIVED
  readonly grossPnL: number; // tUSDC, sum realizedPnL from bot_positions
  readonly gasCost: number; // tUSDC, sum gasCost from bot_fills where recorded (LIVE_ONCHAIN gasUsed*gasPrice)
  readonly netPnL: number; // gross - gasCost
  readonly winRate: number | null; // winningTrades / resolvedTrades, null while no position is realized (CLOSED)
  readonly tradeCount: number; // number of fill records
  readonly winningTrades: number | null; // closed positions with cumulative realizedPnL > 0
  readonly losingTrades: number | null; // closed positions with cumulative realizedPnL < 0
  readonly resolvedTrades: number; // closed positions (SETTLEMENT or EARLY_CLOSE) that resolved win-or-loss
  readonly openPositions: number; // still-unrealized positions (excluded from win rate)
  readonly averageEdge: number | null; // mean edgeAtDecision for fills where captured (HISTORICAL)
  readonly realizedEdge: number | null; // mean realized PnL per closed position (tUSDC, DERIVED from real settlement/early-close data)
  readonly maximumDrawdown: number | null; // Stage 4's peak-to-trough logic over cumulative realized PnL series — null when series unavailable, reason in gaps[]
  readonly executionQuality: number | null; // avg (fillPrice - midAtDecision) for fills where both present
  readonly adverseSelection: number | null; // mean (fillPrice - postFillMid) signed by side over fills with a real nearby snapshot; null when none computable
  readonly insufficientDataReason: string | null;
  /** Per STOP CONDITIONS: every metric that could not be computed for SOME of the data, with the data reason. Never backfilled. */
  readonly gaps: string[];
}

export interface EdgeAnalyticsResult {
  readonly status: "ok" | "insufficient_data";
  readonly dataIntegrity: {
    fills: "LIVE_ONCHAIN";
    positions: "LIVE_ONCHAIN";
    edgeAtDecision: "HISTORICAL";
    snapshots: "HISTORICAL";
    computed: "DERIVED";
  };
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
 * Cumulative realized PnL time series from persisted bot_events.
 * Stage 7's runner recorded FILL_OBSERVED with `data.newRealizedPnL`; Stage 9's settlement poller
 * records SETTLEMENT_REALIZED with `data.cumulativeRealizedPnL`. Both are real captured data.
 * We read both event types and normalize to a single series — parse failures go to `gaps`.
 */
function readRealizedPnlSeries(db: Database.Database, gaps: string[]): FillObservedPnlSeriesPoint[] {
  const rows = db
    .prepare(
      "SELECT id, eventType, data FROM bot_events WHERE eventType IN ('FILL_OBSERVED','SETTLEMENT_REALIZED') ORDER BY id ASC",
    )
    .all() as Array<{ id: number; eventType: string; data: string }>;
  const series: FillObservedPnlSeriesPoint[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch (err) {
      gaps.push(`bot_events id=${row.id} ${row.eventType} data unparseable, excluded from PnL series: ${(err as Error).message}`);
      continue;
    }
    const obj = parsed as Record<string, unknown> | null;
    // Stage 7: FILL_OBSERVED { newRealizedPnL }, Stage 9: SETTLEMENT_REALIZED { cumulativeRealizedPnL } or FILL_OBSERVED { newRealizedPnL }
    const raw = obj?.newRealizedPnL ?? obj?.cumulativeRealizedPnL ?? (obj?.positionUpdate as Record<string, unknown> | undefined)?.newRealizedPnL;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      series.push({ eventId: row.id, cumulativeRealizedPnL: raw });
      continue;
    }
    // Also handle nested positionUpdate.result.cumulative? No, we already handled top-level.
    // Events without a PnL point (e.g. raw-topic FILL_OBSERVED without fill) are expected — not a gap.
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
      dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", snapshots: "HISTORICAL", computed: "DERIVED" },
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

  // Win rate / realized edge (Stage 9): from REAL per-position realized P&L. A resolved "trade" is a
  // position lifecycle built by buy fills and realized exactly once by either SETTLEMENT (market
  // resolved/voided on-chain → Stage 4 payout formula) or EARLY_CLOSE (exited by an opposite-side
  // fill before settlement). Only status CLOSED positions count — never-guessed for open ones.
  const closedPositions = positions.filter((p) => p.status === "CLOSED");
  const openPositions = positions.filter((p) => p.status === "OPEN");
  const winningTrades = closedPositions.filter((p) => p.realizedPnL > 0).length;
  const losingTrades = closedPositions.filter((p) => p.realizedPnL < 0).length;
  const resolvedTrades = winningTrades + losingTrades; // CLOSED with exactly 0 realized P&L is a scratch: neither win nor loss
  const winRate = resolvedTrades > 0 ? winningTrades / resolvedTrades : null;
  const realizedEdge = closedPositions.length > 0 ? closedPositions.reduce((a, p) => a + p.realizedPnL, 0) / closedPositions.length : null;
  if (closedPositions.length === 0) {
    const openDesc =
      openPositions.length === 0
        ? "no positions exist — no fill has been applied to the position model"
        : `${openPositions.length} open position(s) still unrealized (cost basis built, no SETTLEMENT/EARLY_CLOSE realized yet)`;
    gaps.push(`winRate/winningTrades/losingTrades/realizedEdge: ${openDesc} — wins/losses only derivable from realized (CLOSED) positions`);
  } else if (openPositions.length > 0) {
    gaps.push(`winRate/winningTrades/losingTrades/realizedEdge: computed over ${closedPositions.length} closed position(s); ${openPositions.length} open position(s) excluded (still unrealized)`);
  }

  // Drawdown: Stage 4's peak-to-trough over the cumulative realized PnL series recorded in
  // FILL_OBSERVED events (real captured data). Null + gap when no series points exist.
  const pnlSeries = readRealizedPnlSeries(db, gaps);
  const maximumDrawdown = pnlSeries.length > 0 ? peakToTroughDrawdown(pnlSeries.map((p) => p.cumulativeRealizedPnL)) : null;
  if (maximumDrawdown === null) {
    gaps.push("maximumDrawdown: no FILL_OBSERVED event carries newRealizedPnL — cumulative PnL series unavailable");
  }

  // Adverse selection (Stage 9): per real fill, find the closest real snapshot mid to
  // fill_time + LOOKAHEAD for the same marketId from snapshots.db. A snapshot within
  // ±MAX_DEVIATION counts; otherwise that specific fill is reported NOT COMPUTABLE — no
  // interpolation. Sign: positive = mid moved against our side after the fill (bought high/sold low).
  const lookahead = ADVERSE_SELECTION_CONFIG.LOOKAHEAD_SECONDS;
  const maxDev = ADVERSE_SELECTION_CONFIG.MAX_DEVIATION_SECONDS;
  let adverseSamples = 0;
  let adverseSum = 0;
  for (const f of fills) {
    if (f.side === null || f.outcome === null) {
      gaps.push(`adverseSelection fill id=${f.id} (tx=${f.txHash.slice(0, 18)}…): side/outcome not recorded (predates Stage 9 or raw-topic decode) — not computable`);
      continue;
    }
    if (f.fillPrice === null || !Number.isFinite(f.fillPrice) || !(f.capturedAtUnix > 0)) {
      gaps.push(`adverseSelection fill id=${f.id} (tx=${f.txHash.slice(0, 18)}…): no fillPrice/capturedAt recorded — not computable`);
      continue;
    }
    const target = f.capturedAtUnix + lookahead;
    const snap = closestSnapshotMid(db, f.marketId, target, maxDev);
    if (snap === null) {
      gaps.push(
        `adverseSelection fill id=${f.id} (tx=${f.txHash.slice(0, 18)}…, marketId=${f.marketId}): no snapshot within ±${maxDev}s of fill+${lookahead}s (fill time ${new Date(f.capturedAtUnix * 1000).toISOString()}) — NOT COMPUTABLE, no interpolation`,
      );
      continue;
    }
    const sign = f.side === "buy" ? 1 : -1;
    adverseSum += (f.fillPrice - snap.mid) * sign;
    adverseSamples += 1;
  }
  const adverseSelection = adverseSamples > 0 ? adverseSum / adverseSamples : null;
  if (adverseSelection === null) {
    gaps.push(`adverseSelection: no fill has a computable post-fill mid (needs a real snapshot within ±${maxDev}s of fill+${lookahead}s) — see per-fill reasons above`);
  }

  const metrics: EdgeMetrics = {
    grossPnL,
    gasCost: gasRecorded > 0 ? gasCost : 0,
    netPnL,
    winRate,
    tradeCount: fillsCount,
    winningTrades,
    losingTrades,
    resolvedTrades,
    openPositions: openPositions.length,
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
    dataIntegrity: { fills: "LIVE_ONCHAIN", positions: "LIVE_ONCHAIN", edgeAtDecision: "HISTORICAL", snapshots: "HISTORICAL", computed: "DERIVED" },
    metrics,
    fillsCount,
    positionsCount,
  };
}
