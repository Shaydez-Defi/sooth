import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, postAnalyze, getMarkets, type DecisionOutput } from "../lib/api";
import { formatMarket } from "../lib/formatMarket";
import { MarketCard } from "../components/decision";
import { COLOR, EASE } from "../components/theme";

const MIN_LIQUIDITY = 100;
const MAX_SPREAD = 0.06;
const SECONDS_PER_HOUR = 3600;

type EnrichedRow = {
  id: string;
  label: string;
  sublabel: string;
  tooltip: string;
  rawSymbol: string;
  marketProb: number;
  direction: "UP" | "DOWN" | "FLAT";
  decision: DecisionOutput["decision"];
  score: number | null;
  expiresInHrs: number;
  timeRemaining: number;
  isExpired: boolean;
  analysisUnavailable: boolean;
};

const STATUS_TABS = ["All", "Trade", "Watch", "No"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export default function SoothMarkets() {
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysisWarning, setAnalysisWarning] = useState<string | null>(null);
  const [cacheNote, setCacheNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("All");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnalysisWarning(null);
    setCacheNote(null);
    try {
      const [marketsRes, analyzeOutcome] = await Promise.all([
        getMarkets().catch(() => null),
        postAnalyze({ all: true })
          .then((res) => ({ ok: true as const, res }))
          .catch((err) => ({ ok: false as const, err })),
      ]);
      if (!analyzeOutcome.ok) {
        const msg = analyzeOutcome.err instanceof ApiError ? `${analyzeOutcome.err.message} (${analyzeOutcome.err.status})` : (analyzeOutcome.err as Error).message;
        if (marketsRes && marketsRes.data.length > 0) {
          const nowSec = Math.floor(Date.now() / 1000);
          const fallback: EnrichedRow[] = marketsRes.data.map((m) => {
            const fmt = formatMarket({ marketId: m.marketId, symbol: m.symbol, asset: m.asset, expiry: m.expiry, intervalSec: m.intervalSec, interval: m.interval, question: m.question, strike: m.strike });
            const expirySec = m.expiry !== null ? Number(m.expiry) : NaN;
            const timeRemaining = Number.isFinite(expirySec) ? expirySec - nowSec : NaN;
            const expiresInHrs = Number.isFinite(timeRemaining) ? Math.max(0, Math.round((timeRemaining as number) / SECONDS_PER_HOUR)) : NaN;
            return {
              id: m.marketId,
              label: fmt.primary,
              sublabel: fmt.secondary,
              tooltip: fmt.tooltip,
              rawSymbol: m.symbol,
              marketProb: NaN,
              direction: "FLAT" as const,
              decision: "NO_TRADE" as const,
              score: null,
              expiresInHrs,
              timeRemaining: Number.isFinite(timeRemaining) ? (timeRemaining as number) : 0,
              isExpired: Number.isFinite(timeRemaining) ? (timeRemaining as number) <= 0 : false,
              analysisUnavailable: true,
            };
          });
          setRows(fallback);
          setAnalysisWarning(msg);
          if (marketsRes.stale) {
            setCacheNote(`Market list cached (updated ${marketsRes.cacheAgeSec ?? 0}s ago) - retry for live.`);
          }
          return;
        }
        throw analyzeOutcome.err;
      }
      const analyzeRes = analyzeOutcome.res;
      const marketMap = new Map<string, { asset: string; expiry: string | null; intervalSec: number | null; interval: string | null; question: string | null; strike: string | null; symbol: string }>();
      if (marketsRes) {
        for (const m of marketsRes.data) {
          marketMap.set(m.marketId, { asset: m.asset, expiry: m.expiry, intervalSec: m.intervalSec, interval: m.interval, question: m.question, strike: m.strike, symbol: m.symbol });
          marketMap.set(m.symbol, { asset: m.asset, expiry: m.expiry, intervalSec: m.intervalSec, interval: m.interval, question: m.question, strike: m.strike, symbol: m.symbol });
        }
      }
      const enriched: EnrichedRow[] = analyzeRes.data.map((d) => {
        const a = d.analysis;
        const tier = a.liquidity < MIN_LIQUIDITY || a.spread > MAX_SPREAD ? "NO" : d.decision ? d.decision.decision : a.recommendation === "TRADE" ? "TRADE" : "NO";
        const decision: DecisionOutput["decision"] = tier === "TRADE" ? "TRADE" : tier === "WATCH" ? "WATCH" : "NO_TRADE";
        const expiresInHrs = Math.max(0, Math.round(a.timeRemaining / SECONDS_PER_HOUR));
        const info = marketMap.get(a.marketId) ?? marketMap.get(a.symbol) ?? null;
        const fmt = info
          ? formatMarket({ marketId: a.marketId, symbol: a.symbol, asset: info.asset, expiry: info.expiry, intervalSec: info.intervalSec, interval: info.interval, question: info.question, strike: info.strike })
          : formatMarket({ marketId: a.marketId, symbol: a.symbol, asset: "?", expiry: null, intervalSec: null, interval: null, question: null, strike: null });
        return {
          id: a.marketId,
          label: fmt.primary,
          sublabel: fmt.secondary,
          tooltip: fmt.tooltip,
          rawSymbol: a.symbol,
          marketProb: a.marketProbability,
          direction: a.direction === "YES" ? "UP" : a.direction === "NO" ? "DOWN" : "FLAT",
          decision,
          score: d.decision ? d.decision.opportunityScore : null,
          expiresInHrs,
          timeRemaining: a.timeRemaining,
          isExpired: a.timeRemaining <= 0,
          analysisUnavailable: false,
        };
      });
      setRows(enriched);
      if (analyzeRes.stale === true || marketsRes?.stale === true) {
        const age = Math.max(analyzeRes.cacheAgeSec ?? 0, marketsRes?.cacheAgeSec ?? 0);
        setCacheNote(`Showing cached data (updated ${age}s ago) - retry for live.`);
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

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    let r = rows.filter((m) => m.label.toLowerCase().includes(q) || m.sublabel.toLowerCase().includes(q) || m.rawSymbol.toLowerCase().includes(q));
    if (statusTab === "Trade") r = r.filter((m) => m.decision === "TRADE");
    if (statusTab === "Watch") r = r.filter((m) => m.decision === "WATCH");
    if (statusTab === "No") r = r.filter((m) => m.decision === "NO_TRADE");
    return r;
  }, [rows, query, statusTab]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    return copy;
  }, [filtered]);

  const counts = useMemo(
    () => ({
      trade: rows.filter((m) => m.decision === "TRADE").length,
      watch: rows.filter((m) => m.decision === "WATCH").length,
      no: rows.filter((m) => m.decision === "NO_TRADE").length,
    }),
    [rows],
  );

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-tab { background: none; border: none; cursor: pointer; font-family: inherit; fontSize: 13px; padding: 6px 12px; border-radius: 6px; transition: background 150ms ${EASE}, color 150ms ${EASE}; }
        .sooth-search:focus { border-color: ${COLOR.accent} !important; }
      `}</style>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "40px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Markets</h1>
        <p style={{ color: COLOR.muted, fontSize: 15, marginTop: 8 }}>Live contracts. Sooth already scored every one.</p>

        {loading && <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Loading live markets…</div>}
        {error && (
          <div style={{ marginTop: 12, border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: "10px 12px", background: "rgba(202,117,96,0.08)", fontSize: 12, color: COLOR.down, fontFamily: "monospace", lineHeight: 1.5 }}>
            <div>Failed to load markets: {error}</div>
            <button onClick={() => void load()} style={{ marginTop: 8, background: "none", border: "none", color: COLOR.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>retry</button>
          </div>
        )}
        {analysisWarning && !error && (
          <div style={{ marginTop: 12, border: `1px solid ${COLOR.accent}`, borderRadius: 8, padding: "10px 12px", background: "rgba(204,136,153,0.06)", fontSize: 12, color: COLOR.text, fontFamily: "monospace", lineHeight: 1.5 }}>
            <div>Analysis engine timed out - showing live market list, Price/Edge/Signal pending.</div>
            <div style={{ marginTop: 4, color: COLOR.muted, fontSize: 11 }}>{analysisWarning}</div>
            <button onClick={() => void load()} style={{ marginTop: 8, background: "none", border: "none", color: COLOR.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>retry analysis</button>
          </div>
        )}
        {cacheNote && !error && (
          <div style={{ marginTop: 12, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "10px 12px", background: COLOR.surface2, fontSize: 12, color: COLOR.muted, fontFamily: "monospace", lineHeight: 1.5 }}>
            <span>{cacheNote}</span>
            <button onClick={() => void load()} style={{ marginLeft: 8, background: "none", border: "none", color: COLOR.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>retry</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 32, marginTop: 24 }}>
          <div><div style={{ fontSize: 20, fontWeight: 700, color: COLOR.accent }}>{counts.trade}</div><div style={{ fontSize: 12, color: COLOR.faint }}>Trade</div></div>
          <div><div style={{ fontSize: 20, fontWeight: 700, color: COLOR.muted }}>{counts.watch}</div><div style={{ fontSize: 12, color: COLOR.faint }}>Watch</div></div>
          <div><div style={{ fontSize: 20, fontWeight: 700, color: COLOR.faint }}>{counts.no}</div><div style={{ fontSize: 12, color: COLOR.faint }}>No</div></div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginTop: 24, marginBottom: 20 }}>
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
            <input className="sooth-search sooth-focusable" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search markets" style={{ width: "100%", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 14, color: COLOR.text, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", gap: 4, background: COLOR.surface2, borderRadius: 8, padding: 4 }}>
            {STATUS_TABS.map((tab) => (
              <button key={tab} className="sooth-tab sooth-focusable" onClick={() => setStatusTab(tab)} style={{ background: statusTab === tab ? COLOR.accent : "transparent", color: statusTab === tab ? COLOR.ink : COLOR.muted, fontWeight: statusTab === tab ? 600 : 400 }}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        {!loading && sorted.length === 0 && <div style={{ padding: "40px 16px", textAlign: "center", color: COLOR.faint, fontSize: 14 }}>No markets match your filters.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
          {sorted.map((m) => (
            <MarketCard
              key={m.id}
              label={m.label}
              sublabel={m.sublabel}
              direction={m.direction}
              price={m.analysisUnavailable || !Number.isFinite(m.marketProb) ? "-" : pct(m.marketProb)}
              decision={m.decision}
              score={m.score}
              onOpen={() => navigate(`/markets/${encodeURIComponent(m.id)}`, { state: { label: m.label, sublabel: m.sublabel } })}
            />
          ))}
        </div>
        <p style={{ fontSize: 12, color: COLOR.faint, marginTop: 20 }}>
          Price is read live from DreamDEX. Sooth Est., Edge, and Signal are derived by Sooth&apos;s analysis engine.
        </p>
      </div>
    </div>
  );
}
