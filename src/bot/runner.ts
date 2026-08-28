/**
 * Bot Runner — continuous loop: market data → strategy → risk → execution → fill monitor → position.
 * Real-time preference (brief §11):
 * - Spot DreamDexWs exposes subscribeOrderbook/subscribeTrades (ws.ts:82) — EC does NOT.
 *   Grep vendor/dreamdex-bot-kit/packages/ec-core/src → no subscribeOrderbook, no watchOrderBook wrapper;
 *   EC SDK's SomniaMarkets has wsRpcUrl + fetchPrice/watchPrice (underlying BTC/ETH spot via priceFeed),
 *   but no order-book WS. All EC strategies use poll: activeMarkets + fetchOrderBook every tick.
 *   Conclusion: EC is poll-only for order-book; we poll (fetchOrderBook + activeMarkets).
 * - For fills: per Stage 1, prefer on-chain OrderFilled events over REST/indexer which can lag.
 *   We poll on-chain logs via viem getLogs on each market's pool address with TOPIC OrderFilled
 *   (0xc87f...), not REST. Real-time watchEvent would be ideal but EC pool addresses are per-market
 *   and viem watchEvent per-pool would fan out; polling getLogs per tick is deterministic and Codespace-safe.
 */

import { createExchange, activeMarkets, marketOnchain, outcomeSymbols } from "@dreamdex-bot-kit/ec-core";
import { analyzeMarket } from "../analysis/engine.js";
import { edgeThresholdStrategy } from "../strategy/edgeThreshold.js";
import { runPipeline } from "../strategy/pipeline.js";
import type { BotConfig, StrategyContext } from "../strategy/types.js";
import { ANALYSIS_CONFIG, SNAPSHOT_CONFIG } from "../config.js";
import { openSnapshotDb, getTotalRealizedPnL, getBotPositions, insertBotFill, upsertBotPosition, getBotPosition } from "../snapshots/db.js";
import { logEvent } from "./events.js";
import { loadPersistedConfig, savePersistedConfig, type PersistedBotConfig } from "./config.js";
import { checkMidMove } from "./midMove.js";
import { readBalancesTagged, createOrderState } from "../ec/orderLifecycle.js";
import type Database from "better-sqlite3";
import type { EcContext } from "@dreamdex-bot-kit/ec-core";
import type { MarketOnchain, UnifiedMarket } from "@somnia-chain/markets-sdk";

// OrderFilled topic (6-arg signature) — shared EC/spot OrderBook core
// TOPIC.OrderFilled = 0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399
const ORDER_FILLED_TOPIC = "0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399" as const;

export type RunnerStatus = "running" | "stopped";

export interface RunnerOptions {
  readonly dbPath?: string;
  readonly withSigner?: boolean;
  readonly loopIntervalMs?: number;
  readonly marketScope?: string; // "all" or marketId
}

export class BotRunner {
  private db: Database.Database;
  private ecCtx: EcContext | null = null;
  private statusValue: RunnerStatus = "stopped";
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private lastFillBlock: bigint | null = null;
  private orderState = createOrderState();
  private stopping = false;
  private ecFactory: ((withSigner: boolean) => EcContext) | null = null;

  constructor(opts: RunnerOptions & { ecFactory?: (withSigner: boolean) => EcContext } = {}) {
    const dbPath = opts.dbPath ?? SNAPSHOT_CONFIG.DB_PATH;
    this.db = openSnapshotDb(dbPath);
    this.ecFactory = opts.ecFactory ?? null;
  }

  /** Test helper: inject mock EC context without network. */
  injectEcContextForTest(ctx: EcContext, lastFillBlock?: bigint): void {
    this.ecCtx = ctx;
    if (lastFillBlock !== undefined) this.lastFillBlock = lastFillBlock;
  }

  /** Check auto-stop conditions (loss limit or disabled) — returns reason if should stop, else null. Used by tick and tests. */
  checkAutoStopReason(): string | null {
    const cfg = this.getConfig();
    if (!cfg.bot.enabled) return "auto-stop: bot disabled";
    const totalPnL = getTotalRealizedPnL(this.db);
    const currentLoss = totalPnL < 0 ? -totalPnL : 0;
    if (currentLoss >= cfg.bot.maxLoss) return `auto-stop: loss limit ${currentLoss.toFixed(2)} >= ${cfg.bot.maxLoss}`;
    return null;
  }

  status(): RunnerStatus {
    return this.statusValue;
  }

  getTickCount(): number {
    return this.tickCount;
  }

  getDb(): Database.Database {
    return this.db;
  }

  /** Programmatic config surface (brief §7) — so REST layer has something real to call. */
  getConfig(): PersistedBotConfig {
    return loadPersistedConfig(this.db);
  }

  setConfig(cfg: PersistedBotConfig): void {
    savePersistedConfig(this.db, cfg);
  }

  /** Update loop interval or market scope without restart — persisted. */
  updateConfig(patch: Partial<PersistedBotConfig>): PersistedBotConfig {
    const cur = this.getConfig();
    const next: PersistedBotConfig = { ...cur, ...patch, bot: { ...cur.bot, ...(patch.bot as Partial<BotConfig> | undefined) } };
    this.setConfig(next);
    return next;
  }

  async start(opts: RunnerOptions = {}): Promise<void> {
    if (this.statusValue === "running") return;
    if (opts.marketScope) {
      this.updateConfig({ marketScope: opts.marketScope });
    }
    if (opts.loopIntervalMs !== undefined) {
      this.updateConfig({ loopIntervalMs: opts.loopIntervalMs });
    }
    // Bot disabled via config → do not start, log why
    const cfg = this.getConfig();
    if (!cfg.bot.enabled) {
      logEvent(this.db, {
        eventType: "AUTO_STOP_DISABLED",
        data: { reason: "bot disabled via config.enabled=false — start() refused", config: { enabled: cfg.bot.enabled } },
      });
      return;
    }

    if (!process.env.NETWORK) process.env.NETWORK = "testnet";
    if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
      process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
    }

    this.ecCtx = this.ecFactory ? this.ecFactory(opts.withSigner ?? true) : createExchange({ withSigner: opts.withSigner ?? true });
    try {
      const bn = await this.ecCtx.exchange.client.getViemClient().getBlockNumber();
      this.lastFillBlock = bn;
    } catch {
      this.lastFillBlock = null;
    }

    this.statusValue = "running";
    this.stopping = false;
    this.tickCount = 0;
    logEvent(this.db, {
      eventType: "BOT_START",
      data: { marketScope: cfg.marketScope, loopIntervalMs: cfg.loopIntervalMs, venueId: this.ecCtx.config.venueId, withSigner: Boolean(this.ecCtx.canTrade) },
      blockNumber: this.lastFillBlock !== null ? Number(this.lastFillBlock) : null,
    });
    console.log(`[BOT] started — scope=${cfg.marketScope} interval=${cfg.loopIntervalMs}ms venue=${String(this.ecCtx.config.venueId ?? "inferred")} withSigner=${String(this.ecCtx.canTrade)} block=${String(this.lastFillBlock ?? "—")}`);

    // Kick first tick immediately (no wait), then interval
    void this.tick().catch((err: unknown) => {
      console.error(`[BOT] tick failed: ${(err as Error).message}`);
    });
    const interval = this.getConfig().loopIntervalMs;
    this.timer = setInterval(() => {
      if (this.statusValue !== "running" || this.stopping) return;
      void this.tick().catch((err: unknown) => {
        console.error(`[BOT] tick failed: ${(err as Error).message}`);
      });
    }, interval);
    // Don't block process exit if only this timer remains
    if (this.timer && typeof (this.timer as unknown as { unref?: () => void }).unref === "function") {
      (this.timer as unknown as { unref: () => void }).unref();
    }
  }

  async stop(reason?: string): Promise<void> {
    if (this.statusValue === "stopped") return;
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.statusValue = "stopped";
    logEvent(this.db, {
      eventType: "BOT_STOP",
      data: { reason: reason ?? "manual stop", tickCount: this.tickCount },
    });
    console.log(`[BOT] stopped — reason=${reason ?? "manual"} ticks=${this.tickCount}`);
    if (this.ecCtx) {
      try {
        await Promise.race([this.ecCtx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 2000))]);
      } catch {
        // ignore
      }
      this.ecCtx = null;
    }
    this.stopping = false;
  }

  /** Single tick: discover → analyze → strategy → risk → execution → fill poll → mid-move observability */
  private async tick(): Promise<void> {
    if (!this.ecCtx || this.statusValue !== "running") return;
    const cfg = this.getConfig();

    // Stop conditions (brief §6 step 8): disabled or loss limit breached → auto-stop, don't keep looping
    if (!cfg.bot.enabled) {
      logEvent(this.db, { eventType: "AUTO_STOP_DISABLED", data: { reason: "config.enabled became false during run — auto-stop", tickCount: this.tickCount } });
      await this.stop("auto-stop: bot disabled");
      return;
    }
    const totalPnL = getTotalRealizedPnL(this.db);
    const currentLoss = totalPnL < 0 ? -totalPnL : 0;
    if (currentLoss >= cfg.bot.maxLoss) {
      logEvent(this.db, { eventType: "AUTO_STOP_LOSS_LIMIT", data: { reason: `loss limit breached: currentLoss ${currentLoss.toFixed(4)} >= maxLoss ${cfg.bot.maxLoss}`, totalPnL, currentLoss, maxLoss: cfg.bot.maxLoss } });
      await this.stop(`auto-stop: loss limit ${currentLoss.toFixed(2)} >= ${cfg.bot.maxLoss}`);
      return;
    }

    this.tickCount += 1;
    const tickStartUnix = Math.floor(Date.now() / 1000);
    const tickStartIso = new Date().toISOString();
    let blockNumber: number | null = null;
    try {
      const bn = await this.ecCtx.exchange.client.getViemClient().getBlockNumber();
      blockNumber = Number(bn);
    } catch {
      blockNumber = null;
    }

    logEvent(this.db, {
      eventType: "TICK",
      data: { tick: this.tickCount, tickStartIso, marketScope: cfg.marketScope, blockNumber, totalPnL, currentLoss },
      blockNumber,
    });

    let markets: UnifiedMarket[];
    try {
      markets = await activeMarkets(this.ecCtx);
    } catch (err) {
      logEvent(this.db, {
        eventType: "TICK",
        data: { tick: this.tickCount, error: `activeMarkets failed: ${(err as Error).message}` },
        blockNumber,
      });
      return;
    }

    // Market scope filter
    if (cfg.marketScope !== "all") {
      markets = markets.filter((m) => String((m.info as unknown as { marketId: string }).marketId) === cfg.marketScope);
    }

    console.log(`[BOT] tick #${this.tickCount} — ${markets.length} live market(s) block=${String(blockNumber ?? "—")} scope=${cfg.marketScope}`);

    // Balances for risk checks (LIVE_ONCHAIN)
    let balances: { nativeWei: bigint; tUsdcRaw: bigint } | undefined;
    try {
      if (this.ecCtx.canTrade) {
        const snap = await readBalancesTagged(this.ecCtx);
        balances = { nativeWei: snap.nativeWei, tUsdcRaw: snap.tUsdcRaw };
      }
    } catch {
      // balances stays undefined → risk will report funded/gas unavailable (honest)
    }

    // Positions for risk (from persisted fills)
    const positions = getBotPositions(this.db).map((p) => ({ marketId: p.marketId, symbol: p.symbol, side: "YES" as const, size: p.netPosition }));
    const strategyContextBase: StrategyContext = {
      config: cfg.bot,
      openPositions: positions,
      currentLoss,
      balances,
      nowSec: tickStartUnix,
    };

    for (const m of markets) {
      const info = m.info as unknown as { marketId: string };
      const marketId = String(info.marketId);
      const symbol = m.symbol;
      const { yes } = outcomeSymbols(m);

      // Fetch onchain + order book (poll, not WS — EC is poll-only per Step 1)
      let onchain: MarketOnchain | null = null;
      try {
        onchain = await marketOnchain(this.ecCtx, m);
      } catch (err) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "MARKET_EVALUATED",
          data: { error: `marketOnchain failed: ${(err as Error).message}` },
          blockNumber,
        });
        continue;
      }
      if (!onchain) {
        logEvent(this.db, { marketId, symbol, eventType: "MARKET_EVALUATED", data: { error: "marketOnchain returned null" }, blockNumber });
        continue;
      }

      let bids: [number, number][] = [];
      let asks: [number, number][] = [];
      try {
        const raw = await this.ecCtx.exchange.fetchOrderBook(yes, ANALYSIS_CONFIG.DEPTH_LEVELS);
        bids = raw.bids;
        asks = raw.asks;
      } catch (err) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "MARKET_EVALUATED",
          data: { error: `fetchOrderBook failed: ${(err as Error).message}` },
          blockNumber,
        });
        continue;
      }

      const bestBid = bids[0]?.[0];
      const bestAsk = asks[0]?.[0];
      const mid = bestBid !== undefined && bestAsk !== undefined ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk ?? null);
      const timeRemaining = Number(onchain.expiry) - tickStartUnix;

      const analysis = analyzeMarket({
        marketId,
        symbol,
        bids,
        asks,
        bestBid,
        bestAsk,
        marketProbability: mid ?? undefined,
        timeRemaining,
      });

      // 4b — Mid-move observability (does NOT feed strategy/risk, purely logged)
      // Compare current mid (LIVE_INDEXER) to most recent prior snapshot mid for same market
      checkMidMove(this.db, {
        marketId,
        symbol,
        currentMid: mid,
        currentBlockNumber: blockNumber,
      });

      logEvent(this.db, {
        marketId,
        symbol,
        eventType: "MARKET_EVALUATED",
        data: { analysis: { marketProbability: analysis.marketProbability, estimatedProbability: analysis.estimatedProbability, edge: analysis.edge, imbalance: analysis.imbalance, liquidity: analysis.liquidity, spread: analysis.spread, spreadBps: analysis.spreadBps, direction: analysis.direction, recommendation: analysis.recommendation, timeRemaining: analysis.timeRemaining, reasons: analysis.reasons }, mid, bids: bids.slice(0, 2), asks: asks.slice(0, 2) },
        blockNumber,
      });

      // Strategy → Risk → Execution via pipeline (real execution enabled)
      let pipelineResult: Awaited<ReturnType<typeof runPipeline>> | null = null;
      try {
        pipelineResult = await runPipeline(
          {
            analysis,
            strategy: edgeThresholdStrategy,
            strategyContext: strategyContextBase,
            ecCtx: this.ecCtx,
            market: m,
            onchain,
            state: this.orderState,
            yesSymbol: yes,
          },
        );
      } catch (err) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { error: `pipeline failed: ${(err as Error).message}`, analysis, tick: this.tickCount },
          blockNumber,
        });
        continue;
      }

      const decision = pipelineResult.decision;
      const risk = pipelineResult.risk;
      logEvent(this.db, {
        marketId,
        symbol,
        eventType: "STRATEGY_DECISION",
        data: { decision, analysisReasons: analysis.reasons, tick: this.tickCount },
        blockNumber,
      });
      if (risk === null) {
        // SKIP — short-circuit proven, risk not called
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "RISK_CHECK",
          data: { skipped: true, reason: "strategy SKIPs — risk not checked (short-circuit)" },
          blockNumber,
        });
      } else {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "RISK_CHECK",
          data: { approved: risk.approved, rejectionReasons: risk.rejectionReasons },
          blockNumber,
        });
      }

      if (pipelineResult.executed && pipelineResult.placeResult) {
        const pr = pipelineResult.placeResult;
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { executed: true, txHash: pr.txHash, blockNumber: String(pr.blockNumber), orderId: String(pr.orderId ?? ""), price: pr.price, size: pr.size },
          blockNumber: Number(pr.blockNumber),
        });
        console.log(`[BOT] tick #${this.tickCount} ${symbol} PLACED orderId=${String(pr.orderId ?? "?")} tx=${String(pr.txHash).slice(0, 18)}... block=${String(pr.blockNumber)}`);
      } else if (decision.action === "SKIP") {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { executed: false, reason: "SKIP — no execution", decision, risk },
          blockNumber,
        });
      } else if (risk && !risk.approved) {
        logEvent(this.db, {
          marketId,
          symbol,
          eventType: "EXECUTION",
          data: { executed: false, reason: "blocked by risk", rejectionReasons: risk.rejectionReasons, decision },
          blockNumber,
        });
      }
    }

    // Fill monitoring — poll on-chain OrderFilled logs for each market's pool since last block
    await this.pollFills(blockNumber);

    // Re-check stop conditions after tick (fills may have moved PnL)
    const postPnL = getTotalRealizedPnL(this.db);
    const postLoss = postPnL < 0 ? -postPnL : 0;
    if (postLoss >= cfg.bot.maxLoss) {
      logEvent(this.db, { eventType: "AUTO_STOP_LOSS_LIMIT", data: { reason: `post-tick loss limit: ${postLoss.toFixed(4)} >= ${cfg.bot.maxLoss}`, postPnL, postLoss } });
      await this.stop(`auto-stop: post-tick loss limit ${postLoss.toFixed(2)} >= ${cfg.bot.maxLoss}`);
    }
  }

  /** Poll on-chain OrderFilled logs for all live pools since lastFillBlock. */
  private async pollFills(currentBlockNumber: number | null): Promise<void> {
    if (!this.ecCtx || currentBlockNumber === null || this.lastFillBlock === null) {
      if (currentBlockNumber !== null && this.lastFillBlock === null) this.lastFillBlock = BigInt(currentBlockNumber);
      return;
    }
    const fromBlock = this.lastFillBlock + 1n;
    const toBlock = BigInt(currentBlockNumber);
    if (fromBlock > toBlock) return;

    let markets: UnifiedMarket[] = [];
    try {
      markets = await activeMarkets(this.ecCtx);
    } catch {
      return;
    }
    const cfg = this.getConfig();
    if (cfg.marketScope !== "all") {
      markets = markets.filter((m) => String((m.info as unknown as { marketId: string }).marketId) === cfg.marketScope);
    }

    for (const m of markets) {
      const info = m.info as unknown as { marketId: string };
      const marketId = String(info.marketId);
      const symbol = m.symbol;
      let pool: `0x${string}` | undefined;
      try {
        const oc = await marketOnchain(this.ecCtx, m);
        pool = oc?.pool;
      } catch {
        continue;
      }
      if (!pool) continue;
      try {
        const logs = await this.ecCtx.exchange.client.getViemClient().getLogs({
          address: pool,
          events: [
            {
              type: "event",
              name: "OrderFilled",
              inputs: [
                { name: "takerOrderId", type: "uint128", indexed: true },
                { name: "makerOrderId", type: "uint128", indexed: true },
                { name: "quantityFilled", type: "uint256" },
                { name: "takerRemainingQuantity", type: "uint256" },
                { name: "makerRemainingQuantity", type: "uint256" },
                { name: "fillPrice", type: "uint256" },
              ],
            },
          ] as const,
          fromBlock,
          toBlock,
        });
        // Also accept raw topic filter as fallback (if ABI decode fails, still try raw)
        if (logs.length === 0) {
          // Try raw topic query for OrderFilled on this pool (some EC deployments use same topic)
          const rawLogs = await this.ecCtx.exchange.client.getViemClient().getLogs({
            address: pool,
            fromBlock,
            toBlock,
          });
          const filtered = rawLogs.filter((l) => String(l.topics[0]).toLowerCase() === ORDER_FILLED_TOPIC.toLowerCase());
          for (const l of filtered) {
            // Avoid double-count if already handled via decoded path
            const txHash = String(l.transactionHash ?? "0x?");
            const blockNumber = Number(l.blockNumber ?? toBlock);
            const exists = this.db.prepare("SELECT id FROM bot_fills WHERE txHash=? AND blockNumber=?").get(txHash, blockNumber) as { id: number } | undefined;
            if (exists) continue;
            insertBotFill(this.db, { txHash, blockNumber, marketId, symbol, rawData: l });
            logEvent(this.db, { marketId, symbol, eventType: "FILL_OBSERVED", data: { txHash, blockNumber, rawLog: l, source: "raw topic" }, blockNumber });
            // Update position: naive +1 per fill (fill qty unknown from raw decode without ABI)
            this.updatePositionFromFill(marketId, symbol, 1, 0);
          }
          continue;
        }
        for (const l of logs) {
          const txHash = String((l as unknown as { transactionHash?: string }).transactionHash ?? "0x?");
          const blockNumber = Number((l as unknown as { blockNumber?: bigint }).blockNumber ?? toBlock);
          const exists = this.db.prepare("SELECT id FROM bot_fills WHERE txHash=? AND blockNumber=?").get(txHash, blockNumber) as { id: number } | undefined;
          if (exists) continue;
          const args = (l as unknown as { args?: { quantityFilled?: bigint; fillPrice?: bigint; takerOrderId?: bigint; makerOrderId?: bigint } }).args;
          const qty = args?.quantityFilled !== undefined ? Number(args.quantityFilled) / 1_000_000 : 1; // tUSDC 6dp approx
          const price = args?.fillPrice !== undefined ? Number(args.fillPrice) / 1_000_000 : null;
          insertBotFill(this.db, { txHash, blockNumber, marketId, symbol, orderId: String(args?.takerOrderId ?? ""), quantityFilled: qty, fillPrice: price, rawData: l });
          logEvent(this.db, { marketId, symbol, eventType: "FILL_OBSERVED", data: { txHash, blockNumber, args, qty, price }, blockNumber });
          this.updatePositionFromFill(marketId, symbol, qty, price);
        }
      } catch {
        // per-market log fetch failure — don't crash loop
      }
    }
    this.lastFillBlock = toBlock;
  }

  private updatePositionFromFill(marketId: string, symbol: string, quantityFilled: number, _fillPrice: number | null): void {
    const existing = getBotPosition(this.db, marketId);
    const net = (existing?.netPosition ?? 0) + quantityFilled;
    // For demo, realizedPnL not computed from fillPrice vs market — keep 0, rely on manual loss injection for auto-stop test
    const realizedPnL = existing?.realizedPnL ?? 0;
    upsertBotPosition(this.db, { marketId, symbol, netPosition: net, realizedPnL });
    logEvent(this.db, {
      marketId,
      symbol,
      eventType: "FILL_OBSERVED",
      data: { positionUpdate: { marketId, symbol, netPosition: net, quantityFilled, note: "position updated from OrderFilled event (LIVE_ONCHAIN)" } },
    });
  }

  /** For tests: simulate a fill to trigger position/loss update without on-chain logs. */
  simulateFill(marketId: string, symbol: string, quantityFilled: number, fillPrice: number | null, realizedPnLDelta: number): void {
    const txHash = `0x${"a".repeat(64)}`;
    const blockNumber = 999_999_999;
    insertBotFill(this.db, { txHash, blockNumber, marketId, symbol, orderId: "test", quantityFilled, fillPrice, rawData: { simulated: true } });
    const existing = getBotPosition(this.db, marketId);
    const net = (existing?.netPosition ?? 0) + quantityFilled;
    const realizedPnL = (existing?.realizedPnL ?? 0) + realizedPnLDelta;
    upsertBotPosition(this.db, { marketId, symbol, netPosition: net, realizedPnL });
    logEvent(this.db, {
      marketId,
      symbol,
      eventType: "FILL_OBSERVED",
      data: { simulated: true, quantityFilled, fillPrice, realizedPnLDelta, newNet: net, newRealizedPnL: realizedPnL },
      blockNumber,
    });
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
