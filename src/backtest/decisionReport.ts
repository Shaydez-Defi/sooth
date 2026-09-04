/**
 * Step 7 - decision-framework backtest: track what the decision layer says, not
 * just P&L. Every snapshot of every settled market gets a real decision from
 * decideMarket (real books, real mids, real timestamps). First TRADE per market
 * is settled against the real winningOutcome with the Stage 4 payout formula.
 * WATCH and NO_TRADE snapshots are counted by real reason bucket. Whatever the
 * numbers say is reported - including zero trades.
 */
import { DECISION_CONFIG } from "../config.js";
import { computePnL } from "./engine.js";
import { nearestReferenceTick } from "../analysis/referenceFeed.js";
import { collectVariables } from "../analysis/variables.js";
import { computeFairValue } from "../analysis/contextEngine.js";
import { checkSettlement } from "../analysis/settlementGate.js";
import { decideMarket } from "../analysis/decision.js";

export interface DecisionEvalSnapshot {
  readonly capturedAtUnix: number;
  readonly bids: ReadonlyArray<readonly [number, number]>;
  readonly asks: ReadonlyArray<readonly [number, number]>;
  readonly mid: number | null;
}

export interface DecisionEvalMarket {
  readonly marketId: string;
  readonly symbol: string;
  readonly asset: string;
  readonly expiry: number;
  readonly winningOutcome: number | null; // HISTORICAL 0=YES, 1=NO
  readonly voided: boolean; // HISTORICAL
  readonly snapshots: ReadonlyArray<DecisionEvalSnapshot>; // HISTORICAL ascending
  readonly fallbackBook: { bids: ReadonlyArray<readonly [number, number]>; asks: ReadonlyArray<readonly [number, number]> } | null; // ESTIMATED path
  readonly referenceTicks: ReadonlyArray<{ price: number; atUnix: number }>; // LIVE underlying history (may be empty → N/A)
  readonly referenceAsset: string | null;
  readonly bookTag: "HISTORICAL" | "ESTIMATED";
}

export interface DecisionPrediction {
  readonly marketId: string;
  readonly symbol: string;
  readonly predicted: "YES" | "NO";
  readonly entryPrice: number;
  readonly executableEdge: number;
  readonly actual: "YES" | "NO" | "VOID" | "UNKNOWN";
  readonly correct: boolean | null;
  readonly realizedEdge: number | null; // actual outcome prob minus entry, signed by prediction
  readonly pnl: number;
  readonly bookTag: "HISTORICAL" | "ESTIMATED";
}

export interface DecisionReport {
  readonly marketsEvaluated: number;
  readonly snapshotsEvaluated: number;
  readonly tradesTaken: number;
  readonly tradeSignalSnapshots: number;
  readonly watchSnapshots: number;
  readonly noTradeSnapshots: number;
  readonly rejectionReasons: Record<string, number>;
  readonly predictions: DecisionPrediction[];
  readonly realizedEdgeAvg: number | null;
  readonly avgExecutableEdge: number | null; // mean |executableEdge| over taken trades
  readonly totalPnL: number;
  readonly winRate: number | null;
  readonly insufficientHistory: number; // markets below HISTORY_MIN_SNAPSHOTS
  readonly unevaluated: number; // markets with no book at all (should be 0)
}

/** Bucket a NO_TRADE/WATCH outcome into a countable rejection category. */
export function bucketRejection(decision: string, firstReason: string): string {
  if (decision === "WATCH") return "watch-below-trade-bar";
  const r = firstReason.toLowerCase();
  if (r.includes("liquidity")) return "liquidity";
  if (r.includes("spread")) return "spread";
  if (r.includes("timeremaining") || r.includes("expir")) return "expiry";
  if (r.includes("blocked") || r.includes("settlement")) return "settlement";
  if (r.includes("watch bar") || r.includes("below threshold")) return "edge-below-threshold";
  if (r.includes("fair value") || r.includes("market price unknown")) return "no-fair-value";
  return "other";
}

export function evaluateDecisions(markets: ReadonlyArray<DecisionEvalMarket>): DecisionReport {
  const rejectionReasons: Record<string, number> = {};
  const predictions: DecisionPrediction[] = [];
  let snapshotsEvaluated = 0;
  let tradesTaken = 0;
  let tradeSignalSnapshots = 0;
  let watchSnapshots = 0;
  let noTradeSnapshots = 0;
  let insufficientHistory = 0;
  let unevaluated = 0;
  let totalPnL = 0;
  let execEdgeSum = 0;
  let realizedEdgeSum = 0;
  let realizedEdgeCount = 0;
  let wins = 0;
  let decidedOutcomes = 0;

  const bump = (bucket: string): void => {
    rejectionReasons[bucket] = (rejectionReasons[bucket] ?? 0) + 1;
  };

  for (const m of markets) {
    const snaps = [...m.snapshots].sort((a, b) => a.capturedAtUnix - b.capturedAtUnix);
    if (snaps.length < DECISION_CONFIG.HISTORY_MIN_SNAPSHOTS) insufficientHistory += 1;

    // Evaluation points: every real snapshot, or one ESTIMATED fallback evaluation.
    const points: Array<{ atUnix: number; bids: ReadonlyArray<readonly [number, number]>; asks: ReadonlyArray<readonly [number, number]>; mid: number | null }> =
      snaps.length > 0
        ? snaps.map((s) => ({ atUnix: s.capturedAtUnix, bids: s.bids, asks: s.asks, mid: s.mid }))
        : m.fallbackBook
          ? [{ atUnix: m.expiry - 3600, bids: m.fallbackBook.bids, asks: m.fallbackBook.asks, mid: null }]
          : [];
    if (points.length === 0) {
      unevaluated += 1;
      continue;
    }

    const firstPt = points[0];
    if (firstPt === undefined) {
      unevaluated += 1;
      continue;
    }
    const firstAt = firstPt.atUnix;
    let taken = false;
    const history: Array<{ mid: number; capturedAtUnix: number }> = [];
    for (const pt of points) {
      if (pt.mid !== null && Number.isFinite(pt.mid)) history.push({ mid: pt.mid, capturedAtUnix: pt.atUnix });
      const [firstBid] = pt.bids;
      const [firstAsk] = pt.asks;
      const bestBid = firstBid?.[0];
      const bestAsk = firstAsk?.[0];
      const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : (pt.mid ?? undefined);
      const refThen = nearestReferenceTick(m.referenceTicks, firstAt);
      const refNow = nearestReferenceTick(m.referenceTicks, pt.atUnix);
      const variables = collectVariables({
        marketId: m.marketId,
        symbol: m.symbol,
        asset: m.asset,
        strike: null, // settled metas carry no strike - N/A, never invented
        venueId: null,
        expiry: m.expiry,
        // Gate encoding (documented, not invented): a recorded winningOutcome proves
        // on-chain resolution (status Resolved=4); voided proves Voided=5; neither
        // means resolution is unverifiable here, so the gate honestly blocks.
        onchainStatus: m.voided ? 5 : m.winningOutcome !== null ? 4 : null,
        bids: pt.bids,
        asks: pt.asks,
        bestBid,
        bestAsk,
        marketProbability: mid,
        timeRemaining: m.expiry - pt.atUnix,
        referenceNow: refNow ? { asset: m.referenceAsset ?? "?", price: refNow.price, ema: null, blockTimestamp: refNow.atUnix } : null,
        referenceThen: refThen,
        contractHistory: history,
      });
      const fair = computeFairValue(variables);
      const gate = checkSettlement({
        marketId: m.marketId,
        symbol: m.symbol,
        expiry: m.expiry,
        venueId: null,
        onchainStatus: m.voided ? 5 : m.winningOutcome !== null ? 4 : null,
        strikePresent: false,
      });
      const out = decideMarket({ variables, fair, gate });
      snapshotsEvaluated += 1;

      if (out.decision === "TRADE") {
        tradeSignalSnapshots += 1;
        if (!taken) {
          taken = true;
          tradesTaken += 1;
          const predicted = out.executableEdge > 0 ? "YES" : "NO";
          const entryPrice = predicted === "YES" ? out.marketPrice : 1 - out.marketPrice;
          const pnl = computePnL({ direction: predicted, entryPrice, size: DECISION_CONFIG.ORDER_SIZE_SHARES, winningOutcome: m.winningOutcome, voided: m.voided });
          totalPnL += pnl;
          execEdgeSum += Math.abs(out.executableEdge);
          const actual: DecisionPrediction["actual"] = m.voided ? "VOID" : m.winningOutcome === 0 ? "YES" : m.winningOutcome === 1 ? "NO" : "UNKNOWN";
          const correct = actual === "UNKNOWN" ? null : actual === predicted;
          let realizedEdge: number | null = null;
          if (actual !== "UNKNOWN") {
            const actualProb = actual === "VOID" ? 0.5 : actual === "YES" ? 1 : 0;
            realizedEdge = predicted === "YES" ? actualProb - entryPrice : (1 - actualProb) - entryPrice;
            realizedEdgeSum += realizedEdge;
            realizedEdgeCount += 1;
          }
          if (correct !== null) {
            decidedOutcomes += 1;
            if (correct) wins += 1;
          }
          predictions.push({ marketId: m.marketId, symbol: m.symbol, predicted, entryPrice, executableEdge: out.executableEdge, actual, correct, realizedEdge, pnl, bookTag: m.bookTag });
        }
      } else if (out.decision === "WATCH") {
        watchSnapshots += 1;
        bump(bucketRejection(out.decision, out.reasons[0] ?? ""));
      } else {
        noTradeSnapshots += 1;
        bump(bucketRejection(out.decision, out.reasons[0] ?? ""));
      }
    }
  }

  return {
    marketsEvaluated: markets.length - unevaluated,
    snapshotsEvaluated,
    tradesTaken,
    tradeSignalSnapshots,
    watchSnapshots,
    noTradeSnapshots,
    rejectionReasons,
    predictions,
    realizedEdgeAvg: realizedEdgeCount > 0 ? realizedEdgeSum / realizedEdgeCount : null,
    avgExecutableEdge: tradesTaken > 0 ? execEdgeSum / tradesTaken : null,
    totalPnL,
    winRate: decidedOutcomes > 0 ? wins / decidedOutcomes : null,
    insufficientHistory,
    unevaluated,
  };
}
