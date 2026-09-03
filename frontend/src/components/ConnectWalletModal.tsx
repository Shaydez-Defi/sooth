import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { COLOR, EASE } from "./theme";
import { OrbMark } from "./OrbMark";
import { getInjectedProvider, isMobileDevice, shortAddress } from "../lib/somnia-chain";
import { useWallet } from "../lib/useWallet";

export function ConnectWalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address, isCorrectChain, connecting, error, connect, disconnect, clearError } = useWallet();
  const [hasProvider] = useState(() => getInjectedProvider() !== null);
  const [isMobile] = useState(() => isMobileDevice());
  const [closeHover, setCloseHover] = useState(false);

  useEffect(() => {
    if (open) clearError();
  }, [open, clearError]);

  if (!open) return null;

  const handleConnect = (): void => {
    void connect().then((ok) => {
      if (ok) onClose();
    });
  };

  const handleDisconnect = (): void => {
    disconnect();
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,9,8,0.7)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
    >
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        @media (max-width: 640px) {
          .sooth-modal-grid { grid-template-columns: 1fr !important; }
          .sooth-modal-info { border-left: none !important; border-top: 1px solid ${COLOR.border}; }
        }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(760px, 100%)",
          borderRadius: 16,
          border: `1px solid ${COLOR.border}`,
          background: COLOR.surface,
          boxShadow: `0 0 0 1px rgba(204,136,153,0.08), 0 24px 60px rgba(0,0,0,0.5)`,
          overflow: "hidden",
        }}
      >
        <button
          className="sooth-focusable"
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "none",
            border: "none",
            color: closeHover ? COLOR.text : COLOR.faint,
            cursor: "pointer",
            transition: `color 150ms ${EASE}`,
            zIndex: 2,
          }}
        >
          <X size={18} />
        </button>

        <div className="sooth-modal-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: "28px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <OrbMark size={18} />
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: COLOR.text }}>Connect a wallet</h2>
            </div>

            {address ? (
              <div>
                <p style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.text, margin: "0 0 8px", wordBreak: "break-all" }} title={address}>
                  {shortAddress(address)}
                </p>
                <p style={{ fontFamily: "monospace", fontSize: 11, color: isCorrectChain ? COLOR.up : COLOR.down, margin: "0 0 16px" }}>
                  {isCorrectChain ? "Somnia Shannon Testnet" : "Wrong network - switch to continue"}
                </p>
                {!isCorrectChain && (
                  <button
                    className="sooth-focusable"
                    onClick={handleConnect}
                    disabled={connecting}
                    style={{ width: "100%", padding: "11px 0", fontSize: 14, background: COLOR.accent, color: COLOR.ink, border: "none", borderRadius: 8, fontWeight: 600, cursor: connecting ? "wait" : "pointer", fontFamily: "inherit", opacity: connecting ? 0.7 : 1, marginBottom: 8 }}
                  >
                    {connecting ? "Switching…" : "Switch to Somnia Shannon Testnet"}
                  </button>
                )}
                <button
                  className="sooth-focusable"
                  onClick={handleDisconnect}
                  style={{ width: "100%", padding: "11px 0", fontSize: 14, background: "transparent", color: COLOR.muted, border: `1px solid ${COLOR.border}`, borderRadius: 8, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Disconnect
                </button>
                {error && <p style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.down, margin: "12px 0 0", lineHeight: 1.5 }}>{error}</p>}
              </div>
            ) : hasProvider ? (
              <div>
                <button
                  className="sooth-focusable"
                  onClick={handleConnect}
                  disabled={connecting}
                  style={{ width: "100%", display: "block", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "12px 14px", cursor: connecting ? "wait" : "pointer", textAlign: "left", fontFamily: "inherit", opacity: connecting ? 0.7 : 1 }}
                >
                  <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: COLOR.text }}>
                    {connecting ? "Connecting…" : "Injected Wallet"}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: COLOR.muted, marginTop: 2 }}>Your browser wallet (MetaMask, Rabby, etc.)</span>
                </button>
                {error && <p style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.down, margin: "12px 0 0", lineHeight: 1.5 }}>{error}</p>}
              </div>
            ) : isMobile ? (
              <p style={{ fontSize: 13, color: COLOR.muted, margin: 0, lineHeight: 1.6 }}>
                No wallet detected. Open this page inside your wallet app&apos;s browser (MetaMask, Trust Wallet, Rabby, etc.) to connect.
              </p>
            ) : (
              <div>
                <p style={{ fontSize: 13, color: COLOR.muted, margin: "0 0 12px", lineHeight: 1.6 }}>
                  No browser wallet detected. Install MetaMask or another browser wallet extension to connect.
                </p>
                <a href="https://metamask.io" target="_blank" rel="noreferrer" className="sooth-focusable" style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.accent, textDecoration: "none" }}>
                  metamask.io
                </a>
              </div>
            )}
          </div>

          <div className="sooth-modal-info" style={{ padding: "28px 24px", borderLeft: `1px solid ${COLOR.border}` }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 20px", color: COLOR.text }}>What is a wallet?</h3>
            <p style={{ fontSize: 13, color: COLOR.text, margin: "0 0 16px", lineHeight: 1.5 }}>
              A home for your assets — holds funds, positions, and the key that authorizes your bot.
            </p>
            <p style={{ fontSize: 13, color: COLOR.text, margin: "0 0 24px", lineHeight: 1.5 }}>
              No new password — connect the wallet you already use.
            </p>
            <button className="sooth-focusable" style={{ width: "100%", padding: "11px 0", fontSize: 14, background: COLOR.accent, color: COLOR.ink, border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Get a wallet
            </button>
            <a href="#" className="sooth-focusable" style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 13, color: COLOR.muted, textDecoration: "none" }}>
              Learn more
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
