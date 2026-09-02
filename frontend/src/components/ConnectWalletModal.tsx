// Converted from sooth-connect-wallet.jsx — now a reusable modal component, not a standalone page.
// Preserves original copy/noting about brand logos (wallet icons are generic lucide Wallet marks).

import { useState } from "react";
import { Search, Wallet, X, ShieldCheck, KeyRound } from "lucide-react";
import { COLOR, EASE } from "./theme";
import { OrbMark } from "./OrbMark";

const WALLETS = ["MetaMask", "WalletConnect", "Coinbase Wallet", "Rainbow", "OKX Wallet"] as const;

export function ConnectWalletModal({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect?: (wallet: string) => void }) {
  const [query, setQuery] = useState("");
  const [hoveredWallet, setHoveredWallet] = useState<string | null>(null);
  const [closeHover, setCloseHover] = useState(false);

  if (!open) return null;

  const filtered = WALLETS.filter((w) => w.toLowerCase().includes(query.toLowerCase()));

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
        .sooth-wallet-row { transition: background 150ms ${EASE}, border-color 150ms ${EASE}; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-search:focus { border-color: ${COLOR.accent} !important; }
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
            <span style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Popular</span>
            <div style={{ position: "relative", marginTop: 12, marginBottom: 4 }}>
              <Search size={15} color={COLOR.faint} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
              <input
                className="sooth-search sooth-focusable"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                style={{ width: "100%", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "9px 12px 9px 34px", fontSize: 14, color: COLOR.text, fontFamily: "inherit" }}
              />
            </div>
            <div style={{ marginTop: 8 }}>
              {filtered.length === 0 && <p style={{ fontSize: 13, color: COLOR.faint, padding: "16px 4px" }}>No wallets match &quot;{query}&quot;.</p>}
              {filtered.map((wallet) => (
                <button
                  key={wallet}
                  className="sooth-wallet-row sooth-focusable"
                  onMouseEnter={() => setHoveredWallet(wallet)}
                  onMouseLeave={() => setHoveredWallet(null)}
                  onClick={() => {
                    onSelect?.(wallet);
                    onClose();
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: hoveredWallet === wallet ? COLOR.surface2 : "transparent",
                    border: `1px solid ${hoveredWallet === wallet ? COLOR.border : "transparent"}`,
                    borderRadius: 8,
                    padding: "10px 10px",
                    cursor: "pointer",
                    textAlign: "left",
                    color: COLOR.text,
                    fontFamily: "inherit",
                    fontSize: 14,
                  }}
                >
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Wallet size={14} color={COLOR.accent} />
                  </span>
                  {wallet}
                </button>
              ))}
            </div>
          </div>

          <div className="sooth-modal-info" style={{ padding: "28px 24px", borderLeft: `1px solid ${COLOR.border}` }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 20px", color: COLOR.text }}>What is a wallet?</h3>
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <ShieldCheck size={20} color={COLOR.accent} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: COLOR.text }}>A home for your assets</p>
                <p style={{ fontSize: 13, color: COLOR.muted, margin: "4px 0 0", lineHeight: 1.5 }}>Wallets hold what you use to trade — funds, positions, and the keys that authorize a bot on your behalf.</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
              <KeyRound size={20} color={COLOR.accent} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: COLOR.text }}>No new password</p>
                <p style={{ fontSize: 13, color: COLOR.muted, margin: "4px 0 0", lineHeight: 1.5 }}>Instead of creating an account, connect the wallet you already have — same one across every DreamDEX app.</p>
              </div>
            </div>
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
