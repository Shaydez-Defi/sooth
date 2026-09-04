import { BrowserRouter, Routes, Route, Link, NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { COLOR } from "./components/theme";
import { OrbMark } from "./components/OrbMark";
import { ConnectWalletModal } from "./components/ConnectWalletModal";
import { WalletProvider } from "./lib/wallet";
import { useWallet } from "./lib/useWallet";
import { shortAddress } from "./lib/somnia-chain";
import Landing from "./screens/Landing";
import Markets from "./screens/Markets";
import MarketDetail from "./screens/MarketDetail";
import Intelligence from "./screens/Intelligence";
import Positions from "./screens/Positions";
import History from "./screens/History";
import Backtest from "./screens/Backtest";
import Docs from "./screens/Docs";

function TopNav() {
  const [walletOpen, setWalletOpen] = useState(false);
  const { address } = useWallet();
  const location = useLocation();
  const isLanding = location.pathname === "/";
  if (isLanding) return null;
  const activeStyle = (isActive: boolean): React.CSSProperties => ({
    color: isActive ? COLOR.text : COLOR.muted,
    fontWeight: isActive ? 600 : 400,
    textDecoration: "none",
    fontSize: 14,
    borderBottom: isActive ? `2px solid ${COLOR.accent}` : "2px solid transparent",
    paddingBottom: 4,
  });
  return (
    <>
      <nav style={{ position: "sticky", top: 0, zIndex: 20, background: COLOR.ink, borderBottom: `1px solid ${COLOR.border}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: COLOR.text }}>
          <OrbMark size={20} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>SOOTH</span>
        </Link>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <NavLink to="/markets" style={({ isActive }) => activeStyle(isActive)}>Markets</NavLink>
          <NavLink to="/intelligence" style={({ isActive }) => activeStyle(isActive)}>Intelligence</NavLink>
          <NavLink to="/positions" style={({ isActive }) => activeStyle(isActive)}>Positions</NavLink>
          <NavLink to="/history" style={({ isActive }) => activeStyle(isActive)}>History</NavLink>
          <NavLink to="/backtest" style={({ isActive }) => activeStyle(isActive)}>Backtest</NavLink>
          <NavLink to="/docs" style={({ isActive }) => activeStyle(isActive)}>Docs</NavLink>
        </div>
        <button onClick={() => setWalletOpen(true)} style={{ background: address ? COLOR.surface2 : COLOR.accent, color: address ? COLOR.text : COLOR.ink, border: address ? `1px solid ${COLOR.border}` : "none", borderRadius: 6, padding: "8px 14px", fontWeight: 600, cursor: "pointer", fontFamily: address ? "monospace" : "inherit", fontSize: 13 }}>
          {address ? shortAddress(address) : "Connect wallet"}
        </button>
      </nav>
      <ConnectWalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
      <style>{`
        * { scrollbar-width: thin; scrollbar-color: ${COLOR.border} transparent; }
        *::-webkit-scrollbar { width: 8px; height: 8px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: ${COLOR.border}; border-radius: 4px; }
        *::-webkit-scrollbar-thumb:hover { background: ${COLOR.faint}; }
      `}</style>
      <TopNav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/markets" element={<Markets />} />
        <Route path="/markets/:id" element={<MarketDetail />} />
        <Route path="/intelligence" element={<Intelligence />} />
        <Route path="/positions" element={<Positions />} />
        <Route path="/history" element={<History />} />
        <Route path="/backtest" element={<Backtest />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="*" element={<div style={{ background: COLOR.ink, color: COLOR.text, minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}><p>Not found</p><Link to="/markets" style={{ color: COLOR.accent }}>Go to markets</Link></div>} />
      </Routes>
      </WalletProvider>
    </BrowserRouter>
  );
}
