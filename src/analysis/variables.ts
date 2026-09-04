/**
 * Step 1 - real variable collection. Every variable below is computed from real
 * DreamDEX data or explicitly null (N/A) with a note. Approximate-or-drop rule:
 * a variable that cannot be computed cleanly is null, never estimated silently.
 */
import { ANALYSIS_CONFIG, DECISION_CONFIG } from "../config.js";
import { computeBookStats } from "./engine.js";
import { computeDislocation } from "./dislocation.js";
import type { ReferenceNow, ReferencePoint } from "./referenceFeed.js";

export interface ContractHistoryPoint {
  readonly mid: number;
  readonly capturedAtUnix: number;
}

export interface VariablesInput {
  readonly marketId: string;
  readonly symbol: string;
  readonly asset: string;
  readonly strike: string | null;
  readonly venueId?: string | null;
  readonly expiry?: number | null;
  readonly onchainStatus?: number | null;
  readonly bids: ReadonlyArray<readonly [number, number]>;
  readonly asks: ReadonlyArray<readonly [number, number]>;
  readonly bestBid: number | undefined;
  readonly bestAsk: number | undefined;
  readonly marketProbability: number | undefined;
  readonly timeRemaining: number | undefined;
  readonly referenceNow: ReferenceNow | null; // LIVE underlying now (testnet feed) or null
  readonly referenceThen: ReferencePoint | null; // older underlying point aligned to contract window or null
  readonly contractHistory: ReadonlyArray<ContractHistoryPoint>; // real snapshot mids, any order
}

export interface MarketVariables {
  readonly marketId: string;
  readonly symbol: string;
  readonly asset: string;
  readonly marketProbability: number | null; // LIVE_INDEXER YES mid
  readonly spread: number | null; // DERIVED probability points
  readonly spreadBps: number | null; // DERIVED
  readonly imbalance: number | null; // DERIVED Stage 3 formula
  readonly liquidity: number | null; // DERIVED shares in depth window
  readonly timeRemaining: number | null; // LIVE_ONCHAIN seconds
  readonly referencePrice: number | null; // LIVE underlying now
  readonly referenceEma: number | null; // LIVE underlying EMA
  readonly momentum: number | null; // DERIVED mid rate-of-change over window, unitless
  readonly momentumWindowSec: number | null;
  readonly momentumSamples: number;
  readonly volatility: number | null; // DERIVED population stddev of window mids, probability points
  readonly volatilitySamples: number;
  readonly strikeDistancePct: number | null; // DERIVED (ref-strike)/|strike| in percent, null = N/A
  readonly dislocationGap: number | null; // DERIVED underlying RoC minus contract RoC
  readonly dislocationWindowSec: number | null;
  readonly underlyingRoC: number | null;
  readonly contractRoC: number | null;
  readonly venueId: string | null;
  readonly expiry: number | null;
  readonly onchainStatus: number | null;
  readonly strikePresent: boolean;
  readonly notes: string[]; // every N/A and sufficiency call, honestly recorded
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** A strike value counts as present only when it parses to a finite non-zero number. */
export function isStrikePresent(strike: string | null): boolean {
  if (strike === null) return false;
  const n = Number(strike);
  return Number.isFinite(n) && n !== 0;
}

function populationStddev(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

export function collectVariables(input: VariablesInput): MarketVariables {
  const notes: string[] = [];
  const book = computeBookStats(input.bids, input.asks, ANALYSIS_CONFIG.DEPTH_LEVELS);
  if (book.empty) notes.push("book empty on at least one side - imbalance/liquidity N/A");

  const marketProbability = finite(input.marketProbability) ? input.marketProbability : null;
  if (marketProbability === null) notes.push("marketProbability missing - fair value not computable");
  const spread =
    input.bestBid !== undefined && input.bestAsk !== undefined && finite(input.bestBid) && finite(input.bestAsk)
      ? input.bestAsk - input.bestBid
      : null;
  if (spread === null) notes.push("spread unknown - best bid/ask missing");
  const spreadBps = spread !== null && marketProbability !== null && marketProbability > 0 ? (spread / marketProbability) * 10000 : null;
  const rawTime = input.timeRemaining;
  const timeRemaining = typeof rawTime === "number" && Number.isFinite(rawTime) ? rawTime : null;

  // Contract history window: newest HISTORY_LOOKBACK_COUNT real mids, ascending by time.
  const mids = input.contractHistory
    .filter((p) => finite(p.mid) && finite(p.capturedAtUnix))
    .sort((a, b) => a.capturedAtUnix - b.capturedAtUnix)
    .slice(-DECISION_CONFIG.HISTORY_LOOKBACK_COUNT);
  let momentum: number | null = null;
  let momentumWindowSec: number | null = null;
  let volatility: number | null = null;
  if (mids.length < DECISION_CONFIG.HISTORY_MIN_SNAPSHOTS) {
    notes.push(`momentum/volatility N/A - only ${mids.length} real snapshots (need ${DECISION_CONFIG.HISTORY_MIN_SNAPSHOTS})`);
  } else {
    const first = mids[0];
    const last = mids[mids.length - 1];
    if (first === undefined || last === undefined) {
      notes.push("momentum/volatility N/A - window ends unreadable");
    } else {
      const span = last.capturedAtUnix - first.capturedAtUnix;
      if (span < DECISION_CONFIG.HISTORY_MIN_SPAN_SEC) {
        notes.push(`momentum/volatility N/A - window span ${span.toFixed(0)}s under ${DECISION_CONFIG.HISTORY_MIN_SPAN_SEC}s`);
      } else if (first.mid <= 0) {
        notes.push("momentum/volatility N/A - first window mid not positive");
      } else {
        momentum = (last.mid - first.mid) / first.mid;
        momentumWindowSec = span;
        volatility = populationStddev(mids.map((p) => p.mid));
      }
    }
  }

  // Reference (underlying) now/then. Missing feed or missing window point → N/A downstream.
  const referencePrice = input.referenceNow ? input.referenceNow.price : null;
  const referenceEma = input.referenceNow ? input.referenceNow.ema : null;
  if (referencePrice === null) notes.push(`reference price N/A - no feed observation for ${input.asset}`);

  // Dislocation over the SAME window as momentum (contract then/now = window ends).
  const firstBar = mids.length > 0 ? mids[0] : undefined;
  const lastBar = mids.length > 0 ? mids[mids.length - 1] : undefined;
  const contractThen = firstBar !== undefined ? firstBar.mid : null;
  const contractNow = lastBar !== undefined ? lastBar.mid : null;
  const dis = computeDislocation({
    underlyingThenPrice: input.referenceThen ? input.referenceThen.price : null,
    underlyingNowPrice: referencePrice,
    contractThenProb: contractThen,
    contractNowProb: contractNow,
    windowSec: momentumWindowSec,
  });
  if (!dis.sufficient) notes.push(dis.note);

  // Strike distance: real markets report strike 0/absent (Stage 1.5) → N/A, never invented.
  const strikeNum = input.strike !== null ? Number(input.strike) : NaN;
  const strikePresent = isStrikePresent(input.strike);
  let strikeDistancePct: number | null = null;
  if (!strikePresent) {
    notes.push("strike distance N/A - strike absent or zero on this market");
  } else if (referencePrice === null) {
    notes.push("strike distance N/A - no reference price to compare");
  } else {
    strikeDistancePct = ((referencePrice - strikeNum) / Math.abs(strikeNum)) * 100;
  }

  return {
    marketId: input.marketId,
    symbol: input.symbol,
    asset: input.asset,
    marketProbability,
    spread,
    spreadBps,
    imbalance: book.empty ? null : book.imbalance,
    liquidity: book.empty ? null : book.liquidity,
    timeRemaining,
    referencePrice,
    referenceEma,
    momentum,
    momentumWindowSec,
    momentumSamples: mids.length,
    volatility,
    volatilitySamples: mids.length,
    strikeDistancePct,
    dislocationGap: dis.gap,
    dislocationWindowSec: dis.windowSec,
    underlyingRoC: dis.underlyingRoC,
    contractRoC: dis.contractRoC,
    venueId: input.venueId ?? null,
    expiry: typeof input.expiry === "number" && Number.isFinite(input.expiry) ? input.expiry : null,
    onchainStatus: typeof input.onchainStatus === "number" && Number.isFinite(input.onchainStatus) ? input.onchainStatus : null,
    strikePresent,
    notes,
  };
}
