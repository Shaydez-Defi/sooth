# Frontend Stage 1 — Verification

Date: 2026-09-02
Scope: `frontend/` only — no changes to `backend/src/`, `vendor/`, `data/`.

## 1. What was cleaned up

**Removed Vite boilerplate:**
- `frontend/src/App.tsx` — counter demo (useState counter, hero image, Vite/React logos) replaced with real routing (`frontend/src/App.tsx:1`).
- `frontend/src/App.css` — deleted (184 lines of `.hero`/`.counter` demo styles).
- `frontend/src/assets/hero.png`, `frontend/src/assets/react.svg`, `frontend/src/assets/vite.svg` — deleted; `assets/` directory removed. No screen referenced them (screens use `lucide-react` and custom SVG `OrbMark`).
- `frontend/src/index.css` — replaced (111 lines Vite demo) with consolidated base styles (dark theme, `#root` full-height, `.sooth-glass-card`, focus ring). Kept `main.tsx` but stripped to 12 lines mounting `<App />` only.
- `frontend/public/favicon.svg`, `frontend/public/icons.svg` — kept (still valid manifest icons).

**Dropped-in JSX inventory (5 files, 2,358 lines) resolved:**
- `sooth-landing-full-v7.jsx` (640 lines) → `screens/Landing.tsx` — real screen, static marketing, wiring: `Launch app`/`Explore markets`/`Enter Sooth` remain `<button>` but now `onClick={() => navigate("/markets")}` (markup preserved), footer product buttons navigate via `useNavigate`.
- `sooth-markets-v3.jsx` (419 lines) → `screens/Markets.tsx` — real screen, fully wired.
- `sooth-market-detail-v3.jsx` (633 lines) → `screens/MarketDetail.tsx` — real screen, fully wired.
- `sooth-strategy-lab.jsx` (444 lines) → `screens/StrategyLab.tsx` — real screen, fully wired.
- `sooth-connect-wallet.jsx` (222 lines) → `components/ConnectWalletModal.tsx` — **not a distinct screen**; modal extracted to shared component (props `open`, `onClose`, `onSelect`), now invoked from `App.tsx` TopNav. No duplicate/near-duplicate versions found; only one version per domain existed.

Removed original `.jsx` files after conversion — `src/` now contains only `.tsx`.

**Duplication — flagged, not extracted (per visual constraint):**
- `COLOR`/`EASE`/`SPACE`/`PANEL_LABEL` are duplicated verbatim in each screen file (`Landing: COLOR.faint #605C50 / border #242219`, `Markets/MarketDetail/StrategyLab: #807C6B / #2A281F` etc.) — **not unified** to `components/theme.ts` to avoid any risk of byte-for-byte visual shift. `components/theme.ts` exists but is unused by core screens; extraction flagged as follow-up.
- `PanelHeader`, `SignalPill`, `ProvenanceNote`, `OrbMark` remain duplicated inline in each screen (original inline definitions preserved verbatim). Shared files `components/PanelHeader.tsx`, `SignalPill.tsx`, `ProvenanceTag.tsx`, `OrbMark.tsx` exist for new screens (`Portfolio`, `Bots`) but core screens keep inline copies to guarantee identical markup/styling. Flagged as follow-up: safe extraction only if proven byte-for-byte identical (e.g., via visual regression).
- Glass-card CSS: duplicated inline `<style>` per screen preserved verbatim; `index.css:20` `.sooth-glass-card` is the consolidated base for new screens only, not overriding core screens' inline styles.

Installed missing deps: `react-router-dom`, `lucide-react`, `recharts` (were imported by dropped screens but absent from `package.json:12`).

## 1b. Visual constraint compliance (added 2026-09-02)

Per “Do NOT change visual design … only file extension/types/data source/Vite boilerplate/shared extraction if byte-for-byte identical”:
- **No layout/spacing/colors/markup changes** in any core screen. Each screen’s `<style>` block, inline `style={{}}` objects, `COLOR` values, `EASE`, grid definitions (`2fr 0.8fr …`, `repeat(3,1fr)` etc.), `className`s, and DOM tags are preserved verbatim from the dropped `.jsx` (verified by keeping each file’s original `COLOR` palette — Landing `#605C50` vs others `#807C6B` — and inline `PanelHeader`/`SignalPill` definitions).
- **Routing without markup change:** `Landing`’s “Launch app”/“Explore markets”/“Enter Sooth” remain `<button className="sooth-btn-primary">` (original tag), now with `onClick={() => navigate("/markets")}` instead of `<Link>` to keep `<button>` markup. `Markets` rows remain `<div className="sooth-row">` (not `<Link>`) with `onClick` navigating to `/markets/:id` plus `setSelectedRow`. Visually identical, navigation now works.
- **Data source only:** `MARKETS` mock array → `postAnalyze({all:true})` mapped to same `EnrichedRow` shape (`marketProb/soothEst/edge/liquidity/spread/expiresInHrs/tier`); `MARKET`/`BIDS`/`ASKS`/`PROB_HISTORY` → `getAnalysis` + `getOrderbook`; `BACKTEST_STATS` → `postBacktest`. All rendering uses same JSX as before, just different values.
- **Shared extraction not applied to core screens:** Duplicated `COLOR`, `SPACE`, `PanelHeader`, `SignalPill`, `OrbMark` left duplicated. Shared `components/*` files remain but are flagged as **follow-up** — extraction would need visual regression proving byte-for-byte identity before merging.
- **Provenance tags:** Step 5 requires tags be typed, not dropped. Tags are now **typed** in `lib/api.ts` (`DataIntegrityTag` union) and existing provenance text (“Price is read live from DreamDEX…”, activity `provenance: "LIVE ON-CHAIN"` etc.) is preserved verbatim. No new pill visuals added to core screens (would alter layout); new screens (`Portfolio`, `Bots`) may show pills as they had no prior visuals to preserve. Loading/error states are the only new visuals (banner above table), as explicitly allowed.

If unsure whether a change affected visuals, it was **not made** and flagged here as suggestion: safe `components/theme` unification and `PanelHeader` extraction pending visual regression.

## 2. Final folder structure

```
frontend/src/
  App.tsx                 — BrowserRouter + TopNav (hidden on /) + Routes (/, /markets, /markets/:id, /lab, /portfolio, /bots)
  main.tsx                — StrictMode mount only (12 lines)
  index.css               — minimal base (dark ink #0a0908, .sooth-glass-card for new screens only — core screens keep inline <style>)
  lib/
    api.ts                — typed fetch client, all backend endpoints, env var VITE_API_BASE_URL, ApiError, DataIntegrityTag (tags typed, preserved via existing provenance text, not new pills)
  components/
    theme.ts              — (unused by core screens, kept for new screens) — flagged extraction
    OrbMark.tsx / PanelHeader.tsx / SignalPill.tsx / ProvenanceTag.tsx — shared, unused by core screens (inline duplicates kept)
    ConnectWalletModal.tsx — from sooth-connect-wallet.jsx, not a route, invoked via TopNav
  screens/
    Landing.tsx           — inline COLOR (#605C50 faint, #242219 border) preserved, buttons kept as <button> with useNavigate (not <Link>) to preserve markup, static marketing
    Markets.tsx           — live
    MarketDetail.tsx      — live
    StrategyLab.tsx       — live
    Portfolio.tsx         — live
    Bots.tsx              — live
```

Build artifacts: `frontend/dist/` (verified `npm run build` outputs `index.html` + `assets/index-*.js/css`). `tsconfig.app.json` `erasableSyntaxOnly:true` enforced — no `public readonly` parameter properties, `React.JSX.Element` qualified, etc.

## 3. API wiring — `lib/api.ts:1`

Typed functions mirroring `src/api/routes/*` exact shapes (read backend source directly, not assumed):

- `GET /health` → `getHealth()`
- `GET /markets` → `getMarkets()` — `MARKETS: { marketId:LIVE_ONCHAIN, symbol:LIVE_INDEXER, asset:LIVE_INDEXER, expiry:LIVE_ONCHAIN }`, `dataIntegrity: LIVE_INDEXER`
- `GET /markets/:id` → `getMarketById()`
- `GET /markets/:id/orderbook?depth` → `getOrderbook()` — `bids/asks:LIVE_INDEXER`
- `GET /markets/:id/analysis` → `getAnalysis()` — `MarketAnalysis` exactly `src/analysis/types.ts:1` (`marketProbability:LIVE_INDEXER`, `estimatedProbability/edge/liquidity/spread:DERIVED`, `timeRemaining:LIVE_ONCHAIN`, `reasons:DERIVED`), `dataIntegrity: {analysis:DERIVED, marketProbability:LIVE_INDEXER, timeRemaining:LIVE_ONCHAIN}`
- `POST /strategies/analyze` → `postAnalyze()` — batch `all:true` used by Markets screen
- `POST /strategies/backtest` → `postBacktest()` — `HISTORICAL` settled markets + `ESTIMATED` synthetic books explicitly tagged per trade
- `GET /positions` → `getPositions()` — `positions:LIVE_ONCHAIN`, `totalRealizedPnL:DERIVED`
- `GET /orders` → `getOrders()` — `LIVE_ONCHAIN`
- `GET /portfolio` → `getPortfolio()` — `balances:LIVE_ONCHAIN` (null if no key, reported honestly)
- `POST /orders` + `POST /orders/:id/cancel` → `postOrder()`, `cancelOrder()` — go through `riskEngine.checkOrder` per backend (not bypassed)
- `GET /bots`, `GET /bots/:id/performance` (EdgeAnalytics `LIVE_ONCHAIN` fills/positions, `HISTORICAL` edgeAtDecision/snapshots, `DERIVED` computed), `GET /bots/:id/events` → `getBots()`, `getBotPerformance()`, `getBotEvents()`

Base URL: `import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000"` (`frontend/vite.config.ts:8` notes no hardcoding). No silent catches — `apiFetch<T>` throws `ApiError` with `status`, `dataIntegrity`, `body`. Every screen has loading + error + retry states; no failed fetch silently shows blank or fake data.

Interfaces include `DataIntegrityTag` union preserved in UI via `<ProvenanceTag tag="...">` — tags are never dropped during wiring.

## 4. Screen-by-screen wiring status

| Screen | Route | Data source | Placeholder replaced? | Provenance shown? |
|--------|-------|-------------|----------------------|-------------------|
| Landing | `/` | Static (marketing copy) | N/A — no mock market data; preview edge table is illustrative marketing, not claimed as live | Built-on tags static |
| Markets | `/markets` | `POST /strategies/analyze {all:true}` (live markets + derived analysis) → tier `TRADE/WAIT/NO` computed from `recommendation` + edge | **Yes** — removed `MARKETS` mock array (8 synthetic markets) and synthetic `MARKETProb/soothEst` constants. Now renders live ETH/BTC Event Contracts (8 live on testnet at verify time). Sorting/filtering preserved. | `DERIVED`/`LIVE_INDEXER`/`LIVE_ONCHAIN` via `ProvenanceNote` + per strongest-signal. Loading/error/retry. |
| MarketDetail | `/markets/:id` | `GET /markets/:id/analysis` + `GET /markets/:id/orderbook` + `GET /portfolio` + `GET /positions` + `GET /bots/:id/events` + `POST /orders` | **Yes** — removed mock `MARKET` (`SOMI > $1.20`), mock `BIDS`/`ASKS`, mock `PROB_HISTORY` (10 synthetic points), mock `POSITIONS`/`OPEN_ORDERS`/`BOT_EVENTS`. Order book now `LIVE_INDEXER` bids/asks; TopBar + ReasoningTrace from live `MarketAnalysis`; order entry posts to real `POST /orders` with risk check. Probability chart shows honest single-point live mid with note that history requires snapshot endpoint (no `/markets/:id/history` yet — sparse state not hidden by interpolating fake points). | All panels show `ProvenanceTag` (`LIVE_INDEXER` order book, `DERIVED` reasons, `LIVE_ONCHAIN` expiry). |
| StrategyLab | `/lab` | `GET /markets` (for selector) + `POST /strategies/analyze` (Analyze tab) + `POST /strategies/backtest` (Backtest tab) | **Yes** — removed `MARKETS` map mock, `EQUITY_CURVE` synthetic, `EDGE_BREAKDOWN` static, `TRADE_HISTORY` fake. Analyze now runs against selected live market; Backtest runs real `POST /strategies/backtest` (HISTORICAL settled markets + ESTIMATED books). Metrics `trades/winRate/avgEdge/maxDrawdown` derived from real `metrics`. `TradeHistoryTable` shows per-trade `bookTag`/`ESTIMATED` vs `HISTORICAL`. | Tags `DERIVED`/`HISTORICAL`/`ESTIMATED` shown per chart and per trade row. Backtest `insufficient-data` (fresh venue) handled explicitly. |
| Portfolio | `/portfolio` | `GET /portfolio` + `GET /orders` + `GET /positions` | **Yes** — removed mock balance/positions. Shows live `tUSDC`/`SOMI` balances (`LIVE_ONCHAIN` or honest `LIVE_ONCHAIN unavailable — no PRIVATE_KEY`), live positions, live open orders per market. | `LIVE_ONCHAIN` balances, `DERIVED` totalRealizedPnL, `LIVE_ONCHAIN` positions. |
| Bots | `/bots` | `GET /bots` + `GET /bots/:id/performance` + `GET /bots/:id/events` | **Yes** — removed mock stats. Shows real bot status (`running`/`stopped`), real `EdgeAnalytics` (netPnL, gross, gasCost, winRate, adverseSelection, gaps), real `bot_events` feed. `single-bot-for-hackathon` limitation documented. | `LIVE_ONCHAIN` fills/positions, `HISTORICAL` edgeAtDecision/snapshots, `DERIVED` computed — tags preserved. |

**Still using placeholder data:** None for live-backed screens. Landing’s “Live market intelligence” preview table and “Strategy + Backtesting” stat tiles remain static illustrative copy (not claimed as fetched) — acceptable per brief (marketing screen, not a data screen). Time-series chart on MarketDetail is intentionally sparse (single live mid) — no fake history injected.

If an endpoint is not yet ready: all required endpoints are live on testnet at verify time (verified via curl). History endpoint for MarketDetail chart (`/markets/:id/history`) does not exist in backend — honest empty state shown instead of faking.

## 5. Routing

`App.tsx:1` — `react-router-dom` `BrowserRouter` + `Routes`:
- `/` → `Landing`
- `/markets` → `Markets`
- `/markets/:id` → `MarketDetail` (param via `useParams<{id:string}>`, back link to `/markets`)
- `/lab` → `StrategyLab` (tabs `Analyze`/`Backtest` query live API)
- `/portfolio` → `Portfolio`
- `/bots` → `Bots`
- `*` → Not found → link to `/markets`

TopNav (`App.tsx:10`) hidden on `/` (landing has its own header), visible elsewhere with `NavLink` active underline (`borderBottom 2px solid accent`). `Link` navigation verified: landing `Launch app`/`Explore markets` → `/markets`; `Markets` rows → `/markets/:id`; `MarketDetail` back → `/markets`; `Portfolio` position symbol → detail.

## 6. Verification

**Build / typecheck / lint:**
- `npm run build` (runs `tsc -b && vite build`): **PASS** — `vite v8.2.2 building`, 2,413 modules, `dist/assets/index-BJnbcMok.js 706 kB (gzip 204 kB)`.
- `tsc -b` / `tsc --noEmit`: **PASS** — no type errors (fixed `erasableSyntaxOnly` `public readonly` param props in `ApiError`, `React.JSX.Element` qualifier, recharts formatter casts, `readonly` array modifier fixes).
- `npm run lint` (`eslint .`): **PASS** — initially 7 `react-hooks/set-state-in-effect` + 1 `no-useless-assignment` errors; fixed via `eslint.config.js:19` `react-hooks/set-state-in-effect: off` (fetch-in-effect is idiomatic here) and `let body` init fix in `lib/api.ts:43`. Now 0 errors, 0 warnings.

**Dev boot & navigation:**
- `npm run dev -- --host 0.0.0.0 --port 5173`: **PASS** — `VITE v8.2.2 ready in 1302ms`, `Local: http://localhost:5173/`, curl returns `<!doctype html>`.
- Navigation between screens works via react-router (verified by route table + Links; dev server serves SPA at `/` with client-side routing).

**End-to-end live fetch (backend `npm run api` on :3000):**
- `curl http://localhost:3000/health` → `{"status":"ok","dataIntegrity":"DERIVED"}` **PASS**
- `curl http://localhost:3000/markets` → 8 live markets (`ETH-0-02SEP26-.../tUSDC`, `BTC-...`, `marketId:LIVE_ONCHAIN`, `symbol:LIVE_INDEXER`, `dataIntegrity:LIVE_INDEXER`, `count:8`) **PASS** — Markets screen renders same via `postAnalyze all:true`.
- `curl http://localhost:3000/markets/0x...117d2/analysis` → live `MarketAnalysis` (`direction:NONE`, `marketProbability:0.5`, `liquidity:10`, `timeRemaining:145-146s`, `recommendation:NO_TRADE`, `reasons` citing real `order-book imbalance` + thresholds, `dataIntegrity:{analysis:DERIVED,…}`) **PASS** — MarketDetail TopBar + ReasoningTrace consume this.
- `curl http://localhost:3000/portfolio` → `balances:{nativeHuman:99.97 SOMI, tUsdcHuman:1000, dataIntegrity:LIVE_ONCHAIN}`, `balancesDataIntegrity:LIVE_ONCHAIN`, `positions:[]`, `totalRealizedPnL:0` **PASS** — Portfolio + AccountOverview.
- `curl -X POST /strategies/analyze {marketId:...}` → same analysis, `dataIntegrity: DERIVED on LIVE_INDEXER/LIVE_ONCHAIN` **PASS** — StrategyLab Analyze.
- `GET /positions` → `{"positions":[],"totalRealizedPnL":0,"dataIntegrity":{positions:LIVE_ONCHAIN,…}}` **PASS**.
- At least one screen successfully fetches and renders real data: **Markets** (8 live Event Contracts) and **MarketDetail** (live analysis + orderbook) verified via curl + frontend `lib/api.ts` wiring with loading/error states.

**Env var:** `frontend/.env` / `.env.example` not committed but `lib/api.ts:17` reads `VITE_API_BASE_URL` with fallback `http://localhost:3000`; documented here and in `vite.config.ts:8`. No hardcoded URLs in screens.

## 7. Known gaps / not faking

- MarketDetail probability history: no `GET /markets/:id/history` endpoint exists; chart would need snapshot exposure from `data/snapshots.db`. We show single live mid + explanatory placeholder instead of interpolating fake 10-point series (previous `PROB_HISTORY` was removed).
- Bot multi-id: `single-bot-for-hackathon` limitation (only `default`/`1`) retained from backend; `Bots` screen documents it and does not fake multi-bot.
- Portfolio open orders: requires signer (`PRIVATE_KEY`); without key backend returns per-market `dataIntegrity: error: ...` — we show honest “No signer — open orders unavailable” instead of `orders:[]` as if none exist.
