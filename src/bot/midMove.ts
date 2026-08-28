/**
 * Mid-price movement observability — NOT a trading signal.
 * For each market on each tick: compare current mid (LIVE_INDEXER) to most recent
 * prior snapshot for that market in data/snapshots.db. If abs change exceeds
 * MID_MOVE_ALERT_THRESHOLD (e.g. 0.025), log distinctly as MID_MOVE_OBSERVED.
 * Stored in same bot_events table, tagged separately, queryable for demo.
 * Tags: LIVE_INDEXER for mids, DERIVED for delta/threshold.
 */

import type Database from "better-sqlite3";
import { getLatestSnapshotMid } from "../snapshots/db.js";
import { logEvent } from "./events.js";
import { MID_MOVE_CONFIG } from "../config.js";

export interface MidMoveCheckParams {
  readonly marketId: string;
  readonly symbol: string;
  readonly currentMid: number | null;
  readonly currentBlockNumber: number | null;
  readonly threshold?: number;
}

export interface MidMoveResult {
  readonly moved: boolean;
  readonly delta: number | null;
  readonly priorMid: number | null;
  readonly currentMid: number | null;
  readonly threshold: number;
  readonly priorBlockNumber: number | null;
  readonly priorCapturedAtUnix: number | null;
  readonly overThreshold: boolean;
}

/**
 * Check mid move against last snapshot and log if over threshold.
 * Does NOT feed strategy or risk — purely informational.
 * Returns result and logs MID_MOVE_OBSERVED event when moved=true.
 */
export function checkMidMove(
  db: Database.Database,
  params: MidMoveCheckParams,
): MidMoveResult {
  const threshold = params.threshold ?? MID_MOVE_CONFIG.MID_MOVE_ALERT_THRESHOLD;
  const prior = getLatestSnapshotMid(db, params.marketId);

  if (prior === undefined || prior.mid === null || params.currentMid === null) {
    return {
      moved: false,
      delta: null,
      priorMid: prior?.mid ?? null,
      currentMid: params.currentMid,
      threshold,
      priorBlockNumber: prior?.blockNumber ?? null,
      priorCapturedAtUnix: prior?.capturedAtUnix ?? null,
      overThreshold: false,
    };
  }

  const delta = Math.abs(params.currentMid - prior.mid);
  const overThreshold = delta >= threshold;
  const elapsedSec = Math.floor(Date.now() / 1000) - prior.capturedAtUnix;

  if (overThreshold) {
    const signedDelta = params.currentMid - prior.mid;
    const sign = signedDelta >= 0 ? "+" : "";
    const msg = `[MID_MOVE] ${params.symbol} mid ${prior.mid.toFixed(3)} → ${params.currentMid.toFixed(3)} (${sign}${signedDelta.toFixed(3)}) over ${elapsedSec}s (block ${String(prior.blockNumber ?? "—")} → ${String(params.currentBlockNumber ?? "—")})`;
    // Log to stdout and to persisted events table
    console.log(msg);
    logEvent(db, {
      marketId: params.marketId,
      symbol: params.symbol,
      eventType: "MID_MOVE_OBSERVED",
      data: {
        tag: "DERIVED mid-move observability, NOT a trading signal",
        priorMid: prior.mid, // LIVE_INDEXER
        currentMid: params.currentMid, // LIVE_INDEXER
        delta, // DERIVED
        signedDelta, // DERIVED
        threshold, // DERIVED
        priorBlockNumber: prior.blockNumber, // LIVE_ONCHAIN
        currentBlockNumber: params.currentBlockNumber, // LIVE_ONCHAIN
        priorCapturedAtUnix: prior.capturedAtUnix,
        elapsedSec,
        message: msg,
      },
      blockNumber: params.currentBlockNumber,
    });
  }

  return {
    moved: overThreshold,
    delta,
    priorMid: prior.mid,
    currentMid: params.currentMid,
    threshold,
    priorBlockNumber: prior.blockNumber,
    priorCapturedAtUnix: prior.capturedAtUnix,
    overThreshold,
  };
}
