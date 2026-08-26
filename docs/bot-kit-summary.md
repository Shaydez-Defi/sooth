# DreamDEX Bot Kit — Summary (verified from `vendor/dreamdex-bot-kit`)

> Source: `vendor/dreamdex-bot-kit` cloned from `https://github.com/somnia-chain/dreamdex-bot-kit` on 2026-08-26.
> Branch: `main` (HEAD `1a9b4f3` at clone time — verify with `git log -1` inside vendor).
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

- Dependency is `@dreamdex-bot-kit/core` (TypeScript, `viem` + `ws` deps) — see `packages/core/package.json:2,16-18`.
- Python mirror exists at `packages/core-py` (Python + web3) — strategies have `python/` variants.
- Install per kit: `npm install` in kit, then depend via local file path or published package. Kit README does **not** document a public npm registry publish for `@dreamdex-bot-kit/core`; external projects should reference the local kit via `file:./vendor/dreamdex-bot-kit/packages/core` or by copying/mirroring that package. (Verified: no registry URL in `packages/core/package.json`; `README:68` says `npm install` installs workspace.)
- Minimal TS init (verified `packages/core/src/index.ts:9-16`, `skills/dreamdex-bot/SKILL.md:40-53`):

```ts
import { createChainContext, Pool, ORDER_TYPE } from "@dreamdex-bot-kit/core";

const ctx = createChainContext();                // reads PRIVATE_KEY + NETWORK from env (see §3)
const pool = await Pool.load(ctx, "SOMI:USDso"); // MARKET must exist in MARKETS[net.name]
const { bestBid, bestAsk, mid } = await pool.topOfBook();
```

`createChainContext(privateKey?)` builds `viem` `publicClient` + `walletClient` for the active network (see `packages/core/src/client.ts:37-51`). `Pool.load` fetches on-chain `getPoolParams` — no hard-coded tick/lot needed.

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

**Connection pattern (read-only — no private key needed for REST/on-chain reads if you construct clients manually; `createChainContext` requires `PRIVATE_KEY` for signing path):**

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
- Used for **direct-contract path** (`placeOrder` etc.) — you sign locally, broadcast via RPC. No separate login step.
- For **REST prepare path**, auth is SIWE (EIP-4361) inside `DreamDexRest`:
  1. `GET /auth/nonce` (no auth)
  2. Sign SIWE message: `"<domain> wants you to sign in with your Ethereum account:\n<address>\n\nSign in to dreamDEX\n\nURI: <origin>\nVersion: 1\nChain ID: <net.chainId>\nNonce: <nonce>\nIssued At: <iso>"`
  3. `POST /auth/login` with `{message, signature}` → `{token, expiresAt}` JWT — cached, refreshed 3 min before expiry (`rest.ts:53,99-126`).
  - **Chain ID in SIWE MUST match `NETWORK`** — mismatch rejected (gotcha #14, `gotchas.md:114-126`).
  - The REST order endpoints return an **unsigned tx**; you still sign+broadcast yourself (`architecture.md:17-19`).

### 3b. Operator / Session key (split-key / hot key that cannot withdraw)

Verified: `docs/session-keys.md`, `packages/core/src/operator.ts`, `packages/core/src/execute.ts:153-192`, `packages/core/src/contract.ts:99-147`.

- Two keys: **Fund key (owner)** — cold, holds funds, deposits into vault, grants permissions. **Operator key (bot)** — hot, on server.
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

**Not documented as supported:** Using an operator key with wallet auto-pull (default) — docs state operator path requires **manual vault mode** with deposited working capital (`session-keys.md:73-74`). Behavior of auto-pull via operator is not documented — assume unsupported.

## 4. Exact method names for key operations

All names verified against `packages/core/src/*`. The kit offers **three equivalent layers**: `Pool` (ergonomic, recommended), raw `contract.ts` helpers, and `rest.ts` prepare endpoints. Prefer `Pool`.

### 4a. Listing markets

| Method | File | Description |
|--------|------|-------------|
| `DreamDexRest.fetchMarkets(): Promise<MarketInfo[]>` | `rest.ts:65-68` | `GET /v0/markets` — canonical, always-current. Returns `symbol, contract, base, quote, baseDecimals, quoteDecimals, tickSize, lotSize, minQuantity`. Docs note: **never hard-code addresses** (`README:129`). |
| `MARKETS[net.name][symbol]` | `config/tokens.ts:33-94` | Static convenience map (testnet: SOMI:USDso, WBTC:USDso, WETH:USDso). |
| `readPoolParams(client, pool)` | `contract.ts:176-187` | `getPoolParams()` on-chain → `{baseToken, quoteToken, makerFeeBpsTimes1k, takerFeeBpsTimes1k, tickSize, minQuantity, lotSize}` (7 fields, order documented in gotcha #6). |

### 4b. Reading order book

| Method | File | Description |
|--------|------|-------------|
| `Pool.topOfBook(depth?) : Promise<{bestBid?, bestAsk?, mid?}>` | `pool.ts:80-89` | Reads **on-chain** via `readBookLevels` for both sides, converts with `fromRaw`. Depth default 1. |
| `readBookLevels(client, pool, isBid, depth=5): Promise<BookLevel[]>` | `contract.ts:199-212` | Raw `getBookLevels(isBid, numLevels)` → `{priceRaw, sizeRaw}[]`. Returns `[]` on empty book (not revert) — do not swallow errors. |
| `DreamDexRest.fetchOrderbooks(symbols, depth=5)` | `rest.ts:71-74` | `GET /orderbooks?symbols=...&depth=...` — REST snapshot (can lag). |
| `DreamDexWs.subscribeOrderbook(symbols)` + `subscribeTrades` / generic `subscribe(channel, params)` | `ws.ts:82-88` | WebSocket `wss://.../v0/ws/public`, with heartbeat ping 30s, auto-reconnect + replay subscriptions. |

For price-sensitive quoting, docs recommend on-chain `topOfBook` / `getBookLevels` as canonical (see `architecture.md:60-64`).

### 4c. Placing an order

| Method | File | Description |
|--------|------|-------------|
| `Pool.place({isBid, price, qty, orderType?, expireMs?})` | `pool.ts:91-109` | **Recommended.** Quantizes `price` via `alignToTick(toRaw(price, quoteDecimals), tickSize, side)` and `qty` via `alignToLot`, builds `expireTimestampNs` via `buildExpireNs(expireMs ?? 60min)`, then delegates to `placeOrder` or `placeOrderFor` if `ctx.owner` set. Defaults to `ORDER_TYPE.ImmediateOrCancel` (IOC taker). |
| `placeOrder(ctx: ExecCtx, params: PlaceOrderParams)` | `execute.ts:70-151` | Direct-contract path: guards → `getAutoPullRequirement` → allowance/`msg.value` → `simulateContract` (bail if `success===false`) → `estimateContractGas` → `writeContract(placeOrder)` → receipt + `OrderPlaced` log check → read `orderId` from receipt topic1. Gas floor ≥700k; native-base BUY floor `NATIVE_BASE_BUY_GAS = 5_000_000`. |
| `placeOrderFor(ctx, params, owner)` | `execute.ts:160-192` | Operator variant — same guards but via `placeOrderFor(owner, ...)`. No auto-pull; draws from owner's vault (manual mode required). |
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
| **On-chain fills** `TOPIC.OrderFilled = 0xc87f4223e9e7c4e4f39f9b34fc9d64d78cdb95d9035b3748cbde59521261a399` (6-arg signature) | `contract.ts:158-164` | Subscribe to `OrderFilled` logs — **canonical source**. REST `/v0/trades` can lag/stall for extended periods (gotcha #11). Docs: for PnL/inventory, read event from chain, valuing each fill at maker's resting price (`architecture.md:65-67`). |
| `Pool.openOrderIds(): Promise<bigint[]>` | `pool.ts:117-128` | `getOwnOpenOrders()` via `readContract` with `account: subject` (owner-aware). In operator mode uses `ctx.owner` as call subject to see owner's resting orders. |
| `Pool.vaultBase(): Promise<number>` | `pool.ts:131-135` | `getWithdrawableBalance(pool, subject, token)` — token is `NATIVE_SENTINEL 0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00` for native base. In auto-pull mode this reads ~0; useful only in manual vault mode. |
| `Pool.walletBase(): Promise<number>` | `pool.ts:147-159` | **Live inventory** in default auto-pull/deliver mode — `balanceOf(subject)` or `getBalance(subject)` for native. Docs: fills settle to wallet, so this is the correct inventory number (`gotchas.md:89-92`, `pool.ts:136-143`). |
| `readWithdrawableBalance(client, pool, owner, token)` | `contract.ts:214-221` | Raw vault balance read. |
| `getOrder(orderId)` (ABI) / `DreamDexRest.getOrder(symbol, orderId)` | `contract.ts:123-132`, `rest.ts:94-96` | Fetch single order metadata (on-chain vs REST). |
| `DreamDexRest.fetchOrderbooks` / `ws trades` | `rest.ts:71-74`, `ws.ts:88` | Trade tape (REST `trades` / WS `trades`) — laggy, not authoritative for fills. |

**Positions/PnL:** No single "getPosition" helper — position is derived from wallet/vault balances + `OrderFilled` history. Kit's `tools/edge-analytics` (`tools/edge-analytics/README.md`) measures realized fill quality from CSV logs, not live PnL.

**Not found / not documented as a kit method:** A direct `fetchFills` / `fetchPositions` SDK call. Reads are done via event logs / balances. `GET /v0/trades` exists as REST but kit docs explicitly warn against relying on it for fills (`gotchas.md:94-99`).

## 5. Historical backtesting utilities

Verified: `packages/backtest` (`package.json`, `src/`), `docs/backtesting.md`, `scripts/backtest.ts`, `README.md:20,86-95`.

- **Package:** `@dreamdex-bot-kit/backtest` — bar-by-bar engine (`SimPool`, fill model, metrics). Uses synthetic order book from OHLCV candles.
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

- **Location:** `advanced/batch-7702` — **technique demo, not a trading strategy** (`README:1-3`).
- **What it does:** Demonstrates **EIP-7702** to batch multiple on-chain actions into a single type-4 transaction by temporarily delegating the EOA to a contract. Example: **atomic buy→sell round-trip in one tx** — two fills, one signature, one gas payment, inventory flat. Pattern generalizes to any atomic multi-step (e.g. `approve+place` or `place+place` across pairs).
- **How it works:**
  1. Delegates the wallet to `DreamDexVolumeBatch7702` implementation (signs an EIP-7702 authorization).
  2. Calls `atomicRoundTrip` **on own address** in a type-4 tx. Since the EOA now runs the implementation's code, `address(this)` is the wallet — inside the call it IOC-buys (pool auto-pulls quote, delivers base to caller) then IOC-sells **exactly the base just received** (balance delta, handles partial fills). Uses modern wallet auto-pull — no vault step (`README:14-24`).
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

- **Shared client surface:** `packages/core/src/*` — `config/networks+tokens`, `gotchas.ts` (guards), `quant.ts` (tick/lot math), `contract.ts` (modern ABI + `TOPIC`), `execute.ts` (safe lifecycle), `pool.ts` (ergonomic handle), `nonce.ts` (local nonce manager for high throughput), `rest.ts` (SIWE + prepare), `ws.ts` (WS with heartbeat/reconnect), `operator.ts` (session keys), `yield.ts` (presence-score/yield logging).
- **Strategies:** `strategies/starter` (single `decide()` function, recommended start), plus `market-making`, `grid`, `momentum`, `mean-reversion`, `twap`, `ensemble` (modular ensemble+optional LLM). Event-contract variants `ec-starter`, `ec-maker`, `ec-passive`, `ec-laddering-bot`, `ec-oracle-follow`, `ec-settlement` sharing repo but separate SDK `@somnia-chain/markets-sdk` (`README:21-23`).
- **Operations:** `docs/24-7-operations.md` (auth refresh, nonces, reconnects, throughput), `docs/measuring-edge.md` + `tools/edge-analytics` (captured spread vs adverse selection vs tx/fill; Glosten-Milgrom inequality), `scripts/doctor.ts` (read-only wallet+book check), `scripts/inspect-and-clean.ts`, `scripts/one-ioc.ts`.
- **Agent skills:** `skills/somnia/SKILL.md` + `skills/dreamdex-bot/SKILL.md` (embedded directives for AI agents).
- **What is NOT documented as a kit capability:** Exchange-style `fetchBalance` / `fetchPositions` aggregation; historical order-book replay; simulated SIWE auth without a key; fee rebate analytics beyond `edge-analytics`. If absent above, assume not supported by the kit.

## References (file:line)

- Networks/RPC/chain IDs: `packages/core/src/config/networks.ts:33-54` — `README.md:121-126`
- Markets: `packages/core/src/config/tokens.ts:68-94`
- Install: `package.json:7-11`, `packages/core/package.json:12-13`, `README.md:52-54`
- Init: `packages/core/src/index.ts:9-16`, `packages/core/src/client.ts:37-52`
- Auth (SIWE): `packages/core/src/rest.ts:53,99-126`
- Session keys: `docs/session-keys.md:8-78`, `packages/core/src/operator.ts`, `packages/core/src/contract.ts:135-147`
- List/open orders/position: `pool.ts:80-159`, `contract.ts:56-132`, `gotchas.md:89-99,112-133`
- Backtest: `packages/backtest/*`, `docs/backtesting.md:1-139`
- EIP-7702: `advanced/batch-7702/README.md:1-65`, `advanced/batch-7702/src/index.ts`, `advanced/batch-7702/contracts/DreamDexVolumeBatch7702.sol`
