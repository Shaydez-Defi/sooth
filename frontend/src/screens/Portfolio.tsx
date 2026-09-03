import { useEffect, useState, useCallback, useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { ApiError, getPortfolio, getPositions, getBotPerformance, type PortfolioResponse } from "../lib/api";
import { formatSymbolFallback } from "../lib/formatMarket";
import { COLOR } from "../components/theme";
import { PanelHeader } from "../components/PanelHeader";
import { ProvenanceTag } from "../components/ProvenanceTag";
import { useWallet } from "../lib/useWallet";
import { shortAddress } from "../lib/somnia-chain";

function money(v: number, opts: { signed?: boolean } = {}): string {
  const sign = v < 0 ? "-" : opts.signed && v > 0 ? "+" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export default function Portfolio() {
  const { address } = useWallet();
  const [portfolio, setPortfolio] = useState<PortfolioResponse["data"] | null>(null);
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof getPositions>>["data"]["positions"]>([]);
  const [performance, setPerformance] = useState<Awaited<ReturnType<typeof getBotPerformance>>["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [portRes, posRes, perfRes] = await Promise.all([
        getPortfolio(),
        getPositions().catch(() => null),
        getBotPerformance("default").catch(() => null),
      ]);
      setPortfolio(portRes.data);
      if (posRes) setPositions(posRes.data.positions);
      else setPositions(portRes.data.positions);
      if (perfRes) setPerformance(perfRes.data);    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message} (${err.status})` : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalEquity = useMemo(() => {
    if (!portfolio) return null;
    // Real equity: balances + unrealized? For now, use tUSDC balance as proxy, plus performance netPnL if available
    const base = portfolio.balances ? portfolio.balances.tUsdcHuman : 0;
    return base;
  }, [portfolio]);

  const chartData = useMemo(() => {
    // No real time-series for portfolio equity yet - return empty to trigger honest empty state
    // If we had snapshots of portfolio equity, we'd map here. For now, honest empty.
    return [] as Array<{ t: string; v: number }>;
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", padding: "32px 20px", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Loading portfolio…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", padding: "32px 20px", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: 12, background: "rgba(202,117,96,0.08)", color: COLOR.down, fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}>
          <div>{error}</div>
          <button onClick={() => void load()} style={{ marginTop: 8, background: "none", border: "none", color: COLOR.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>retry</button>
        </div>
      </div>
    );
  }
  if (!portfolio) return null;

  const walletShort = address ? shortAddress(address) : "Not connected";
  const hasChartData = chartData.length >= 2;

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: rgba(20, 19, 15, 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204,136,153,0.14); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(244,242,237,0.05), 0 6px 20px rgba(0,0,0,0.35); }
        @media (max-width: 1000px) { .sooth-detail-grid { grid-template-columns: 1fr !important; } }
      `}</style>
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, background: `radial-gradient(600px circle at 15% 10%, rgba(204,136,153,0.10), transparent 60%), radial-gradient(500px circle at 85% 60%, rgba(204,136,153,0.07), transparent 60%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Portfolio</div>
            <div style={{ fontFamily: "monospace", fontSize: 32, fontWeight: 800, lineHeight: 1.1, marginTop: 6, color: COLOR.text }}>{totalEquity !== null ? money(totalEquity) : "-"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: (performance?.metrics?.netPnL ?? portfolio.totalRealizedPnL) >= 0 ? COLOR.up : COLOR.down }}>
                {performance?.metrics ? money(performance.metrics.netPnL, { signed: true }) : money(portfolio.totalRealizedPnL, { signed: true })}
              </span>
              <ProvenanceTag tag="DERIVED" small />
              <span style={{ fontSize: 11, color: COLOR.faint }}>total P&L</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "7px 10px" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>{walletShort}</span>
            {address && <ProvenanceTag tag="LIVE_ONCHAIN" small />}
          </div>
        </div>

        <div className="sooth-detail-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) 360px", gap: 16, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="sooth-glass-card">
              <PanelHeader>Portfolio performance</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <ProvenanceTag tag="HISTORICAL" small />
                <ProvenanceTag tag="DERIVED" small />
              </div>
              {!hasChartData ? (
                <div style={{ height: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, border: `1px solid ${COLOR.border}`, borderRadius: 8, background: COLOR.surface2 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${COLOR.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 14, color: COLOR.faint }}>$</span>
                  </div>
                  <div style={{ fontSize: 13, color: COLOR.muted, fontWeight: 600 }}>Not enough history yet</div>
                  <div style={{ fontSize: 11, color: COLOR.faint, maxWidth: 300, textAlign: "center", lineHeight: 1.5 }}>P&L history needs at least 2 settled fills. Trade a few markets, then this chart will show real equity over time. <span style={{ fontFamily: "monospace" }}>HISTORICAL</span></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="sooth-portfolio-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLOR.accent} stopOpacity="0.18" />
                        <stop offset="100%" stopColor={COLOR.accent} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={COLOR.border} vertical={false} />
                    <XAxis dataKey="t" stroke={COLOR.faint} tick={{ fontSize: 11, fontFamily: "monospace", fill: COLOR.faint }} axisLine={{ stroke: COLOR.border }} tickLine={false} />
                    <YAxis stroke={COLOR.faint} tick={{ fontSize: 11, fontFamily: "monospace", fill: COLOR.faint }} axisLine={false} tickLine={false} width={56} tickFormatter={(v: number) => `$${Math.round(v)}`} />
                    <Tooltip cursor={{ stroke: COLOR.accent, strokeWidth: 1, strokeDasharray: "3 3" }} contentStyle={{ background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 6 }} />
                    <Area type="monotone" dataKey="v" stroke={COLOR.accent} strokeWidth={1.8} fill="url(#sooth-portfolio-fill)" dot={false} activeDot={{ r: 4, fill: COLOR.accent, stroke: COLOR.ink, strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="sooth-glass-card">
              <PanelHeader>Current exposure</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <ProvenanceTag tag="LIVE_ONCHAIN" small />
              </div>
              {positions.length === 0 ? (
                <div style={{ fontSize: 12, color: COLOR.faint, padding: "12px 0" }}>No open positions.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {positions.map((p) => {
                    const fmt = formatSymbolFallback(p.symbol);
                    return (
                      <div key={p.marketId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: COLOR.surface2, borderRadius: 6, border: `1px solid ${COLOR.border}` }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: COLOR.text, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fmt.title}>{fmt.label}</div>
                          <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace" }}>{fmt.sublabel || p.symbol} · {p.side}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                          <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.text }}>${Math.abs(p.netPosition).toFixed(2)}</div>
                          <div style={{ fontSize: 11, color: p.status === "OPEN" ? COLOR.up : COLOR.faint }}>{p.status.toLowerCase()}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="sooth-glass-card">
              <PanelHeader>Recent settlements</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <ProvenanceTag tag="HISTORICAL" small />
                <ProvenanceTag tag="LIVE_ONCHAIN" small />
              </div>
              {(() => {
                const closed = positions.filter((p) => p.status === "CLOSED");
                if (closed.length === 0) {
                  return <div style={{ fontSize: 12, color: COLOR.faint, padding: "12px 0" }}>No settlements yet - positions settle on-chain at expiry.</div>;
                }
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {closed.slice(0, 5).map((p) => {
                      const fmt = formatSymbolFallback(p.symbol);
                      const won = p.realizedPnL > 0;
                      return (
                        <div key={p.marketId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${COLOR.border}` }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR.text, fontFamily: "monospace" }} title={fmt.title}>{fmt.label}</div>
                            <div style={{ fontSize: 11, color: won ? COLOR.up : COLOR.down, fontFamily: "monospace" }}>{won ? "Won" : "Lost"}</div>
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: 12, color: won ? COLOR.up : COLOR.down, flexShrink: 0, marginLeft: 12 }}>{won ? "+" : ""}${p.realizedPnL.toFixed(2)}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="sooth-glass-card">
              <PanelHeader>Risk</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <ProvenanceTag tag="DERIVED" small />
              </div>
              {(() => {
                const maxLoss = 100;
                const currentLoss = performance?.metrics ? Math.max(0, -performance.metrics.netPnL) : 0;
                const pctUsed = Math.min(100, Math.round((currentLoss / maxLoss) * 100));
                const color = pctUsed >= 90 ? COLOR.down : pctUsed >= 60 ? "#D6A64F" : COLOR.up;
                return (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: 12, color: COLOR.muted }}>Risk utilization</span>
                      <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color }}>{pctUsed}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: COLOR.surface2, overflow: "hidden", marginTop: 6 }}>
                      <div style={{ height: "100%", width: `${pctUsed}%`, background: color }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", marginTop: 8, borderTop: `1px solid ${COLOR.border}`, fontSize: 12 }}>
                      <span style={{ color: COLOR.muted }}>Max loss</span>
                      <span style={{ fontFamily: "monospace", color: COLOR.text }}>${maxLoss}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: `1px solid ${COLOR.border}`, fontSize: 12 }}>
                      <span style={{ color: COLOR.muted }}>Loss used</span>
                      <span style={{ fontFamily: "monospace", color: pctUsed >= 60 ? COLOR.down : COLOR.text }}>${currentLoss.toFixed(2)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: `1px solid ${COLOR.border}`, fontSize: 12 }}>
                      <span style={{ color: COLOR.muted }}>Positions</span>
                      <span style={{ fontFamily: "monospace", color: COLOR.text }}>{positions.length} open</span>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="sooth-glass-card">
              <PanelHeader>Performance</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <ProvenanceTag tag="DERIVED" small />
                <ProvenanceTag tag="HISTORICAL" small />
              </div>
              {!performance || !performance.metrics ? (
                <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: 16, background: COLOR.surface2, textAlign: "center" }}>
                  <div style={{ fontSize: 13, color: COLOR.muted, fontWeight: 600 }}>Insufficient data</div>
                  <div style={{ fontSize: 11, color: COLOR.faint, marginTop: 4, lineHeight: 1.5 }}>No fills yet - bot hasn't traded. Metrics will appear after the first fill.</div>
                  <div style={{ marginTop: 8 }}><ProvenanceTag tag="HISTORICAL" small /></div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Net P&L", value: `${performance.metrics.netPnL >= 0 ? "+" : ""}$${performance.metrics.netPnL.toFixed(2)}`, color: performance.metrics.netPnL >= 0 ? COLOR.up : COLOR.down, tag: "DERIVED" as const },
                    { label: "Win rate", value: performance.metrics.winRate !== null ? `${(performance.metrics.winRate * 100).toFixed(0)}%` : "Insufficient data", color: performance.metrics.winRate !== null ? COLOR.accent : COLOR.faint, tag: "DERIVED" as const },
                    { label: "Realized edge", value: performance.metrics.realizedEdge !== null ? `$${performance.metrics.realizedEdge.toFixed(2)}` : "Insufficient data", color: COLOR.accent, tag: "HISTORICAL" as const },
                    { label: "Adverse selection", value: performance.metrics.adverseSelection !== null ? `${(performance.metrics.adverseSelection * 100).toFixed(2)}%` : "Insufficient data", color: COLOR.faint, tag: "HISTORICAL" as const },
                    { label: "Drawdown", value: performance.metrics.maximumDrawdown !== null ? `$${performance.metrics.maximumDrawdown.toFixed(2)}` : "Insufficient data", color: COLOR.down, tag: "DERIVED" as const },
                  ].map((s) => (
                    <div key={s.label} style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: 10, background: COLOR.surface2 }}>
                      <div style={{ fontSize: 10, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: s.color, marginTop: 4 }}>{s.value}</div>
                      <div style={{ marginTop: 4 }}><ProvenanceTag tag={s.tag} small /></div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="sooth-glass-card">
              <PanelHeader>Allocation</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                <ProvenanceTag tag="LIVE_ONCHAIN" small />
              </div>
              {positions.length === 0 ? (
                <div style={{ fontSize: 12, color: COLOR.faint, padding: "12px 0" }}>No allocation - no open positions.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(() => {
                    const total = positions.reduce((s, p) => s + Math.abs(p.netPosition), 0) || 1;
                    const byAsset = new Map<string, number>();
                    for (const p of positions) {
                      const fmt = formatSymbolFallback(p.symbol);
                      const asset = fmt.label.split(" ")[0] ?? p.symbol.split("-")[0] ?? "?";
                      byAsset.set(asset, (byAsset.get(asset) ?? 0) + Math.abs(p.netPosition));
                    }
                    return Array.from(byAsset.entries()).map(([asset, val]) => {
                      const share = (val / total) * 100;
                      return (
                        <div key={asset} style={{ marginBottom: 4 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                            <span style={{ color: COLOR.text, fontFamily: "monospace" }}>{asset}</span>
                            <span style={{ fontFamily: "monospace", color: COLOR.faint }}>{share.toFixed(0)}%</span>
                          </div>
                          <div style={{ height: 5, borderRadius: 3, background: COLOR.surface2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${share}%`, background: COLOR.accent, opacity: 0.85 }} />
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
