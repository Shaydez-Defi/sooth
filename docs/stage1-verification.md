# Stage 1 Verification — Real DreamDEX on Somnia Testnet

**Date (UTC):** 2026-08-26T15:12:03Z (second run block 471841920; first run block 471840854)
**Environment:** GitHub Codespace (Linux), Node v24.14.0, npm 11.9.0
**Bot Kit revision:** `vendor/dreamdex-bot-kit` @ `dccd2fd` (main) — cloned from `https://github.com/somnia-chain/dreamdex-bot-kit`
**Network:** Shannon testnet — `NETWORK=testnet`, `CHAIN_ID=50312`
**RPC URL (LIVE_ONCHAIN):** `https://dream-rpc.somnia.network` (verified `getChainId() → 50312`)
**REST API (LIVE_ONCHAIN):** `https://stg.api.dreamdex.io/v0`
**WS URL:** `wss://stg.api.dreamdex.io/v0/ws/public`

## What was verified

- [x] Cloned official Bot Kit into `./vendor/dreamdex-bot-kit` (public repo `somnia-chain/dreamdex-bot-kit`)
- [x] Built `@dreamdex-bot-kit/core` (`tsc -p tsconfig.json`) — dist present
- [x] Read-only RPC connection: `getChainId()` and `getBlockNumber()` succeeded (no API key, no allowlist, no funded wallet)
- [x] REST `GET /v0/markets` returned 3 live markets (addresses match `packages/core/src/config/tokens.ts`)
- [x] On-chain `getPoolParams` and `getBookLevels` for a real pool via `viem` `readContract`
- [x] DERIVED spread/mid computed from LIVE_ONCHAIN top-of-book; REST orderbook snapshot agrees
- [x] `WALLET_PRIVATE_KEY` **not required** for reads — script runs with dummy SIWE account; funding not needed (Stage 1 read-only)

## Contract address / ID used for deep inspection

**Symbol:** `SOMI:USDso`
**Pool (SpotPool) address:** `0x259fD6559214dd5aD3752322426eA9F9fABEFff4` (testnet, per `MARKETS.testnet["SOMI:USDso"]`)
**Base token:** `0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00` (NATIVE_SENTINEL for SOMI — not `address(0)`, gotcha #5)
**Quote token (USDso):** `0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171`
**All testnet markets discovered via `DreamDexRest.fetchMarkets()`:**

| Symbol | Pool | baseDecimals | quoteDecimals | tickSize (DERIVED) | lotSize | minQuantity |
|--------|------|--------------|---------------|---------------------|---------|-------------|
| SOMI:USDso | `0x259fD6559214dd5aD3752322426eA9F9fABEFff4` | 18 | 18 | `0.0001` | `0.01` | `1` |
| WBTC:USDso | `0x3605f28aA7C50e7441211e77Cb0762d49539326C` | 8 | 18 | `0.1` | `0.00001` | `0.0001` |
| WETH:USDso | `0xD180195da5459C7a0DEA188ed61216ec43682b50` | 18 | 18 | `0.01` | `0.0001` | `0.001` |

> Mainnet additionally hosts `USDC.e:USDso` (`0x47fD2f18426f67106DBaC82F6d21D446c5F2120b`) — not present on testnet.

## Actual script output (provable — not stubbed)

Command: `npx tsx src/scripts/discover-markets.ts` (no `.env` private key set, uses defaults)

```text
=== DreamDEX Trading Intelligence — Stage 1 Discovery ===

Network    : testnet (chainId=50312)
RPC URL    : https://dream-rpc.somnia.network
REST API   : https://stg.api.dreamdex.io/v0
WS URL     : wss://stg.api.dreamdex.io/v0/ws/public
Bot Kit net: testnet (chainId=50312, rpc=https://dream-rpc.somnia.network)

[RPC] Connected — chainId=50312, block=471841920

[REST] GET https://stg.api.dreamdex.io/v0/markets → 3 market(s)
  - SOMI:USDso pool=0x259fD6559214dd5aD3752322426eA9F9fABEFff4 base=0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00 quote=0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171 tick=0.0001 lot=0.01 minQty=1 baseDecimals=18 quoteDecimals=18
  - WBTC:USDso pool=0x3605f28aA7C50e7441211e77Cb0762d49539326C base=0x4e85DC48a70DA1298489d5B6FC2492767d98f384 quote=0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171 tick=0.1 lot=0.00001 minQty=0.0001 baseDecimals=8 quoteDecimals=18
  - WETH:USDso pool=0xD180195da5459C7a0DEA188ed61216ec43682b50 base=0x4d8E02BBfCf205828A8352Af4376b165E123D7b0 quote=0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171 tick=0.01 lot=0.0001 minQty=0.001 baseDecimals=18 quoteDecimals=18
[REST raw] GET /markets status=200

=== Deep inspection: SOMI:USDso (0x259fD6559214dd5aD3752322426eA9F9fABEFff4) ===
[LIVE_ONCHAIN] getPoolParams:
  baseToken  = 0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00
  quoteToken = 0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171
  makerFee   = 0 (bps*1000)
  takerFee   = 0 (bps*1000)
  tickSize   = 100000000000000 raw = 0.0001 quote
  lotSize    = 10000000000000000 raw = 0.01 base
  minQuantity= 1000000000000000000 raw = 1 base
[LIVE_ONCHAIN] getBookLevels (depth 5):
  bids (5 levels): 
    BID 0.108600 x 461.5000
    BID 0.108500 x 583.8000
    BID 0.108400 x 1459.5000
    BID 0.108300 x 875.7000
    BID 0.050000 x 413.6000
  asks (5 levels): 
    ASK 0.108700 x 1129.7000
    ASK 0.108800 x 1540.5000
    ASK 0.108900 x 924.3000
    ASK 0.500000 x 10.0000
    ASK 2.000000 x 10.0000
[DERIVED] Market state:
  bestBid = 0.108600
  bestAsk = 0.108700
  mid     = 0.108650
  spread  = 0.000100 (9.20 bps)
  expiry  : N/A for spot — spot pools have no market expiry (orders carry expireTimestampNs per order; see gotchas.md #2)
  pool    : 0x259fD6559214dd5aD3752322426eA9F9fABEFff4
  REST base/quote decimals: 18/18

[LIVE_ONCHAIN via REST] fetchOrderbooks depth 5 (may lag on-chain by seconds):
{
  "orderbooks": [
    {
      "asks": [
        {
          "price": "0.1087",
          "quantity": "1129.7"
        },
        {
          "price": "0.1088",
          "quantity": "1540.5"
        },
        {
          "price": "0.1089",
          "quantity": "924.3"
        },
        {
          "price": "0.5",
          "quantity": "10"
        },
        {
          "price": "2",
          "quantity": "10"
        }
      ],
      "bids": [
        {
          "price": "0.1086",
          "quantity": "461.5"
        },
        {
          "price": "0.1085",
          "quantity": "583.8"
        },
        {
          "price": "0.1084",
          "quantity": "1459.5"
        },
        {
          "price": "0.1083",
          "quantity": "875.7"
        },
        {
          "price": "0.05",
          "quantity": "413.6"
        }
      ],
      "symbol": "SOMI:USDso",
      "timestamp": 1787757130119
    }
  ]
}

[INFO] Read-only proof completed without WALLET_PRIVATE_KEY — REST + RPC reads require no funds or signature.
[INFO] WALLET_PRIVATE_KEY not set — expected for Stage 1 read-only.

=== Verification: hit real Somnia testnet chain 50312, block 471841920, pool 0x259fD6559214dd5aD3752322426eA9F9fABEFff4 ===
```

*First run (block 471840854) showed bid 0.1089 / ask 0.1090 mid 0.10895 spread 9.18 bps — same pool, book moved between blocks as expected on a live chain.*

## How to re-run

```bash
npm install
npx tsx src/scripts/discover-markets.ts
# or: npm run discover
```

No `.env` needed — defaults target testnet. To override: `SOMNIA_TESTNET_RPC_URL`, `CHAIN_ID`, `DREAMDEX_API_BASE`, `NETWORK`.

## Stop conditions checked

- Bot Kit repo: **found** (public, `somnia-chain/dreamdex-bot-kit`)
- Testnet RPC: **no API key / allowlist required** — `https://dream-rpc.somnia.network` responded with `chainId 50312`
- REST: **no auth for market data** — `https://stg.api.dreamdex.io/v0/markets` returned 200
- Funded wallet: **not needed** for this stage (read-only). SDK's `createChainContext()` does require a key for signing, but this script bypasses it with a dummy account for REST + direct `viem` reads. Flagged for Stage 2.

## Notes on "Event Contracts" vs spot

The task text says "DreamDEX Event Contracts" — the kit hosts **spot** markets (verified above) and **event/binary** markets (Up/Down on BTC/ETH) via a separate SDK `@somnia-chain/markets-sdk` under `strategies/ec-*` and `VENUE_ID`. Spot is the default trading surface; event contracts require `VENUE_ID` and carry a per-market expiry (unlike spot). This verification proves the **spot CLOB** path; event-contract listing would require the venue SDK and is gated separately (see `docs/event-contracts.md`).

## Technical checks

- `npx tsc --noEmit` → PASS (0 errors)
- `npx eslint src` → PASS (using `eslint.config.js` + `typescript-eslint` flat config)
- `npx vitest run` → PASS (8 tests in `src/config.test.ts` + `src/constants.test.ts`)
