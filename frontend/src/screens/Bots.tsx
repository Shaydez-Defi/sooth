import { useEffect, useState, useCallback } from "react";
import { RefreshCcw } from "lucide-react";
import { formatSymbolFallback } from "../lib/formatMarket";
import { COLOR } from "../components/theme";
import { PanelHeader } from "../components/PanelHeader";
import { ProvenanceTag } from "../components/ProvenanceTag";
import { ApiError, getBots, getBotPerformance, getBotEvents } from "../lib/api";

export default function Bots() {
  const [perf, setPerf] = useState<Awaited<ReturnType<typeof getBotPerformance>>["data"] | null>(null);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof getBotEvents>>["data"]>([]);
  const [botStatus, setBotStatus] = useState<string>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bots, p, ev] = await Promise.all([getBots(), getBotPerformance("default"), getBotEvents("default", { limit: 20 })]);
      setBotStatus(bots.data[0]?.status ?? "unknown");
      setPerf(p.data);
      setEvents(ev.data);
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
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Bot Dashboard</h1>
          <p style={{ color: COLOR.muted, fontSize: 13, marginTop: 4 }}>Single bot for hackathon - id is always <code style={{ fontFamily: "monospace", background: COLOR.surface2, padding: "2px 6px", borderRadius: 4 }}>default</code> <ProvenanceTag tag="DERIVED" small /></p>
        </div>
        <button onClick={() => void load()} style={{ display: "flex", alignItems: "center", gap: 6, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "8px 12px", color: COLOR.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
          <RefreshCcw size={14} /> Refresh
        </button>
      </div>

      {loading && <div style={{ marginTop: 24, color: COLOR.faint, fontFamily: "monospace", fontSize: 13 }}>Loading bot performance…</div>}
      {error && (
        <div style={{ marginTop: 16, border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: 12, background: "rgba(202,117,96,0.08)", color: COLOR.down, fontSize: 12, fontFamily: "monospace", lineHeight: 1.5 }}>
          <div>{error}</div>
          {error.includes("API not reachable") && <div style={{ marginTop: 6, color: COLOR.muted, fontSize: 11 }}>Start the API with <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>npm run api</code> from the repo root.</div>}
        </div>
      )}

      {!loading && perf && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginTop: 24 }}>
            <div className="sooth-glass-card">
              <PanelHeader>Status</PanelHeader>
              <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: botStatus === "running" ? COLOR.up : COLOR.faint }}>{botStatus}</div>
              <div style={{ marginTop: 8 }}><ProvenanceTag tag="DERIVED" small /></div>
            </div>
            <div className="sooth-glass-card">
              <PanelHeader>Performance</PanelHeader>
              {perf.metrics ? (
                <>
                  <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: perf.metrics.netPnL >= 0 ? COLOR.up : COLOR.down }}>{perf.metrics.netPnL >= 0 ? "+" : ""}${perf.metrics.netPnL.toFixed(2)} net</div>
                  <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 4 }}>{perf.metrics.grossPnL.toFixed(2)} gross · {perf.metrics.gasCost.toFixed(4)} gas</div>
                  <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 4 }}>{perf.metrics.tradeCount} fills · {perf.metrics.resolvedTrades} resolved · {perf.metrics.openPositions} open</div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <ProvenanceTag tag="LIVE_ONCHAIN" small /> <ProvenanceTag tag="DERIVED" small />
                  </div>
                  {perf.metrics.winRate !== null && <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 6 }}>Win rate {(perf.metrics.winRate * 100).toFixed(0)}% · realized edge {perf.metrics.realizedEdge !== null ? `$${perf.metrics.realizedEdge.toFixed(2)}` : "-"}</div>}
                  {perf.metrics.gaps.length > 0 && <div style={{ fontSize: 11, color: COLOR.faint, marginTop: 8, borderTop: `1px solid ${COLOR.border}`, paddingTop: 8 }}>{perf.metrics.gaps[0].slice(0, 120)}</div>}
                </>
              ) : (
                <div style={{ fontSize: 13, color: COLOR.faint }}>No fills yet - insufficient data. Trade first, then metrics appear.</div>
              )}
            </div>
          </div>

          <div className="sooth-glass-card" style={{ marginTop: 20 }}>
            <PanelHeader>Recent events</PanelHeader>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <ProvenanceTag tag="DERIVED (persisted bot_events)" small />
            </div>
            {events.length === 0 ? (
              <div style={{ fontSize: 13, color: COLOR.faint }}>No bot events yet.</div>
            ) : (
              <div>
                {events.map((e) => {
                  const sym = e.symbol ?? e.marketId ?? "";
                  const fmt = sym ? formatSymbolFallback(sym) : { label: "", sublabel: "", title: "" };
                  return (
                    <div key={e.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: `1px solid ${COLOR.border}` }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint, flexShrink: 0 }}>{new Date(e.createdAtIso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.accent, flexShrink: 0 }}>{e.eventType}</span>
                      <span style={{ fontSize: 12, color: COLOR.text, fontFamily: "monospace" }} title={fmt.title}>{fmt.label}{fmt.sublabel ? <span style={{ color: COLOR.faint, fontSize: 10, marginLeft: 6 }}>{fmt.sublabel}</span> : null}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
