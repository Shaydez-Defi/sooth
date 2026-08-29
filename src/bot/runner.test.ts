import { describe, it, expect } from "vitest";
import { BotRunner } from "./runner.js";
import { getBotPosition, getTotalRealizedPnL, countBotEvents } from "../snapshots/db.js";
import { logEvent } from "./events.js";
import fs from "node:fs";

// Mock EC factory for runner lifecycle without network
function makeMockEcFactory(): (withSigner: boolean) => import("@dreamdex-bot-kit/ec-core").EcContext {
  return (_withSigner: boolean) =>
    ({
      canTrade: true,
      config: { venueId: "0xmock", network: "testnet" } as unknown as import("@dreamdex-bot-kit/ec-core").EcContext["config"],
      exchange: {
        client: {
          getViemClient: () => ({
            // eslint-disable-next-line @typescript-eslint/require-await
            getBlockNumber: async () => 12345n,
            // eslint-disable-next-line @typescript-eslint/require-await
            getLogs: async () => [],
          }),
        },
        // eslint-disable-next-line @typescript-eslint/require-await
        close: async () => undefined,
      },
    } as unknown as import("@dreamdex-bot-kit/ec-core").EcContext);
}

describe("BotRunner — lifecycle, auto-stop, events, fills", () => {
  it("start/stop lifecycle — status() reflects running/stopped and loop halts", async () => {
    const runner = new BotRunner({ dbPath: ":memory:", ecFactory: makeMockEcFactory() });
    expect(runner.status()).toBe("stopped");
    await runner.start({ withSigner: false, loopIntervalMs: 50_000 });
    expect(runner.status()).toBe("running");
    expect(runner.getTickCount()).toBeGreaterThanOrEqual(0);
    // Event log has BOT_START
    const db = runner.getDb();
    const startEvents = db.prepare("SELECT * FROM bot_events WHERE eventType='BOT_START'").all() as Array<{ eventType: string }>;
    expect(startEvents.length).toBe(1);
    await runner.stop("test manual");
    expect(runner.status()).toBe("stopped");
    const stopEvents = db.prepare("SELECT * FROM bot_events WHERE eventType='BOT_STOP'").all() as Array<{ eventType: string }>;
    expect(stopEvents.length).toBe(1);
    runner.close();
  });

  it("loss-limit-triggered auto-stop (synthetic) — cost basis buy then EARLY_CLOSE sell realizes a real loss", () => {
    const runner = new BotRunner({ dbPath: ":memory:", ecFactory: makeMockEcFactory() });
    // Set maxLoss low, then buy 100 @0.60 and sell 100 @0.50 → realized loss of 10 tUSDC
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    runner.updateConfig({ bot: { ...runner.getConfig().bot, maxLoss: 5 } as unknown as import("../strategy/types.js").BotConfig });
    runner.simulateFill("0xabc", "ETH-TEST/tUSDC", 100, 0.6);
    runner.simulateFill("0xabc", "ETH-TEST/tUSDC", 100, 0.5, { side: "sell" });
    expect(getTotalRealizedPnL(runner.getDb())).toBeCloseTo(-10, 2);
    const reason = runner.checkAutoStopReason();
    expect(reason).not.toBeNull();
    expect(reason).toContain("loss limit");
    // start() should refuse when disabled? For loss limit, start still starts but tick will auto-stop.
    // We test that checkAutoStopReason is the trigger used by tick.
    runner.close();
  });

  it("event log records every tick outcome including SKIPs (synthetic tick via direct event log)", () => {
    const runner = new BotRunner({ dbPath: ":memory:" });
    const db = runner.getDb();
    // Simulate what tick does: log MARKET_EVALUATED + STRATEGY_DECISION + RISK_CHECK + EXECUTION for a SKIP
    logEvent(db, { marketId: "0xabc", symbol: "ETH-TEST/tUSDC", eventType: "MARKET_EVALUATED", data: { mid: 0.5 } });
    logEvent(db, { marketId: "0xabc", symbol: "ETH-TEST/tUSDC", eventType: "STRATEGY_DECISION", data: { action: "SKIP", reasons: ["edge < minEdge"] } });
    logEvent(db, { marketId: "0xabc", symbol: "ETH-TEST/tUSDC", eventType: "RISK_CHECK", data: { skipped: true } });
    logEvent(db, { marketId: "0xabc", symbol: "ETH-TEST/tUSDC", eventType: "EXECUTION", data: { executed: false, reason: "SKIP" } });
    const count = countBotEvents(db);
    expect(count).toBe(4);
    const rows = db.prepare("SELECT eventType FROM bot_events ORDER BY id").all() as Array<{ eventType: string }>;
    expect(rows.map((r) => r.eventType)).toEqual(["MARKET_EVALUATED", "STRATEGY_DECISION", "RISK_CHECK", "EXECUTION"]);
    runner.close();
  });

  it("fill-based position update builds weighted-average cost basis (buys do not realize until exit/settlement)", () => {
    const runner = new BotRunner({ dbPath: ":memory:" });
    expect(getBotPosition(runner.getDb(), "0xabc")).toBeUndefined();
    runner.simulateFill("0xabc", "ETH-TEST/tUSDC", 2, 0.6); // buy 2 @ 0.6
    const pos = getBotPosition(runner.getDb(), "0xabc");
    expect(pos).toBeDefined();
    expect(pos?.netPosition).toBeCloseTo(2, 2);
    expect(pos?.totalSize).toBeCloseTo(2, 2);
    expect(pos?.avgEntryPrice).toBeCloseTo(0.6, 6);
    // buys cannot realize P&L — that happens at EARLY_CLOSE (sell) or SETTLEMENT
    expect(pos?.realizedPnL).toBeCloseTo(0, 2);
    expect(pos?.status).toBe("OPEN");
    // Second fill adds at a different price → quantity-weighted average entry
    runner.simulateFill("0xabc", "ETH-TEST/tUSDC", 1, 0.55);
    const pos2 = getBotPosition(runner.getDb(), "0xabc");
    expect(pos2?.netPosition).toBeCloseTo(3, 2);
    expect(pos2?.totalSize).toBeCloseTo(3, 2);
    expect(pos2?.avgEntryPrice).toBeCloseTo((0.6 * 2 + 0.55 * 1) / 3, 6);
    expect(pos2?.realizedPnL).toBeCloseTo(0, 2);
    expect(getTotalRealizedPnL(runner.getDb())).toBeCloseTo(0, 2);
    // Event log has FILL_OBSERVED
    const fills = runner.getDb().prepare("SELECT * FROM bot_fills").all() as Array<{ marketId: string }>;
    expect(fills.length).toBe(2);
    const events = runner.getDb().prepare("SELECT * FROM bot_events WHERE eventType='FILL_OBSERVED'").all() as Array<{ eventType: string }>;
    expect(events.length).toBeGreaterThanOrEqual(2);
    runner.close();
  });

  it("BOT_START and BOT_STOP events are persisted and survives restart via SQLite file", async () => {
    const tmpPath = `/tmp/bot-restart-test-${Date.now()}.db`;
    const r1 = new BotRunner({ dbPath: tmpPath, ecFactory: makeMockEcFactory() });
    await r1.start({ withSigner: false, loopIntervalMs: 60_000 });
    await r1.stop("test");
    r1.close();
    // Reopen same file, config and events should persist
    const r2 = new BotRunner({ dbPath: tmpPath });
    const events = r2.getDb().prepare("SELECT eventType FROM bot_events ORDER BY id").all() as Array<{ eventType: string }>;
    expect(events.some((e) => e.eventType === "BOT_START")).toBe(true);
    expect(events.some((e) => e.eventType === "BOT_STOP")).toBe(true);
    // Config persisted: change scope in r1, see in r2
    r2.updateConfig({ marketScope: "0xabc" });
    r2.close();
    const r3 = new BotRunner({ dbPath: tmpPath });
    expect(r3.getConfig().marketScope).toBe("0xabc");
    r3.close();
    // Cleanup
    try {
      fs.unlinkSync(tmpPath);
      fs.unlinkSync(`${tmpPath}-wal`);
      fs.unlinkSync(`${tmpPath}-shm`);
    } catch {
      // ignore
    }
  });
});
