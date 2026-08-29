/**
 * Historical Books — match real snapshot order-book history to settled markets.
 * Queries data/snapshots.db for snapshots captured while the market was still live
 * (capturedAtUnix < market.expiry) for each settled marketId.
 * Not every settled market will have coverage — the logger only started 2026-08-28
 * 00:17. Report exactly how many have ≥1 vs zero, honestly. Markets with zero
 * keep using Stage 4's ESTIMATED fallback, clearly tagged per-market.
 * Tags: LIVE_INDEXER for book levels/mid, DERIVED for depth/imbalance, LIVE_ONCHAIN for marketId/expiry.
 */

import type Database from "better-sqlite3";
import { openSnapshotDb } from "../snapshots/db.js";

export interface HistoricalSnapshot {
  readonly capturedAtUnix: number; // DERIVED
  readonly capturedAtIso: string; // DERIVED
  readonly bids: ReadonlyArray<readonly [number, number]>; // LIVE_INDEXER JSON parsed
  readonly asks: ReadonlyArray<readonly [number, number]>; // LIVE_INDEXER
  readonly mid: number | null; // LIVE_INDEXER
  readonly bidDepth: number; // DERIVED
  readonly askDepth: number; // DERIVED
  readonly imbalance: number; // DERIVED
  readonly blockNumber: number | null; // LIVE_ONCHAIN
}

export interface MarketHistory {
  readonly marketId: string; // LIVE_ONCHAIN
  readonly symbol: string; // LIVE_INDEXER (constructed)
  readonly expiry: number; // LIVE_ONCHAIN
  readonly winningOutcome: number | null; // HISTORICAL
  readonly voided: boolean; // HISTORICAL
  readonly lastPrice: number | null; // HISTORICAL
  readonly snapshots: readonly HistoricalSnapshot[]; // HISTORICAL sequence if any, else empty
  readonly snapshotCount: number; // DERIVED
  readonly dataPath: "HISTORICAL" | "ESTIMATED"; // per-market tag: HISTORICAL if ≥1 real snapshot, else ESTIMATED fallback
}

/**
 * For each settled market, pull all snapshots where marketId matches and capturedAtUnix < expiry.
 * Returns per-market histories sorted by capturedAtUnix ascending (real time-series).
 * Also returns coverage counts for honest reporting.
 */
export function loadHistoriesForSettledMarkets(
  db: Database.Database,
  settledMarkets: readonly { marketId: string; symbol: string; expiry: number; winningOutcome: number | null; voided: boolean; lastPrice: number | null }[],
): { histories: MarketHistory[]; withHistory: number; withoutHistory: number } {
  const histories: MarketHistory[] = [];
  let withHistory = 0;
  let withoutHistory = 0;

  const stmt = db.prepare(
    "SELECT capturedAtUnix, capturedAtIso, bidLevels, askLevels, mid, bidDepth, askDepth, imbalance, blockNumber FROM snapshots WHERE marketId=? AND capturedAtUnix < ? ORDER BY capturedAtUnix ASC, id ASC",
  );

  for (const m of settledMarkets) {
    const rows = stmt.all(m.marketId, m.expiry) as Array<{
      capturedAtUnix: number;
      capturedAtIso: string;
      bidLevels: string;
      askLevels: string;
      mid: number | null;
      bidDepth: number;
      askDepth: number;
      imbalance: number;
      blockNumber: number | null;
    }>;
    if (rows.length > 0) {
      withHistory += 1;
      const snapshots: HistoricalSnapshot[] = rows.map((r) => {
        let bids: ReadonlyArray<readonly [number, number]>;
        let asks: ReadonlyArray<readonly [number, number]>;
        try {
          bids = JSON.parse(r.bidLevels) as ReadonlyArray<readonly [number, number]>;
        } catch {
          bids = [];
        }
        try {
          asks = JSON.parse(r.askLevels) as ReadonlyArray<readonly [number, number]>;
        } catch {
          asks = [];
        }
        return {
          capturedAtUnix: r.capturedAtUnix,
          capturedAtIso: r.capturedAtIso,
          bids,
          asks,
          mid: r.mid,
          bidDepth: r.bidDepth,
          askDepth: r.askDepth,
          imbalance: r.imbalance,
          blockNumber: r.blockNumber,
        };
      });
      histories.push({
        marketId: m.marketId,
        symbol: m.symbol,
        expiry: m.expiry,
        winningOutcome: m.winningOutcome,
        voided: m.voided,
        lastPrice: m.lastPrice,
        snapshots,
        snapshotCount: snapshots.length,
        dataPath: "HISTORICAL",
      });
    } else {
      withoutHistory += 1;
      histories.push({
        marketId: m.marketId,
        symbol: m.symbol,
        expiry: m.expiry,
        winningOutcome: m.winningOutcome,
        voided: m.voided,
        lastPrice: m.lastPrice,
        snapshots: [],
        snapshotCount: 0,
        dataPath: "ESTIMATED",
      });
    }
  }

  return { histories, withHistory, withoutHistory };
}

/** Convenience: open the default DB and load histories (for scripts). */
export function loadHistoriesFromDefaultDb(
  settledMarkets: readonly { marketId: string; symbol: string; expiry: number; winningOutcome: number | null; voided: boolean; lastPrice: number | null }[],
): { histories: MarketHistory[]; withHistory: number; withoutHistory: number } {
  const db = openSnapshotDb();
  try {
    return loadHistoriesForSettledMarkets(db, settledMarkets);
  } finally {
    db.close();
  }
}
