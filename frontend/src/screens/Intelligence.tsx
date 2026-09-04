import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, getBots, getBotEvents, postAnalyze, postBotStart, postBotStop, type DecisionOutput } from "../lib/api";
import { formatSymbolFallback } from "../lib/formatMarket";
import { summarizeEvent } from "../components/eventSummary";
import { DecisionBadge, OpportunityScore } from "../components/decision";
import { COLOR } from "../components/theme";

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso.slice(11, 16);
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

interface TopPick {
  id: string;
  label: string;
  sublabel: string;
  direction: "UP" | "DOWN" | "FLAT";
  decision: DecisionOutput["decision"];
  score: number;
}

export default function Intelligence() {
  const [status, setStatus] = useState("unknown");
  const [tickCount, setTickCount] = useState(0);
  const [acting, setActing] = useState(false);
  const [monitored, setMonitored] = useState(0);
  const [opportunities, setOpportunities] = useState(0);
  const [top, setTop] = useState<TopPick | null>(null);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof getBotEvents>>["data"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [botsRes, analyzeRes, eventsRes] = await Promise.all([
        getBots().catch(() => null),
        postAnalyze({ all: true }).catch(() => null),
        getBotEvents("default", { limit: 8 }).catch(() => null),
      ]);
      const bot = botsRes?.data?.[0] as { status?: unknown; tickCount?: unknown } | undefined;
      setStatus(typeof bot?.status === "string" ? bot.status : "unknown");
      setTickCount(typeof bot?.tickCount === "number" ? bot.tickCount : 0);
      if (eventsRes) setEvents(eventsRes.data);
      if (analyzeRes) {
        const scored = analyzeRes.data.filter((d) => d.decision && (d.decision.decision === "TRADE" || d.decision.decision === "WATCH"));
        setMonitored(analyzeRes.data.length);
        setOpportunities(scored.length);
        const best = [...analyzeRes.data]
          .filter((d) => d.decision)
          .sort((a, b) => (b.decision?.opportunityScore ?? -1) - (a.decision?.opportunityScore ?? -1))[0];
        if (best?.decision) {
          const dir = best.analysis.direction === "YES" ? "UP" : best.analysis.direction === "NO" ? "DOWN" : "FLAT";
          setTop({
            id: best.marketId,
            label: best.symbol,
            sublabel: "",
            direction: dir,
            decision: best.decision.decision,
            score: best.decision.opportunityScore,
          });
        } else {
          setTop(null);
        }
      }
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

  const toggleBot = async () => {
    setActing(true);
    try {
      if (status === "running") await postBotStop("default");
      else await postBotStart("default");
      await load();
    } catch {
      setError("Bot control failed - retry.");
    } finally {
      setActing(false);
    }
  };

  const isRunning = status === "running";

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: linear-gradient(180deg, rgba(27,26,21,0.72), rgba(20,19,15,0.55)); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204,136,153,0.16); border-radius: 10px; box-shadow: inset 0 1px 0 rgba(244,242,237,0.07), inset 0 0 0 1px rgba(0,0,0,0.25), 0 14px 34px rgba(0,0,0,0.42); }
      `}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Intelligence</h1>
          <p style={{ color: COLOR.muted, fontSize: 15, marginTop: 8 }}>Sooth is watching. This is what it thinks right now.</p>
        </div>

        {loading && <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Reading live state…</div>}
        {error && (
          <div style={{ border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: "10px 12px", background: "rgba(202,117,96,0.08)", fontSize: 12, color: COLOR.down, fontFamily: "monospace" }}>
            {error} <button onClick={() => void load()} style={{ marginLeft: 8, background: "none", border: "none", color: COLOR.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>retry</button>
          </div>
        )}

        <div className="sooth-glass-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: isRunning ? COLOR.up : COLOR.faint, display: "inline-block" }} />
              <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", color: isRunning ? COLOR.up : COLOR.faint }}>
                SOOTH {isRunning ? "ACTIVE" : "IDLE"}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>tick {tickCount}</span>
            </div>
            <button className="sooth-focusable" onClick={() => void toggleBot()} disabled={acting} style={{ background: isRunning ? "transparent" : COLOR.accent, color: isRunning ? COLOR.down : COLOR.ink, border: isRunning ? `1px solid ${COLOR.down}` : "none", borderRadius: 6, padding: "8px 16px", fontWeight: 600, cursor: acting ? "wait" : "pointer", fontFamily: "inherit", fontSize: 13 }}>
              {acting ? "Working…" : isRunning ? "Stop" : "Start watching"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16, marginTop: 16 }}>
            <div><div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 800 }}>{monitored}</div><div style={{ fontSize: 12, color: COLOR.faint }}>Monitoring</div></div>
            <div><div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 800, color: COLOR.accent }}>{opportunities}</div><div style={{ fontSize: 12, color: COLOR.faint }}>Opportunities found</div></div>
          </div>
        </div>

        {top && (
          <div className="sooth-glass-card">
            <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint, marginBottom: 12 }}>Top opportunity now</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{top.label}</span>
                <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: top.direction === "UP" ? COLOR.up : top.direction === "DOWN" ? COLOR.down : COLOR.muted }}>{top.direction}</span>
                <DecisionBadge decision={top.decision} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <OpportunityScore score={top.score} />
                <button className="sooth-focusable" onClick={() => navigate(`/markets/${encodeURIComponent(top.id)}`)} style={{ background: COLOR.accent, color: COLOR.ink, border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13 }}>
                  Open
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="sooth-glass-card">
          <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint, marginBottom: 12 }}>Recent decisions</div>
          {events.length === 0 ? (
            <p style={{ fontSize: 12, color: COLOR.faint, margin: 0 }}>Nothing recorded yet - decisions appear here as Sooth works.</p>
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
