import { useEffect, useState, useCallback, useMemo } from "react";
import { ApiError, getBots, getBotEvents, getBotPerformance, postBotStart, postBotStop, getPositions, getPortfolio, type BotEventRow } from "../lib/api";
import { formatSymbolFallback } from "../lib/formatMarket";
import { COLOR } from "../components/theme";
import { PanelHeader } from "../components/PanelHeader";
import { ProvenanceTag } from "../components/ProvenanceTag";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
// Reuse MarketDetail's event log treatment - dot + mono, no circular badges
function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
function EventDetail({ data }: { data: unknown }) {
  let parsed: Record<string, unknown> | null;
  try {
    parsed = typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>) : (data as Record<string, unknown>);
  } catch {
    parsed = null;
  }
  if (parsed === undefined) parsed = null;
  if (!parsed) return <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>{String(data).slice(0, 120)}</span>;
  // Try to extract reasoning trace fields
  const analysis = (parsed as Record<string, unknown>).analysis as Record<string, unknown> | undefined;
  const decision = (parsed as Record<string, unknown>).decision as Record<string, unknown> | undefined;
  const risk = (parsed as Record<string, unknown>).risk as Record<string, unknown> | undefined;
  const reasons = (analysis as Record<string, unknown> | undefined)?.reasons as string[] | undefined;
  if (analysis && typeof analysis === "object") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {typeof analysis.marketProbability === "number" && typeof analysis.estimatedProbability === "number" && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.muted }}>market <span style={{ color: COLOR.text }}>{pct(analysis.marketProbability as number)}</span></span>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.muted }}>sooth <span style={{ color: COLOR.accent }}>{pct(analysis.estimatedProbability as number)}</span></span>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.muted }}>edge <span style={{ color: Number(analysis.edge) >= 0 ? COLOR.up : COLOR.down }}>{(analysis.edge as number) >= 0 ? "+" : ""}{((analysis.edge as number) * 100).toFixed(1)}%</span></span>
          </div>
        )}
        {Array.isArray(reasons) && reasons.length > 0 && (
          <div style={{ borderLeft: `2px solid ${COLOR.border}`, paddingLeft: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {reasons.slice(0, 3).map((r, i) => (
              <span key={i} style={{ fontSize: 11, color: COLOR.muted, lineHeight: 1.4 }}>{String(i + 1).padStart(2, "0")} {r}</span>
            ))}
          </div>
        )}
        {decision && <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>decision: {String((decision as Record<string, unknown>).action ?? (decision as Record<string, unknown>).side ?? JSON.stringify(decision).slice(0, 80))}</span>}
        {risk && typeof risk === "object" && <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>risk: {JSON.stringify(risk).slice(0, 120)}</span>}
      </div>
    );
  }
  if (decision) {
    return <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>{JSON.stringify(decision).slice(0, 140)}</span>;
  }
  return <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>{JSON.stringify(parsed).slice(0, 160)}</span>;
}

export default function Bots() {
  const [bots, setBots] = useState<Awaited<ReturnType<typeof getBots>>["data"]>([]);
  const [selectedId, setSelectedId] = useState<string>("default");
  const [events, setEvents] = useState<BotEventRow[]>([]);
  const [performance, setPerformance] = useState<Awaited<ReturnType<typeof getBotPerformance>>["data"] | null>(null);
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof getPositions>>["data"]["positions"]>([]);
  const [portfolio, setPortfolio] = useState<Awaited<ReturnType<typeof getPortfolio>>["data"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [botsRes, perfRes, posRes, portRes] = await Promise.all([
        getBots(),
        getBotPerformance(selectedId).catch(() => null),
        getPositions().catch(() => null),
        getPortfolio().catch(() => null),
      ]);
      setBots(botsRes.data);
      if (botsRes.data.length > 0 && !botsRes.data.find((b) => b.id === selectedId)) {
        setSelectedId(botsRes.data[0].id);
      }
      if (perfRes) setPerformance(perfRes.data);
      if (posRes) setPositions(posRes.data.positions);
      if (portRes) setPortfolio(portRes.data);
      const evRes = await getBotEvents(selectedId, { limit: 50 });
      setEvents(evRes.data);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message} (${err.status})` : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedBot = useMemo(() => bots.find((b) => b.id === selectedId) ?? bots[0] ?? null, [bots, selectedId]);
  const status = (selectedBot?.status as string) ?? "unknown";
  const tickCount = selectedBot?.tickCount ?? 0;
  const isRunning = status === "running";
  const isStopped = status === "stopped";

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await postBotStart(selectedId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };
  const handleStop = async () => {
    setActionLoading(true);
    try {
      await postBotStop(selectedId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  // equity/trades derived from portfolio/performance - kept for future use, not displayed directly

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: rgba(20, 19, 15, 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204,136,153,0.14); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(244,242,237,0.05), 0 6px 20px rgba(0,0,0,0.35); }
        .sooth-tab { background: none; border: none; cursor: pointer; font-family: monospace; font-size: 11px; padding: 6px 10px; border-radius: 6px; transition: background 150ms ${EASE}, color 150ms ${EASE}; }
        @media (max-width: 1000px) { .sooth-detail-grid { grid-template-columns: 1fr !important; } }
      `}</style>
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, background: `radial-gradient(600px circle at 15% 10%, rgba(204,136,153,0.10), transparent 60%), radial-gradient(500px circle at 85% 60%, rgba(204,136,153,0.07), transparent 60%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: COLOR.text }}>Bot Monitor</h1>
            <p style={{ fontSize: 12, color: COLOR.muted, marginTop: 4, fontFamily: "monospace" }}>Single bot for hackathon - id is always <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>default</code> <ProvenanceTag tag="DERIVED" small /></p>
          </div>
          <button onClick={() => void load()} style={{ display: "flex", alignItems: "center", gap: 6, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "7px 10px", color: COLOR.muted, cursor: "pointer", fontFamily: "monospace", fontSize: 11 }}>
            refresh
          </button>
        </div>

        {bots.length > 1 && (
          <div style={{ display: "flex", gap: 6, borderBottom: `1px solid ${COLOR.border}`, paddingBottom: 8 }}>
            {bots.map((b) => (
              <button key={b.id} onClick={() => setSelectedId(b.id)} className="sooth-tab" style={{ background: selectedId === b.id ? COLOR.accent : "transparent", color: selectedId === b.id ? COLOR.ink : COLOR.muted, fontWeight: selectedId === b.id ? 700 : 400 }}>
                {b.id}
              </button>
            ))}
          </div>
        )}

        {loading && <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Loading bot…</div>}
        {error && (
          <div style={{ border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: 12, background: "rgba(202,117,96,0.08)", color: COLOR.down, fontSize: 12, fontFamily: "monospace", lineHeight: 1.5 }}>
            <div>{error}</div>
            {error.includes("API not reachable") && <div style={{ marginTop: 6, color: COLOR.muted, fontSize: 11 }}>Start the API with <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>npm run api</code> from the repo root.</div>}
          </div>
        )}

        {!loading && selectedBot && (
          <div className="sooth-detail-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) 360px", gap: 16, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="sooth-glass-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: isRunning ? COLOR.up : isStopped ? COLOR.down : COLOR.faint, opacity: isRunning ? 1 : 0.7, flexShrink: 0 }} aria-hidden="true" />
                      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", color: isRunning ? COLOR.up : isStopped ? COLOR.down : COLOR.faint, textTransform: "uppercase" }}>{status}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>tick {tickCount}</span>
                      <ProvenanceTag tag="DERIVED" small />
                    </div>
                    <h2 style={{ fontSize: 16, fontWeight: 700, margin: "8px 0 2px", color: COLOR.text }}>{selectedId}</h2>
                    <p style={{ fontSize: 12, color: COLOR.muted, margin: 0, fontFamily: "monospace" }}>venue {String((selectedBot.config as unknown as Record<string, unknown>)?.venueId ?? (selectedBot.config as unknown as Record<string, unknown>)?.marketScope ?? "all")} · {bots[0]?.dataIntegrity ? "" : ""}</p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {isRunning ? (
                      <button onClick={() => void handleStop()} disabled={actionLoading} className="sooth-focusable" style={{ background: "transparent", color: COLOR.down, border: `1px solid ${COLOR.down}55`, borderRadius: 6, padding: "7px 12px", fontFamily: "monospace", fontSize: 11, cursor: actionLoading ? "not-allowed" : "pointer", opacity: actionLoading ? 0.6 : 1 }}>
                        {actionLoading ? "…" : "stop"}
                      </button>
                    ) : (
                      <button onClick={() => void handleStart()} disabled={actionLoading} className="sooth-focusable" style={{ background: COLOR.accent, color: COLOR.ink, border: "none", borderRadius: 6, padding: "7px 12px", fontFamily: "monospace", fontSize: 11, fontWeight: 700, cursor: actionLoading ? "not-allowed" : "pointer", opacity: actionLoading ? 0.6 : 1 }}>
                        {actionLoading ? "…" : "start"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="sooth-glass-card">
                <PanelHeader>Live decision feed</PanelHeader>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <ProvenanceTag tag="DERIVED (persisted bot_events)" small />
                </div>
                {events.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLOR.faint, padding: "12px 0" }}>No events yet - bot hasn't ticked or no market evaluated. <span style={{ fontFamily: "monospace" }}>HISTORICAL</span> when available.</div>
                ) : (
                  <div>
                    {events.slice(0, 20).map((ev, idx) => {
                      const isExpanded = expandedIdx === idx;
                      const sym = ev.symbol ?? ev.marketId ?? "";
                      const fmt = sym ? formatSymbolFallback(sym) : null;
                      return (
                        <div key={ev.id} style={{ borderBottom: idx < Math.min(events.length, 20) - 1 ? `1px solid ${COLOR.border}` : "none" }}>
                          <button onClick={() => setExpandedIdx(isExpanded ? null : idx)} className="sooth-focusable" style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 0", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: ev.eventType === "FILL_OBSERVED" ? COLOR.down : ev.eventType === "EXECUTION" ? COLOR.up : ev.eventType === "RISK_CHECK" ? COLOR.faint : COLOR.accent, flexShrink: 0, opacity: 0.9 }} aria-hidden="true" />
                            <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint, width: 72, flexShrink: 0 }}>{new Date(ev.createdAtIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                            <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.accent, flexShrink: 0, width: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.eventType.toLowerCase()}</span>
                            <span style={{ fontSize: 12, color: COLOR.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }} title={fmt ? fmt.title : sym}>{fmt ? fmt.label : sym || "-"}</span>
                            <span style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint, flexShrink: 0 }}>{isExpanded ? "-" : "+"}</span>
                          </button>
                          {isExpanded && (
                            <div style={{ padding: "0 0 12px 16px", borderLeft: `2px solid ${COLOR.border}`, marginLeft: 2, marginBottom: 8 }}>
                              {fmt && fmt.sublabel && <div style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint, marginBottom: 6 }}>{fmt.sublabel}</div>}
                              <EventDetail data={ev.data} />
                              <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                                <ProvenanceTag tag="DERIVED" small />
                                {ev.marketId && <ProvenanceTag tag="LIVE_ONCHAIN" small />}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="sooth-glass-card">
                <PanelHeader>Current positions</PanelHeader>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <ProvenanceTag tag="LIVE_ONCHAIN" small />
                </div>
                {positions.length === 0 ? (
                  <div style={{ fontSize: 12, color: COLOR.faint }}>No open positions.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {positions.map((p) => {
                      const fmt = formatSymbolFallback(p.symbol);
                      return (
                        <div key={p.marketId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: COLOR.surface2, borderRadius: 6, border: `1px solid ${COLOR.border}` }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: COLOR.text, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fmt.title}>{fmt.label}</div>
                            <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace" }}>{fmt.sublabel || p.symbol} · {p.side} · {p.status.toLowerCase()}</div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                            <div style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.text }}>{p.netPosition}</div>
                            <div style={{ fontFamily: "monospace", fontSize: 11, color: p.realizedPnL >= 0 ? COLOR.up : COLOR.down }}>{p.realizedPnL >= 0 ? "+" : ""}${p.realizedPnL.toFixed(2)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="sooth-glass-card">
                <PanelHeader>Risk</PanelHeader>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <ProvenanceTag tag="DERIVED" small />
                </div>
                {(() => {
                  const maxLoss = (selectedBot.config as unknown as Record<string, unknown>)?.bot as Record<string, unknown> | undefined;
                  const maxLossVal = typeof maxLoss?.maxLoss === "number" ? (maxLoss.maxLoss as number) : 100;
                  const currentLoss = performance?.metrics ? Math.max(0, -performance.metrics.netPnL) : 0;
                  const utilization = maxLossVal > 0 ? Math.min(100, Math.round((currentLoss / maxLossVal) * 100)) : 0;
                  const color = utilization >= 90 ? COLOR.down : utilization >= 60 ? "#D6A64F" : COLOR.up;
                  return (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontSize: 12, color: COLOR.muted }}>Risk utilization</span>
                        <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color }}>{utilization}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: COLOR.surface2, overflow: "hidden", marginTop: 6 }}>
                        <div style={{ height: "100%", width: `${utilization}%`, background: color }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", marginTop: 8, borderTop: `1px solid ${COLOR.border}`, fontSize: 12 }}>
                        <span style={{ color: COLOR.muted }}>Max loss</span>
                        <span style={{ fontFamily: "monospace", color: COLOR.text }}>${maxLossVal}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: `1px solid ${COLOR.border}`, fontSize: 12 }}>
                        <span style={{ color: COLOR.muted }}>Loss used</span>
                        <span style={{ fontFamily: "monospace", color: utilization >= 60 ? COLOR.down : COLOR.text }}>${currentLoss.toFixed(2)}</span>
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
                  <ProvenanceTag tag="LIVE_ONCHAIN" small />
                </div>
                {!performance || !performance.metrics ? (
                  <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: 16, background: COLOR.surface2, textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: COLOR.muted, fontWeight: 600 }}>Insufficient data</div>
                    <div style={{ fontSize: 11, color: COLOR.faint, marginTop: 4, lineHeight: 1.5 }}>{performance?.metrics ? "No fills yet" : "No performance yet"} - bot hasn't traded. Metrics will appear after the first fill.</div>
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
                <PanelHeader>Balances</PanelHeader>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <ProvenanceTag tag="LIVE_ONCHAIN" small />
                </div>
                {portfolio ? (
                  portfolio.balances ? (
                    <>
                      <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: COLOR.text }}>{portfolio.balances.tUsdcHuman.toFixed(2)} tUSDC</div>
                      <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.muted, marginTop: 2 }}>{portfolio.balances.nativeHuman.toFixed(4)} SOMI</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: COLOR.faint }}>{portfolio.balancesDataIntegrity}</div>
                  )
                ) : (
                  <div style={{ fontSize: 12, color: COLOR.faint }}>Loading…</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
