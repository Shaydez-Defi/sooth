# DreamDEX Bot Kit - Summary (verified from `vendor/dreamdex-bot-kit`)

> Source: `vendor/dreamdex-bot-kit` cloned from `https://github.com/somnia-chain/dreamdex-bot-kit` on 2026-08-26.
> Branch: `main` (HEAD `1a9b4f3` at clone time - verify with `git log -1` inside vendor).
> All statements below are verified against files in the repo. Where the repo does not clearly document a capability, it is marked **Not documented / not found**.

## 1. How to install / init the TypeScript client

**Repo install (kit workspace):**

```bash
git clone <this repo> && cd dreamdex-bot-kit
npm install                       # installs workspace: @dreamdex-bot-kit/core + all TS strategies (+ @dreamdex-bot-kit/backtest)
# or with pnpm: pnpm install (pnpm-workspace.yaml present)
npm run build                     # builds core + backtest (also runs as postinstall)
```

Verified: `package.json:7-11` declares workspaces `packages/*, strategies/*, advanced/*`; `packages/core/package.json:12-13` build script is `tsc -p tsconfig.json`. `README.md:52-54` quickstart uses `npm install` + `npm run quickstart`.

**Using the core in an external project (our backend):**

- Dependency is `@dreamdex-bot-kit/core` (TypeScript, `viem` + `ws` deps) - see `packages/core/package.json:2,16-18`.
- Python mirror exists at `packages/core-py` (Python + web3) - strategies have `python/` variants.
- Install per kit: `npm install` in kit, then depend via local file path or published package. Kit README does **not** document a public npm registry publish for `@dreamdex-bot-kit/core`; external projects should reference the local kit via `file:./vendor/dreamdex-bot-kit/packages/core` or by copying/mirroring that package. (Verified: no registry URL in `packages/core/package.json`; `README:68` says `npm install` installs workspace.)
- Minimal TS init (verified `packages/core/src/index.ts:9-16`, `skills/dreamdex-bot/SKILL.md:40-53`):

```ts
import { createChainContext, Pool, ORDER_TYPE } from "@dreamdex-bot-kit/core";

const ctx = createChainContext();                // reads PRIVATE_KEY + NETWORK from env (see §3)
const pool = await Pool.load(ctx, "SOMI:USDso"); // MARKET must exist in MARKETS[net.name]
const { bestBid, bestAsk, mid } = await pool.topOfBook();
```

`createChainContext(privateKey?)` builds `viem` `publicClient` + `walletClient` for the active network (see `packages/core/src/client.ts:37-51`). `Pool.load` fetches on-chain `getPoolParams` - no hard-coded tick/lot needed.

Env loading is walk-up: `loadEnv()` checks `.env` from cwd upward (see `packages/core/src/env.ts:20-32`). `dotenv` `override:false`, nearest `.env` wins.

## 2. How to connect to Somnia testnet (Shannon)

Verified: `packages/core/src/config/networks.ts:33-54`, `README.md:121-126`, `docs/getting-started.md:10-12`.

| Field | Mainnet | Shannon testnet |
|-------|---------|-----------------|
| `NETWORK` env value | `mainnet` | `testnet` (default) |
| Chain ID | `5031` | `50312` |
| RPC | `https://api.infra.mainnet.somnia.network` | `https://dream-rpc.somnia.network` |
| REST API | `https://api.dreamdex.io/v0` | `https://stg.api.dreamdex.io/v0` |
| WebSocket | `wss://api.dreamdex.io/v0/ws/public` | `wss://stg.api.dreamdex.io/v0/ws/public` |
| Explorer | `https://explorer.somnia.network` | `https://shannon-explorer.somnia.network` |
| Native symbol | `SOMI` | `STT` (but docs/market symbols use `SOMI` as base asset label) |
| OperatorRegistry | `0xE7a...005ce` | `0x15C7...F20A` |

Overrides: `RPC_URL`, `REST_API_URL`, `WS_URL` env vars override defaults (see `networks.ts:38-40`).

**Connection pattern (read-only - no private key needed for REST/on-chain reads if you construct clients manually; `createChainContext` requires `PRIVATE_KEY` for signing path):**

```ts
import { getNetwork, toViemChain } from "@dreamdex-bot-kit/core";
import { createPublicClient, http } from "viem";
const net = getNetwork(); // NETWORK=testnet -> chain 50312
const client = createPublicClient({ chain: toViemChain(net), transport: http(net.rpcUrl) });
```

For `Pool.topOfBook()` / `readBookLevels` etc., `createChainContext()` already creates `publicClient` with correct chain + RPC.

Faucet: `https://testnet.somnia.network` (README:106).

Active testnet markets (verified `packages/core/src/config/tokens.ts:68-93`): `SOMI:USDso`, `WBTC:USDso`, `WETH:USDso`. Mainnet additionally `USDC.e:USDso`.

## 3. Authentication

### 3a. Wallet private key (default)

- Env: `PRIVATE_KEY=0x...` (hex, `0x` prefix optional). `createChainContext()` derives `viem` `Account` via `privateKeyToAccount` (`client.ts:42`).
- Used for **direct-contract path** (`placeOrder` etc.) - you sign locally, broadcast via RPC. No separate login step.
- For **REST prepare path**, auth is SIWE (EIP-4361) inside `DreamDexRest`:
  1. `GET /auth/nonce` (no auth)
  2. Sign SIWE message: `"<domain> wants you to sign in with your Ethereum account:\n<address>\n\nSign in to dreamDEX\n\nURI: <origin>\nVersion: 1\nChain ID: <net.chainId>\nNonce: <nonce>\nIssued At: <iso>"`
  3. `POST /auth/login` with `{message, signature}` → `{token, expiresAt}` JWT - cached, refreshed 3 min before expiry (`rest.ts:53,99-126`).
  - **Chain ID in SIWE MUST match `NETWORK`** - mismatch rejected (gotcha #14, `gotchas.md:114-126`).
  - The REST order endpoints return an **unsigned tx**; you still sign+broadcast yourself (`architecture.md:17-19`).

### 3b. Operator / Session key (split-key / hot key that cannot withdraw)

Verified: `docs/session-keys.md`, `packages/core/src/operator.ts`, `packages/core/src/execute.ts:153-192`, `packages/core/src/contract.ts:99-147`.

- Two keys: **Fund key (owner)** - cold, holds funds, deposits into vault, grants permissions. **Operator key (bot)** - hot, on server.
- On-chain registry: `OperatorPermissionsRegistry` at address per network (`networks.ts:42,52`, getter `ctx.net.operatorRegistry`).
- Authorization is **per function selector, per pool** (or global). Selectors: `placeOrderFor 0x80054449`, `cancelOrderFor 0xe37b444b`, `reduceOrderFor 0x364c2587` (see `contract.ts:143-147`).
- One-time setup (fund key):

```bash
PRIVATE_KEY=<fund key> OPERATOR_ADDRESS=0x<hot> OP_SYMBOL=SOMI:USDso OP_DEPOSIT_USDSO=50 \
npx tsx scripts/operator-setup.ts
# internally: setManualVaultMode(true) + depositVault + setOperatorApprovalForPool
```

- Run bot in operator mode: set `PRIVATE_KEY=<operator key>` and `OWNER_ADDRESS=<fund address>` (`client.ts:48-49`). Then every `Pool.place()` / `Pool.cancel()` automatically routes through `placeOrderFor` / `cancelOrderFor` (`pool.ts:107-114`). Fills settle to **owner's vault**; hot key never holds funds.
- Grants: `setOperatorApprovalForPool(pool, operator, selectors, approved)` or global `setOperatorApprovalGlobal`. Revocation immediate. Each pool is separate vault+grant.

**Not documented as supported:** Using an operator key with wallet auto-pull (default) - docs state operator path requires **manual vault mode** with deposited working capital (`session-keys.md:73-74`). Behavior of auto-pull via operator is not documented - assume unsupported.

## 4. Exact method names for key operations

All names verified against `packages/core/src/*`. The kit offers **three equivalent layers**: `Pool` (ergonomic, recommended), raw `contract.ts` helpers, and `rest.ts` prepare endpoints. Prefer `Pool`.

### 4a. Listing markets

| Method | File | Description |
|--------|------|-------------|
| `DreamDexRest.fetchMarkets(): Promise<MarketInfo[]>` | `rest.ts:65-68` | `GET /v0/markets` - canonical, always-current. Returns `symbol, contract, base, quote, baseDecimals, quoteDecimals, tickSize, lotSize, minQuantity`. Docs note: **never hard-code addresses** (`README:129`). |
| `MARKETS[net.name][symbol]` | `config/tokens.ts:33-94` | Static convenience map (testnet: SOMI:USDso, WBTC:USDso, WETH:USDso). |
| `readPoolParams(client, pool)` | `contract.ts:176-187` | `getPoolParams()` on-chain → `{baseToken, quoteToken, makerFeeBpsTimes1k, takerFeeBpsTimes1k, tickSize, minQuantity, lotSize}` (7 fields, order documented in gotcha #6). |

### 4b. Reading order book

| Method | File | Description |
|--------|------|-------------|
| `Pool.topOfBook(depth?) : Promise<{bestBid?, bestAsk?, mid?}>` | `pool.ts:80-89` | Reads **on-chain** via `readBookLevels` for both sides, converts with `fromRaw`. Depth default 1. |
| `readBookLevels(client, pool, isBid, depth=5): Promise<BookLevel[]>` | `contract.ts:199-212` | Raw `getBookLevels(isBid, numLevels)` → `{priceRaw, sizeRaw}[]`. Returns `[]` on empty book (not revert) - do not swallow errors. |
| `DreamDexRest.fetchOrderbooks(symbols, depth=5)` | `rest.ts:71-74` | `GET /orderbooks?symbols=...&depth=...` - REST snapshot (can lag). |
| `DreamDexWs.subscribeOrderbook(symbols)` + `subscribeTrades` / generic `subscribe(channel, params)` | `ws.ts:82-88` | WebSocket `wss://.../v0/ws/public`, with heartbeat ping 30s, auto-reconnect + replay subscriptions. |

For price-sensitive quoting, docs recommend on-chain `topOfBook` / `getBookLevels` as canonical (see `architecture.md:60-64`).

### 4c. Placing an order

| Method | File | Description |
|--------|------|-------------|
| `Pool.place({isBid, price, qty, orderType?, expireMs?})` | `pool.ts:91-109` | **Recommended.** Quantizes `price` via `alignToTick(toRaw(price, quoteDecimals), tickSize, side)` and `qty` via `alignToLot`, builds `expireTimestampNs` via `buildExpireNs(expireMs ?? 60min)`, then delegates to `placeOrder` or `placeOrderFor` if `ctx.owner` set. Defaults to `ORDER_TYPE.ImmediateOrCancel` (IOC taker). |
| `placeOrder(ctx: ExecCtx, params: PlaceOrderParams)` | `execute.ts:70-151` | Direct-contract path: guards → `getAutoPullRequirement` → allowance/`msg.value` → `simulateContract` (bail if `success===false`) → `estimateContractGas` → `writeContract(placeOrder)` → receipt + `OrderPlaced` log check → read `orderId` from receipt topic1. Gas floor ≥700k; native-base BUY floor `NATIVE_BASE_BUY_GAS = 5_000_000`. |
| `placeOrderFor(ctx, params, owner)` | `execute.ts:160-192` | Operator variant - same guards but via `placeOrderFor(owner, ...)`. No auto-pull; draws from owner's vault (manual mode required). |
| `DreamDexRest.prepareOrder(input: PrepareOrderInput): Promise<PreparedTx>` | `rest.ts:77-82` | `POST /v0/markets/{symbol}/orders` → `{to, data, value?, gasLimit?, chainId?}` unsigned tx. Caller signs+broadcasts. Input: `{symbol, side: "buy"|"sell", type: "limit"|"market", amount, price?, fundingSource?, orderType?}`. |
| Raw contract `placeOrder(isBid, userData, price, quantity, expireTimestampNs, orderType, selfMatchingOption, builder, builderFeeBpsTimes1k) payable` | `contract.ts:22-40` | Single modern ABI entry point (June 2026 upgrade removed `placeTakerOrderWithoutVault`). |

`ORDER_TYPE` constants (`gotchas.ts:18-28`): `Normal 0` (GTC), `FillOrKill 1`, `ImmediateOrCancel 2` (taker default), `PostOnly 3` (maker-only). `SELF_MATCH` (`gotchas.ts:30-35`): `CancelTaker 0` (default), `CancelMaker 1`.

### 4d. Cancelling an order

| Method | File | Description |
|--------|------|-------------|
| `Pool.cancel(orderId: bigint)` | `pool.ts:111-115` | Routes to `cancelOrder` or `cancelOrderFor` based on `ctx.owner`. |
| `cancelOrder(ctx, pool, orderId)` | `execute.ts:202-213` | `simulateContract(cancelOrder) → writeContract → waitForTransactionReceipt`. |
| `cancelOrderFor(ctx, pool, owner, orderId)` | `execute.ts:195-200` | Operator variant via `cancelOrderFor(owner, orderId)`. |
| `DreamDexRest.prepareCancel(symbol, orderId): Promise<PreparedTx>` | `rest.ts:84-86` | `DELETE /v0/markets/{symbol}/orders/{orderId}` → unsigned tx. |
| Raw contract `cancelOrder(orderId)`, `cancelOrderFor(owner, orderId)` | `contract.ts:41,119` | Direct ABIs. |

Also: `reduceOrder(orderId, newQuantityRemaining)` exists in ABI (`contract.ts:42-51`) but **no high-level wrapper in `Pool`**; operator variant selector `0x364c2587` exists but not wrapped (must be granted separately per `session-keys.md:68`).

### 4e. Reading fills / positions

| Method | File | Description |
|--------|------|-------------|
| **On-chain fills** `TOPIC.OrderFilled = 0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399` (6-arg signature) | `contract.ts:158-164` | Subscribe to `OrderFilled` logs - **canonical source**. REST `/v0/trades` can lag/stall for extended periods (gotcha #11). Docs: for PnL/inventory, read event from chain, valuing each fill at maker's resting price (`architecture.md:65-67`). |
| `Pool.openOrderIds(): Promise<bigint[]>` | `pool.ts:117-128` | `getOwnOpenOrders()` via `readContract` with `account: subject` (owner-aware). In operator mode uses `ctx.owner` as call subject to see owner's resting orders. |
| `Pool.vaultBase(): Promise<number>` | `pool.ts:131-135` | `getWithdrawableBalance(pool, subject, token)` - token is `NATIVE_SENTINEL 0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00` for native base. In auto-pull mode this reads ~0; useful only in manual vault mode. |
| `Pool.walletBase(): Promise<number>` | `pool.ts:147-159` | **Live inventory** in default auto-pull/deliver mode - `balanceOf(subject)` or `getBalance(subject)` for native. Docs: fills settle to wallet, so this is the correct inventory number (`gotchas.md:89-92`, `pool.ts:136-143`). |
| `readWithdrawableBalance(client, pool, owner, token)` | `contract.ts:214-221` | Raw vault balance read. |
| `getOrder(orderId)` (ABI) / `DreamDexRest.getOrder(symbol, orderId)` | `contract.ts:123-132`, `rest.ts:94-96` | Fetch single order metadata (on-chain vs REST). |
| `DreamDexRest.fetchOrderbooks` / `ws trades` | `rest.ts:71-74`, `ws.ts:88` | Trade tape (REST `trades` / WS `trades`) - laggy, not authoritative for fills. |

**Positions/PnL:** No single "getPosition" helper - position is derived from wallet/vault balances + `OrderFilled` history. Kit's `tools/edge-analytics` (`tools/edge-analytics/README.md`) measures realized fill quality from CSV logs, not live PnL.

**Not found / not documented as a kit method:** A direct `fetchFills` / `fetchPositions` SDK call. Reads are done via event logs / balances. `GET /v0/trades` exists as REST but kit docs explicitly warn against relying on it for fills (`gotchas.md:94-99`).

## 5. Historical backtesting utilities

Verified: `packages/backtest` (`package.json`, `src/`), `docs/backtesting.md`, `scripts/backtest.ts`, `README.md:20,86-95`.

- **Package:** `@dreamdex-bot-kit/backtest` - bar-by-bar engine (`SimPool`, fill model, metrics). Uses synthetic order book from OHLCV candles.
- **CLI:**

```bash
npm run backtest -- review --symbol WETH:USDso --interval 5m --days 7      # compare all bots
npm run backtest -- run momentum --days 3 --quiet                          # single strategy
npm run backtest -- run grid --set stepBps=20 --set lotUsdso=10
```

Flags: `--symbol` (default `WETH:USDso`), `--interval` (`1m|5m|15m|1h|4h|1d`, default `5m`), `--days` 7, `--since/--until` ms, `--network mainnet|testnet`, `--spread-bps 10`, `--quote-usdso 1000 --base 0`, `--taker-fee-bps --maker-fee-bps --slippage-bps 0`, `--calibrate-live`, `--depth-dir`, `--queue-position`, `--markout-bars 5`, `--set key=value`, `--no-cache`, `--out report.json --csv report.csv`. Candles cached at `.cache/candles/` (gitignored).

- **Simulation model:** 1) fake `Date.now()` to candle ts, 2) synthetic top-of-book from close (or hl2) ± spread, 3) match resting maker orders vs bar high/low, 4) call strategy `onBar()`, 5) mark equity at close (`backtesting.md:57-64`).
- **Modeled:** IOC/FOK/PostOnly/GTC, maker/taker fees, slippage, optional queue-position partial fills, maker markout reporting.
- **Limitations:** No historical CLOB (synthetic book unless `--depth-dir` snapshots supplied), no gas (`gasUsed 0`), one callback per candle, no full on-chain silent rejection model (`backtesting.md:76-82`).
- **Adapter pattern:** Each strategy has `src/backtest.ts` exporting `createBacktestBot(overrides)` → `BotFactory` using `asPool<Pool>(simPool)` and `applyConfigOverrides` (`backtesting.md:93-114`). Must register bot id in `scripts/backtest.ts` (`BOT_IDS` + `loadAdapter`).
- **Programmatic API:** `import { backtest, reviewBots } from "@dreamdex-bot-kit/backtest"`.
- **Data source:** Historical OHLCV candles fetched via DreamDEX API (same REST base per network).

## 6. EIP-7702 batching example

Verified: `advanced/batch-7702` (`README.md`, `src/index.ts`, `contracts/DreamDexVolumeBatch7702.sol`, `package.json`).

- **Location:** `advanced/batch-7702` - **technique demo, not a trading strategy** (`README:1-3`).
- **What it does:** Demonstrates **EIP-7702** to batch multiple on-chain actions into a single type-4 transaction by temporarily delegating the EOA to a contract. Example: **atomic buy→sell round-trip in one tx** - two fills, one signature, one gas payment, inventory flat. Pattern generalizes to any atomic multi-step (e.g. `approve+place` or `place+place` across pairs).
- **How it works:**
  1. Delegates the wallet to `DreamDexVolumeBatch7702` implementation (signs an EIP-7702 authorization).
  2. Calls `atomicRoundTrip` **on own address** in a type-4 tx. Since the EOA now runs the implementation's code, `address(this)` is the wallet - inside the call it IOC-buys (pool auto-pulls quote, delivers base to caller) then IOC-sells **exactly the base just received** (balance delta, handles partial fills). Uses modern wallet auto-pull - no vault step (`README:14-24`).
- **Run:**

```bash
npm install
cp .env.example .env  # set PRIVATE_KEY, NETWORK; leave IMPL_ADDRESS blank to auto-deploy
npm run start -w batch-7702
# First run: compiles via solc, deploys implementation, prints address + tip to set IMPL_ADDRESS
```

- **Key subtlety (gotcha):** When the authorization signer **also sends** the tx (self-sponsored), authorization must be signed at **nonce+1** (`executor: "self"` in viem's `signAuthorization`). Without it, delegation is silently invalid: tx succeeds but `logs=0` and code never runs (`README:47-54`, `src/index.ts` comment).
- **Details:** ERC-20 pair only (example targets `USDC.e:USDso`). Default `BATCH_GAS_LIMIT = 6_000_000`; round-trip ~2.3M. Requires viem ≥2.30 with type-4 support. Verified live on Somnia mainnet (one type-4 tx, buy+sell fill, flat). Test on testnet first.

## 7. Additional verified capabilities (not requested but relevant)

- **Shared client surface:** `packages/core/src/*` - `config/networks+tokens`, `gotchas.ts` (guards), `quant.ts` (tick/lot math), `contract.ts` (modern ABI + `TOPIC`), `execute.ts` (safe lifecycle), `pool.ts` (ergonomic handle), `nonce.ts` (local nonce manager for high throughput), `rest.ts` (SIWE + prepare), `ws.ts` (WS with heartbeat/reconnect), `operator.ts` (session keys), `yield.ts` (presence-score/yield logging).
- **Strategies:** `strategies/starter` (single `decide()` function, recommended start), plus `market-making`, `grid`, `momentum`, `mean-reversion`, `twap`, `ensemble` (modular ensemble+optional LLM). Event-contract variants `ec-starter`, `ec-maker`, `ec-passive`, `ec-laddering-bot`, `ec-oracle-follow`, `ec-settlement` sharing repo but separate SDK `@somnia-chain/markets-sdk` (`README:21-23`).
- **Operations:** `docs/24-7-operations.md` (auth refresh, nonces, reconnects, throughput), `docs/measuring-edge.md` + `tools/edge-analytics` (captured spread vs adverse selection vs tx/fill; Glosten-Milgrom inequality), `scripts/doctor.ts` (read-only wallet+book check), `scripts/inspect-and-clean.ts`, `scripts/one-ioc.ts`.
- **Agent skills:** `skills/somnia/SKILL.md` + `skills/dreamdex-bot/SKILL.md` (embedded directives for AI agents).
- **What is NOT documented as a kit capability:** Exchange-style `fetchBalance` / `fetchPositions` aggregation; historical order-book replay; simulated SIWE auth without a key; fee rebate analytics beyond `edge-analytics`. If absent above, assume not supported by the kit.

## 8. Event Contracts (EC) surface - distinct from spot

> EC is a separate stack: `@dreamdex-bot-kit/ec-core` over `@somnia-chain/markets-sdk` (`packages/ec-core/package.json:15` - `^0.28.1`, verified public at `https://registry.npmjs.org/@somnia-chain/markets-sdk/-/markets-sdk-0.28.1.tgz`). Spot `Pool`/REST paths are untouched; the two sides share only repo + Railway entrypoint (`docs/event-contracts.md:13-15`). Do NOT mix spot `Pool` helpers with EC - they target different contracts/SDKs.

### 8a. Install / init the EC client

**SDK source:** Not vendored. `ec-core` declares dependency on `@somnia-chain/markets-sdk` and re-exports it. Install via npm (`npm i @somnia-chain/markets-sdk@0.28.1`) or via `file:vendor/dreamdex-bot-kit/packages/ec-core` which transitively pulls it. Verified installed at `node_modules/@somnia-chain/markets-sdk` in our backend.

**Init (verified `packages/ec-core/src/exchange.ts:28-58`, `packages/ec-core/src/index.ts:9-18`):**

```ts
import { createExchange, activeMarkets, marketOnchain, snapshot } from "@dreamdex-bot-kit/ec-core";
// or: import { SomniaMarkets } from "@somnia-chain/markets-sdk" (raw SDK)

const ctx = createExchange({ withSigner: false }); // read-only, no PRIVATE_KEY
// ctx.exchange: SomniaMarkets instance (indexer + chain + wsRpc)
// ctx.config: EcConfig (venue, decimals, tick/lot)
// ctx.canTrade: boolean (privateKey present)

const markets = await activeMarkets(ctx); // LIVE via indexer + chain, venue-scoped
const onchain = await marketOnchain(ctx, markets[0]!); // authoritative per-marketId
const { bestYesBid, bestYesAsk, yesMid } = await snapshot(ctx, outcomeSymbols(markets[0]!).yes);
```

`createExchange({withSigner:true})` requires `PRIVATE_KEY`; without it reads still work (`exchange.ts:32-42`). Config comes from `loadConfig()` which reads `NETWORK`, `VENUE_ID`/`OPERATOR_ID`, `PRIVATE_KEY`, `RPC_URL`/`WS_RPC_URL`/`INDEXER_URL`, `MM_TICK`/`MM_LOT`, etc. (`config.ts:164-205`).

### 8b. Connecting to Somnia testnet (EC - different endpoints than spot)

Spot reuses `https://dream-rpc.somnia.network` / `stg.api.dreamdex.io`. EC uses the **somnia-markets** deployment (`packages/ec-core/src/config.ts:146-160`, `packages/ec-core/src/addresses.ts:65-92`):

| Field | Mainnet (chain 5031) | Shannon testnet (chain 50312) |
|-------|----------------------|------------------------------|
| `NETWORK` | `mainnet` | `testnet` (default) |
| Chain ID | `5031` | `50312` |
| RPC | `https://api.infra.mainnet.somnia.network` | `https://api.infra.testnet.somnia.network` |
| WS RPC | `wss://api.infra.mainnet.somnia.network/ws` | `wss://api.infra.testnet.somnia.network/ws` |
| Indexer (GraphQL) | `https://prd.smk.somnia.host/v1/graphql` | `https://dev.smk.somnia.host/v1/graphql` |
| Collateral | `0x00000022dA000002656c64D9eA6011ea952D008A` (USDso, 18dp) | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` (tUSDC, 6dp) |
| Decimals | 18 | 6 |
| marketCreator | `0x62627805965705Cc303A7F6282DD5059921980aD` | `0x5Ce69567dB39C8fBAd7e048bEfdbcCdfE67B44e6` |
| Core (binaryModule etc., CREATE3 deterministic) | `0x3ecC69…E388`, `0x28025…294`, `0xb2BE8…F04` … | same as mainnet (`addresses.ts:47-56`) |

Overrides: `RPC_URL`, `WS_RPC_URL`, `INDEXER_URL`, plus per-address `COLLATERAL`/`BINARY_MODULE`/… (`config.ts:51-63`).

Price feed (underlying BTC/ETH spot, distinct from EC's own probability): `SOMNIA_TESTNET_PRICE_FEED` bundled for testnet only; mainnet requires `PRICE_FEED_URL` (`config.ts:68-77`). Used by `exchange.fetchPrice/watchPrice`, not by order-book reads.

### 8c. Authentication - EC vs spot

| Aspect | Spot | EC |
|--------|------|----|
| Default | `PRIVATE_KEY` (fund key) + optional `OWNER_ADDRESS` (operator hot key) via `OperatorPermissionsRegistry` per-selector (`placeOrderFor 0x8005…`) (`packages/core/src/operator.ts`, `docs/session-keys.md`) | **No `OWNER_ADDRESS` / `OperatorPermissionsRegistry`**. EC's `operatorId`/`venueId` are **venue scoping**, not split-key auth. Signer is `PRIVATE_KEY` directly in `SomniaMarkets({privateKey})` (`exchange.ts:54-55`). |
| Operator/session-key | Yes - hot key can `placeOrderFor`/`cancelOrderFor` but never withdraw; requires `setManualVaultMode(true)` + vault deposit + grant | **Not documented / not found** in `ec-core/src/*` or `docs/event-contracts.md`. Grep for `OWNER_ADDRESS` in `packages/ec-core` returns 0 hits (only spot). EC inventory is ERC-6909 + collateral escrow from **wallet**, with local `seedInventory` faucet/mint-a-pair, not a vault. |
| SIWE/JWT | Yes for REST `prepareOrder` | Not applicable - EC writes go via `exchange.trader.*` (local `viem` signing + `realtime_sendRawTransaction`), not DreamDEX REST. Reads are indexer GraphQL. No `DreamDexRest`/`DreamDexWs` in EC path. |
| Faucet | `testnet.somnia.network` (SOMI) | `exchange.trader.faucet()` for tUSDC on testnet when `FAUCET_ENABLED` (default on testnet, off on mainnet) (`config.ts:201-202`, `inventory.ts:24-28`). |

**Conclusion:** Spot session-key model does **not** carry over to EC. Treat EC auth as single-key `PRIVATE_KEY` (or read-only with no key). If you need split-key for EC, it is not provided by this kit - report as unknown.

### 8d. How VENUE_ID is obtained/used

- Env: `VENUE_ID=0x…` (bytes32, `venueIdHash` in `venues.json`) or `OPERATOR_ID` numeric (`config.ts:175-187`, `docs/event-contracts.md:58-63`). Both differ per network: testnet `0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c`, mainnet `0x458b30c2d72bfd2c6317304a4594ecbafe5f729d3111b65fdc3a33bd48e5432d` (docs note these **move** - three changes in first week of August).
- Resolution (`markets.ts:68-103`): explicit `VENUE_ID`/`OPERATOR_ID` wins and filters `activeMarkets` via `inVenue()`; else if both unset and all live markets sit on one venue, that venue is inferred; else if live markets span several venues, `activeMarkets()` **throws** rather than guess (same rule in `settledMarkets():221-245` and `resolveVenue():107-124`). `explainEmptyScope()` distinguishes “no live markets” vs “scope excludes them” (`markets.ts:275-295`).
- Stale VENUE_ID symptom: `activeMarkets()` returns 0 and strategies log `no market to quote - …` via `explainEmptyScope()`.

### 8e. Discovering live Event Contracts (list/metadata)

| Method | File | Description |
|--------|------|-------------|
| `createExchange(opts).exchange.loadMarkets(true): Promise<Record<string,UnifiedMarket>>` | `exchange.ts:33-55` + SDK | Registry sweep (indexer) - all markets on deployment. EC-core then scopes to DreamDEX venue. |
| `activeMarkets(ctx, {asset?, max?}): Promise<UnifiedMarket[]>` | `markets.ts:68-103` | **Recommended**. Filters `loadMarkets()` to `type==="binary" && active && inVenue(scope)` and slices to `maxMarkets` (default 8). Asset filter optional (`BTC`/`ETH`). |
| `resolveVenue(ctx): Promise<{scope, source, markets}>` | `markets.ts:107-124` | Reports which venue the bot would trade (`env`/`inferred`/`none`) - used by doctor. |
| `explainEmptyScope(ctx): Promise<string>` | `markets.ts:275-295` | Human reason when `activeMarkets()` is empty (0 live binaries vs venue mismatch). |
| `venueOf(m)/operatorOf(m)` | `markets.ts:39-44` | Read `venueId`/`operatorId` off a `UnifiedMarket` row. |
| `outcomeSymbols(m): {yes,no}` | `markets.ts:140-143` | YES=outcome 0, NO=1 - tradable symbols (e.g. `BTC-15m-…:YES`). |
| `exchange.client.listBinaryMarkets({venueId?, operatorId?, status?, limit?})` | SDK (used in `markets.ts:236,247`) | Raw binary-tier listing. `status:"Finalized"` lists settled (not live) - see settlement §. |

Metadata on `UnifiedMarket` (binary): `symbol`, `info.marketId` (bytes32, stable key - **not** pool address), `info.asset` (`BTC`/`ETH`), `info.intervalSec`, `info.strike`, `info.expiry` (indexer), `info.venueId`, `info.operatorId`, `outcomes[0].symbol`/`[1].symbol`, `active` (derived trading window). Do **not** parse question text (`event-contracts.md:139-141`).

### 8f. Reading event-contract market state (price, probability, liquidity, time-to-expiry)

| Method | File | Description |
|--------|------|-------------|
| `marketOnchain(ctx, market): Promise<MarketOnchain|null>` | `markets.ts:134-137` | **Authoritative** per-`marketId` snapshot via `client.getMarketOnchain(marketId)`. Returns `{marketAddress, pool, outcomeToken, yesId/noId, oneCollateral, status (0-5), expiry (unix sec), isResolved/isVoided, winningOutcome, collateral, decimals, marketNonce, finalized, ...}`. **Gate on this status, not the indexer** (`MARKET_STATUS.Trading===1` only accepts orders) (`gotchas.ts:48-55`, `event-contracts.md:78-79`). Pool address is time-varying - key state by `marketId`/`symbol`, never pool (`event-contracts.md:128-129`). |
| `MARKET_STATUS` | `markets.ts:20-27` | `Listed 0, Trading 1, Locked 2, Settling 3, Resolved 4, Voided 5`. |
| `isTradable(onchain)` | `markets.ts:147` | `status===Trading`. |
| `snapshot(ctx, yesSymbol, depth=5): Promise<EcSnapshot>` | `markets.ts:157-163` | One-shot YES-book snapshot (human units): `{bestYesBid?, bestYesAsk?, yesMid?}` via `exchange.fetchOrderBook`. **Prices are YES probabilities in (0,1), not dollars** (`gotchas.ts:21-24`). Use `clampProbability`/`assertProbability` for derived prices. |
| `exchange.fetchOrderBook(yesSymbol, depth)` | SDK (via `snapshot`) | Raw `UnifiedOrderBook {bids:[price,qty][], asks:[], ...}` - price=YES probability, qty=shares. |
| `netPosition(ctx, onchain): Promise<number>` | `orders.ts:296-305` | `(YES held - NO held)` human units via ERC-6909 balances; a complete set is flat (worth 1 collateral) - net is risk. |
| `toHuman`/`fromHuman`, `probabilityToPrice`/`priceToProbability` | SDK re-export `index.ts:84-87` | Decimal converters (collateral decimals 6/18). |
| `toRawUnits(human, decimals)` / `quantize(ctx, human)` | `markets.ts:165-206` | Raw units & lot-grid snapping (uses `MM_LOT`). SDK's `amountToPrecision` skips lot sizing on binaries and floors to whole - **do not use** it (`markets.ts:173-180`). |
| `minLeftSec(intervalSec)` / `headroomSec(intervalSec, capSec=300)` | `orders.ts:345-354` | Scaled expiry headroom (`intervalSec*0.4`, min 30, cap 300) - fixed 300s swallows 5m windows (`event-contracts.md:118-121`). Compare `Number(onchain.expiry) - Date.now()/1000` to this. |
| `headroom` check pattern (all `ec-*`) | `ec-starter/src/index.ts:47-56`, etc. | `if (expiry - now < minLeftSec(interval)) return` - skip window about to close. |

**Implied probability / liquidity:** YES probability is the book price itself; mid is signal, touch + size is liquidity. No separate “implied” field - derive from best bid/ask or from underlying spot via `exchange.fetchPrice` (price-feed, testnet only). **Time remaining:** `onchain.expiry - nowSec` seconds.

### 8g. Reading the event-contract order book (same CLOB primitives as spot, or different?)

**Different stack, same shape.** Spot uses `getBookLevels` / `fetchOrderbooks` on SpotPool contracts. EC uses `exchange.fetchOrderBook(symbol, depth)` / `fetchOpenOrders(symbol)` over the binary pools via the SDK's unified tier, which itself sits on the same on-chain CLOB (binary pools). Human-unit tuple `[price, qty]`; price is probability (0,1) not quote price. There is **no REST `DreamDexWs`/`DreamDexRest` in EC** - EC's `SomniaMarkets` has its own WS RPC + indexer URIs (`config.ts:149-153`). Indexer rows lag chain by seconds - treat chain (`marketOnchain`) as truth (`event-contracts.md:124`).

| Method | File | Description |
|--------|------|-------------|
| `exchange.fetchOrderBook(yesSymbol, depth=5): Promise<UnifiedOrderBook>` | SDK | YES-book for depth; `bids[0][0]`/`asks[0][0]` are probabilities. EC's `snapshot()` wraps this. |
| `exchange.fetchOpenOrders(symbol)` | SDK | Open orders for **that symbol** (not all venues). Prefer per-market over `fetchOpenOrders()` with no symbol (spans binary+spot+perp). |
| `exchange.watchOrderBook` / `watchOrders` | SDK (not in `ec-core` wrappers) | Live-tail WS (available on SDK, not wrapped by `ec-core` - **Not documented / not found** as a kit helper). |
| `getMarketOnchain` | SDK via `marketOnchain()` | Pool/nonce/outcomeIds - needed to interpret book + to place/cancel. |

Tick/lot are **not discoverable via SDK** on binaries (rows carry no `tickSize`/`lotSize` unlike spot/perp) - they come from `MM_TICK`/`MM_LOT` config (`config.ts:191-198`: mainnet `1e15` for both, testnet `1`/`1_000`).

### 8h. Placing / cancelling orders on an event contract

| Method | File | Description |
|--------|------|-------------|
| `placeLimit(ctx, {market, onchain, outcome:"YES"|"NO", side:"buy"|"sell", price, size, type, expiresInSec}): Promise<PlacedOrder>` | `orders.ts:100-159` | **Recommended**. Snaps `price` to tick (round) and `size` to lot (floor) as **integers** via `toSteps` (avoids float `toFixed(18)` reverts on 18dp venue - `price=0.05` would become `…0003` and hit `InvalidPrice` if float path used). Validates `0<price<1`, `0<quantity<=lotGrid`, checks wallet funded (`assertFunded`), caps `expireTimestampNs` at `onchain.expiry`, then `exchange.trader.placeOrder({pool, side:BinarySide, price:priceYes, quantity, outcomeToken, yesId, noId, orderType, expireTimestampNs})` where `priceYes = outcome==="YES"?priceOwn:one-priceOwn` and `orderType = POST_ONLY|MARKET|LIMIT`. Returns `{rested, orderId?, filled, size, price, hash}`. Checks receipt via `assertTxOk` (reverted writes resolve otherwise). Types: `post-only` (maker, rejected if would cross), `ioc` (`MARKET`, takes then cancels), `limit` (takes then rests). |
| `ORDER_TYPE` (SDK) | `@somnia-chain/markets-sdk` | `POST_ONLY`, `MARKET` (IOC), `LIMIT` (GTC-like with remainder resting). EC does **not** use spot's `FillOrKill`/`PostOnly` numeric enum via `Pool`. |
| `BinarySide` | SDK `orders.ts:29` | `BUY_YES / SELL_YES / BUY_NO / SELL_NO` - derived from `outcome+side` (`SIDES` map `orders.ts:72-77`). |
| `sellableSize(ctx, onchain, outcome, want)` | `orders.ts:170-184` | Caps SELL to held ERC-6909 balance, snapped to lot; 0 means skip. Needed because `MM_INVENTORY` (1 on mainnet) may be < `MM_QUOTE_SIZE`. |
| `quantize(ctx, human)` | `markets.ts:193-206` | Snap DOWN to lot grid, walking down until `toRawUnits(size)%lot===0`; 0 means below one lot. |
| `cancelById(ctx, onchain, orderId)` | `orders.ts:330-334` | `exchange.trader.cancelOrder({pool, orderId})` + `assertTxOk`. |
| `cancelTracked(ctx)` | `orders.ts:275-288` | Cancel orders this process placed that rested (`restingOrders` map); errors swallowed (filled/expired already). |
| `cancelVenueOrders(ctx)` | `orders.ts:315-327` | Cancel live venue's open orders per market via `fetchOpenOrders(yes)` + `cancelOrder`. Safer than global `fetchOpenOrders()` with no symbol (would cross portfolios). |
| `exchange.cancelOrder(id, symbol)` | SDK | Unified cancel (used inside maker loops per market). |
| Raw: `exchange.trader.placeOrder/cancelOrder` | SDK | Bigint-tier - the only path that accepts exact `price`/`quantity` as bigints (unified `createOrder` takes float and reverts on 18dp venues). |
| `untrackOrder(id)` | `orders.ts:266-268` | Remove from `restingOrders` when pulled via unified cancel. |

Inventory for SELL: no naked short - `SELL` needs held `YES`/`NO` tokens; seed via `seedInventory` (mint-a-pair) first. `placeLimit` checks wallet before signing (`assertFunded` checks native gas >0, then `price*quantity` collateral for buy or outcome balance for sell, including vault fallback).

Expiry: every order carries `expireTimestampNs = expiresAt*1e9`, capped at `onchain.expiry`; default `expiresInSec=300` (5m). `type="ioc"` vs `limit` is a deliberate choice - `limit` remainder rests with escrow locked (`event-contracts.md:94-95`).

### 8i. Settlement / claim at expiry

Markets progress `Trading→Locked→Settling→Resolved/Voided` (`MARKET_STATUS`). Winnings are **claimed, not received** - balance stays spread across finalized markets until redeemed (`event-contracts.md:28-34`).

| Method | File | Description |
|--------|------|-------------|
| `settledMarkets(ctx, limit=40)` | `markets.ts:221-264` | Recently settled in venue: `listBinaryMarkets({venueId, status:"Finalized", limit: want*3})` then sort by `expiry` desc slice `want`. **Do not use `loadMarkets()` for settled** - it skips finalized since `markets-sdk 0.20` (`event-contracts.md:130-137`). |
| `claimableOutcomes(onchain, held)` | `settlement.ts:120-131` | Which sides still redeemable: voided→ both held>0 (refund 0.5 each), resolved→ winning side only. |
| `estimatePayout({onchain, outcome, amount, feeBps})` | `settlement.ts:96-117` | `estPayoutFor()` wrapper with fee. Winner pays `1−settlementFeeBps` (not 1:1); loser 0; voided 0.5 (no fee). Guard: unresolved→0. |
| `settlementFeeBps(ctx, market, onchain?)` | `settlement.ts:47-90` | Indexer `getMarketFees().settlementFeeBps` preferred; fallback reads on-chain: finalized→ `binarySettlement.getSettlement(yesId).settlementFeeBpsTimes1k/1000`, live→ `pool.getBinaryPoolParams().settlementFeeBpsTimes1k/1000`. Throws if finalized and `BINARY_SETTLEMENT` unset (pool recycled). |
| `redeemOutcome(ctx, market, onchain, outcomeIdx, amount)` | `settlement.ts:138-154` | `exchange.trader.redeem({marketId, market, outcomeToken, outcomeIdx, amount})` + `assertTxOk`; explicit `outcomeIdx` required for voided. Finalizes market if needed. |
| `redeemHoldings(ctx, market, onchain, held?)` | `claim.ts:95-140` | Redeems every claimable side (dry-run logs estimate). Reads fee, calls `redeemOutcome` per side. |
| `claimSettled(ctx, {scan?, verbose?})` | `claim.ts:58-89` | Sweeps `settledMarkets(scan)` and redeems claimable; no-op if no signer or empty. |
| `maybeClaim(ctx, {intervalMs?, scan?, verbose?})` | `claim.ts:149-159` | **Loop helper** - throttled (default `AUTO_CLAIM_INTERVAL_MS 600k`), respects `AUTO_CLAIM=false`, swallows errors (indexer hiccup shouldn't kill bot). Call once per strategy loop. |
| `seedInventory(ctx, market, onchain)` | `inventory.ts:22-54` | One-time mint-a-pair (`exchange.mintSet(symbol, inventory)`) to collateralize SELLs; faucets tUSDC on testnet if `<1000*one`. Re-checks gas. |
| `estPayoutFor` (SDK) | SDK | Direct payout calc if needed. |

EC's `ec-settlement` strategy (`strategies/ec-settlement/src/index.ts:12-14`): `CLAIM=1` sweeps settled via `maybeClaim` or `claimSettled`; every other `ec-*` also calls `maybeClaim()` each loop.

Vault vs wallet: per-pool vault is payout **fallback** (reads 0 normal) - escrow leaves wallet and returns to wallet on cancel; placement draws vault first if non-zero but `assertFunded` checks `wallet+vault` for buy.

### 8j. Auth comparison - does spot session-key apply to EC?

**No.** Verified `grep -r OWNER_ADDRESS/OperatorPermissionsRegistry` in `packages/ec-core/src` → 0 hits; `docs/session-keys.md` is spot-only and referenced only from `packages/core`/`strategies/*` (spot). EC strategies never read `OWNER_ADDRESS`; they use `createExchange({privateKey})` single-key. EC's `operatorId`/`venueId` are **venue routing**, not `OperatorPermissionsRegistry` selectors (`0x80054449` etc.). Any split-key for EC would be a separate design - **Not documented / not found** as a kit feature.

## References (file:line)

- Networks/RPC/chain IDs: `packages/core/src/config/networks.ts:33-54` - `README.md:121-126`
- Markets: `packages/core/src/config/tokens.ts:68-94`
- Install: `package.json:7-11`, `packages/core/package.json:12-13`, `README.md:52-54`
- Init: `packages/core/src/index.ts:9-16`, `packages/core/src/client.ts:37-52`
- Auth (SIWE): `packages/core/src/rest.ts:53,99-126`
- Session keys: `docs/session-keys.md:8-78`, `packages/core/src/operator.ts`, `packages/core/src/contract.ts:135-147`
- List/open orders/position: `pool.ts:80-159`, `contract.ts:56-132`, `gotchas.md:89-99,112-133`
- Backtest: `packages/backtest/*`, `docs/backtesting.md:1-139`
- EIP-7702: `advanced/batch-7702/README.md:1-65`, `advanced/batch-7702/src/index.ts`, `advanced/batch-7702/contracts/DreamDexVolumeBatch7702.sol`
- EC SDK: `packages/ec-core/package.json:15`, `packages/ec-core/src/config.ts:19-20,146-160`, `packages/ec-core/src/addresses.ts:65-92`, `packages/ec-core/src/exchange.ts:28-58`
- EC markets/order-book: `packages/ec-core/src/markets.ts:68-107,134-163,221-264`, `packages/ec-core/src/orders.ts:72-159,170-354`, `strategies/ec-starter/src/index.ts:44-86`
- EC settlement/claim: `packages/ec-core/src/settlement.ts:47-154`, `packages/ec-core/src/claim.ts:49-159`, `packages/ec-core/src/inventory.ts:22-54`, `docs/event-contracts.md:28-148`
