/**
 * Settlement Poller - Stage 9 (brief §13 gap-close).
 *
 * For every open (non-zero-size) position in bot_positions, this polls whether its market has
 * settled on-chain and, when it has, writes the REAL realized P&L using Stage 4's exact payout
 * formula. Two realization sources are distinguished in the data:
 *   - "SETTLEMENT": market resolved/voided → YES win (1-avgEntryPrice)*size, NO win
 *     -avgEntryPrice*size, voided (0.5-avgEntryPrice)*size (Stage 4 engine formula).
 *   - "EARLY_CLOSE": handled at fill time by the cost-basis engine (positions.ts) when an
 *     opposite-side fill exits the position before settlement.
 *
 * Settlement happens on the market's own clock, NOT the bot's trading clock, so this poller runs on
 * its own interval (`SETTLEMENT_POLL_CONFIG.POLL_INTERVAL_MS`). It is intentionally decoupled from
 * BotRunner's loop; `npm run settle` runs it as a standalone lightweight script.
 *
 * A position whose market has NOT settled is left clearly marked OPEN/unrealized - no outcome is
 * guessed before it is known. Anything that cannot be resolved (network error, missing cost basis,
 * ambiguous winningOutcome) is reported in the result's `errors[]` and the position is left OPEN.
 * No silent catches.
 *
 * Tags: LIVE_ONCHAIN (isResolved/isVoided/winningOutcome via getMarketOnchain), LIVE_INDEXER
 * (Finalized shortlist via listBinaryMarkets), DERIVED (payout).
 */

import type Database from "better-sqlite3";
import type { EcContext } from "@dreamdex-bot-kit/ec-core";
import type { Hex } from "viem";
import { getOpenBotPositions, patchBotPosition, type PositionSide } from "../snapshots/db.js";
import { computeSettlementPnL } from "./positions.js";
import { logEvent } from "./events.js";
import { SETTLEMENT_POLL_CONFIG } from "../config.js";

/** Authoritative on-chain settlement state for one market. */
export interface MarketSettlementStatus {
  readonly isResolved: boolean;
  readonly isVoided: boolean;
  readonly winningOutcome: number | null; // 0=YES, 1=NO, null while unresolved/ambiguous
  readonly status: number; // MARKET_STATUS: 0 Listed … 4 Resolved · 5 Voided
  /** Whether the market also appeared in the indexer's status:"Finalized" listing (LIVE_INDEXER cross-check). */
  readonly inFinalizedList: boolean;
}

export type SettlementStatusResolver = (marketIds: readonly string[]) => Promise<Map<string, MarketSettlementStatus>>;

/**
 * Real resolver: ec-core pattern from Stages 1.5/4, verified.
 *  1. Indexer `listBinaryMarkets({status:"Finalized"})` shortlists settled ids (cheap, venue-scoped).
 *  2. Per open position, `getMarketOnchain(marketId)` is the AUTHORITATIVE on-chain gate
 *     (Stage 1.5: gate on this status, not the indexer) - isResolved/isVoided/winningOutcome.
 */
export function createEcSettlementResolver(ctx: EcContext): SettlementStatusResolver {
  return async (marketIds) => {
    const scope = ctx.config.venueId
      ? { venueId: ctx.config.venueId }
      : ctx.config.operatorId !== undefined
        ? { operatorId: ctx.config.operatorId }
        : {};
    const finalizedRows = await ctx.exchange.client.listBinaryMarkets({ ...scope, status: "Finalized", limit: 200 });
    const finalizedIds = new Set(finalizedRows.map((r) => String(r.marketId).toLowerCase()));
    const map = new Map<string, MarketSettlementStatus>();
    for (const id of marketIds) {
      const oc = await ctx.exchange.client.getMarketOnchain(id as Hex);
      map.set(id, {
        isResolved: Boolean(oc.isResolved),
        isVoided: Boolean(oc.isVoided),
        winningOutcome: oc.winningOutcome ?? null,
        status: Number(oc.status),
        inFinalizedList: finalizedIds.has(id.toLowerCase()),
      });
    }
    return map;
  };
}

export interface RealizedBySettlement {
  readonly marketId: string;
  readonly symbol: string;
  readonly side: PositionSide;
  readonly avgEntryPrice: number;
  readonly size: number;
  readonly winningOutcome: number | null;
  readonly voided: boolean;
  readonly realizedPnLDelta: number;
}

export interface SettlementPollResult {
  readonly checkedPositions: number;
  readonly stillOpen: Array<{ marketId: string; reason: string }>;
  readonly realized: RealizedBySettlement[];
  readonly errors: string[];
}
/**
 * One poll pass over all open positions. Deterministic and network-free given a resolver - unit
 * tests inject a stub resolver; the live script uses createEcSettlementResolver.
 */
export async function runSettlementPoll(
  db: Database.Database,
  opts: { resolve: SettlementStatusResolver; nowUnix?: number },
): Promise<SettlementPollResult> {
  const nowUnix = opts.nowUnix ?? Math.floor(Date.now() / 1000);
  const open = getOpenBotPositions(db);
  const result: SettlementPollResult = { checkedPositions: open.length, stillOpen: [], realized: [], errors: [] };
  if (open.length === 0) return result;

  let statusMap: Map<string, MarketSettlementStatus>;
  try {
    statusMap = await opts.resolve(open.map((p) => p.marketId));
  } catch (err) {
    result.errors.push(`settlement resolver failed as a whole: ${(err as Error).message} - all ${open.length} open position(s) left open`);
    result.stillOpen.push(...open.map((p) => ({ marketId: p.marketId, reason: "resolver error (indexer/onchain unreachable)" })));
    return result;
  }

  for (const p of open) {
    const st = statusMap.get(p.marketId);
    if (st === undefined) {
      result.stillOpen.push({ marketId: p.marketId, reason: "no settlement status returned for this market - left open" });
      continue;
    }
    if (!st.isResolved && !st.isVoided) {
      result.stillOpen.push({ marketId: p.marketId, reason: `status=${st.status} unresolved and not voided - no premature realization` });
      continue;
    }
    if (p.avgEntryPrice === null || !(p.totalSize > 0)) {
      result.errors.push(
        `position ${p.marketId} is OPEN with totalSize=${p.totalSize} avgEntryPrice=${String(p.avgEntryPrice)} - cost basis missing, cannot compute settlement P&L (no guessing), left open`,
      );
      continue;
    }
    const pnl = computeSettlementPnL({
      side: p.side,
      avgEntryPrice: p.avgEntryPrice,
      size: p.totalSize,
      winningOutcome: st.winningOutcome,
      voided: st.isVoided,
    });
    if (pnl === null) {
      result.errors.push(
        `market ${p.marketId} settled (isVoided=${st.isVoided}) but payout uncomputable (winningOutcome=${String(st.winningOutcome)}) - left open, no guess`,
      );
      continue;
    }
    const cumulative = p.realizedPnL + pnl;
    patchBotPosition(db, p.marketId, {
      realizedPnL: cumulative,
      totalSize: 0,
      status: "CLOSED",
      realizationSource: "SETTLEMENT",
      realizedAtUnix: nowUnix,
    });
    logEvent(db, {
      marketId: p.marketId,
      symbol: p.symbol,
      eventType: "SETTLEMENT_REALIZED",
      data: {
        side: p.side,
        avgEntryPrice: p.avgEntryPrice,
        size: p.totalSize,
        winningOutcome: st.winningOutcome,
        voided: st.isVoided,
        realizedPnL: pnl,
        cumulativeRealizedPnL: cumulative,
        realizationSource: "SETTLEMENT",
        inFinalizedList: st.inFinalizedList,
      },
    });
    result.realized.push({
      marketId: p.marketId,
      symbol: p.symbol,
      side: p.side,
      avgEntryPrice: p.avgEntryPrice,
      size: p.totalSize,
      winningOutcome: st.winningOutcome,
      voided: st.isVoided,
      realizedPnLDelta: pnl,
    });
  }
  return result;
}

/**
 * Continuous poller loop on the settlement poll interval (default SETTLEMENT_POLL_CONFIG).
 * Runs an immediate first poll, then on the interval; the timer is unref'd so it cannot keep the
 * process alive on its own. Errors are logged, never swallowed - a failed poll leaves positions open.
 */
export function startSettlementPoller(args: {
  readonly db: Database.Database;
  readonly resolve: SettlementStatusResolver;
  readonly intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = args.intervalMs ?? SETTLEMENT_POLL_CONFIG.POLL_INTERVAL_MS;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const runOnce = (): Promise<void> =>
    runSettlementPoll(args.db, { resolve: args.resolve })
      .then((result) => {
        for (const e of result.errors) console.error(`[SETTLE] error: ${e}`);
        for (const r of result.realized) {
          const outcomeStr = r.voided ? "VOIDED" : r.winningOutcome === 0 ? "YES" : "NO";
          console.log(
            `[SETTLE] REALIZED ${r.symbol} ${r.side} size=${r.size} avg=${r.avgEntryPrice.toFixed(4)} outcome=${outcomeStr} pnl=${r.realizedPnLDelta >= 0 ? "+" : ""}${r.realizedPnLDelta.toFixed(4)} tUSDC`,
          );
        }
        if (result.stillOpen.length > 0) console.log(`[SETTLE] ${result.stillOpen.length} open position(s) still unrealized (not guessed)`);
      })
      .catch((err: unknown) => {
        console.error(`[SETTLE] poll failed: ${(err as Error).message} - positions left open`);
      });

  void runOnce();
  timer = setInterval(() => {
    if (stopped) return;
    void runOnce();
  }, intervalMs);
  if (timer && typeof (timer as unknown as { unref?: () => void }).unref === "function") {
    (timer as unknown as { unref: () => void }).unref();
  }

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}