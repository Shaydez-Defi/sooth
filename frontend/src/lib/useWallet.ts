import { createContext, useContext } from "react";

// Shared wallet state shape - kept in a component-free module so the
// react-refresh rule (components-only exports) stays clean.
export interface WalletContextValue {
  readonly address: string | null;
  readonly chainIdHex: string | null;
  readonly isCorrectChain: boolean;
  readonly isConnected: boolean;
  readonly connecting: boolean;
  readonly error: string | null;
  readonly connect: () => Promise<boolean>;
  readonly disconnect: () => void;
  readonly clearError: () => void;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider.");
  return ctx;
}
