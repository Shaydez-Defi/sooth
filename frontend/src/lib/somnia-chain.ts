// Canonical Somnia Shannon testnet params for the injected-wallet flow.
// Values mirror src/constants.ts NETWORK_DEFAULTS.testnet - single source of truth lives there.

export const SOMNIA_CHAIN_ID_DEC = 50312;
export const SOMNIA_CHAIN_ID_HEX = "0xC488";
export const SOMNIA_CHAIN_NAME = "Somnia Shannon Testnet";
export const SOMNIA_RPC_URL = "https://dream-rpc.somnia.network";
export const SOMNIA_EXPLORER_URL = "https://shannon-explorer.somnia.network";
export const SOMNIA_NATIVE_CURRENCY = {
  name: "Somnia Test Token",
  symbol: "STT",
  decimals: 18,
} as const;

// EIP-1193 / EIP-3085 provider error codes.
export const USER_REJECTED_REQUEST_CODE = 4001;
export const CHAIN_NOT_ADDED_CODE = 4902;

const MOBILE_UA_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
const ADDRESS_LEAD_LEN = 6;
const ADDRESS_TAIL_LEN = 4;

// Minimal EIP-1193 injected provider shape - no wallet SDK needed.
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?: (event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void) => void;
  removeListener?: (event: "accountsChanged" | "chainChanged", listener: (value: unknown) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function getInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export function isMobileUserAgent(userAgent: string): boolean {
  return MOBILE_UA_PATTERN.test(userAgent);
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") return false;
  return isMobileUserAgent(navigator.userAgent);
}

export function shortAddress(address: string): string {
  if (address.length <= ADDRESS_LEAD_LEN + ADDRESS_TAIL_LEN) return address;
  return `${address.slice(0, ADDRESS_LEAD_LEN)}…${address.slice(-ADDRESS_TAIL_LEN)}`;
}

export interface ProviderRpcError {
  readonly code?: unknown;
  readonly message?: unknown;
}

export function asProviderError(err: unknown): ProviderRpcError | null {
  if (typeof err !== "object" || err === null) return null;
  if (!("code" in err) && !("message" in err)) return null;
  return err as ProviderRpcError;
}

export function providerErrorMessage(err: unknown): string {
  const shaped = asProviderError(err);
  if (shaped !== null && shaped.code === USER_REJECTED_REQUEST_CODE) {
    return "Connection rejected in wallet.";
  }
  if (err instanceof Error && err.message !== "") return err.message;
  if (shaped !== null && typeof shaped.message === "string" && shaped.message !== "") return shaped.message;
  return "Wallet connection failed.";
}
