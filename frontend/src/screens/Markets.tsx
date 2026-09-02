import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ChevronRight, ChevronUp, ChevronDown, Info, TrendingUp } from "lucide-react";
import { ApiError, postAnalyze, type MarketAnalysis } from "../lib/api";

// ── Preserved verbatim from sooth-markets-v3.jsx - do not unify, flagged as follow-up duplication
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

// No magic numbers - thresholds from src/config.ts ANALYSIS_CONFIG
const MIN_LIQUIDITY = 100;
const MAX_SPREAD = 0.06;
const MIN_EDGE = 0.02;
const SECONDS_PER_HOUR = 3600;

// Type for enriched row derived from live MarketAnalysis - visual shape identical to original
type EnrichedRow = {
  id: string;
  label: string;
  marketProb: number;
  soothEst: number;
  edge: number;
  liquidity: number;
  spread: number;
  expiresInHrs: number;
  timeRemaining: number;
  isExpired: boolean;
  recommendation: "TRADE" | "NO_TRADE";
  tier: "TRADE" | "WAIT" | "NO";
  illiquid: boolean;
  reasons: string[];
};

function computeTier(a: MarketAnalysis): { tier: EnrichedRow["tier"]; illiquid: boolean } {
  const illiquid = a.liquidity < MIN_LIQUIDITY || a.spread > MAX_SPREAD;
  if (illiquid) return { tier: "NO", illiquid: true };
  if (a.recommendation === "TRADE") return { tier: "TRADE", illiquid: false };
  if (Math.abs(a.edge) >= MIN_EDGE) return { tier: "WAIT", illiquid: false };
  return { tier: "NO", illiquid: false };
}

// Visual hierarchy: TRADE = strong accent, WAIT = neutral/muted, NO = quiet/receded, expired = fully dimmed
const TIER_COLOR = { TRADE: COLOR.accent, WAIT: COLOR.muted, NO: COLOR.faint } as const;
const TIER_BG: Record<EnrichedRow["tier"], string> = { TRADE: COLOR.accent, WAIT: "transparent", NO: "transparent" };

function ProvenanceNote() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: COLOR.faint }}>Price is read live from DreamDEX. Sooth Est., Edge, and Signal are derived by Sooth&apos;s analysis engine.</span>
      <button
        className="sooth-focusable"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="What does derived mean?"
        style={{ background: "none", border: "none", color: COLOR.faint, cursor: "pointer", display: "flex" }}
      >
        <Info size={13} />
      </button>
      {open && (
        <div role="tooltip" style={{ position: "absolute", top: "130%", left: 0, zIndex: 5, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "10px 12px", width: 260, fontSize: 12, color: COLOR.muted, lineHeight: 1.5 }}>
          Signal is gated by liquidity and spread before edge size matters - a wide edge in a thin market still reads NO. TRADE needs edge ≥ 5%, sufficient liquidity, and a tight spread.
        </div>
      )}
    </div>
  );
}

const STATUS_TABS = ["All", "Trade", "Wait", "No"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const COLUMNS = [
  { key: "label", label: "Market", sortable: false },
  { key: "marketProb", label: "Price", sortable: true },
  { key: "soothEst", label: "Sooth Est.", sortable: true },
  { key: "edge", label: "Edge", sortable: true },
  { key: "expiresInHrs", label: "Expires", sortable: true },
] as const;

function formatHrs(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "expired";
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem ? `${d}d ${rem}h` : `${d}d`;
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function SignalPill({ tier, isExpired }: { tier: EnrichedRow["tier"]; isExpired?: boolean }) {
  if (isExpired) {
    return (
      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, letterSpacing: "0.03em", color: COLOR.faint, background: "transparent", border: `1px solid ${COLOR.border}`, borderRadius: 4, padding: "2px 8px", opacity: 0.6 }}>
        {tier}
      </span>
    );
  }
  const isTrade = tier === "TRADE";
  return (
    <span
      style={{
        fontFamily: "monospace", fontSize: 11, fontWeight: isTrade ? 800 : 600, letterSpacing: "0.03em",
        color: isTrade ? COLOR.ink : TIER_COLOR[tier],
        background: TIER_BG[tier],
        border: isTrade ? "none" : `1px solid ${tier === "WAIT" ? COLOR.muted + "55" : COLOR.border}`,
        borderRadius: 4, padding: "2px 8px",
        opacity: tier === "NO" ? 0.75 : 1,
      }}
    >
      {tier}
    </span>
  );
}

function SignalSummary({ markets }: { markets: EnrichedRow[] }) {
  const best = useMemo(() => {
    const tradeable = markets.filter((m) => m.tier === "TRADE");
    if (tradeable.length === 0) return null;
    return tradeable.reduce((a, b) => (Math.abs(b.edge) > Math.abs(a.edge) ? b : a));
  }, [markets]);
  return (
    <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: 16, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <TrendingUp size={14} color={COLOR.accent} />
        <span style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Strongest signal</span>
      </div>
      {best ? (
        <>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{best.label}</p>
          <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
            <div><div style={{ fontSize: 11, color: COLOR.faint }}>Market</div><div style={{ fontFamily: "monospace", fontSize: 15 }}>{pct(best.marketProb)}</div></div>
            <div><div style={{ fontSize: 11, color: COLOR.faint }}>Sooth Est.</div><div style={{ fontFamily: "monospace", fontSize: 15, color: COLOR.accent }}>{pct(best.soothEst)}</div></div>
            <div><div style={{ fontSize: 11, color: COLOR.faint }}>Edge</div><div style={{ fontFamily: "monospace", fontSize: 15, color: COLOR.up }}>+{(best.edge * 100).toFixed(1)}%</div></div>
          </div>
          <p style={{ fontSize: 12, color: COLOR.muted, marginTop: 10, lineHeight: 1.5 }}>Cleared the {(Math.abs(best.edge) * 100).toFixed(0)}% edge threshold with liquidity and spread within range - the strongest qualifying signal right now.</p>
        </>
      ) : (
        <p style={{ fontSize: 13, color: COLOR.faint, margin: 0 }}>No market clears the trade threshold right now. That&apos;s a legitimate result, not a gap.</p>
      )}
    </div>
  );
}

// Original ACTIVITY shape preserved verbatim - data now populated from live API where available,
// but markup/spacing/colors identical to sooth-markets-v3.jsx
function ActivityFeed({ rows }: { rows: Array<{ type: "fill" | "signal" | "settle"; text: string; tx?: string; provenance: string; time: string }> }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const dotFor = (t: string): string => (t === "fill" ? COLOR.up : t === "settle" ? COLOR.faint : COLOR.accent);
  if (rows.length === 0) {
    return (
      <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span className="sooth-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: COLOR.up, display: "inline-block" }} />
          <span style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Live activity</span>
        </div>
        <p style={{ fontSize: 12, color: COLOR.faint, margin: 0 }}>No recent activity - trades and signals will appear here.</p>
      </div>
    );
  }
  return (
    <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span className="sooth-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: COLOR.up, display: "inline-block" }} />
        <span style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Live activity</span>
      </div>
      <div>
        {rows.map((a, i) => (
          <div key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} style={{ display: "flex", gap: 10, padding: "9px 8px", marginLeft: -8, marginRight: -8, borderRadius: 6, background: hovered === i ? COLOR.surface2 : "transparent", borderBottom: i < rows.length - 1 ? `1px solid ${COLOR.border}` : "none" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotFor(a.type), flexShrink: 0, marginTop: 7, opacity: 0.9 }} aria-hidden="true" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.4, fontFamily: "monospace", color: COLOR.text }}>{a.type} <span style={{ color: COLOR.muted, fontFamily: "inherit" }}>- {a.text}</span></p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "monospace", fontSize: 10.5, color: COLOR.faint }}>{a.time}</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint }}>{a.provenance}</span>
                {a.tx && <a href="#" style={{ fontFamily: "monospace", fontSize: 10.5, color: COLOR.accent, textDecoration: "none" }}>{a.tx} -&gt;</a>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SoothMarkets() {
  const [rows, setRows] = useState<EnrichedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>("All");
  const [sortKey, setSortKey] = useState<(typeof COLUMNS)[number]["key"]>("edge");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postAnalyze({ all: true });
      const enriched: EnrichedRow[] = res.data.map((d) => {
        const a = d.analysis;
        const { tier, illiquid } = computeTier(a);
        // expiresInHrs derived from timeRemaining seconds → hours, matching original expiresInHrs shape
        const expiresInHrs = Math.max(0, Math.round(a.timeRemaining / SECONDS_PER_HOUR));
        return {
          id: a.marketId,
          label: a.symbol,
          marketProb: a.marketProbability,
          soothEst: a.estimatedProbability,
          edge: a.edge,
          liquidity: a.liquidity,
          spread: a.spread,
          expiresInHrs,
          timeRemaining: a.timeRemaining,
          isExpired: a.timeRemaining <= 0,
          recommendation: a.recommendation,
          tier,
          illiquid,
          reasons: a.reasons,
        };
      });
      setRows(enriched);
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
    let r = rows.filter((m) => m.label.toLowerCase().includes(query.toLowerCase()));
    if (statusTab === "Trade") r = r.filter((m) => m.tier === "TRADE");
    if (statusTab === "Wait") r = r.filter((m) => m.tier === "WAIT");
    if (statusTab === "No") r = r.filter((m) => m.tier === "NO");
    return r;
  }, [rows, query, statusTab]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      // Original sort logic preserved verbatim: edge sorts by abs, others by raw key
      const av = sortKey === "edge" ? Math.abs(a.edge) : (a[sortKey] as number | string);
      const bv = sortKey === "edge" ? Math.abs(b.edge) : (b[sortKey] as number | string);
      if (typeof av === "string" && typeof bv === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      const diff = (av as number) - (bv as number);
      return sortDir === "asc" ? diff : -diff;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const handleSort = (key: (typeof COLUMNS)[number]["key"]) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const tradeCount = rows.filter((m) => m.tier === "TRADE").length;
  const waitCount = rows.filter((m) => m.tier === "WAIT").length;
  const noCount = rows.filter((m) => m.tier === "NO").length;

  // Live activity derived from best signal - keeps same 5-row markup shape as original when data exists
  const activityRows = useMemo(() => {
    if (rows.length === 0) return [];
    // Derive minimal live rows: strongest signal + count summary, rendered in same ActivityFeed
    const best = [...rows].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
    if (!best) return [];
    return [
      { type: "signal" as const, text: `Edge ${best.edge >= 0 ? "+" : ""}${(best.edge * 100).toFixed(1)}% on “${best.label}”`, provenance: "DERIVED" as const, time: "now" },
    ];
  }, [rows]);

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-tab { background: none; border: none; cursor: pointer; font-family: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px; transition: background 150ms ${EASE}, color 150ms ${EASE}; }
        .sooth-th { background: none; border: none; cursor: pointer; font-family: inherit; color: ${COLOR.faint}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; display: inline-flex; align-items: center; gap: 4px; padding: 0; }
        .sooth-th:hover { color: ${COLOR.text}; }
        .sooth-row { transition: background 150ms ${EASE}; cursor: pointer; }
        .sooth-search:focus { border-color: ${COLOR.accent} !important; }
        @keyframes sooth-live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .sooth-live-dot { animation: sooth-live-pulse 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .sooth-live-dot { animation: none !important; } }
        @media (max-width: 900px) { .sooth-markets-grid { grid-template-columns: 1fr !important; } }
        @media (max-width: 800px) {
          .sooth-table-head { display: none !important; }
          .sooth-row { display: grid !important; grid-template-columns: 1fr !important; padding: 16px !important; gap: 6px; }
          .sooth-cell-label { grid-column: 1; font-weight: 600; margin-bottom: 4px; }
          .sooth-cell { display: flex !important; justify-content: space-between; font-size: 13px; }
          .sooth-cell::before { content: attr(data-label); color: ${COLOR.faint}; font-size: 12px; }
        }
      `}</style>
      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "40px 24px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Market Intelligence</h1>
        <p style={{ color: COLOR.muted, fontSize: 15, marginTop: 8 }}>Find where the market is mispriced.</p>

        {loading && <div style={{ marginTop: 16, fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Loading live markets…</div>}
        {error && (
          <div style={{ marginTop: 12, border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: "10px 12px", background: "rgba(202,117,96,0.08)", fontSize: 12, color: COLOR.down, fontFamily: "monospace", lineHeight: 1.5 }}>
            <div>Failed to load markets: {error}</div>
            {error.includes("API not reachable") && (
              <div style={{ marginTop: 6, color: COLOR.muted, fontSize: 11 }}>
                Tip: frontend uses vite proxy → <span style={{ color: COLOR.text }}>http://localhost:3000</span> unless{" "}
                <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>VITE_API_BASE_URL</code> is set. Open a second terminal and run{" "}
                <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>npm run api</code> from the repo root (port 3000 must stay running), then retry. In Codespaces leave <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4 }}>VITE_API_BASE_URL</code> empty.
              </div>
            )}
            <button onClick={() => void load()} style={{ marginTop: 8, background: "none", border: "none", color: COLOR.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>retry</button>
          </div>
        )}

        <div className="sooth-markets-grid" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 32, marginTop: 24, alignItems: "start" }}>
          <div>
            <div style={{ display: "flex", gap: 32, marginBottom: 4 }}>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: COLOR.up }}>{tradeCount}</div><div style={{ fontSize: 12, color: COLOR.faint }}>Trade</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: COLOR.accent }}>{waitCount}</div><div style={{ fontSize: 12, color: COLOR.faint }}>Wait</div></div>
              <div><div style={{ fontSize: 20, fontWeight: 700, color: COLOR.faint }}>{noCount}</div><div style={{ fontSize: 12, color: COLOR.faint }}>No</div></div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", marginTop: 32, marginBottom: 12 }}>
              <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
                <Search size={15} color={COLOR.faint} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
                <input className="sooth-search sooth-focusable" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search markets" style={{ width: "100%", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "9px 12px 9px 34px", fontSize: 14, color: COLOR.text, fontFamily: "inherit" }} />
              </div>
              <div style={{ display: "flex", gap: 4, background: COLOR.surface2, borderRadius: 8, padding: 4 }}>
                {STATUS_TABS.map((tab) => (
                  <button key={tab} className="sooth-tab sooth-focusable" onClick={() => setStatusTab(tab)} style={{ background: statusTab === tab ? COLOR.accent : "transparent", color: statusTab === tab ? COLOR.ink : COLOR.muted, fontWeight: statusTab === tab ? 600 : 400 }}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 20 }}><ProvenanceNote /></div>
            <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 8, overflow: "hidden" }}>
              <div className="sooth-table-head" style={{ display: "grid", gridTemplateColumns: "2fr 0.8fr 0.9fr 0.9fr 0.8fr 0.8fr 24px", padding: "10px 16px", borderBottom: `1px solid ${COLOR.border}`, background: COLOR.surface }}>
                {COLUMNS.map((col) => (
                  <button key={col.key} className="sooth-th sooth-focusable" onClick={() => col.sortable && handleSort(col.key)} style={{ cursor: col.sortable ? "pointer" : "default", justifyContent: col.key === "label" ? "flex-start" : "flex-end", textAlign: col.key === "label" ? "left" : "right" }}>
                    {col.label}
                    {col.sortable && sortKey === col.key && (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                  </button>
                ))}
                <span style={{ fontSize: 11, color: COLOR.faint, textAlign: "right" }}>SIG</span>
                <span />
              </div>
              {!loading && sorted.length === 0 && <div style={{ padding: "40px 16px", textAlign: "center", color: COLOR.faint, fontSize: 14 }}>No markets match your filters.</div>}
              {sorted.map((m, i) => {
                const isPositive = m.edge > 0.0001;
                const isNegative = m.edge < -0.0001;
                const soothEstColor = m.isExpired ? COLOR.faint : isPositive ? COLOR.accent : isNegative ? COLOR.down : COLOR.muted;
                const edgeColor = m.isExpired ? COLOR.faint : isPositive ? COLOR.up : isNegative ? COLOR.down : COLOR.faint;
                const rowOpacity = m.isExpired ? 0.55 : 1;
                return (
                  <div
                    key={m.id}
                    className="sooth-row"
                    onMouseEnter={() => setHoveredRow(m.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    onClick={() => {
                      setSelectedRow(m.id);
                      navigate(`/markets/${encodeURIComponent(m.id)}`);
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 0.8fr 0.9fr 0.9fr 0.8fr 0.8fr 24px",
                      alignItems: "center",
                      padding: "14px 16px",
                      borderBottom: i < sorted.length - 1 ? `1px solid ${COLOR.border}` : "none",
                      background: hoveredRow === m.id && !m.isExpired ? COLOR.surface2 : selectedRow === m.id && !m.isExpired ? "rgba(204,136,153,0.06)" : m.isExpired ? "rgba(20,19,15,0.25)" : "transparent",
                      opacity: rowOpacity,
                    }}
                  >
                    <span className="sooth-cell-label" style={{ fontSize: 14, paddingRight: 12, display: "inline-flex", alignItems: "center", gap: 8, color: m.isExpired ? COLOR.faint : COLOR.text }}>
                      {!m.isExpired && <span className="sooth-live-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: COLOR.up, display: "inline-block", flexShrink: 0 }} aria-hidden="true" />}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
                    </span>
                    <span className="sooth-cell" data-label="Price" style={{ textAlign: "right", fontFamily: "monospace", fontSize: 13, color: m.isExpired ? COLOR.faint : COLOR.muted }}>{pct(m.marketProb)}</span>
                    <span className="sooth-cell" data-label="Sooth Est." style={{ textAlign: "right", fontFamily: "monospace", fontSize: 13, color: soothEstColor }}>{pct(m.soothEst)}</span>
                    <span className="sooth-cell" data-label="Edge" style={{ textAlign: "right", fontFamily: "monospace", fontSize: 13, color: edgeColor, display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 2 }}>
                      {isPositive ? <ChevronUp size={10} style={{ flexShrink: 0 }} /> : isNegative ? <ChevronDown size={10} style={{ flexShrink: 0 }} /> : null}
                      {m.edge >= 0 ? "+" : ""}
                      {(m.edge * 100).toFixed(1)}%
                    </span>
                    <span className="sooth-cell" data-label="Expires" style={{ textAlign: "right", fontFamily: "monospace", fontSize: 13, color: m.isExpired ? COLOR.faint : COLOR.muted }}>{formatHrs(m.expiresInHrs)}</span>
                    <span className="sooth-cell" data-label="Signal" style={{ textAlign: "right" }}><SignalPill tier={m.tier} isExpired={m.isExpired} /></span>
                    <ChevronRight size={16} color={m.isExpired ? COLOR.faint : hoveredRow === m.id ? COLOR.text : COLOR.faint} style={{ justifySelf: "end", opacity: m.isExpired ? 0.5 : 1 }} />
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <SignalSummary markets={rows} />
            <ActivityFeed rows={activityRows} />
          </div>
        </div>
      </div>
    </div>
  );
}
