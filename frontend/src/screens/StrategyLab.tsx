import { useState, useEffect, useCallback } from "react";
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { Play } from "lucide-react";
import { ApiError, postAnalyze, postBacktest, getMarkets, type MarketAnalysis, type BacktestMetrics } from "../lib/api";

// Preserved verbatim from sooth-strategy-lab.jsx - inline duplication flagged as follow-up
const COLOR = {
  ink: "#0A0908",
  surface: "#14130F",
  surface2: "#1B1A15",
  border: "#2A281F",
  text: "#F4F2ED",
  muted: "#8C887E",
  faint: "#807C6B",
  accent: "#CC8899",
  accentDim: "#722F37",
  up: "#6B9E78",
  down: "#CA7560",
} as const;
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SPACE = { header: 12, block: 16, panel: 20 } as const;
const PANEL_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: COLOR.faint,
};
function PanelHeader({ icon: Icon, children, right }: { icon?: React.ComponentType<{ size: number; color: string }>; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: SPACE.header }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {Icon ? <Icon size={13} color={COLOR.faint} /> : null}
        <span style={PANEL_LABEL_STYLE}>{children}</span>
      </div>
      {right}
    </div>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function SignalBadge({ tier }: { tier: string }) {
  const isTrade = tier === "TRADE";
  return <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, padding: "5px 12px", borderRadius: 4, background: isTrade ? COLOR.up : "transparent", color: isTrade ? COLOR.ink : COLOR.faint, border: isTrade ? "none" : `1px solid ${COLOR.border}` }}>{tier}</span>;
}

function SignalAnalysisPanel({ analysis, marketLabel }: { analysis: MarketAnalysis | null; marketLabel: string }) {
  if (!analysis) return <div className="sooth-glass-card"><PanelHeader>Signal analysis</PanelHeader><div style={{ fontSize: 12, color: COLOR.faint }}>Select a market and run analysis.</div></div>;
  const tier = analysis.recommendation === "TRADE" ? "TRADE" : Math.abs(analysis.edge) >= 0.02 ? "WAIT" : "NO TRADE";
  return (
    <div className="sooth-glass-card">
      <PanelHeader right={<SignalBadge tier={tier} />}>Signal analysis - {marketLabel}</PanelHeader>
      <div style={{ display: "flex", gap: 32, marginBottom: SPACE.panel }}>
        <div><div style={PANEL_LABEL_STYLE}>Market prob.</div><div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 700, marginTop: 4 }}>{pct(analysis.marketProbability)}</div></div>
        <div><div style={PANEL_LABEL_STYLE}>Sooth est.</div><div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 700, marginTop: 4, color: COLOR.accent }}>{pct(analysis.estimatedProbability)}</div></div>
        <div><div style={PANEL_LABEL_STYLE}>Edge</div><div style={{ fontFamily: "monospace", fontSize: 24, fontWeight: 700, marginTop: 4, color: analysis.edge >= 0 ? COLOR.up : COLOR.down }}>{analysis.edge >= 0 ? "+" : ""}{(analysis.edge * 100).toFixed(1)}%</div></div>
      </div>
      <div style={{ borderTop: `1px solid ${COLOR.border}`, paddingTop: SPACE.block }}>
        <div style={{ ...PANEL_LABEL_STYLE, marginBottom: SPACE.header }}>Why {tier}</div>
        {analysis.reasons.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: COLOR.muted, lineHeight: 1.5, marginBottom: 8 }}>
            <span style={{ fontFamily: "monospace", color: COLOR.faint, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            {r}
          </div>
        ))}
      </div>
      <div style={{ borderTop: `1px solid ${COLOR.border}`, marginTop: SPACE.block, paddingTop: SPACE.block, display: "flex", gap: 32 }}>
        <div><div style={PANEL_LABEL_STYLE}>Liquidity</div><div style={{ fontFamily: "monospace", fontSize: 15, marginTop: 4 }}>{analysis.liquidity.toFixed(0)}</div></div>
        <div><div style={PANEL_LABEL_STYLE}>Spread</div><div style={{ fontFamily: "monospace", fontSize: 15, marginTop: 4 }}>{(analysis.spread * 100).toFixed(2)}%</div></div>
        <div><div style={PANEL_LABEL_STYLE}>Expires</div><div style={{ fontFamily: "monospace", fontSize: 15, marginTop: 4 }}>{analysis.timeRemaining > 0 ? `${Math.floor(analysis.timeRemaining / 3600)}h` : "expired"}</div></div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="sooth-glass-card" style={{ flex: 1, minWidth: 130 }}>
      <div style={PANEL_LABEL_STYLE}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, marginTop: 6, color: color ?? COLOR.text }}>{value}</div>
    </div>
  );
}

function EquityCurveChart({ startingCapital, trades }: { startingCapital: number; trades: Array<{ pnl: number }> }) {
  // Build equity curve from real backtest trades if available
  const equityCurve = (() => {
    let equity = startingCapital;
    const points: Array<{ trade: number; equity: number }> = [{ trade: 0, equity }];
    trades.forEach((t, i) => {
      equity += t.pnl;
      points.push({ trade: i + 1, equity });
    });
    return points;
  })();
  const totalReturn = trades.length > 0 ? ((equityCurve[equityCurve.length - 1].equity - startingCapital) / startingCapital) * 100 : 0;
  return (
    <div className="sooth-glass-card" style={{ marginTop: SPACE.panel }}>
      <PanelHeader right={<span style={{ fontFamily: "monospace", fontSize: 13, color: totalReturn >= 0 ? COLOR.up : COLOR.down }}>{totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(1)}%</span>}>Equity curve</PanelHeader>
      {trades.length === 0 ? (
        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: COLOR.faint, fontSize: 13, border: `1px dashed ${COLOR.border}`, borderRadius: 8 }}>Run a backtest to see equity curve.</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={equityCurve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="sooth-equity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLOR.accent} stopOpacity={0.22} />
                <stop offset="100%" stopColor={COLOR.accent} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={COLOR.border} vertical={false} />
            <XAxis dataKey="trade" stroke={COLOR.faint} tick={{ fontSize: 11, fontFamily: "monospace", fill: COLOR.faint }} axisLine={{ stroke: COLOR.border }} tickLine={false} />
            <YAxis stroke={COLOR.faint} tick={{ fontSize: 11, fontFamily: "monospace", fill: COLOR.faint }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => `$${v}`} />
            <Tooltip contentStyle={{ background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 6, fontSize: 12 }} labelFormatter={(value) => `Trade #${String(value)}`} formatter={(value) => [`$${String(value)}`, "Equity"] as [string, string]} cursor={{ stroke: COLOR.accent, strokeWidth: 1, strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey="equity" stroke={COLOR.accent} strokeWidth={2} fill="url(#sooth-equity-fill)" activeDot={{ r: 5, fill: COLOR.accent, stroke: COLOR.ink, strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function EdgeBreakdownChart({ trades }: { trades: Array<{ won: boolean }> }) {
  const wins = trades.filter((t) => t.won).length;
  const losses = trades.length - wins;
  const data = trades.length === 0 ? [] : [
    { name: "Wins", value: wins, color: COLOR.up },
    { name: "Losses", value: losses, color: COLOR.down },
  ];
  return (
    <div className="sooth-glass-card" style={{ marginTop: SPACE.panel }}>
      <PanelHeader>Signal breakdown</PanelHeader>
      {data.length === 0 ? (
        <div style={{ color: COLOR.faint, fontSize: 13 }}>No trades yet.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <ResponsiveContainer width={140} height={140}>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={64} paddingAngle={2} stroke="none">
                {data.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 6, fontSize: 12 }} formatter={(value, name) => [`${String(value)}`, String(name)] as [string, string]} />
            </PieChart>
          </ResponsiveContainer>
          <div>
            {data.map((d) => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: "inline-block" }} />
                <span style={{ fontSize: 13, color: COLOR.muted, width: 80 }}>{d.name}</span>
                <span style={{ fontFamily: "monospace", fontSize: 13 }}>{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TradeHistoryTable({ trades }: { trades: BacktestMetrics["trades"] }) {
  if (trades.length === 0) return <div className="sooth-glass-card" style={{ marginTop: SPACE.panel }}><PanelHeader>Trade history</PanelHeader><div style={{ fontSize: 13, color: COLOR.faint }}>No trades in this backtest window.</div></div>;
  // Preserved verbatim layout from sooth-strategy-lab.jsx: Entry, Exit, Side, P&L, Result - byte-for-byte identical columns
  // Live bookTag provenance preserved via typed API but not added as new column - flagged as follow-up to keep visuals identical
  return (
    <div className="sooth-glass-card" style={{ marginTop: SPACE.panel, overflowX: "auto" }}>
      <PanelHeader>Trade history</PanelHeader>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ ...PANEL_LABEL_STYLE, fontSize: 11 }}><th style={{ textAlign: "left", paddingBottom: 8 }}>Entry</th><th style={{ textAlign: "left", paddingBottom: 8 }}>Exit</th><th style={{ textAlign: "left", paddingBottom: 8 }}>Side</th><th style={{ textAlign: "right", paddingBottom: 8 }}>P&L</th><th style={{ textAlign: "right", paddingBottom: 8 }}>Result</th></tr></thead>
        <tbody>
          {trades.slice(0, 20).map((t, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${COLOR.border}` }}>
              <td style={{ padding: "9px 0", fontFamily: "monospace" }}>{pct(t.entryPrice)}</td>
              <td style={{ padding: "9px 0", fontFamily: "monospace" }}>-</td>
              <td style={{ padding: "9px 0", fontFamily: "monospace", color: COLOR.muted }}>{t.direction}</td>
              <td style={{ padding: "9px 0", fontFamily: "monospace", textAlign: "right", color: t.pnl >= 0 ? COLOR.up : COLOR.down }}>{t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}</td>
              <td style={{ padding: "9px 0", textAlign: "right", fontFamily: "monospace", color: t.won ? COLOR.up : COLOR.down }}>{t.won ? "Win" : "Loss"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trades.length > 20 && <div style={{ fontSize: 11, color: COLOR.faint, marginTop: 8 }}>Showing 20 of {trades.length} trades.</div>}
    </div>
  );
}

export default function StrategyLab() {
  const [activeTab, setActiveTab] = useState<"Analyze" | "Backtest">("Analyze");
  const [marketOptions, setMarketOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [marketKey, setMarketKey] = useState<string>("");
  const [params, setParams] = useState({ minEdge: "5", maxPosition: "500", maxLoss: "100", minLiquidity: "10000" });
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestNote, setBacktestNote] = useState<string | null>(null);

  useEffect(() => {
    void getMarkets()
      .then((r) => {
        const opts = r.data.map((m) => ({ id: m.marketId, label: m.symbol }));
        setMarketOptions(opts);
        if (opts.length > 0 && !marketKey) setMarketKey(opts[0].id);
      })
      .catch(() => setMarketOptions([]));
  }, [marketKey]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setAnalysisError(null);
    setBacktestError(null);
    setBacktestNote(null);
    try {
      if (activeTab === "Analyze") {
        if (!marketKey) throw new Error("Select a market first");
        const res = await postAnalyze({ marketId: marketKey });
        if (res.data.length === 0) throw new Error("No analysis returned for this market");
        setAnalysis(res.data[0].analysis);
      } else {
        const res = await postBacktest({ limit: 50, startingCapital: 1000, sizePerTrade: 1 });
        if (res.data.metrics === null) {
          setMetrics(null);
          setBacktestNote(res.data.note ?? "No settled markets - insufficient data");
        } else {
          setMetrics(res.data.metrics);
        }
      }
      setLastRun(new Date());
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      if (activeTab === "Analyze") setAnalysisError(msg);
      else setBacktestError(msg);
    } finally {
      setRunning(false);
    }
  }, [activeTab, marketKey]);

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: rgba(20, 19, 15, 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204, 136, 153, 0.14); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(244, 242, 237, 0.05), 0 6px 20px rgba(0, 0, 0, 0.35); }
        .sooth-tab { background: none; border: none; cursor: pointer; font-family: inherit; font-size: 14px; padding: 8px 16px; border-radius: 6px; transition: background 150ms ${EASE}, color 150ms ${EASE}; }
        @media (max-width: 1000px) { .sooth-lab-grid { grid-template-columns: 1fr !important; } }
      `}</style>
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, background: "radial-gradient(600px circle at 15% 10%, rgba(204,136,153,0.10), transparent 60%), radial-gradient(500px circle at 85% 60%, rgba(204,136,153,0.07), transparent 60%)", pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1400, margin: "0 auto", padding: "24px 20px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: SPACE.panel }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: COLOR.text }}>Strategy Lab</h1>
            <p style={{ fontSize: 13, color: COLOR.muted, marginTop: 4 }}>{marketOptions.find((o) => o.id === marketKey)?.label ?? "Select a market"}</p>
          </div>
          <div style={{ display: "flex", gap: 4, background: COLOR.surface2, borderRadius: 8, padding: 4 }}>
            {(["Analyze", "Backtest"] as const).map((t) => (
              <button key={t} className="sooth-focusable sooth-tab" onClick={() => setActiveTab(t)} style={{ background: activeTab === t ? COLOR.accent : "transparent", color: activeTab === t ? COLOR.ink : COLOR.muted, fontWeight: activeTab === t ? 600 : 400 }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="sooth-lab-grid" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: SPACE.panel, alignItems: "start" }}>
          <div>
            {activeTab === "Analyze" ? (
              <>
                {analysisError && (
                  <div style={{ border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: 12, marginBottom: 12, background: "rgba(202,117,96,0.08)", color: COLOR.down, fontSize: 12, fontFamily: "monospace", lineHeight: 1.5 }}>
                    <div>{analysisError}</div>
                    {analysisError.includes("API not reachable") && <div style={{ marginTop: 6, color: COLOR.muted, fontSize: 11 }}>Start the API with <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>npm run api</code> from the repo root.</div>}
                  </div>
                )}
                <SignalAnalysisPanel analysis={analysis} marketLabel={marketOptions.find((o) => o.id === marketKey)?.label ?? marketKey} />
              </>
            ) : (
              <>
                {backtestError && (
                  <div style={{ border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: 12, marginBottom: 12, background: "rgba(202,117,96,0.08)", color: COLOR.down, fontSize: 12, fontFamily: "monospace", lineHeight: 1.5 }}>
                    <div>{backtestError}</div>
                    {backtestError.includes("API not reachable") && <div style={{ marginTop: 6, color: COLOR.muted, fontSize: 11 }}>Start the API with <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>npm run api</code>.</div>}
                  </div>
                )}
                {backtestNote && <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: 12, marginBottom: 12, color: COLOR.faint, fontSize: 13 }}>{backtestNote}</div>}
                {metrics ? (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: SPACE.block }}>
                      <StatCard label="Trades" value={metrics.numberOfTrades} />
                      <StatCard label="Win rate" value={metrics.numberOfTrades ? `${(metrics.winRate * 100).toFixed(0)}%` : "-"} color={COLOR.up} />
                      <StatCard label="Avg edge" value={`${(metrics.averageEdge * 100).toFixed(1)}%`} />
                      <StatCard label="Max drawdown" value={`${metrics.maximumDrawdown.toFixed(2)}`} color={COLOR.down} />
                      <StatCard label="Gas cost" value="-" />
                    </div>
                    <EquityCurveChart startingCapital={metrics.startingCapital} trades={[...metrics.trades]} />
                    <EdgeBreakdownChart trades={[...metrics.trades]} />
                    <TradeHistoryTable trades={metrics.trades} />
                  </>
                ) : (
                  !backtestNote && <div style={{ fontSize: 13, color: COLOR.faint, padding: 20, border: `1px dashed ${COLOR.border}`, borderRadius: 8 }}>Run a backtest to see metrics.</div>
                )}
              </>
            )}
          </div>

          <div>
            <div className="sooth-glass-card">
              <PanelHeader>Strategy configuration</PanelHeader>
              <label style={{ ...PANEL_LABEL_STYLE, display: "block", marginBottom: 6 }}>Market</label>
              <select className="sooth-focusable" value={marketKey} onChange={(e) => setMarketKey(e.target.value)} style={{ width: "100%", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: "monospace", fontSize: 13, color: COLOR.text, marginBottom: SPACE.block }}>
                {marketOptions.length === 0 && <option value="">Loading markets…</option>}
                {marketOptions.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.id.slice(0, 8)}…)</option>)}
              </select>
              <label style={{ ...PANEL_LABEL_STYLE, display: "block", marginBottom: 6 }}>Time window</label>
              <select className="sooth-focusable" defaultValue="Last 30 days" style={{ width: "100%", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "9px 12px", fontFamily: "monospace", fontSize: 13, color: COLOR.text, marginBottom: SPACE.block }}>
                <option>Last 7 days</option><option>Last 30 days</option><option>Last 90 days</option><option>All time</option>
              </select>
              <div style={{ ...PANEL_LABEL_STYLE, marginBottom: SPACE.header }}>Risk parameters</div>
              {(Object.entries({ minEdge: "Min edge (%)", maxPosition: "Max position ($)", maxLoss: "Max loss ($)", minLiquidity: "Min liquidity ($)" }) as Array<[keyof typeof params, string]>).map(([key, label]) => (
                <div key={key} style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 12, color: COLOR.muted }}>{label}</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <input className="sooth-focusable" type="number" value={params[key]} onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))} style={{ width: "100%", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "7px 10px", fontFamily: "monospace", fontSize: 13, color: COLOR.text }} />
                    <span style={{ fontSize: 12, color: COLOR.faint, flexShrink: 0 }}>{key === "minEdge" ? "%" : "$"}</span>
                  </div>
                </div>
              ))}
              <button className="sooth-focusable" onClick={() => void handleRun()} disabled={running} style={{ width: "100%", marginTop: SPACE.block, padding: "11px 0", borderRadius: 8, fontWeight: 700, fontSize: 14, fontFamily: "inherit", border: "none", cursor: running ? "default" : "pointer", background: running ? COLOR.surface2 : COLOR.accent, color: running ? COLOR.faint : COLOR.ink, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: `background 150ms ${EASE}` }}>
                {!running && <Play size={14} fill={COLOR.ink} />}
                {running ? "Running…" : activeTab === "Analyze" ? "Run analysis" : "Run backtest"}
              </button>
            </div>
            {lastRun && <p style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", marginTop: 10, textAlign: "center" }}>Last run {lastRun.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
