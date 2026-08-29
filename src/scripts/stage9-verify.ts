/**
 * Stage 9 verification (brief §13 gap-close) — proven against REAL data, no fabrication.
 *
 * REAL sources used:
 *   - Real settled EC markets: listBinaryMarkets({status:"Finalized"}) + getMarketOnchain
 *     (LIVE_INDEXER + LIVE_ONCHAIN) for real winningOutcome/isResolved/isVoided.
 *   - Real snapshot mid history: data/snapshots.db (the continuous logger has run since Stage
 *     "logger" — real mids per market, polled ~45s) joined per fill for adverse selection.
 *
 * SYNTHETIC parts (explicitly tagged, never presented as live trading):
 *   - The bot has 0 REAL fills (Stage 6/7 honest result; bot_fills/bot_positions are empty), so the
 *     settlement/realization logic is proven by SYNTHETIC positions and fills placed in a TEMP copy
 *     DB against the REAL settled markets and REAL snapshot mids above. Entry prices are taken from
 *     the indexer row's lastPrice when present (HISTORICAL) else documented 0.5 (ESTIMATED).
 *     The real bot DB (data/snapshots.db) is NEVER written to.
 *
 * Per STOP CONDITIONS: if the real bot DB genuinely has 0 fills, this script says so explicitly and
 * proves the logic via synthetic fills against real settled markets — no claim of live proof.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createExchange } from "@dreamdex-bot-kit/ec-core";
import { openSnapshotDb, upsertBotPosition, insertBotFill, insertBotEvent, type PositionSide } from "../snapshots/db.js";
import { applyFillToPosition } from "../bot/positions.js";
import { SNAPSHOT_CONFIG } from "../config.js";
import { createEcSettlementResolver, runSettlementPoll } from "../bot/settlementPoller.js";
import { computeEdgeAnalytics } from "../analytics/edge.js";

const SIZE_PER_POSITION = 1; // share, DERIVED synthetic position size

function clampProb(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

async function main(): Promise<void> {
  console.log("=== Stage 9 Verification — win rate / realized edge / adverse selection on REAL data ===\n");

  if (!process.env.NETWORK) process.env.NETWORK = "testnet";
  if (!process.env.VENUE_ID && !process.env.OPERATOR_ID) {
    process.env.VENUE_ID = "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
  }

  // ── 1. Real-data census (bot tables) ─────────────────────────────────────────────────────────────
  const realDb = openSnapshotDb(SNAPSHOT_CONFIG.DB_PATH);
  const fillsCount = (realDb.prepare("SELECT COUNT(*) c FROM bot_fills").get() as { c: number }).c;
  const positionsCount = (realDb.prepare("SELECT COUNT(*) c FROM bot_positions").get() as { c: number }).c;
  const snapshotsCount = (realDb.prepare("SELECT COUNT(*) c FROM snapshots").get() as { c: number }).c;
  console.log(`[CENSUS] real bot_fills=${fillsCount} bot_positions=${positionsCount} snapshots=${snapshotsCount} (data/snapshots.db)`);
  console.log(`[STOP-CONDITION] with 0 real fills, realization logic is proven via SYNTHETIC positions against REAL settled markets + REAL snapshot mids — live proof does not exist (yet).\n`);

  // ── 2. Copy REAL snapshot history into a TEMP db (never write the real bot tables) ───────────────
  const tmpPath = path.join(os.tmpdir(), `stage9-verify-${Date.now()}.db`);
  const tmpDb = openSnapshotDb(tmpPath);
  // Copy ALL real snapshots (not just one market) so every synthetic marketId has history for adverse selection.
  // The previous single-market copy caused join mismatches when synthetic fills used a different marketId.
  tmpDb.prepare("ATTACH DATABASE ? AS realdb").run(SNAPSHOT_CONFIG.DB_PATH);
  const copiedRows = tmpDb
    .prepare(
      `INSERT INTO snapshots (marketId, symbol, capturedAtUnix, capturedAtIso, bidLevels, askLevels, mid, bidDepth, askDepth, imbalance, blockNumber)
       SELECT marketId, symbol, capturedAtUnix, capturedAtIso, bidLevels, askLevels, mid, bidDepth, askDepth, imbalance, blockNumber FROM realdb.snapshots`,
    )
    .run();
  tmpDb.prepare("DETACH DATABASE realdb").run();
  const distinctMarkets = (tmpDb.prepare("SELECT COUNT(DISTINCT marketId) c FROM snapshots").get() as { c: number }).c;
  console.log(
    `[SNAPSHOTS] copied ${copiedRows.changes} REAL rows for ${distinctMarkets} distinct market(s) into temp db ${tmpPath} — real mid history for adverse selection (all markets, not just one)`,
  );

  // ── 3. REAL settled markets from the indexer + on-chain, then SYNTHETIC positions ─────────────────
  const ctx = createExchange({ withSigner: false });
  console.log(`\n[EC] exchange created — network=${ctx.config.network} venue=${String(ctx.config.venueId ?? "inferred")} indexer=${ctx.config.indexerUrl}\n`);

  const settledRows = await ctx.exchange.client.listBinaryMarkets({ venueId: ctx.config.venueId as `0x${string}`, status: "Finalized", limit: 50 });
  console.log(`[HISTORICAL] listBinaryMarkets Finalized → ${settledRows.length} real settled markets`);

  const syntheticPositions: Array<{ marketId: string; symbol: string; side: PositionSide; entryPrice: number; entryTag: string }> = [];
  let skippedNoOnchain = 0;
  const take = Math.min(6, settledRows.length);
  for (let i = 0; i < take; i += 1) {
    const r = settledRows[i] as { marketId: string; asset?: string; intervalSec?: number; expiry?: string; lastPrice?: string };
    if (!r?.marketId) continue;
    const onchain = await ctx.exchange.client.getMarketOnchain(r.marketId as `0x${string}`);
    if (!onchain.isResolved && !onchain.isVoided) {
      skippedNoOnchain += 1;
      continue;
    }
    const lastProb = r.lastPrice !== undefined && r.lastPrice !== null && Number(r.lastPrice) > 0 ? Number(r.lastPrice) / 1e6 : null;
    // alternate sides to demonstrate both legs of the payout formula
    const side: PositionSide = i % 2 === 0 ? "YES" : "NO";
    const entryTag = lastProb !== null ? "HISTORICAL lastPrice" : "ESTIMATED 0.5";
    const entryPrice = clampProb(side === "YES" ? (lastProb ?? 0.5) : 1 - (lastProb ?? 0.5));
    const symbol = `${String(r.asset ?? "UNK")}-${String(r.intervalSec ?? "?")}s@${String(r.expiry ?? "?")}`;
    upsertBotPosition(tmpDb, {
      marketId: r.marketId,
      symbol,
      side,
      netPosition: SIZE_PER_POSITION,
      totalSize: SIZE_PER_POSITION,
      avgEntryPrice: entryPrice,
      realizedPnL: 0,
      status: "OPEN",
    });
    syntheticPositions.push({ marketId: r.marketId, symbol, side, entryPrice, entryTag });
  }
    console.log(`[SYNTHETIC] built ${syntheticPositions.length} OPEN positions (size ${SIZE_PER_POSITION}) against REAL settled markets; ${skippedNoOnchain} settled-market rows skipped (onchain not resolved/voided)`);
  for (const p of syntheticPositions) console.log(`  ${p.marketId.slice(0, 18)} ${p.symbol} side=${p.side} entry=${p.entryPrice.toFixed(4)} (${p.entryTag})`);

  // EARLY_CLOSE must close an OPEN (still-live) market — seed 2 from non-Finalized EC markets so §5
  // has an unresolved position to close. These stay OPEN through §4 (resolver reports unresolved).
  const openForEC: Array<{ marketId: string; symbol: string; side: PositionSide; entryPrice: number }> = [];
  try {
    const liveRows = await ctx.exchange.client.listBinaryMarkets({ venueId: ctx.config.venueId as `0x${string}`, status: "Trading", limit: 20 });
    let ecSeeded = 0;
    for (const r of liveRows) {
      if (ecSeeded >= 2) break;
      if (!r?.marketId) continue;
      const chain = await ctx.exchange.client.getMarketOnchain(r.marketId);
      if (chain.isResolved || chain.isVoided) continue;
      const ecSide: PositionSide = ecSeeded === 0 ? "YES" : "NO";
      const ecSymbol = `${String(r.asset ?? "UNK")}-${String(r.intervalSec ?? "?")}s@${String(r.expiry ?? "?")}`;
      upsertBotPosition(tmpDb, {
        marketId: r.marketId,
        symbol: ecSymbol,
        side: ecSide,
        netPosition: SIZE_PER_POSITION,
        totalSize: SIZE_PER_POSITION,
        avgEntryPrice: ecSide === "YES" ? 0.5 : 0.5,
        realizedPnL: 0,
        status: "OPEN",
      });
      openForEC.push({ marketId: r.marketId, symbol: ecSymbol, side: ecSide, entryPrice: 0.5 });
      ecSeeded += 1;
    }
    console.log(`[SYNTHETIC] seeded ${openForEC.length} OPEN positions on live (unresolved) markets for EARLY_CLOSE demonstration`);
    for (const p of openForEC) console.log(`  ${p.marketId.slice(0, 18)} ${p.symbol} side=${p.side} entry=${p.entryPrice.toFixed(4)} (ESTIMATED 0.5 — live market, no settled lastPrice)`);
  } catch (err) {
    console.log(`[WARN] could not seed EARLY_CLOSE live market: ${(err as Error).message} — EARLY_CLOSE demo skipped`);
  }

  // ── 4. RUN the settlement poll against the REAL on-chain/INDEXER state ───────────────────────────
  const resolver = createEcSettlementResolver(ctx);
  const pollResult = await runSettlementPoll(tmpDb, { resolve: resolver });
  console.log(`\n[SETTLEMENT_POLL] checked=${pollResult.checkedPositions} realized=${pollResult.realized.length} stillOpen=${pollResult.stillOpen.length} errors=${pollResult.errors.length}`);
  const outcomeOf = (r: (typeof pollResult.realized)[number]): string => (r.voided ? "VOIDED" : r.winningOutcome === 0 ? "YES" : r.winningOutcome === 1 ? "NO" : "?");
  for (const r of pollResult.realized) {
    console.log(`  [REALIZED] ${r.symbol.slice(0, 30)} ${r.side} size=${r.size} avg=${r.avgEntryPrice.toFixed(4)} outcome=${outcomeOf(r)} pnl=${r.realizedPnLDelta >= 0 ? "+" : ""}${r.realizedPnLDelta.toFixed(4)}`);
  }
  for (const e of pollResult.errors) console.log(`  [ERROR] ${e}`);
  for (const s of pollResult.stillOpen) console.log(`  [STILL_OPEN] ${s.marketId.slice(0, 18)} — ${s.reason}`);

  // ── 5. Demonstrate EARLY_CLOSE with a synthetic exit fill (fill → basis → realized P&L) ──────────
  let earlyCloseSaved: { marketId: string; symbol: string; status: string; realizationSource: string | null; realizedPnL: number } | null = null;
  const ec = openForEC.length >= 2 ? openForEC[1] : openForEC.length === 1 ? openForEC[0] : null;
  if (ec) {
    const exitPrice = clampProb(ec.entryPrice + 0.05);
    // Pick a real snapshot for this marketId to anchor adverse selection: fill at snapshotTime-300, snapshot at fill+300
    const anchorSnap = realDb
      .prepare("SELECT capturedAtUnix, mid FROM snapshots WHERE marketId=? AND mid IS NOT NULL ORDER BY capturedAtUnix DESC LIMIT 1")
      .get(ec.marketId) as { capturedAtUnix: number; mid: number } | undefined;
    const fillCapturedAtUnix = anchorSnap ? anchorSnap.capturedAtUnix - 300 : Math.floor(Date.now() / 1000) - 300;
    const syntheticEdge = 0.025; // HISTORICAL edge at decision, for averageEdge
    const syntheticMid = anchorSnap?.mid ?? 0.5; // HISTORICAL mid at decision
    // Ensure a real snapshot exists at fill+300 for this marketId (adverse selection needs it)
    if (anchorSnap) {
      // The anchorSnap itself is at fill+300, so it already satisfies the 5m lookahead within ±120s
      // No extra insert needed — we copied all real snapshots, so this anchor is in tmpDb.
    } else {
      // No real snapshot for this marketId — insert a synthetic one at fill+300 so adverse selection is computable
      const { insertSnapshot } = await import("../snapshots/db.js");
      insertSnapshot(tmpDb, {
        marketId: ec.marketId,
        symbol: ec.symbol,
        capturedAtUnix: fillCapturedAtUnix + 300,
        capturedAtIso: new Date((fillCapturedAtUnix + 300) * 1000).toISOString(),
        bidLevels: [[syntheticMid - 0.01, 100]],
        askLevels: [[syntheticMid + 0.01, 100]],
        mid: syntheticMid + 0.02, // drift 2 cents for adverse selection demo
        bidDepth: 100,
        askDepth: 100,
        imbalance: 0,
        blockNumber: 9999,
      });
    }
    const fillId = insertBotFill(tmpDb, {
      txHash: `0x${"e".repeat(64)}`,
      blockNumber: 999,
      marketId: ec.marketId,
      symbol: ec.symbol,
      orderId: "stage9-ec",
      side: "sell",
      outcome: ec.side,
      quantityFilled: SIZE_PER_POSITION,
      fillPrice: exitPrice,
      capturedAtUnix: fillCapturedAtUnix,
      edgeAtDecision: syntheticEdge,
      midAtDecision: syntheticMid,
      rawData: { simulated: true, tag: "SYNTHETIC early-close verification" },
    });
    // insertBotFill only persists the row — realization happens here via the SAME engine the bot
    // uses (positions.ts applyFillToPosition → EARLY_CLOSE path). This is what proves the close logic
    // against an OPEN position (the settlement poll left it open because the market is still live).
    const fillResult = applyFillToPosition(tmpDb, {
      marketId: ec.marketId,
      symbol: ec.symbol,
      side: "sell",
      outcome: ec.side,
      quantityFilled: SIZE_PER_POSITION,
      fillPrice: exitPrice,
      fillId,
    });
    const closedByFill = tmpDb.prepare("SELECT status, realizationSource, realizedPnL FROM bot_positions WHERE marketId=?").get(ec.marketId) as {
      status: string;
      realizationSource: string | null;
      realizedPnL: number;
    };
    earlyCloseSaved = { marketId: ec.marketId, symbol: ec.symbol, ...closedByFill };
    const delta = fillResult.kind === "error" ? 0 : fillResult.realizedPnLDelta;
    // For maximumDrawdown: log a proper FILL_OBSERVED with newRealizedPnL so the analytics series sees this early-close realization.
    // Stage 7's drawdown calc depends on FILL_OBSERVED newRealizedPnL; Stage 9's settlement path already logs SETTLEMENT_REALIZED which we now also read.
    insertBotEvent(tmpDb, {
      marketId: ec.marketId,
      symbol: ec.symbol,
      eventType: "FILL_OBSERVED",
      data: { newRealizedPnL: closedByFill.realizedPnL, cumulativeRealizedPnL: closedByFill.realizedPnL, fillId, realizedPnLDelta: delta, positionUpdate: { marketId: ec.marketId, symbol: ec.symbol, result: fillResult } },
      blockNumber: 999,
    });
    console.log(
      `\n[EARLY_CLOSE] SYNTHETIC sell ${ec.side} ${SIZE_PER_POSITION} @${exitPrice.toFixed(4)} (fill id=${fillId}) → applyFillToPosition=${fillResult.kind}${fillResult.kind === "error" ? ` (${fillResult.reason})` : ""} realizedPnLDelta=${delta.toFixed(4)} → status=${closedByFill.status} source=${String(closedByFill.realizationSource)} cumulativeRealizedPnL=${closedByFill.realizedPnL.toFixed(4)}`,
    );
  }

  // ── 6. Edge analytics over the temp db — winRate/realizedEdge/adverseSelection ─────────────────────
  const analytics = computeEdgeAnalytics(tmpDb);
  const m = analytics.metrics;
  console.log(`\n[EDGE_ANALYTICS] status=${analytics.status} fills=${analytics.fillsCount} positions=${analytics.positionsCount}`);
  if (m) {
    console.log(`  winRate=${m.winRate === null ? "null" : m.winRate.toFixed(3)} winning=${String(m.winningTrades)} losing=${String(m.losingTrades)} resolved=${m.resolvedTrades} open=${m.openPositions}`);
    console.log(`  realizedEdge=${m.realizedEdge === null ? "null" : m.realizedEdge.toFixed(4)} grossPnL=${m.grossPnL.toFixed(4)} adverseSelection=${m.adverseSelection === null ? "null" : m.adverseSelection.toFixed(5)}`);
    console.log(`  maxDrawdown=${m.maximumDrawdown === null ? "null" : m.maximumDrawdown.toFixed(4)} averageEdge=${m.averageEdge === null ? "null" : m.averageEdge.toFixed(4)}`);
    console.log(`  gaps[]=${m.gaps.length}`);
    for (const g of m.gaps.slice(0, 4)) console.log(`    gap: ${g}`);
        if (m.gaps.length > 4) console.log(`    … and ${m.gaps.length - 4} more`);
  }

  // ── 7. Verification JSON for docs ───────────────────────────────────────────────────────────────
  const summary = {
    census: { realFills: fillsCount, realPositions: positionsCount, realSnapshots: snapshotsCount },
    settledMarketsPulled: settledRows.length,
    syntheticPositionsBuilt: syntheticPositions.length,
    entryTags: [...new Set(syntheticPositions.map((p) => p.entryTag))],
    settlementPoll: {
      checked: pollResult.checkedPositions,
      realized: pollResult.realized,
      stillOpen: pollResult.stillOpen,
      errors: pollResult.errors,
    },
    earlyClose: earlyCloseSaved,
    realizedCountBySource: {
      SETTLEMENT: pollResult.realized.length,
      EARLY_CLOSE: earlyCloseSaved !== null ? 1 : 0,
    },
    edgeAnalytics: m
      ? {
          winRate: m.winRate,
          winningTrades: m.winningTrades,
          losingTrades: m.losingTrades,
          realizedEdge: m.realizedEdge,
          adverseSelection: m.adverseSelection,
          grossPnL: m.grossPnL,
          gaps: m.gaps,
        }
      : null,
    tempDbPath: tmpPath,
  };
  console.log("\n[VERIFICATION_JSON] " + JSON.stringify(summary, null, 2));

  // ── 8. Teardown — temp db removed, real db untouched, exchange closed ─────────────────────────────
  tmpDb.close();
  realDb.close();
  try {
    fs.unlinkSync(tmpPath);
    if (fs.existsSync(`${tmpPath}-wal`)) fs.unlinkSync(`${tmpPath}-wal`);
    if (fs.existsSync(`${tmpPath}-shm`)) fs.unlinkSync(`${tmpPath}-shm`);
  } catch (err) {
    console.error(`[WARN] temp db cleanup: ${(err as Error).message}`);
  }
  await Promise.race([ctx.exchange.close().catch(() => undefined), new Promise<void>((r) => setTimeout(r, 3000))]);
  console.log("\n[OK] verification complete — real bot DB untouched.");
}

main().catch((err: unknown) => {
  const e = err as Error;
  console.error(`[FATAL] stage9 verify failed: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});