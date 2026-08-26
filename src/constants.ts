/**
 * Protocol constants — single source of truth, no magic numbers in logic.
 * Values verified from @dreamdex-bot-kit/core and docs.
 */

// LIVE_ONCHAIN — chain IDs recognized by the protocol / Bot Kit
export const CHAIN_IDS = {
  MAINNET: 5031,
  TESTNET: 50312,
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

// LIVE_ONCHAIN — native sentinel for SOMI vault reads (see docs/gotchas.md #5)
export const NATIVE_SENTINEL = "0x28f34DeFd2b4CB48d9eE6d89f2Be4Bc601694c00" as const;

// DERIVED — network defaults (pulled from packages/core/src/config/networks.ts)
export const NETWORK_DEFAULTS = {
  testnet: {
    chainId: CHAIN_IDS.TESTNET,
    rpcUrl: "https://dream-rpc.somnia.network",
    restApi: "https://stg.api.dreamdex.io/v0",
    wsUrl: "wss://stg.api.dreamdex.io/v0/ws/public",
    explorer: "https://shannon-explorer.somnia.network",
  },
  mainnet: {
    chainId: CHAIN_IDS.MAINNET,
    rpcUrl: "https://api.infra.mainnet.somnia.network",
    restApi: "https://api.dreamdex.io/v0",
    wsUrl: "wss://api.dreamdex.io/v0/ws/public",
    explorer: "https://explorer.somnia.network",
  },
} as const;

export const DEFAULT_NETWORK = "testnet" as const;
export type NetworkName = "testnet" | "mainnet";

// ESTIMATED — thresholds used for display / validation (not protocol-enforced)
export const SPREAD_WARN_BPS = 500; // warn if spread > 5% (illiquid book)
