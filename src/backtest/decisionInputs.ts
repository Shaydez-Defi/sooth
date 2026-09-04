/**
 * Shared builders for decision evaluation inputs - used by the
 * POST /strategies/decision-report route (the backtest script keeps its own
 * inline copy; both read the same real sources).
 */
import { syntheticBookAround, type MarketHistoryInput } from "./engine.js";
import type { DecisionEvalMarket } from "./decisionReport.js";
import type { ReferencePoint } from "../analysis/referenceFeed.js";

export interface SettledMeta {
  readonly marketId: string;
  readonly symbol: string;
  readonly expiry: number;
  readonly winningOutcome: number | null;
  readonly voided: boolean;
  readonly lastPrice: number | null;
}

export interface SettledRow {
  readonly marketId: unknown;
  readonly asset?: unknown;
  readonly interval?: unknown;
  readonly intervalSec?: unknown;
  readonly expiry?: unknown;
  readonly lastPrice?: unknown;
  readonly baseDecimals?: unknown;
  readonly winningOutcome?: unknown;
  readonly voided?: unknown;
}

function rawPriceToProb(raw: string | null, decimals = 6): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** decimals;
}

function isoDay(expiry: number): string {
  return new Date(expiry * 1000).toISOString().slice(0, 10);
}

/** Normalize raw indexer rows to settled metas (same mapping as the backtest script). */
export function settledMetasFromRows(rows: ReadonlyArray<SettledRow>): SettledMeta[] {
  return rows.map((r) => {
    const marketId = String(r.marketId);
    const asset = typeof r.asset === "string" ? r.asset : "UNK";
    const interval = typeof r.interval === "string" ? r.interval : typeof r.intervalSec === "number" ? r.intervalSec : "?";
    const expiryNum = Number(r.expiry ?? 0);
    const expiry = Number.isFinite(expiryNum) ? expiryNum : 0;
    const decimals = typeof r.baseDecimals === "number" ? r.baseDecimals : 6;
    return {
      marketId,
      symbol: `${asset}-${interval}-${isoDay(expiry)}`,
      expiry,
      winningOutcome: typeof r.winningOutcome === "number" ? r.winningOutcome : null,
      voided: Boolean(r.voided),
      lastPrice: rawPriceToProb(typeof r.lastPrice === "string" ? r.lastPrice : null, decimals),
    };
  });
}

function assetOf(symbol: string): string {
  const head = symbol.split("-")[0];
  return head !== undefined && head !== "" ? head : "?";
}

/**
 * Build decision-eval inputs from matched histories. Reference ticks come from
 * the injected fetcher (live feed where it retains the window); failures yield
 * empty ticks, which the evaluator records as N/A - never throws.
 */
export async function buildDecisionInputs(
  histories: ReadonlyArray<MarketHistoryInput>,
  getTicks: (asset: string, fromUnix: number, toUnix: number) => Promise<ReferencePoint[]>,
): Promise<DecisionEvalMarket[]> {
  const out: DecisionEvalMarket[] = [];
  for (const h of histories) {
    const asset = assetOf(h.symbol);
    if (h.snapshots.length > 0) {
      const times = h.snapshots.map((s) => s.capturedAtUnix);
      const from = Math.min(...times);
      const to = Math.max(...times);
      let ticks: ReferencePoint[] = [];
      try {
        ticks = await getTicks(asset, from, to);
      } catch {
        ticks = [];
      }
      out.push({
        marketId: h.marketId,
        symbol: h.symbol,
        asset,
        expiry: h.expiry,
        winningOutcome: h.winningOutcome,
        voided: h.voided,
        snapshots: h.snapshots.map((s) => ({ capturedAtUnix: s.capturedAtUnix, bids: s.bids, asks: s.asks, mid: s.mid })),
        fallbackBook: null,
        referenceTicks: ticks,
        referenceAsset: ticks.length > 0 ? asset : null,
        bookTag: "HISTORICAL",
      });
    } else {
      const book = syntheticBookAround(h.lastPrice ?? 0.5);
      out.push({
        marketId: h.marketId,
        symbol: h.symbol,
        asset,
        expiry: h.expiry,
        winningOutcome: h.winningOutcome,
        voided: h.voided,
        snapshots: [],
        fallbackBook: book,
        referenceTicks: [],
        referenceAsset: null,
        bookTag: "ESTIMATED",
      });
    }
  }
  return out;
}
