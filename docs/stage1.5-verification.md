# Stage 1.5 Verification - DreamDEX Event Contracts on Somnia Testnet

**Date (UTC):** 2026-08-26T18:15:53Z (block 471952078; earlier run block 471944174 at 18:08Z)
**Environment:** GitHub Codespace (Linux), Node v24.14.0
**Bot Kit revision:** `vendor/dreamdex-bot-kit` @ `dccd2fd` (same as Stage 1), `@somnia-chain/markets-sdk@0.28.1` (public, `https://registry.npmjs.org/@somnia-chain/markets-sdk/-/markets-sdk-0.28.1.tgz`)
**Network:** Shannon testnet - `NETWORK=testnet`, `CHAIN_ID=50312`
**EC RPC (LIVE_ONCHAIN):** `https://api.infra.testnet.somnia.network` (verified `getChainId() → 50312`)
**EC Indexer (LIVE_INDEXER):** `https://dev.smk.somnia.host/v1/graphql`
**Venue:** `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` (operator 2, DreamDEX venue per `docs/event-contracts.md:62` and `.env.example`)
**Collateral:** `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` (tUSDC, 6 decimals, testnet)
**Tick/Lot:** `1000 / 1` raw (EC config `MM_TICK`/`MM_LOT` for testnet, `packages/ec-core/src/config.ts:197-198`)

## What was verified

- [x] Installed `@somnia-chain/markets-sdk@0.28.1` (public) and `@dreamdex-bot-kit/ec-core` (`file:vendor/dreamdex-bot-kit/packages/ec-core`) - mirror of Stage 1 discovery (see `packages/ec-core/package.json:15`)
- [x] Read-only EC connection via `createExchange({withSigner:false})` - no `PRIVATE_KEY` required, no funds, no SIWE (EC uses local signing, not DreamDEX REST)
- [x] Venue scoping: without `VENUE_ID` EC throws `Live markets span 2 venues: 0x1a1e… (op 4), 0x6797… (op 2)` - proves multi-venue indexer, requires `VENUE_ID` (verified `packages/ec-core/src/markets.ts:86-96`). With `VENUE_ID=0x6797…` → 8 live markets.
- [x] On-chain `marketOnchain(marketId)` for a real contract via `client.getMarketOnchain` (authoritative, not indexer lag)
- [x] Order book via `fetchOrderBook` / `snapshot` (price = YES probability in (0,1), human units), best bid/ask/mid, spread, liquidity (quantities)
- [x] Time-to-expiry from `onchain.expiry` (unix sec) vs `Date.now()`, headroom via `headroomSec(intervalSec)` (scaled, not fixed)
- [x] `isTradable` gate on `MARKET_STATUS.Trading === 1` (not indexer `active`)
- [x] Settlement/claim surface inspected but not executed (read-only): `settledMarkets` via `listBinaryMarkets(status:"Finalized")`, `redeemOutcome`, `maybeClaim` - matches `docs/event-contracts.md:130-137`
- [x] Auth difference confirmed: spot session-key (`OWNER_ADDRESS` + `OperatorPermissionsRegistry` 0x8005…) **does not apply** to EC - EC is single-key `PRIVATE_KEY` or read-only, venue scoping via `VENUE_ID`/`OPERATOR_ID` only (grep `OWNER_ADDRESS` in `ec-core/src` → 0 hits)

## Contract address / ID used for deep inspection

**Symbol (target):** `ETH-0-26AUG26-1830/tUSDC` (also verified `ETH-0-26AUG26-1900/tUSDC` `a530` on earlier run)
**Outcomes:** `YES: ETH-0-26AUG26-1830/tUSDC#YES` / `NO: ETH-0-26AUG26-1830/tUSDC#NO` (outcome 0=YES, 1=NO)
**marketId (bytes32):** `0x000000000000000000000000000000000000000000000000000000000000a558` (stable key; pool is time-varying, never use pool as key per `docs/event-contracts.md:128-129`)
**Pool (CLOB):** `0x3ae79C8A2C3197B57Af3715B74BA1E96BCE82607`
**Market (BinaryMarket):** `0x48eA0642cb31cc0232cDc0A0a6821CAf45C86e1d`
**OutcomeToken singleton:** `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9`
**yesId:** `1588068442782767936681760620158326934735299358487244073907514102533888`
**noId:** `1588068442782767936681760620158326934735299358487244073907514102533889`
**Nonce:** `79`
**VenueId:** `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c`
**OperatorId:** `2`
**Asset:** `ETH` `intervalSec=900` (15m window), `strike=0`
**Expiry (unix):** `1787769000` → `2026-08-26T18:30:00.000Z` (remaining 852s / 14.2 min at capture, headroom 300s, tradable true)

**Full live venue (8 markets) at capture:**

| Symbol | marketId suffix | asset | interval | pool |
|--------|----------------|-------|----------|------|
| ETH-0-26AUG26-1830/tUSDC | `…a558` | ETH | 900s | `0x3ae7…2607` |
| BTC-0-26AUG26-1830/tUSDC | `…a559` | BTC | 900s | … |
| ETH-0-26AUG26-1900/tUSDC | `…a530` | ETH | 3600s | `0xd6fB…F927` |
| BTC-0-26AUG26-1900/tUSDC | `…a531` | BTC | 3600s | … |
| BTC/ETH-0-26AUG26-2000/tUSDC | 4h | both | 14400s | … |
| BTC/ETH-0-27AUG26/tUSDC | 1d | both | 86400s | … |

> Other venues on same deployment: `0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f` (op 4, 5 rows total, 2 live at capture), `0xcc69885f…` etc. - proves `VENUE_ID` scoping required.

## Actual script output (provable - not stubbed)

Command: `NETWORK=testnet npx tsx src/scripts/discover-event-contracts.ts` (no private key; script defaults `VENUE_ID` to documented testnet venue if unset, see `src/scripts/discover-event-contracts.ts:22-26`)

```text
=== DreamDEX Trading Intelligence - Stage 1.5 EC Discovery ===

Network      : testnet (chainId=50312)
RPC URL      : https://api.infra.testnet.somnia.network
WS RPC URL   : wss://api.infra.testnet.somnia.network/ws
Indexer      : https://dev.smk.somnia.host/v1/graphql
VENUE_ID     : 0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c
OPERATOR_ID  : (unset)
Collateral   : 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E (decimals=6)
Tick/Lot     : 1000 / 1 (raw)
DryRun       : true

[LIVE_INDEXER] resolveVenue: source=env markets=8 scope={"venueId":"0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c"}
[RPC] Connected - chainId=50312, block=471952078

[LIVE_INDEXER] activeMarkets (via venue 0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c) → 8 market(s)

[LIVE_INDEXER] Live binary markets (first 8):
  - ETH-0-26AUG26-1830/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=ETH interval=900s active=true
  - BTC-0-26AUG26-1830/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=BTC interval=900s active=true
  - ETH-0-26AUG26-1900/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=ETH interval=3600s active=true
  - BTC-0-26AUG26-1900/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=BTC interval=3600s active=true
  - BTC-0-26AUG26-2000/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=BTC interval=14400s active=true
  - ETH-0-26AUG26-2000/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=ETH interval=14400s active=true
  - BTC-0-27AUG26/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=BTC interval=86400s active=true
  - ETH-0-27AUG26/tUSDC marketId=0x0000000000000000… venue=0x679795a0195a1b76… op=2 asset=ETH interval=86400s active=true

=== Deep inspection: ETH-0-26AUG26-1830/tUSDC (ETH-0-26AUG26-1830/tUSDC#YES / ETH-0-26AUG26-1830/tUSDC#NO) ===
[LIVE_INDEXER] UnifiedMarket metadata:
  symbol     = ETH-0-26AUG26-1830/tUSDC
  marketId   = 0x000000000000000000000000000000000000000000000000000000000000a558
  venueId    = 0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c
  operatorId = 2
  asset      = ETH intervalSec=900
  strike     = 0
  outcomes   = YES:ETH-0-26AUG26-1830/tUSDC#YES NO:ETH-0-26AUG26-1830/tUSDC#NO
  active     = true

[LIVE_ONCHAIN] marketOnchain (by marketId):
  pool         = 0x3ae79C8A2C3197B57Af3715B74BA1E96BCE82607
  market       = 0x48eA0642cb31cc0232cDc0A0a6821CAf45C86e1d
  outcomeToken = 0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9 yesId=1588068442782767936681760620158326934735299358487244073907514102533888 noId=1588068442782767936681760620158326934735299358487244073907514102533889
  collateral   = 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E decimals=6
  status       = 1 (Trading) isTradable=true
  expiry       = 1787769000 (unix sec) → 2026-08-26T18:30:00.000Z
  isResolved   = false isVoided=false winningOutcome=0 finalized=false
  nonce        = 79 backing=1500000000 raw
[DERIVED] Time remaining: 852s (14.2 min) headroom=300s tradable=true

[LIVE_INDEXER] snapshot ETH-0-26AUG26-1830/tUSDC#YES (depth 5, price=YES prob):
  bestYesBid = 0.4460 (implied prob 44.6%)
  bestYesAsk = 0.4750 (implied 47.5%)
  yesMid     = 0.4605 (46.1%)
  spread     = 0.0290 (629.8 bps)

[LIVE_INDEXER] fetchOrderBook ETH-0-26AUG26-1830/tUSDC#YES (raw, human units):
  bids (3):
    BID 0.4460 (44.6%) x 200.0000 → notional 89.2000 collateral
    BID 0.4350 (43.5%) x 330.0000 → notional 143.5500 collateral
    BID 0.4240 (42.4%) x 460.0000 → notional 195.0400 collateral
  asks (3):
    ASK 0.4750 (47.5%) x 200.0000 → notional 95.0000
    ASK 0.4860 (48.6%) x 330.0000 → notional 160.3800
    ASK 0.4970 (49.7%) x 460.0000 → notional 228.6200

[LIVE_INDEXER] fetchOrderBook ETH-0-26AUG26-1830/tUSDC#NO (3 levels, for reference): bids=3 asks=3
  NO best bid=0.5250 x 200.0000
  NO best ask=0.5540 x 200.0000

[LIVE_ONCHAIN] Collateral context:
  backing (raw) = 1500000000 → 1500 collateral
  pool status finalized=false

[INFO] EC order placement uses ec-core placeLimit (tick/lot as ints, via trader.placeOrder), not spot Pool.place. See docs/bot-kit-summary.md §8h.
[INFO] Settlement via redeemOutcome/settledMarkets; this script is read-only - no mint/claim sent.

=== Verification: hit real EC venue 0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c on chain 50312, market 0x000000000000000000000000000000000000000000000000000000000000a558, pool 0x3ae79C8A2C3197B57Af3715B74BA1E96BCE82607 ===
```

*Multi-venue diagnostic without `VENUE_ID` (same block 471943966, proves venue scoping required):*

```text
[LIVE_INDEXER] resolveVenue: source=inferred markets=12 scope={"venueId":"0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f","operatorId":4}
[FATAL] activeMarkets threw (likely multi-venue without VENUE_ID): Live markets span 2 venues: 0x1a1e… (op 4), 0x6797… (op 2). Set VENUE_ID …
[DIAG] total binary rows (any status): 548
  venue 0x1a1e6821cde7d0159c0d293177871e09677b4e42307c7db3ba94f8648a5a050f: 5 rows
  venue 0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c: 532 rows
```

## How to re-run

```bash
npm run discover:ec        # defaults VENUE_ID to 0x6797… if unset, NETWORK=testnet
# or explicit:
VENUE_ID=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c NETWORK=testnet npx tsx src/scripts/discover-event-contracts.ts
```

No private key needed - `createExchange({withSigner:false})` reads via indexer + `getMarketOnchain` + `fetchOrderBook`.

## Stop conditions checked

- `@somnia-chain/markets-sdk@0.28.1`: **found and public** (`https://registry.npmjs.org/.../markets-sdk-0.28.1.tgz`, `packages/ec-core/package.json:15`)
- EC requires materially different auth than spot: **yes, but read-only verified without it** - EC has no `OWNER_ADDRESS`/`OperatorPermissionsRegistry`; it uses single-key `PRIVATE_KEY` or none. Read-only works; write would need `PRIVATE_KEY` but not for this discovery.
- `ec-*` strategies reference methods: **all exist** - `createExchange`, `activeMarkets`, `marketOnchain`, `snapshot`/`fetchOrderBook`, `placeLimit` (via `exchange.trader.placeOrder`), `cancelTracked`/`cancelById`, `maybeClaim`/`settledMarkets` etc. verified in `packages/ec-core/src/*` and installed `node_modules/@somnia-chain/markets-sdk`.

## Technical checks

- `npx tsc --noEmit` → PASS
- `npx eslint src` → PASS
- `npx vitest run` → PASS (existing tests; EC path not touching money in this read-only stage - no new money module yet)
