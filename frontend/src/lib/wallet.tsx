import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CHAIN_NOT_ADDED_CODE,
  SOMNIA_CHAIN_ID_HEX,
  SOMNIA_CHAIN_NAME,
  SOMNIA_EXPLORER_URL,
  SOMNIA_NATIVE_CURRENCY,
  SOMNIA_RPC_URL,
  asProviderError,
  getInjectedProvider,
  providerErrorMessage,
} from "./somnia-chain";

import { WalletContext } from "./useWallet";

function parseAccounts(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first: unknown = value[0];
  return typeof first === "string" && first !== "" ? first : null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainIdHex, setChainIdHex] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = useCallback((): void => {
    setAddress(null);
    setChainIdHex(null);
    setError(null);
  }, []);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  const connect = useCallback(async (): Promise<boolean> => {
    setConnecting(true);
    setError(null);
    try {
      const provider = getInjectedProvider();
      if (!provider) {
        setError("No injected wallet found.");
        return false;
      }
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const account = parseAccounts(accounts);
      if (!account) {
        setError("Wallet returned no accounts.");
        return false;
      }
      let chainId: unknown = await provider.request({ method: "eth_chainId" });
      if (typeof chainId !== "string" || !chainId.startsWith("0x")) {
        setError("Wallet returned an invalid chain ID.");
        return false;
      }
      if (chainId.toLowerCase() !== SOMNIA_CHAIN_ID_HEX.toLowerCase()) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: SOMNIA_CHAIN_ID_HEX }],
          });
        } catch (switchErr) {
          const shaped = asProviderError(switchErr);
          if (shaped !== null && shaped.code === CHAIN_NOT_ADDED_CODE) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: SOMNIA_CHAIN_ID_HEX,
                  chainName: SOMNIA_CHAIN_NAME,
                  rpcUrls: [SOMNIA_RPC_URL],
                  nativeCurrency: { ...SOMNIA_NATIVE_CURRENCY },
                  blockExplorerUrls: [SOMNIA_EXPLORER_URL],
                },
              ],
            });
          } else {
            throw switchErr;
          }
        }
        chainId = await provider.request({ method: "eth_chainId" });
        if (typeof chainId !== "string" || !chainId.startsWith("0x")) {
          setError("Wallet returned an invalid chain ID after switching.");
          return false;
        }
      }
      setAddress(account);
      setChainIdHex(chainId);
      return true;
    } catch (err) {
      setError(providerErrorMessage(err));
      return false;
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider || !provider.on || !provider.removeListener) return;
    const handleAccounts = (value: unknown): void => {
      setAddress(parseAccounts(value));
    };
    const handleChain = (value: unknown): void => {
      if (typeof value === "string") setChainIdHex(value);
    };
    provider.on("accountsChanged", handleAccounts);
    provider.on("chainChanged", handleChain);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  const value = useMemo(
    () => ({
      address,
      chainIdHex,
      isCorrectChain: chainIdHex?.toLowerCase() === SOMNIA_CHAIN_ID_HEX.toLowerCase(),
      isConnected: address !== null,
      connecting,
      error,
      connect,
      disconnect,
      clearError,
    }),
    [address, chainIdHex, connecting, error, connect, disconnect, clearError],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
