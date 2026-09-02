import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Wallet, TrendingUp, TrendingDown, RefreshCcw } from "lucide-react";
import { COLOR } from "../components/theme";
import { PanelHeader } from "../components/PanelHeader";
import { ProvenanceTag } from "../components/ProvenanceTag";
import { ApiError, getPortfolio, getOrders, getPositions, type PortfolioResponse } from "../lib/api";

export default function Portfolio() {
  const [data, setData] = useState<PortfolioResponse["data"] | null>(null);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof getOrders>>["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, o, pos] = await Promise.all([getPortfolio(), getOrders().catch(() => null), getPositions().catch(() => null)]);
      // Prefer portfolio's positions but ensure consistent
      const merged = { ...p.data, positions: pos ? pos.data.positions : p.data.positions };
      setData(merged);
      if (o) setOrders(o.data);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.message} (${err.status})` : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", padding: "32px 20px", maxWidth: 1100, margin: "0 auto" }}>
      <style>{` *{box-sizing:border-box} .sooth-glass-card{position:relative;padding:16px;background:rgba(20,19,15,0.5);backdrop-filter:blur(14px);border:1px solid rgba(204,136,153,0.14);border-radius:8px;}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Portfolio</h1>
        <button onClick={() => void load()} style={{ display: "flex", alignItems: "center", gap: 6, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "8px 12px", color: COLOR.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      {loading && <div style={{ marginTop: 24, color: COLOR.faint, fontFamily: "monospace", fontSize: 13 }}>Loading portfolio…</div>}
      {error && <div style={{ marginTop: 16, border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: 12, background: "rgba(202,117,96,0.08)", color: COLOR.down, fontSize: 12, fontFamily: "monospace" }}>{error}</div>}

      {data && !loading && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 24 }}>
            <div className="sooth-glass-card">
              <PanelHeader icon={Wallet}>Balances</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <ProvenanceTag tag={data.balances ? "LIVE_ONCHAIN" : data.balancesDataIntegrity} small />
              </div>
              {data.balances ? (
                <>
                  <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700 }}>{data.balances.tUsdcHuman.toFixed(2)} tUSDC</div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.muted, marginTop: 4 }}>{data.balances.nativeHuman.toFixed(4)} SOMI</div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: COLOR.faint }}>{data.balancesDataIntegrity}</div>
              )}
            </div>
            <div className="sooth-glass-card">
              <PanelHeader>{data.totalRealizedPnL >= 0 ? <TrendingUp size={13} color={COLOR.up} /> : <TrendingDown size={13} color={COLOR.down} />}Realized P&amp;L</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <ProvenanceTag tag="DERIVED" small /> <span style={{ fontSize: 11, color: COLOR.faint }}>from LIVE_ONCHAIN fills</span>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: data.totalRealizedPnL >= 0 ? COLOR.up : COLOR.down }}>{data.totalRealizedPnL >= 0 ? "+" : ""}${data.totalRealizedPnL.toFixed(2)}</div>
              <div style={{ fontSize: 12, color: COLOR.faint, marginTop: 4 }}>{data.positionsCount} position(s)</div>
            </div>
          </div>

          <div className="sooth-glass-card" style={{ marginTop: 20 }}>
            <PanelHeader>Positions</PanelHeader>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <ProvenanceTag tag="LIVE_ONCHAIN" small />
            </div>
            {data.positions.length === 0 ? (
              <div style={{ fontSize: 13, color: COLOR.faint }}>No positions yet. Place an order from a <Link to="/markets" style={{ color: COLOR.accent }}>market</Link>.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: COLOR.faint, fontFamily: "monospace", fontSize: 11, textTransform: "uppercase" }}>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Market</th>
                    <th style={{ textAlign: "right", paddingBottom: 8 }}>Side</th>
                    <th style={{ textAlign: "right", paddingBottom: 8 }}>Net</th>
                    <th style={{ textAlign: "right", paddingBottom: 8 }}>Realized PnL</th>
                    <th style={{ textAlign: "right", paddingBottom: 8 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.marketId} style={{ borderTop: `1px solid ${COLOR.border}` }}>
                      <td style={{ padding: "10px 0" }}><Link to={`/markets/${encodeURIComponent(p.marketId)}`} style={{ color: COLOR.accent, textDecoration: "none" }}>{p.symbol}</Link></td>
                      <td style={{ textAlign: "right", fontFamily: "monospace", color: p.side === "YES" ? COLOR.up : COLOR.down }}>{p.side}</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace" }}>{p.netPosition}</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace", color: p.realizedPnL >= 0 ? COLOR.up : COLOR.down }}>{p.realizedPnL.toFixed(2)}</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace", color: COLOR.faint }}>{p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="sooth-glass-card" style={{ marginTop: 20 }}>
            <PanelHeader>Open orders</PanelHeader>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <ProvenanceTag tag="LIVE_ONCHAIN" small />
            </div>
            {orders === null ? (
              <div style={{ fontSize: 13, color: COLOR.faint }}>No signer — open orders unavailable without PRIVATE_KEY.</div>
            ) : orders.length === 0 ? (
              <div style={{ fontSize: 13, color: COLOR.faint }}>No open orders.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {orders.map((m) => (
                  <div key={m.marketId} style={{ borderTop: `1px solid ${COLOR.border}`, paddingTop: 10 }}>
                    <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>{m.symbol} — {m.marketId.slice(0, 10)}…</div>
                    <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 4 }}>{m.orders.length} order(s) — <ProvenanceTag tag={m.dataIntegrity} small /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
