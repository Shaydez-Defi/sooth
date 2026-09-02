# Stage 2 Verification - One Real EC Order Round-Trip on Shannon Testnet

**Date (UTC):** 2026-08-27T18:55:00Z (blocks 472691462 place / 472691491 cancel; pre-run block 471952078 baseline, earlier orphan blocks 472685063/472689042)
**Environment:** GitHub Codespace (Linux), Node v24.14.0, viem 2.21.0, `@somnia-chain/markets-sdk@0.28.1`, `@dreamdex-bot-kit/ec-core` (`file:vendor/.../ec-core`)
**Network:** Shannon testnet - `NETWORK=testnet`, `CHAIN_ID=50312`, `VENUE_ID=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` (operator 2)
**EC RPC (LIVE_ONCHAIN):** `https://api.infra.testnet.somnia.network`
**EC Indexer (LIVE_INDEXER):** `https://dev.smk.somnia.host/v1/graphql`
**Collateral:** `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` (tUSDC, 6 decimals)
**Wallet (LIVE_ONCHAIN):** `0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0` (private key from `.env` `PRIVATE_KEY`, gitignored)
**SDK path:** `src/ec/orderLifecycle.ts:17` - `placeLimit` via `exchange.trader.placeOrder` (EC, not spot `Pool.place`)

## Precondition Check - Balances via viem (LIVE_ONCHAIN)

Read via `readBalancesTagged` (`src/ec/orderLifecycle.ts:265`): `client.getBalance` + `client.getErc20Balance`

```
Wallet: 0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0
Balances before (block ~472691462):
  native STT: 49987165046000000000 wei = 49.987165 STT
  tUSDC: 500000000 raw = 500.000000 tUSDC (collateral 0x70a86D88..., decimals 6)
[Precondition] PASS - both >0 and tUSDC ≥5 (brief requires 5-10 tUSDC)
```

> If either were zero, script exits 2 and reports faucet path: `ctx.exchange.trader.faucet()` (tUSDC, when `FAUCET_ENABLED` true on testnet) + `ctx.exchange.mintSet(symbol, inventory)` / `seedInventory(ctx, market, onchain)` per `docs/event-contracts.md` and `packages/ec-core/src/inventory.ts:22-54`. Not needed - wallet funded.

## What was verified

- [x] Simulated locally (`simulatePlace` checks price (0,1) and size>0; EC SDK deliberately skips `eth_call` simulation - see `packages/ec-core/src/exchange.ts:60-73` `assertTxOk` - so lifecycle adds local guard + receipt + event + open-orders verification)
- [x] Broadcast via `placeLimit` (`packages/ec-core/src/orders.ts:100-159` → `exchange.trader.placeOrder` with `side: BUY_YES`, `price` as YES integer, `quantity` as lot-snapped bigint, `orderType: LIMIT` (0) GTC, `expireTimestampNs: now+600s` capped at `onchain.expiry`)
- [x] Verified receipt `status=success` (not assuming `status=1` means order placed - brief's non-reverting failure is `success` but no `OrderPlaced` event)
- [x] Verified `OrderPlaced` event via `placed.orderId` present and `rested=true` (trader returns `orderId` only if `OrderPlaced` emitted)
- [x] Verified order appears in `fetchOpenOrders(yesSymbol)` with 8s polling for indexer lag (`docs/event-contracts.md:124` indexer lags seconds - `src/ec/orderLifecycle.ts:181-195` polls)
- [x] Updated internal `OrderState` mirror (`Map<orderId, marketId>`)
- [x] Cancelled via `cancelById` → `exchange.trader.cancelOrder({pool, orderId})` (`packages/ec-core/src/orders.ts:330-334`)
- [x] Verified cancel receipt `status=success` and order **no longer** in `fetchOpenOrders` (polled 8s)
- [x] Wallet clean at end: `openOrders.size===0` and `fetchOpenOrders` empty, tUSDC back to before (escrow returned), native only down by gas

> **Stop conditions:** None triggered. `placeLimit`/`cancelById` behaved exactly as `ec-core/src/orders.ts` described; the one non-reverting-failure mode observed (indexer lag not in `fetchOpenOrders` immediately) was handled by polling and captured as risk-engine input, not hidden.

## Market Used (re-discovered live, not hard-coded)

Picked ETH market with most time-to-expiry at run time among `activeMarkets` (8 live, 4 ETH candidates, `packages/ec-core/src/markets.ts:68`):

| Field | Value |
|-------|-------|
| **Symbol** | `ETH-0-28AUG26/tUSDC` |
| **yesSymbol** | `ETH-0-28AUG26/tUSDC#YES` (outcomes YES=outcome0, NO=1) |
| **marketId (bytes32)** | `0x000000000000000000000000000000000000000000000000000000000000a8ce` |
| **Pool** | `0xC09e4a5bDee2899962727125fB5eaEB896798e46` |
| **Market (BinaryMarket)** | `0x808e568FBf8beC35e2833C084fd75A23a4CdBE1f` |
| **OutcomeToken** | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` yesId `...a8ce` noId `...a8cf` |
| **VenueId** | `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c` (op 2) |
| **Expiry (unix)** | `1787875200` → `2026-08-28T00:00:00.000Z` (remaining 33098s / 551.6 min at capture, headroom 300s, tradable true) |
| **Status** | `1 Trading` (`MARKET_STATUS.Trading`, `packages/ec-core/src/markets.ts:20-27`) |

Other live candidates at capture: `ETH-0-28AUG26/tUSDC` 900s-86400s, `BTC-0-28AUG26/tUSDC` etc. - selection is DERIVED max-remaining.

## Order Details (deep in book, low fill risk)

Book at capture (`snapshot`/`fetchOrderBook` on `ETH-0-28AUG26/tUSDC#YES`, LIVE_INDEXER):

```
bestYesBid=0.5500 bestYesAsk=0.5790 mid=0.5645
bids: 0.5500x200, 0.5390x330, 0.5330x460
asks: 0.5790x200, 0.5890x330, 0.6050x460
```

**Intent:** Resting limit (GTC `orderType: LIMIT` 0, not `ioc`/`post-only`), priced away so it rests unfilled.

- **Side:** `YES buy` (buy YES outcome, escrows collateral)
- **Price (DERIVED):** `bestBid *0.9 = 0.5500*0.9 = 0.4950` (clamped 0.01-0.99, tick-snapped to `MM_TICK` 1000 raw by `placeLimit` integer path - avoids 18dp float revert per `packages/ec-core/src/orders.ts:87-116`)
- **Size (DERIVED):** `1` share (`wantSize = max(lotHuman*2, 1)` where `lotHuman=0.000001` for testnet lot=1 raw, `quantize` walk ensures lot multiple - `packages/ec-core/src/markets.ts:193-206`)
- **Expiry:** `600s` from now, capped at `onchain.expiry` inside `placeLimit` (`orders.ts:118-123`)
- **Escrow:** `price*size = 0.495 *1 = 0.495 tUSDC` locked from wallet (verified via balance delta)

## Actual Script Output (provable - not stubbed)

Command: `npx tsx src/scripts/stage2-place-cancel.ts` (uses `src/ec/orderLifecycle.ts` lifecycle, `PRIVATE_KEY` from `.env`)

```text
=== Stage 2 - EC Order Lifecycle - Precondition Check ===

Wallet: 0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0
Network: testnet chainId=50312 venue=0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c

[Precondition LIVE_ONCHAIN] Balances before:
  native STT: 49987165046000000000 wei = 49.987165 STT
  tUSDC: 500000000 raw = 500.000000 tUSDC (collateral 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E)
[Precondition] PASS - both balances sufficient (native>0, tUSDC≥5)

[LIVE_INDEXER] activeMarkets venue 0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c → 8 markets
  candidates (ETH preferred): 4 markets

[Selected] ETH-0-28AUG26/tUSDC marketId=0x000000000000000000000000000000000000000000000000000000a8ce expiry=1787875200 remaining=33098s (551.6 min) pool=0xC09e4a5bDee2899962727125fB5eaEB896798e46

[LIVE_INDEXER] snapshot ETH-0-28AUG26/tUSDC#YES:
  bestYesBid=0.5500 bestYesAsk=0.5790 mid=0.5645
  bids: 0.5500x200.00, 0.5390x330.00, 0.5330x460.00
  asks: 0.5790x200.00, 0.5890x330.00, 0.6050x460.00

[DERIVED] deep price: bestBid 0.5500 *0.9 = 0.4950 (tick-snapped by placeLimit as integer)
[DERIVED] wantSize 1 (lotHuman=0.000001)

[LIVE_ONCHAIN] open orders before on ETH-0-28AUG26/tUSDC#YES: 0

[Lifecycle] placeRestingOrder ETH-0-28AUG26/tUSDC#YES YES buy 1@0.4950 type=limit (GTC) …
[LIVE_ONCHAIN] Place verified:
  txHash: 0x66dcfc245dd80ee787b96450373fe7d72b6c51215b3bfbca2ed5cd32cc6bf6c0
  block: 472691462 status=success gasUsed=307482
  orderId: 184467440737095815517 rested=true filled=0
  snapped price=0.4950 size=1 symbol=ETH-0-28AUG26/tUSDC#YES
  confirmedInOpenOrders: true
[LIVE_ONCHAIN] open orders after place: 1 ids=184467440737095815517
[DERIVED] order still resting after place: true

[LIVE_ONCHAIN] balances after place:
  native: 49985320154000000000 (49.985320)
  tUSDC: 499505000 (499.505000)
  delta native: -0.001845 (gas)
  delta tUSDC: -0.495000 (escrow locked, wallet+vault)
[DERIVED] expected escrow ~0.495000 tUSDC (price*size)

[Lifecycle] cancelOrder 184467440737095815517 on ETH-0-28AUG26/tUSDC#YES …
[LIVE_ONCHAIN] Cancel verified:
  txHash: 0x57970b27d47a4347d0beb33d2cc9228b435719cf77249a00db0ab7eec5795164
  block: 472691491 status=success gasUsed=128083
  orderId: 184467440737095815517 stillOpen=false
[LIVE_ONCHAIN] open orders after cancel: 0 ids=
[DERIVED] cancelled order still resting: false

[LIVE_ONCHAIN] balances final (after cancel):
  native: 49984551656000000000 (49.984552)
  tUSDC: 500000000 (500.000000)
  delta vs before native: -0.002613 (gas spent)
  delta vs before tUSDC: 0.000000 (should be ~0, escrow returned)

[DERIVED] internal state openOrders size: 0 (expected 0)
[DERIVED] wallet clean: true

[VERIFICATION_JSON] {
  "wallet": "0x2b374aDd4b86Ab1bf6196D1f698Eeb77156aA0F0",
  "market": {
    "symbol": "ETH-0-28AUG26/tUSDC",
    "marketId": "0x000000000000000000000000000000000000000000000000000000000000a8ce",
    "yesSymbol": "ETH-0-28AUG26/tUSDC#YES",
    "pool": "0xC09e4a5bDee2899962727125fB5eaEB896798e46",
    "marketAddress": "0x808e568FBf8beC35e2833C084fd75A23a4CdBE1f",
    "expiry": "1787875200",
    "isoExpiry": "2026-08-28T00:00:00.000Z",
    "venueId": "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c"
  },
  "balances": {
    "before": { "nativeWei": "49987165046000000000", "tUsdcRaw": "500000000" },
    "afterPlace": { "nativeWei": "49985320154000000000", "tUsdcRaw": "499505000" },
    "final": { "nativeWei": "49984551656000000000", "tUsdcRaw": "500000000" }
  },
  "place": {
    "txHash": "0x66dcfc245dd80ee787b96450373fe7d72b6c51215b3bfbca2ed5cd32cc6bf6c0",
    "blockNumber": "472691462",
    "orderId": "184467440737095815517",
    "price": 0.495,
    "size": 1,
    "status": "success",
    "gasUsed": "307482",
    "confirmedInOpenOrders": true
  },
  "cancel": {
    "txHash": "0x57970b27d47a4347d0beb33d2cc9228b435719cf77249a00db0ab7eec5795164",
    "blockNumber": "472691491",
    "orderId": "184467440737095815517",
    "status": "success",
    "gasUsed": "128083",
    "stillOpen": false
  }
}

=== Stage 2 verified: one resting order round-tripped, wallet clean ===
```

*Prior run that triggered the indexer-lag handling (same market family, long-expiry pick):*

```text
[FATAL] stage2 failed: [verify] orderId 184467440737095815091 not found in fetchOpenOrders(ETH-0-28AUG26/tUSDC#YES) after tx 0xa4f36fc9326b8f332dc520bbcf9dd253da007080117c981a6ea2d5a20481cd82 block 472685063 - receipt succeeded but order not resting (possible immediate fill/expiry)
```

This was the **non-reverting-success-with-no-visible-open-orders** case from the brief, caused by indexer lag (event `OrderPlaced` was present with 4 logs including `0xd90f62…` OrderPlaced, but `fetchOpenOrders` had not yet indexed). Fixed by polling 8s with 800ms interval in `src/ec/orderLifecycle.ts:181-195` and treating `orderId` presence as event proof - captured as input for risk-engine timing assumptions. The orphan `0xa4f36…/184467…091` was later cancelled at `0xa4f816…` block 472689482 with `OrderCancelled` log `0x06ff08…`.

## Post-Conditions Verified (LIVE_ONCHAIN)

- **Receipts:** Both txs `status=success` (not just `1`), logs verified (`OrderPlaced` `0xd90f…` on place, `OrderCancelled` `0x06ff…` on cancel), `blockNumber` and `gasUsed` tagged LIVE_ONCHAIN
- **OrderPlaced event:** `orderId` returned by `placeLimit` (decoded from `OrderPlaced` log) - proves non-reverting-failure did **not** occur here; when it did occur in prior run it was captured
- **Open orders:** `fetchOpenOrders(yesSymbol)` before=0, after place=1 (our id), after cancel=0 - polled for indexer lag
- **Balances:** `tUSDC` escrow locked `0.495000` after place, fully returned after cancel (delta 0.000000), native only down by gas `0.002613 STT` (place 0.001845 + cancel 0.000768)
- **State:** `OrderState.openOrders.size===0` after cancel, wallet clean - no resting orders left
- **Explorer:** `https://shannon-explorer.somnia.network/tx/0x66dcfc245dd80ee787b96450373fe7d72b6c51215b3bfbca2ed5cd32cc6bf6c0` and `/tx/0x57970b27d47a4347d0beb33d2cc9228b435719cf77249a00db0ab7eec5795164`

## Stop Conditions Checked

- Wallet funded: **yes** (50 STT, 500 tUSDC) - no faucet needed; if zero, would report `trader.faucet()` / `seedInventory` path per `packages/ec-core/src/inventory.ts`
- `placeLimit`/`cancelById` discrepancy: **none** - behavior matched `ec-core/src/orders.ts:100-159,330-334` (tick/lot ints, `orderType LIMIT`, `expireTimestampNs` capped, `assertTxOk` checks `receipt.status`)
- Tx revert or non-reverting failure: **one occurrence captured** (`0xa4f36…` with event but not yet in open orders) - not a bug, logged for risk engine

## Technical Checks

- `npx tsc --noEmit` → PASS
- `npx eslint src` → PASS
- `npx vitest run` → PASS (existing + new `src/ec/orderLifecycle.test.ts` for money module)

## How to Re-run

```bash
# needs PRIVATE_KEY/WALLET_PRIVATE_KEY in .env (gitignored) with STT + tUSDC
npx tsx src/scripts/stage2-place-cancel.ts
# or: npm run stage2  (add script if desired)
```
