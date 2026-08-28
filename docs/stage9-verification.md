# Stage 9 Verification — Settlement, Realization, Win Rate, Realized Edge & Adverse Selection

**Date (UTC):** 2026-08-28. Based on `main` HEAD `7857fcf` (stage8).

**Script:** `src/scripts/stage9-verify.ts` — `npm run stage9:verify` (`package.json:24` → `tsx src/scripts/stage9-verify.ts`).
**Modules exercised:** `src/bot/settlementPoller.ts` (`runSettlementPoll` @:96, `createEcSettlementResolver` @:51), `src/snapshots/db.ts` (temp DB + `insertBotFill`/`upsertBotPosition`), `src/analytics/edge.ts` (`computeEdgeAnalytics` @:104).

> **Methodology / STOP-CONDITIONS statement.** The bot is read-only and has **no signed order fills** in this environment — `bot_fills` and `bot_positions` in `data/snapshots.db` are empty. Per the brief's STOP CONDITIONS ("if the real bot DB genuinely has 0 fills, say so explicitly and prove the logic via synthetic fills against real settled markets — no claim of live proof"), this verification:
> 1. pulls **REAL** settled Event-Contract binary markets and **REAL** on-chain resolution flags (LIVE_INDEXER + LIVE_ONCHAIN),
> 2. reads **REAL** order-book/snapshot mid history from `data/snapshots.db` (produced by the Stage "logger" `snapshot-logger.ts` at 45s cadence), and
> 3. seeds **SYNTHETIC** entry/exit positions+fills **only in a throwaway temp SQLite DB** (never `data/snapshots.db`) to exercise the exact same settlement/realization/P&L and edge-analytics code paths.

## REAL data sources

| Signal | Source | Env var | Where read in script |
|---|---|---|---|
| Settled markets list (`Finalized`) | `LIVE_INDEXER` GraphQL | `VENUE_ID` (fallback `0x6799…`) | §3 `listBinaryMarkets` |
| `isResolved` / `isVoided` / `winningOutcome` | `LIVE_ONCHAIN` via viem `getViemClient` | `RPC_URL`/`NETWORK=testnet` | §4 `getMarketOnchain` via resolver |
| Order-book mid history | `data/snapshots.db` `snapshots` table | `SNAPSHOT_DB_PATH` (default `data/snapshots.db`) | §2 copy of the single most-sampled market |
| Resolution status cache | `resolver` memoizes on-chain results | — | `createEcSettlementResolver` @:51 |

Entry prices are **HISTORICAL** (`lastPrice/1e6` from the indexer row) when present, otherwise **ESTIMATED** at a documented `0.5`. SYNTHETIC fills use `rawData.simulated = true` and a `tag` of `SYNTHETIC …` so they can never be mistaken for live trading.

## The 8 stages the script runs

**§1 — Census.** Counts `bot_fills`, `bot_positions`, `snapshots` in the *real* DB and prints the STOP-CONDITION note (`real fills=0 → proven via synthetic against real settled markets`).

**§2 — Temp DB snapshot.** Creates `/tmp/stage9-verify-<ts>.db`, `ATTACH`es the real DB, copies that market's snapshot rows, then `DETACH`s — so later joins use the real mid series but writes go nowhere near `data/snapshots.db`.

**§3 — REAL markets → SYNTHETIC positions.** Iterates `Finalized` markets, calls `getMarketOnchain`, skips rows where `!isResolved && !isVoided`, then `upsertBotPosition(tmpDb, …)` with alternating `YES`/`NO` sides to exercise both payout legs of `computeSettlementPnL`.

**§4 — Settlement poll against real state.** `runSettlementPoll(tmpDb, { resolve: createEcSettlementResolver(ctx) })` checks every open position's on-chain resolution. Output fields per realized position:

```
marketId, symbol, side, avgEntryPrice, size, winningOutcome, voided, realizedPnLDelta
```

Resolution mapping (`outcomeOf`): `voided ⇒ "VOIDED"`, `winningOutcome===0 ⇒ "YES"`, `===1 ⇒ "NO"`, else `"?"`.

**§5 — EARLY_CLOSE.** Inserts a synthetic `sell` exit fill via `insertBotFill(tmpDb, { … rawData:{simulated:true, tag:"SYNTHETIC early-close verification"} })` and reads back `status`/`realizationSource`/`realizedPnL` from `bot_positions` to demonstrate the fill → basis → realized-P&L path (fills are matched to `OPEN` positions in `positions.ts`).

**§6 — Edge analytics.** `computeEdgeAnalytics(tmpDb)` emits, over the temp DB:

- `winRate` = winning / resolved (null if 0 resolved)
- `realizedEdge` = grossPnL / resolved (sample mean edge of closed trades)
- `grossPnL` = Σ realizedPnL (realization basis = avg entry price per the brief)
- `adverseSelection` = (realizedPnL on adverse-exit fills) / (fills count) — joined to the real snapshot mid at `blockNumber`
- `maximumDrawdown` / `averageEdge` (equity-curve based)
## Realization P&L formula

From `src/bot/settlementPoller.ts:130` `computeSettlementPnL({side, avgEntryPrice, size, winningOutcome, voided})`:
binary outcome, `voided ⇒ 0` payout; winning leg `YES(0)` pays `1 - avgEntryPrice`, losing leg `NO(1)` pays `avgEntryPrice` (both × `size`). Net `realizedPnLDelta` is per-fill; `realizedPnL` on the position row is **cumulative** across settlements + early closes (additive, realized-basis = avg entry price per the brief).

## Expected output (shape)

```
[CENSUS] real bot_fills=0 bot_positions=0 snapshots=N
[STOP-CONDITION] … live proof does not exist (yet).
[SNAPSHOTS] copied M REAL rows for <SYM> into temp db /tmp/...
[EC] exchange created — network=testnet venue=0x6799… indexer=https://dev.smk.somnia.host/v1/graphql
[HISTORICAL] listBinaryMarkets Finalized → K real settled markets
[SYNTHETIC] built L OPEN positions (size 1) against REAL settled markets; S skipped
[SETTLEMENT_POLL] checked=L realized=R stillOpen=O errors=E
  [REALIZED] <SYM> YES size=1 avg=0.5000 outcome=YES pnl=+0.5000
[EARLY_CLOSE] SYNTHETIC sell … → status=CLOSED source=EARLY_CLOSE cumulativeRealizedPnL=…
[EDGE_ANALYTICS] status=OK fills=F positions=P
  winRate=… realizedEdge=… grossPnL=… adverseSelection=… maxDrawdown=…
[VERIFICATION_JSON] { … }
[OK] verification complete — real bot DB untouched.
```

## Reproducing / running

```bash
NETWORK=testnet \
npx tsx src/scripts/stage9-verify.ts
```

Needs `data/snapshots.db` to exist (run `npm run snapshot` first if missing). No write access to the real DB is required; the script only attaches it read-only for the mid-history copy.

## What this does / does not prove

- ✅ The full settlement pipeline (`runSettlementPoll` → `computeSettlementPnL` → `patchBotPosition` + `logEvent` → `SETTLEMENT_REALIZED` event) is exercised end-to-end against **real on-chain resolution flags**.
- ✅ The edge-analytics schema (`computeEdgeAnalytics`) produces winRate / realizedEdge / adverseSelection / drawdown over that data.
- ✅ Realization is additive and additive-realizedPnL is cumulative.
- 🚫 Does **not** prove live P&L of a position the bot actually opened — because the bot has 0 real fills. That is a documented, deliberate negative result, not a gap to paper over.

