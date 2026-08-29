/**
 * Bot event log — persisted in data/snapshots.db (reuse logger DB, zero external service).
 * Every loop tick's outcome: market evaluated, decision, risk result, execution result or SKIP reason.
 * Becomes eventual GET /bots/:id/events data source.
 * Tags: LIVE_INDEXER/LIVE_ONCHAIN for market data, DERIVED for computed.
 */

import type Database from "better-sqlite3";
import { insertBotEvent, listBotEvents, countBotEvents, type BotEventRow } from "../snapshots/db.js";

export type BotEventType =
  | "BOT_START"
  | "BOT_STOP"
  | "TICK"
  | "MARKET_EVALUATED"
  | "STRATEGY_DECISION"
  | "RISK_CHECK"
  | "EXECUTION"
  | "FILL_OBSERVED"
  | "SETTLEMENT_REALIZED"
  | "MID_MOVE_OBSERVED"
  | "AUTO_STOP_LOSS_LIMIT"
  | "AUTO_STOP_DISABLED";

export interface LogEventParams {
  readonly marketId?: string | null;
  readonly symbol?: string | null;
  readonly eventType: BotEventType;
  readonly data: unknown;
  readonly blockNumber?: number | null;
}

export function logEvent(db: Database.Database, params: LogEventParams): number {
  return insertBotEvent(db, {
    marketId: params.marketId ?? null,
    symbol: params.symbol ?? null,
    eventType: params.eventType,
    data: params.data,
    blockNumber: params.blockNumber ?? null,
  });
}

export function getRecentEvents(db: Database.Database, limit = 100): BotEventRow[] {
  return listBotEvents(db, limit);
}

export function getEventCount(db: Database.Database): number {
  return countBotEvents(db);
}
