/**
 * Position / cost-basis engine — Stage 9 (brief §13 gap-close).
 *
 * Tracks a quantity-weighted average entry price per marketId+outcome from bot_fills, and realizes
 * P&L through exactly two documented paths:
 *   - SETTLEMENT: the market resolved/voided on-chain → Stage 4's EXACT payout formula
 *     (YES win = (1-avgEntryPrice)*size, NO win = -avgEntryPrice*size, voided = (0.5-avgEntryPrice)*size).
 *     Only the settlement poller (settlementPoller.ts) invokes this, after an on-chain
 *     isResolved/isVoided confirmation. No outcome is ever guessed pre-settlement.
 *   - EARLY_CLOSE: the position was partially/fully exited by an opposite-side fill before
 *     settlement; that fill's price IS the realization → P&L = (exitPrice - avgEntryPrice) * exitedSize.
 *
 * This module does NOT compute realized P&L at fill time for buys — buys only build the cost basis
 * that Step 2 (settlement / early-close) needs.
 *
 * No silent catches: every invalid fill returns { kind: "error", reason }. Positions are modelled as
 * ONE outcome per marketId row (`side`); buying the opposite outcome realizes the held leg at the
 * crossing-implied price (buying NO at P implies the YES bid ≈ 1 - P) and opens the new outcome.
 *
 * Tags: LIVE_ONCHAIN (fills), DERIVED (weighted cost basis / realized P&L).
 */

import type Database from "better-sqlite3";
import { getBotPosition, patchBotPosition, upsertBotPosition, type FillSide, type PositionSide } from "../snapshots/db.js";

export interface ApplyFillInput {
  readonly marketId: string;
  readonly symbol: string;
  readonly side: FillSide;
  readonly outcome: PositionSide;
  readonly quantityFilled: number;
  readonly fillPrice: number;
  /** bot_fills row id — when provided, closing fills tag their own realizedPnl on the row. */
  readonly fillId?: number | null;
}

export type ApplyFillResult =
  | { readonly kind: "opened"; readonly avgEntryPrice: number; readonly totalSize: number; readonly realizedPnLDelta: number }
  | { readonly kind: "added"; readonly avgEntryPrice: number; readonly totalSize: number; readonly realizedPnLDelta: number }
  | {
      readonly kind: "partially_closed" | "closed_early";
      readonly avgEntryPrice: number;
      readonly totalSize: number;
      readonly realizedPnLDelta: number;
      readonly realizationSource: "EARLY_CLOSE";
    }
  | { readonly kind: "error"; readonly reason: string };

/** Quantity-weighted average entry price across multiple fills into the same position. */
export function weightedEntryPrice(currentAvg: number | null | undefined, currentSize: number, price: number, qty: number): number {
  if (currentAvg === null || currentAvg === undefined || !(currentSize > 0)) return price;
  return (currentAvg * currentSize + price * qty) / (currentSize + qty);
}

/**
 * Whether the held outcome wins given the on-chain winningOutcome. null when unresolved/ambiguous —
 * callers must NOT guess an outcome from null.
 */
export function settlementWon(side: PositionSide, winningOutcome: number | null | undefined): boolean | null {
  if (winningOutcome === null || winningOutcome === undefined) return null;
  if (winningOutcome !== 0 && winningOutcome !== 1) return null;
  return (side === "YES" && winningOutcome === 0) || (side === "NO" && winningOutcome === 1);
}

/**
 * Stage 4's exact payout formula applied to an open position's remaining shares.
 * Returns null when the outcome is unresolved/ambiguous or the basis is invalid — no guessing.
 */
export function computeSettlementPnL(args: {
  readonly side: PositionSide;
  readonly avgEntryPrice: number;
  readonly size: number;
  readonly winningOutcome: number | null | undefined;
  readonly voided: boolean;
}): number | null {
  const { side, avgEntryPrice, size, winningOutcome, voided } = args;
  if (!Number.isFinite(size) || !(size > 0)) return null;
  if (!Number.isFinite(avgEntryPrice) || !(avgEntryPrice > 0 && avgEntryPrice < 1)) return null;
  if (voided) return (0.5 - avgEntryPrice) * size;
  const won = settlementWon(side, winningOutcome);
  if (won === null) return null;
  return won ? (1 - avgEntryPrice) * size : -avgEntryPrice * size;
}

/** Tag a closing fill with the P&L it realized (null while the fill is just building cost basis). */
function tagFillRealizedPnl(db: Database.Database, fillId: number | null | undefined, realizedPnL: number): void {
  if (fillId === null || fillId === undefined) return;
  db.prepare("UPDATE bot_fills SET realizedPnL=? WHERE id=?").run(realizedPnL, fillId);
}

/**
 * Apply one real fill to the position: build weighted-average cost basis on buys, realize P&L on
 * sells (EARLY_CLOSE) and on the crossing-implied exit when buying the opposite outcome.
 * Returns an explicit result; errors are never silent.
 */
export function applyFillToPosition(db: Database.Database, input: ApplyFillInput): ApplyFillResult {
  const { marketId, symbol, side, outcome, quantityFilled, fillPrice, fillId } = input;
  if (!Number.isFinite(quantityFilled) || quantityFilled <= 0) {
    return { kind: "error", reason: `fill qty ${String(quantityFilled)} is not a positive number — cannot build cost basis` };
  }
  if (!Number.isFinite(fillPrice) || !(fillPrice > 0 && fillPrice < 1)) {
    return { kind: "error", reason: `fill price ${String(fillPrice)} outside (0,1) probability — cannot build cost basis` };
  }

  const existing = getBotPosition(db, marketId);
  const priorRealized = existing?.realizedPnL ?? 0;
  const priorSize = existing?.totalSize ?? 0;

  // ── SELL = exit (EARLY_CLOSE: the fill's price IS the realization) ────────────────────────────
  if (side === "sell") {
    if (!existing || priorSize <= 0) {
      return { kind: "error", reason: `sell ${outcome} for ${marketId} but no open position exists to exit` };
    }
    if (existing.side !== outcome) {
      return { kind: "error", reason: `sell ${outcome} but open position holds ${existing.side} — sell the held side to exit` };
    }
    if (existing.avgEntryPrice === null) {
      return { kind: "error", reason: `position ${marketId} has size ${priorSize} but no avgEntryPrice — cannot compute exit P&L (data integrity), refused` };
    }
    if (quantityFilled > priorSize) {
      // Over-exit: only the held shares exist; realize those fully, never go negative size.
      const fullDelta = (fillPrice - existing.avgEntryPrice) * priorSize;
      patchBotPosition(db, marketId, {
        realizedPnL: priorRealized + fullDelta,
        netPosition: 0,
        totalSize: 0,
        status: "CLOSED",
        realizationSource: "EARLY_CLOSE",
      });
      tagFillRealizedPnl(db, fillId, fullDelta);
      return { kind: "closed_early", avgEntryPrice: existing.avgEntryPrice, totalSize: 0, realizedPnLDelta: fullDelta, realizationSource: "EARLY_CLOSE" };
    }
    const realizedDelta = (fillPrice - existing.avgEntryPrice) * quantityFilled;
    const newSize = priorSize - quantityFilled;
    if (newSize > 0) {
      patchBotPosition(db, marketId, { netPosition: newSize, realizedPnL: priorRealized + realizedDelta, totalSize: newSize });
      tagFillRealizedPnl(db, fillId, realizedDelta);
      return { kind: "partially_closed", avgEntryPrice: existing.avgEntryPrice, totalSize: newSize, realizedPnLDelta: realizedDelta, realizationSource: "EARLY_CLOSE" };
    }
    patchBotPosition(db, marketId, {
      realizedPnL: priorRealized + realizedDelta,
      netPosition: 0,
      totalSize: 0,
      status: "CLOSED",
      realizationSource: "EARLY_CLOSE",
    });
    tagFillRealizedPnl(db, fillId, realizedDelta);
    return { kind: "closed_early", avgEntryPrice: existing.avgEntryPrice, totalSize: 0, realizedPnLDelta: realizedDelta, realizationSource: "EARLY_CLOSE" };
  }

  // ── BUY ─────────────────────────────────────────────────────────────────────────────────────────
  if (!existing || priorSize <= 0) {
    // Fresh open: cost basis = this fill.
    upsertBotPosition(db, {
      marketId,
      symbol,
      side: outcome,
      netPosition: quantityFilled,
      totalSize: quantityFilled,
      avgEntryPrice: fillPrice,
      realizedPnL: priorRealized,
      status: "OPEN",
      realizationSource: null,
      realizedAtUnix: null,
    });
    return { kind: "opened", avgEntryPrice: fillPrice, totalSize: quantityFilled, realizedPnLDelta: 0 };
  }

  if (existing.side === outcome) {
    // Same-outcome accumulation: quantity-weighted average entry price.
    const newTotal = priorSize + quantityFilled;
    const newAvg = weightedEntryPrice(existing.avgEntryPrice, priorSize, fillPrice, quantityFilled);
    patchBotPosition(db, marketId, { netPosition: newTotal, totalSize: newTotal, avgEntryPrice: newAvg });
    return { kind: "added", avgEntryPrice: newAvg, totalSize: newTotal, realizedPnLDelta: 0 };
  }

  // Opposite-outcome buy while holding the other side: the crossing price implies an exit price for
  // the held leg (buying NO at P_n implies the YES bid ≈ 1 - P_n). Realize the held leg EARLY_CLOSE
  // at that implied price, then open the new outcome in the same row (positions stay keyed by
  // marketId). This is a documented rule, not a silent approximation.
  if (existing.avgEntryPrice === null) {
    return { kind: "error", reason: `position ${marketId} has size ${priorSize} but no avgEntryPrice — cannot compute implied exit (data integrity), refused` };
  }
  const impliedExit = 1 - fillPrice;
  const realizedDelta = (impliedExit - existing.avgEntryPrice) * priorSize;
  upsertBotPosition(db, {
    marketId,
    symbol,
    side: outcome,
    netPosition: quantityFilled,
    totalSize: quantityFilled,
    avgEntryPrice: fillPrice,
    realizedPnL: priorRealized + realizedDelta,
    status: "OPEN",
    realizationSource: null,
    realizedAtUnix: null,
  });
  tagFillRealizedPnl(db, fillId, realizedDelta);
  return { kind: "closed_early", avgEntryPrice: fillPrice, totalSize: quantityFilled, realizedPnLDelta: realizedDelta, realizationSource: "EARLY_CLOSE" };
}