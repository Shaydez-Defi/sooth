# Stage 8 Verification - EIP-7702 × Event Contracts (brief §12, optional item)

Date: 2026-08-28. Branch `main` (after `52e5252` stage 7). No prior stage 8 attempt found (git log + docs/ checked).

## Verdict (read this first)

**EIP-7702 batching does not directly generalize to Event Contracts.** The existing
`DreamDexVolumeBatch7702` implementation contract cannot be pointed at an EC pool - it calls the
spot pool's order entry, which the EC (binary) pool **reverts with `UseBinaryPlacement()`** - proven
by read-only `eth_call` simulation against a live EC pool on Shannon testnet, not just from docs.
A **new implementation contract** (calling `placeBinaryOrder` with ERC-6909-aware escrow handling)
would be required. Per the brief's STOP CONDITIONS, no new Solidity contract was written or
deployed: that is a real scope increase for an optional item, only to be taken on explicitly.

## Step 1 - Re-verified scope of the existing example (against actual code, full reads)

`vendor/dreamdex-bot-kit/advanced/batch-7702`:

- **What `atomicRoundTrip` actually calls** (`contracts/DreamDexVolumeBatch7702.sol:14-26, 78-83`):
  the spot pool entry `placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity,
  uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder,
  uint96 builderFeeBpsTimes1k) payable` - selector `0x4e978373` (computed, matches the SDK's spot
  ABI declaration in `@somnia-chain/markets-sdk/dist/tradeAbi.js:60`). It then measures inventory
  with **ERC-20** `approve`/`balanceOf` deltas on quote/base tokens (lines 65-73).
- **What EC actually calls** (Stage 1.5/2 findings, re-confirmed in `node_modules/@somnia-chain/markets-sdk/dist/orders.js:499-534`):
  ec-core's `placeLimit` → SDK `trader.placeOrder` → **`placeBinaryOrder(uint8 kind, uint256 price,
  uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address
  builder, uint96 builderFeeBpsTimes1k, uint64 userData) payable`** - selector `0x718c2d4d`,
  `kind` ∈ {BUY_YES, SELL_YES, BUY_NO, SELL_NO}, price always in YES terms, `userData` moved to the
  end. `tradeAbi.js:12-19` documents that the generic `placeOrder` entry **REVERTS
  `UseBinaryPlacement` on a binary pool**; `orders.js:514-516` ("Pool-direct") encodes the same.
- **Escrow model**: EC buys escrow via collateral ERC-20 allowance; **EC sells need a one-time
  ERC-6909 operator grant** on the outcome-token singleton (`ensureOperator`, `orders.js:537-547`).
  Outcome positions are **ERC-6909 id-based balances** - the batcher's
  `IERC20(baseToken).balanceOf(address(this))` delta cannot even read them.

**Conclusion of Step 1**: materially different contracts/ABIs - different selector, different arg
layout, different order-identification model (isBid vs BUY/SELL×YES/NO kind), different escrow

## Step 2 - Path decision

Because the interfaces are materially different (Step 1), the "cheap test" path (point
`IMPL_ADDRESS`'s `atomicRoundTrip` at an EC pool unmodified) is **dead on arrival**: the batch's
`_placeIoc` would revert `UseBinaryPlacement()` inside the delegated call and the whole type-4 tx
would revert. The alternative - writing and deploying a new 7702 implementation contract that
calls `placeBinaryOrder` + handles ERC-6909 operator grants + measures ERC-6909 id-balance deltas -
is a genuine new-contract scope increase for an optional brief item. Per the STOP CONDITIONS,
**we STOP here and report the gap** rather than build it speculatively.

To make the negative result *evidence-backed* rather than doc-only, a read-only probe was added:
`src/scripts/eip7702-ec-probe.ts` (no signer, no transactions, no deployment, no funds - pure
`eth_call` simulation). It (1) computes both selectors, (2) resolves a live EC pool address via
ec-core (`LIVE_ONCHAIN`), (3) `eth_call`s the SPOT signature against that pool - byte-for-byte what
the 7702 batcher does - and (4) `eth_call`s EC's real `placeBinaryOrder` entry for contrast.
Revert data is decoded via verified error selectors (identified by selector-matching the SDK's
418-error table in `dist/contractErrorsAbi.js`; that table is not exported from the package root).

## Probe output (live Shannon testnet, 2026-08-28)

```
[probe] spot   selector placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96) = 0x4e978373
[probe] binary selector placeBinaryOrder(uint8,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64) = 0x718c2d4d
[probe] selectors identical: false
[probe] UseBinaryPlacement() selector = 0x341c6622
[probe] live EC pool: 0xd6fBBe5Eb2D7De1071EB07DA69A8E18482F9E927 (market ETH-0-28AUG26-0230/tUSDC, LIVE_ONCHAIN)
[probe] eth_call SPOT placeOrder on EC pool: REVERTED - Execution reverted for an unknown reason.
[probe] eth_call SPOT placeOrder on EC pool: revert data (depth 2): 0x341c6622
[probe] eth_call SPOT placeOrder on EC pool: decoded error: UseBinaryPlacement()
[probe] eth_call placeBinaryOrder on EC pool: REVERTED - Execution reverted for an unknown reason.
[probe] eth_call placeBinaryOrder on EC pool: revert data (depth 2): 0xfb8f41b2...00000000000000000000000000000000000000000000000000000000000007ce
[probe] eth_call placeBinaryOrder on EC pool: decoded error: ERC20InsufficientAllowance(0xd6fBBe5Eb2D7De1071EB07DA69A8E18482F9E927, 0, 1998)
[probe] done - read-only, no state changed, nothing deployed.
```

Interpretation (all LIVE_ONCHAIN revert data, decoded with DERIVED selectors):

## What would EC 7702 batching require (gap report, not implemented)

A new implementation contract (not written - scope decision per STOP CONDITIONS) would need:
1. Call `placeBinaryOrder(uint8 kind, price, quantity, expireNs, orderType, selfMatch, builder, fee, userData)`
   on the EC pool with `kind` = BUY_YES/SELL_YES etc., price in YES terms, tick/lot-snapped integers.
2. Handle escrow: collateral ERC-20 `approve` for buys; **`setApprovalForAll` (ERC-6909 operator
   grant) on the outcome-token singleton for sells** - not plain `IERC20.approve`.
3. Measure inventory via **ERC-6909 `balanceOf(owner, tokenId)`** (id from `marketOnchain` yes/no
   token ids) for the balance-delta pattern; keep the "sell exactly what was bought" partial-fill fix.
4. Respect the v2 order-expiry rule (`0 < expireNs <= marketExpiryNs`) and `QuantityBelowMinimum`.
5. Re-verify EIP-7702 type-4 acceptance on Somnia **for this new delegation** (the kit's example
   proves the chain accepts type-4 txs for the spot demo, but each delegation/impl is its own tx).

## Final report

- **Finding**: EIP-7702 batching does **not** directly generalize to Event Contracts. The spot
  `placeOrder` entry the existing implementation contract uses is explicitly blocked on EC pools
  (`UseBinaryPlacement`), and the inventory/escrow primitives it relies on (ERC-20 balances,
  ERC-20 approvals) do not model EC outcome tokens (ERC-6909 ids + operator grants).
- **Evidence**: on-chain `eth_call` simulations against live EC pool
  `0xd6fBBe5Eb2D7De1071EB07DA69A8E18482F9E927` (testnet) + selector-level ABI comparison against
  `@somnia-chain/markets-sdk` source. Probe artifact: `src/scripts/eip7702-ec-probe.ts` (re-runnable).
- **Scope decision**: no new Solidity contract written or deployed - explicitly out of the optional
  item's reasonable scope per the brief's STOP CONDITIONS. This closes brief section 12 with a
  definitive, evidence-backed negative result.

## Validation

- `npx tsc --noEmit` clean; `npx eslint src` 0 errors; full test suite 56/56 (probe is a script,
  no unit test - its verification value is the live probe run recorded above).
- No funds spent, no transactions sent, nothing deployed, no state changed (read-only `eth_call`).


1. **SPOT `placeOrder` on the EC pool → `UseBinaryPlacement()`** - the exact call
   `DreamDexVolumeBatch7702._placeIoc` makes cannot execute on an EC pool. This is the on-chain
   proof of the negative result. (The 7702 delegation mechanics are irrelevant at this point:
   the delegated EOA's call would hit the same revert, rolling back the entire atomic batch.)
2. **`placeBinaryOrder` on the EC pool → `ERC20InsufficientAllowance(pool, 0, 1998)`** - the EC
   path gets past placement dispatch and reaches escrow (1998 raw = 0.999 price × 2000 qty / 1e6,
   the exact collateral cost). This confirms the real EC entry works as Stage 2 demonstrated with
   a real placed order; it is simply a different ABI and escrow rail from spot.

Probe iterations (honest record of gate discovery, all read-only):
- quantity 1 raw → `QuantityBelowMinimum(1, 1000)` (pool minimum gate; selector-matched to the SDK table)
- fixed +1h expiry → `OrderAlreadyExpired()` (market expiry gate; short-interval markets)
- final: quantity 2000 raw + market's own on-chain expiry → the two decoded errors above

rail (ERC-20 approve vs approve + ERC-6909 operator grant), different inventory token standard
(ERC-20 vs ERC-6909 id balances). Not a config change.
