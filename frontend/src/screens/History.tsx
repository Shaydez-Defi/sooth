import { useEffect, useState, useCallback } from "react";
import { ApiError, getPositions, getBotEvents } from "../lib/api";
import { formatSymbolFallback } from "../lib/formatMarket";
import { summarizeEvent } from "../components/eventSummary";
import { COLOR } from "../components/theme";
import { PanelHeader } from "../components/PanelHeader";
import { ProvenanceTag } from "../components/ProvenanceTag";

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso.slice(11, 16);
  }
}

function formatDay(unix: number | null): string {
  if (unix === null) return "";
  try {
    return new Date(unix * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export default function History() {
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof getPositions>>["data"]["positions"]>([]);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof getBotEvents>>["data"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [posRes, evRes] = await Promise.all([getPositions().catch(() => null), getBotEvents("default", { limit: 50 }).catch(() => null)]);
      if (posRes) setPositions(posRes.data.positions);
      if (evRes) setEvents(evRes.data);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message} (${err.status})` : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", padding: "32px 20px", maxWidth: 1280, margin: "0 auto" }}>
        <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Loading history…</div>
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

  const closed = positions.filter((p) => p.status === "CLOSED");

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: linear-gradient(180deg, rgba(27,26,21,0.72), rgba(20,19,15,0.55)); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204,136,153,0.16); border-radius: 10px; box-shadow: inset 0 1px 0 rgba(244,242,237,0.07), inset 0 0 0 1px rgba(0,0,0,0.25), 0 14px 34px rgba(0,0,0,0.42); }
      `}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>History</h1>
          <p style={{ color: COLOR.muted, fontSize: 15, marginTop: 8 }}>Decisions and what actually happened. Sooth does not trade everything.</p>
        </div>

        <div className="sooth-glass-card">
          <PanelHeader>Settled</PanelHeader>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <ProvenanceTag tag="HISTORICAL" small />
            <ProvenanceTag tag="LIVE_ONCHAIN" small />
          </div>
          {closed.length === 0 ? (
            <div style={{ fontSize: 12, color: COLOR.faint, padding: "12px 0" }}>Nothing settled yet - positions settle on-chain at expiry.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {closed.map((p) => {
                const fmt = formatSymbolFallback(p.symbol);
                const won = p.realizedPnL > 0;
                return (
                  <div key={p.marketId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: COLOR.surface2, borderRadius: 6, border: `1px solid ${COLOR.border}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fmt.title}>{fmt.label}</span>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: won ? COLOR.up : COLOR.down }}>{won ? "WIN" : "LOSS"}</span>
                      </div>
                      <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", marginTop: 2 }}>{p.side} · {formatDay(p.realizedAtUnix)}</div>
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 13, color: won ? COLOR.up : COLOR.down, flexShrink: 0, marginLeft: 12 }}>
                      {won ? "+" : ""}${p.realizedPnL.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="sooth-glass-card">
          <PanelHeader>Decision log</PanelHeader>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <ProvenanceTag tag="DERIVED" small />
          </div>
          {events.length === 0 ? (
            <div style={{ fontSize: 12, color: COLOR.faint, padding: "12px 0" }}>No decisions recorded yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {events.map((e, i) => {
                const sym = e.symbol ?? e.marketId ?? null;
                const fmt = sym ? formatSymbolFallback(sym) : null;
                return (
                  <div key={e.id ?? i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < events.length - 1 ? `1px solid ${COLOR.border}` : "none" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: COLOR.accent, flexShrink: 0, marginTop: 7, opacity: 0.9 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: COLOR.text }}>{e.eventType.toLowerCase()}</span>
                        <span style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint }}>{e.createdAtIso ? formatClock(e.createdAtIso) : ""}</span>
                        {fmt && <span style={{ fontSize: 11, color: COLOR.muted, fontFamily: "monospace" }}>{fmt.label}</span>}
                      </div>
                      {summarizeEvent(e.eventType, e.data, pct).map((s) => (
                        <div key={s.k} style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint, marginTop: 2 }}>{s.k}: <span style={{ color: COLOR.muted }}>{s.v}</span></div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
