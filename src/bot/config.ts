/**
 * Bot Configuration persistence — extends Stage 5's BotConfig with market scope.
 * Persisted to SQLite data/snapshots.db (bot_config table, id=1, zero external service)
 * so start/stop survives a process restart. This is the programmatic surface that
 * the later REST layer will call into.
 */

import type Database from "better-sqlite3";
import { BOT_CONFIG, MID_MOVE_CONFIG } from "../config.js";
import type { BotConfig } from "../strategy/types.js";

export interface PersistedBotConfig {
  /** BotConfig shape from Stage 5 (brief §7). */
  readonly bot: BotConfig;
  /** Market scope: single marketId (bytes32) or "all" for all live markets. */
  readonly marketScope: string; // "all" or marketId hex
  /** Human-readable label. */
  readonly label?: string;
  /** Mid-move alert threshold (probability points). */
  readonly midMoveThreshold: number;
  /** Loop interval ms. */
  readonly loopIntervalMs: number;
}

export function defaultPersistedConfig(): PersistedBotConfig {
  return {
    bot: {
      enabled: BOT_CONFIG.ENABLED,
      maxPosition: BOT_CONFIG.MAX_POSITION,
      maxLoss: BOT_CONFIG.MAX_LOSS,
      minLiquidity: BOT_CONFIG.MIN_LIQUIDITY,
      maxSpread: BOT_CONFIG.MAX_SPREAD,
      maxSpreadBps: BOT_CONFIG.MAX_SPREAD_BPS,
      minTimeRemaining: BOT_CONFIG.MIN_TIME_REMAINING,
      minOrderSize: BOT_CONFIG.MIN_ORDER_SIZE,
      maxOrderSize: BOT_CONFIG.MAX_ORDER_SIZE,
      defaultOrderSize: BOT_CONFIG.DEFAULT_ORDER_SIZE,
      minNativeWei: BOT_CONFIG.MIN_NATIVE_WEI,
      minCollateralRaw: BOT_CONFIG.MIN_COLLATERAL_RAW,
    },
    marketScope: "all",
    label: "default",
    midMoveThreshold: MID_MOVE_CONFIG.MID_MOVE_ALERT_THRESHOLD,
    loopIntervalMs: BOT_CONFIG.LOOP_INTERVAL_MS,
  };
}

export function loadPersistedConfig(db: Database.Database): PersistedBotConfig {
  const row = db.prepare("SELECT data FROM bot_config WHERE id=1").get() as { data: string } | undefined;
  if (!row) return defaultPersistedConfig();
  try {
    const parsed = JSON.parse(row.data) as PersistedBotConfig;
    // Revive BigInt fields which were stringified
    const bot = parsed.bot as unknown as Record<string, unknown>;
    if (typeof bot.minNativeWei === "string") bot.minNativeWei = BigInt(bot.minNativeWei);
    if (typeof bot.minCollateralRaw === "string") bot.minCollateralRaw = BigInt(bot.minCollateralRaw);
    return parsed;
  } catch {
    return defaultPersistedConfig();
  }
}

export function savePersistedConfig(db: Database.Database, cfg: PersistedBotConfig): void {
  const serializable = {
    ...cfg,
    bot: {
      ...cfg.bot,
      minNativeWei: String(cfg.bot.minNativeWei),
      minCollateralRaw: String(cfg.bot.minCollateralRaw),
    },
  };
  const nowUnix = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO bot_config (id, data, updatedAtUnix) VALUES (1, @data, @updatedAtUnix)
     ON CONFLICT(id) DO UPDATE SET data=@data, updatedAtUnix=@updatedAtUnix`,
  ).run({ data: JSON.stringify(serializable), updatedAtUnix: nowUnix });
}
