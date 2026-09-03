import { useState, useMemo, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { ChevronDown, CheckCircle2, XCircle, Activity } from "lucide-react";
import { ApiError, getOrderbook, getAnalysis, getPositions, getPortfolio, getBotEvents, postOrder, getMarketHistory, getMarketById, type MarketAnalysis } from "../lib/api";
import { formatMarket, formatSymbolFallback } from "../lib/formatMarket";

// Preserved verbatim from sooth-market-detail-v3.jsx - inline, not unified
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
const PANEL_LABEL: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: COLOR.faint,
};
const MIN_LIQUIDITY = 100;
const MIN_ORDER_SIZE = 1;
const MARKET_HISTORY_LIMIT = 100;
function PanelHeader({ icon: Icon, children, right }: { icon?: React.ComponentType<{ size: number; color: string }>; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: SPACE.header }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {Icon ? <Icon size={13} color={COLOR.faint} /> : null}
        <span style={PANEL_LABEL}>{children}</span>
      </div>
      {right}
    </div>
  );
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function formatClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso.slice(11, 16);
  }
}

function TopBar({ analysis, marketId, formatted }: { analysis: MarketAnalysis | null; marketId: string; formatted: { label: string; sublabel: string; title: string } | null }) {
  const [open, setOpen] = useState(false);
  const edge = analysis ? analysis.estimatedProbability - analysis.marketProbability : 0;
  const displayLabel = formatted ? formatted.label : marketId;
  const displaySub = formatted ? formatted.sublabel : "";
  return (
    <div className="sooth-glass-card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <button className="sooth-focusable" onClick={() => setOpen((v) => !v)} title={formatted ? formatted.title : marketId} style={{ display: "flex", alignItems: "center", gap: 8, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "8px 14px", color: COLOR.text, fontFamily: "monospace", fontSize: 13, cursor: "pointer", maxWidth: 360, textAlign: "left" }}>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12, fontWeight: 700, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: COLOR.text }}>{displayLabel}</span>
          {displaySub && <span style={{ display: "block", fontSize: 10, color: COLOR.faint, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displaySub}</span>}
        </span>
        <ChevronDown size={14} color={COLOR.faint} style={{ transform: open ? "rotate(180deg)" : "none", transition: `transform 150ms ${EASE}`, flexShrink: 0 }} />
      </button>
      {analysis ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {[
            ["Market prob.", pct(analysis.marketProbability), COLOR.text],
            ["Sooth est.", pct(analysis.estimatedProbability), COLOR.accent],
            ["Edge", `+${(edge * 100).toFixed(1)}%`, COLOR.up],
            ["Liquidity", `${analysis.liquidity.toFixed(0)}`, COLOR.text],
            ["Spread", `${(analysis.spread * 100).toFixed(1)}%`, COLOR.text],
            ["Expires", analysis.timeRemaining > 0 ? `${Math.floor(analysis.timeRemaining / 3600)}h` : "expired", COLOR.text],
          ].map(([label, value, color]) => (
            <div key={label as string}>
              <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase" }}>{label as string}</div>
              <div style={{ fontFamily: "monospace", fontSize: 15, color: color as string, fontWeight: 600 }}>{value as string}</div>
            </div>
          ))}
        </div>
      ) : (
        <span style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Loading analysis…</span>
      )}
    </div>
  );
}

function ReasoningTrace({ analysis }: { analysis: MarketAnalysis }) {
  return (
    <div className="sooth-glass-card">
      <PanelHeader>Reasoning trace - why {analysis.recommendation}</PanelHeader>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "6px 24px" }}>
        {analysis.reasons.map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: COLOR.muted, lineHeight: 1.5 }}>
            <span style={{ fontFamily: "monospace", color: COLOR.faint, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            {r}
          </div>
        ))}
      </div>
    </div>
  );
}

function DepthChart({ bids, asks }: { bids: [number, number][]; asks: [number, number][] }) {
  const maxDepth = Math.max(...bids.map((b) => b[1]), ...asks.map((a) => a[1]), 1);
  const emptyBoxStyle: React.CSSProperties = {
    border: `1px dashed ${COLOR.border}`,
    borderRadius: 6,
    padding: "16px 12px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    background: COLOR.surface2,
    minHeight: 64,
  };
  return (
    <div className="sooth-glass-card">
      <PanelHeader>Order book depth</PanelHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: COLOR.up, marginBottom: 6, fontFamily: "monospace" }}>BIDS</div>
          {bids.length === 0 ? (
            <div style={emptyBoxStyle}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>No bids</span>
              <span style={{ fontSize: 11, color: COLOR.faint }}>Waiting for live book</span>
            </div>
          ) : (
            bids.map((b) => (
              <div key={b[0]} style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: "5px 8px", fontSize: 12.5, fontFamily: "monospace" }}>
                <div style={{ position: "absolute", inset: 0, background: COLOR.up, opacity: 0.1, width: `${(b[1] / maxDepth) * 100}%`, right: "auto" }} />
                <span style={{ position: "relative", color: COLOR.up }}>{pct(b[0])}</span>
                <span style={{ position: "relative", color: COLOR.muted }}>{b[1].toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLOR.down, marginBottom: 6, fontFamily: "monospace", textAlign: "right" }}>ASKS</div>
          {asks.length === 0 ? (
            <div style={emptyBoxStyle}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>No asks</span>
              <span style={{ fontSize: 11, color: COLOR.faint }}>Waiting for live book</span>
            </div>
          ) : (
            asks.map((a) => (
              <div key={a[0]} style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: "5px 8px", fontSize: 12.5, fontFamily: "monospace" }}>
                <div style={{ position: "absolute", inset: 0, background: COLOR.down, opacity: 0.1, left: "auto", width: `${(a[1] / maxDepth) * 100}%` }} />
                <span style={{ position: "relative", color: COLOR.muted }}>{a[1].toLocaleString()}</span>
                <span style={{ position: "relative", color: COLOR.down }}>{pct(a[0])}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function OrderEntry({ marketId, marketProb, liquidity, onPlaced }: { marketId: string; marketProb: number; liquidity: number; onPlaced: () => void }) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const amountNum = parseFloat(amount) || 0;
  const price = side === "YES" ? marketProb : 1 - marketProb;
  const orderValue = amountNum * price;
  const fees = orderValue * 0.001;

  const riskCheck = useMemo(() => {
    if (amountNum === 0) return null;
    if (amountNum < MIN_ORDER_SIZE) return { ok: false, reason: `Below minimum order size (${MIN_ORDER_SIZE})` };
    if (liquidity < MIN_LIQUIDITY) return { ok: false, reason: `Market liquidity below ${MIN_LIQUIDITY} minimum` };
    return { ok: true, reason: "Within liquidity, spread, and balance limits" };
  }, [amountNum, liquidity]);

  const handlePlace = async () => {
    if (!riskCheck?.ok) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await postOrder({ marketId, side, price, size: amountNum });
      setResult({ ok: true, msg: `Order placed tx ${res.data.txHash.slice(0, 18)}… block ${res.data.blockNumber}` });
      onPlaced();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setResult({ ok: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sooth-glass-card">
      <PanelHeader>Place order</PanelHeader>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["YES", "NO"] as const).map((s) => (
          <button key={s} className="sooth-focusable" onClick={() => setSide(s)} style={{ flex: 1, padding: "8px 0", borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${side === s ? (s === "YES" ? COLOR.up : COLOR.down) : COLOR.border}`, background: side === s ? (s === "YES" ? COLOR.up : COLOR.down) : "transparent", color: side === s ? COLOR.ink : COLOR.muted, transition: `all 150ms ${EASE}` }}>
            {s}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase" }}>Price</label>
          <div style={{ background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "8px 10px", marginTop: 4, fontFamily: "monospace", fontSize: 13, color: COLOR.muted }}>
            {pct(price)} <span style={{ color: COLOR.faint }}>(mid)</span>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase" }}>Amount</label>
          <input className="sooth-focusable sooth-amount-input" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" style={{ width: "100%", background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "8px 10px", marginTop: 4, fontFamily: "monospace", fontSize: 13, color: COLOR.text }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <button key={f} className="sooth-focusable" onClick={() => setAmount(String(Math.round((4000 * f) / price)))} style={{ flex: 1, padding: "5px 0", fontSize: 11, borderRadius: 6, border: `1px solid ${COLOR.border}`, background: "transparent", color: COLOR.muted, cursor: "pointer", fontFamily: "inherit" }}>
            {f === 1 ? "MAX" : `${f * 100}%`}
          </button>
        ))}
      </div>
      {riskCheck && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10, padding: "8px 10px", borderRadius: 8, border: `1px solid ${COLOR.border}`, background: COLOR.surface2 }}>
          {riskCheck.ok ? <CheckCircle2 size={14} color={COLOR.up} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={14} color={COLOR.down} style={{ flexShrink: 0, marginTop: 1 }} />}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: riskCheck.ok ? COLOR.up : COLOR.down }}>{riskCheck.ok ? "Risk check passed" : "Risk check failed"}</div>
            <div style={{ fontSize: 11.5, color: COLOR.muted, marginTop: 2 }}>{riskCheck.reason}</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: COLOR.muted, marginTop: 10, padding: "8px 10px", background: COLOR.surface2, borderRadius: 6, border: `1px solid ${COLOR.border}` }}>
        <span>Value <span style={{ fontFamily: "monospace", color: COLOR.text }}>${orderValue.toFixed(2)}</span></span>
        <span style={{ color: COLOR.faint }}>|</span>
        <span>Fee <span style={{ fontFamily: "monospace", color: COLOR.text }}>${fees.toFixed(2)}</span></span>
        <span style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint }}>(0.1%)</span>
      </div>
      <button className="sooth-focusable" disabled={!riskCheck?.ok || submitting} onClick={() => void handlePlace()} style={{ width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 8, fontWeight: 700, fontSize: 13, fontFamily: "inherit", border: "none", cursor: riskCheck?.ok && !submitting ? "pointer" : "not-allowed", background: riskCheck?.ok && !submitting ? COLOR.accent : COLOR.surface2, color: riskCheck?.ok && !submitting ? COLOR.ink : COLOR.faint, transition: `background 150ms ${EASE}` }}>
        {submitting ? "Placing…" : "Place order"}
      </button>
      {result && <div style={{ marginTop: 8, fontSize: 11, color: result.ok ? COLOR.up : COLOR.down, fontFamily: "monospace" }}>{result.msg}</div>}
    </div>
  );
}

function AccountOverview() {
  const [data, setData] = useState<{ balances: { nativeHuman: number; tUsdcHuman: number } | null; totalRealizedPnL: number; positionsCount: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    void getPortfolio()
      .then((r) => setData({ balances: r.data.balances ? { nativeHuman: r.data.balances.nativeHuman, tUsdcHuman: r.data.balances.tUsdcHuman } : null, totalRealizedPnL: r.data.totalRealizedPnL, positionsCount: r.data.positionsCount }))
      .catch((e: unknown) => setErr((e as Error).message));
  }, []);
  if (err) return <div className="sooth-glass-card"><PanelHeader>Account</PanelHeader><div style={{ fontSize: 12, color: COLOR.down, lineHeight: 1.5 }}>{err}{err.includes("API not reachable") && <span style={{ display: "block", marginTop: 6, color: COLOR.muted, fontSize: 11 }}>API down - run <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>npm run api</code></span>}</div></div>;
  if (!data) return <div className="sooth-glass-card"><PanelHeader>Account</PanelHeader><div style={{ fontSize: 12, color: COLOR.faint }}>Loading…</div></div>;
  return (
    <div className="sooth-glass-card">
      <PanelHeader>Account</PanelHeader>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
        <div>
          <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase" }}>Wallet</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.text, marginTop: 2, lineHeight: 1.3 }}>{data.balances ? `${data.balances.nativeHuman.toFixed(3)} SOMI` : "—"}</div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.muted }}>{data.balances ? `${data.balances.tUsdcHuman.toFixed(2)} tUSDC` : "No key"}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase" }}>Positions</div>
          <div style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: COLOR.text, marginTop: 2 }}>{data.positionsCount}</div>
          <div style={{ fontSize: 11, color: COLOR.faint }}>open</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase" }}>Realized P&L</div>
          <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: data.totalRealizedPnL >= 0 ? COLOR.up : COLOR.down, marginTop: 2 }}>{data.totalRealizedPnL >= 0 ? "+" : ""}${data.totalRealizedPnL.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", textTransform: "uppercase" }}>Win rate</div>
          <div style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint, marginTop: 2, lineHeight: 1.3 }}>Closed only</div>
        </div>
      </div>
    </div>
  );
}

function BottomTabs({ marketId }: { marketId: string }) {
  const [tab, setTab] = useState<"Positions" | "Open orders" | "Bot events" | "Backtest results">("Positions");
  const [positions, setPositions] = useState<unknown[]>([]);
  const [events, setEvents] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (tab === "Positions") {
      void getPositions().then((r) => setPositions(r.data.positions as unknown[])).catch(() => setPositions([]));
    } else if (tab === "Bot events") {
      setLoading(true);
      void getBotEvents("default", { limit: 10 }).then((r) => setEvents(r.data as unknown[])).catch(() => setEvents([])).finally(() => setLoading(false));
    }
  }, [tab]);

  return (
    <div className="sooth-glass-card" style={{ overflow: "hidden", padding: 0 }}>
      <div style={{ display: "flex", gap: 4, padding: "8px 12px", borderBottom: `1px solid ${COLOR.border}` }}>
        {(["Positions", "Open orders", "Bot events", "Backtest results"] as const).map((t) => (
          <button key={t} className="sooth-focusable" onClick={() => setTab(t)} style={{ padding: "6px 12px", fontSize: 13, borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", background: tab === t ? COLOR.accent : "transparent", color: tab === t ? COLOR.ink : COLOR.muted, fontWeight: tab === t ? 600 : 400 }}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ padding: 16, overflowX: "auto" }}>
        {tab === "Positions" && (
          <div style={{ fontSize: 13 }}>
            {(positions as Array<{ symbol: string; netPosition: number; realizedPnL: number; status: string }>).length === 0 ? (
              <div style={{ color: COLOR.faint }}>No positions yet. Trades settle on-chain.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ color: COLOR.faint, fontFamily: "monospace", fontSize: 11, textTransform: "uppercase" }}><th style={{ textAlign: "left", paddingBottom: 8 }}>Market</th><th style={{ textAlign: "right", paddingBottom: 8 }}>Net</th><th style={{ textAlign: "right", paddingBottom: 8 }}>PnL</th><th style={{ textAlign: "right", paddingBottom: 8 }}>Status</th></tr></thead>
                <tbody>
                  {(positions as Array<{ marketId: string; symbol: string; netPosition: number; realizedPnL: number; status: string }>).map((p) => {
                    const fmt = formatSymbolFallback(p.symbol);
                    return (
                      <tr key={p.marketId} style={{ borderTop: `1px solid ${COLOR.border}` }}><td style={{ padding: "10px 0" }} title={fmt.title}><span style={{ display: "block", lineHeight: 1.2, color: COLOR.text }}>{fmt.label}</span><span style={{ display: "block", fontSize: 11, color: COLOR.faint, fontFamily: "monospace", lineHeight: 1.2 }}>{fmt.sublabel || p.symbol}</span></td><td style={{ textAlign: "right", fontFamily: "monospace" }}>{p.netPosition}</td><td style={{ textAlign: "right", fontFamily: "monospace", color: p.realizedPnL >= 0 ? COLOR.up : COLOR.down }}>{p.realizedPnL.toFixed(2)}</td><td style={{ textAlign: "right", fontFamily: "monospace", color: COLOR.faint }}>{p.status}</td></tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {tab === "Bot events" && (
          <div>
            {loading && <div style={{ fontSize: 12, color: COLOR.faint }}>Loading events…</div>}
            {!loading &&
              (events as Array<{ id: number; eventType: string; symbol?: string; dataJson?: { reason?: string } }>).map((e, i) => {
                const sym = e.symbol ?? "";
                const fmt = sym ? formatSymbolFallback(sym) : null;
                return (
                  <div key={e.id ?? i} style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: i > 0 ? `1px solid ${COLOR.border}` : "none", alignItems: "flex-start" }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLOR.faint, flexShrink: 0, marginTop: 7, opacity: 0.7 }} aria-hidden="true" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.text, fontWeight: 600 }}>{e.eventType.toLowerCase()}</span>
                        <span style={{ fontSize: 12, color: COLOR.muted }} title={fmt ? fmt.title : ""}>{fmt ? fmt.label : String(e.dataJson?.reason ?? "")}</span>
                      </div>
                      {fmt && fmt.sublabel && <div style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint, marginTop: 2 }}>{fmt.sublabel}</div>}
                    </div>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint, flexShrink: 0, marginLeft: 12 }}>#{String(e.id)}</span>
                  </div>
                );
              })}
            {!loading && events.length === 0 && <div style={{ fontSize: 12, color: COLOR.faint }}>No bot events yet.</div>}
          </div>
        )}
        {tab === "Open orders" && <div style={{ fontSize: 12, color: COLOR.faint }}>Open orders via GET /orders - requires signer. Shown in Portfolio.</div>}
        {tab === "Backtest results" && <div style={{ fontSize: 12, color: COLOR.faint }}>Run a backtest in <Link to="/lab" style={{ color: COLOR.accent }}>Strategy Lab</Link>.</div>}
        {tab !== "Positions" && tab !== "Bot events" && tab !== "Open orders" && tab !== "Backtest results" ? null : null}
      </div>
      <div style={{ display: "none" }}>{marketId}</div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload || payload.length === 0 || label === undefined) return null;
  return (
    <div style={{ background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: "6px 10px" }}>
      <div style={{ ...PANEL_LABEL, fontSize: 10, marginBottom: 2 }}>{formatClock(label)}</div>
      <div style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: COLOR.accent }}>{pct(payload[0].value)}</div>
    </div>
  );
}

function ProbabilityChart({ marketId, analysis }: { marketId: string; analysis: MarketAnalysis | null }) {
  const [history, setHistory] = useState<Array<{ capturedAtIso: string; mid: number | null }>>([]);
  const [hasHistory, setHasHistory] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!marketId) return;
    setLoading(true);
    setError(null);
    void getMarketHistory(marketId, MARKET_HISTORY_LIMIT)
      .then((res) => {
        setHistory(res.data);
        setHasHistory(res.hasHistory);
      })
      .catch((err: unknown) => {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        setError(msg);
        setHasHistory(false);
      })
      .finally(() => setLoading(false));
  }, [marketId]);

  const chartData = useMemo(() => history.filter((p) => p.mid !== null && Number.isFinite(p.mid)).map((p) => ({ time: p.capturedAtIso, p: p.mid as number })), [history]);
  const latest = chartData[chartData.length - 1];
  const isExpired = analysis ? analysis.timeRemaining <= 0 : false;

  if (loading) {
    return (
      <div className="sooth-glass-card">
        <PanelHeader
          right={<span style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.text }}>{analysis ? pct(analysis.marketProbability) : "-"} <span style={{ color: COLOR.faint, fontSize: 11 }}>now</span></span>}
        >
          Market probability - history
        </PanelHeader>
        <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: COLOR.faint, fontSize: 13 }}>Loading history…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sooth-glass-card">
        <PanelHeader>Market probability - history</PanelHeader>
        <div style={{ padding: 12, border: `1px solid ${COLOR.down}`, borderRadius: 6, background: "rgba(202,117,96,0.08)", color: COLOR.down, fontSize: 12, fontFamily: "monospace" }}>{error}</div>
      </div>
    );
  }

  if (!hasHistory || chartData.length < 2) {
    return (
      <div className="sooth-glass-card">
        <PanelHeader
          right={latest ? <span style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.text }}>{pct(latest.p)} <span style={{ color: COLOR.faint, fontSize: 11 }}>latest</span></span> : undefined}
        >
          Market probability - history
        </PanelHeader>
        <div style={{ height: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, border: `1px solid ${COLOR.border}`, borderRadius: 8, background: COLOR.surface2 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${COLOR.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Activity size={16} color={COLOR.faint} />
          </div>
          <div style={{ fontSize: 13, color: COLOR.muted, fontWeight: 600 }}>Not enough history yet</div>
          <div style={{ fontSize: 12, color: COLOR.faint, maxWidth: 280, textAlign: "center", lineHeight: 1.5 }}>This market just listed - the logger will capture its first snapshots soon. {isExpired ? "Market is expired." : ""}</div>
          {analysis && <div style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>Current mid {pct(analysis.marketProbability)} • {history.length} snapshot(s) • <span style={{ color: COLOR.faint }}>HISTORICAL</span></div>}
        </div>
      </div>
    );
  }

  const yTicks = [0.25, 0.5, 0.75, 1].filter((t) => t >= Math.min(...chartData.map((d) => d.p)) - 0.05 && t <= Math.max(...chartData.map((d) => d.p)) + 0.05);
  return (
    <div className="sooth-glass-card">
      <PanelHeader
        right={<span style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.text }}>{pct(latest.p)} <span style={{ color: COLOR.faint, fontSize: 11 }}>at {formatClock(latest.time)}</span></span>}
      >
        Market probability - {chartData.length} snapshots
      </PanelHeader>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sooth-prob-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR.accent} stopOpacity={0.22} />
              <stop offset="100%" stopColor={COLOR.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={COLOR.border} strokeDasharray="0" vertical={false} />
          <XAxis dataKey="time" tickFormatter={formatClock} stroke={COLOR.faint} tick={{ fontSize: 11, fontFamily: "monospace", fill: COLOR.faint }} axisLine={{ stroke: COLOR.border }} tickLine={false} interval={Math.max(0, Math.floor(chartData.length / 5) - 1)} />
          <YAxis domain={[0, 1]} ticks={yTicks.length > 0 ? yTicks : undefined} tickFormatter={pct} stroke={COLOR.faint} tick={{ fontSize: 11, fontFamily: "monospace", fill: COLOR.faint }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: COLOR.accent, strokeWidth: 1, strokeDasharray: "3 3" }} />
          <Area type="monotone" dataKey="p" stroke={COLOR.accent} strokeWidth={2} fill="url(#sooth-prob-fill)" dot={false} activeDot={{ r: 5, fill: COLOR.accent, stroke: COLOR.ink, strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function EventLog({ marketId }: { marketId: string }) {
  const [rows, setRows] = useState<Array<{ id: number; eventType: string; createdAtIso: string; data: string; marketId: string | null; symbol: string | null }>>([]);
  useEffect(() => {
    void getBotEvents("default", { limit: 12 }).then((r) => setRows(r.data as unknown as typeof rows)).catch(() => setRows([]));
  }, [marketId]);
  const dotColor = (t: string): string => {
    if (t === "FILL_OBSERVED") return COLOR.down;
    if (t === "EXECUTION") return COLOR.up;
    if (t === "RISK_CHECK") return COLOR.faint;
    return COLOR.accent;
  };
  return (
    <div className="sooth-glass-card">
      <PanelHeader>Event log</PanelHeader>
      {rows.length === 0 && <div style={{ fontSize: 12, color: COLOR.faint }}>No events yet.</div>}
      {rows.map((e, i) => {
        const sym = (e as unknown as { symbol?: string | null }).symbol ?? (e as unknown as { marketId?: string | null }).marketId ?? null;
        const fmt = sym ? formatSymbolFallback(sym) : null;
        return (
          <div key={e.id ?? i} style={{ display: "flex", gap: 10, padding: "8px 6px", marginLeft: -6, marginRight: -6, borderRadius: 6, borderBottom: i < rows.length - 1 ? `1px solid ${COLOR.border}` : "none", alignItems: "flex-start" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor(e.eventType), flexShrink: 0, marginTop: 7, opacity: 0.9 }} aria-hidden="true" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.text, fontWeight: 600, letterSpacing: "0.02em" }}>{e.eventType.toLowerCase()}</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint }}>{e.createdAtIso ? formatClock(e.createdAtIso) : ""}</span>
                {fmt && <span style={{ fontSize: 11, color: COLOR.muted, fontFamily: "monospace" }} title={fmt.title}>{fmt.label}</span>}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.faint, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.data.slice(0, 80)}</div>
              {fmt && fmt.sublabel && <div style={{ fontFamily: "monospace", fontSize: 9, color: COLOR.faint, marginTop: 1 }}>{fmt.sublabel}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const marketId = id ?? "";
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [bids, setBids] = useState<[number, number][]>([]);
  const [asks, setAsks] = useState<[number, number][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formatted, setFormatted] = useState<{ label: string; sublabel: string; title: string } | null>(null);

  const load = useCallback(async () => {
    if (!marketId) return;
    setLoading(true);
    setError(null);
    try {
      const [aRes, bookRes, detailRes] = await Promise.all([
        getAnalysis(marketId),
        getOrderbook(marketId, 5).catch(() => null),
        getMarketById(marketId).catch(() => null),
      ]);
      setAnalysis(aRes.data);
      if (bookRes) {
        setBids(bookRes.data.bids as [number, number][]);
        setAsks(bookRes.data.asks as [number, number][]);
      } else {
        // fallback: analysis already has liquidity/spread but not depth - use empty
        setBids([]);
        setAsks([]);
      }
      // Build human-readable label from real API fields - never fabricate a price question
      if (detailRes && detailRes.data && detailRes.data.unified) {
        const info = detailRes.data.unified.info as unknown as { asset?: string; intervalSec?: number; interval?: string; expiry?: number | string; question?: string | null; strike?: string | number | null };
        const fmt = formatMarket({
          marketId,
          symbol: detailRes.data.unified.symbol,
          asset: String(info.asset ?? "?"),
          expiry: info.expiry !== undefined && info.expiry !== null ? String(info.expiry) : null,
          intervalSec: typeof info.intervalSec === "number" ? info.intervalSec : null,
          interval: typeof info.interval === "string" ? info.interval : null,
          question: typeof info.question === "string" ? info.question : null,
          strike: info.strike !== undefined && info.strike !== null ? String(info.strike) : null,
        });
        setFormatted({ label: fmt.primary, sublabel: fmt.secondary, title: fmt.tooltip });
        if (!fmt.hasQuestion && fmt.primary === detailRes.data.unified.symbol) {
          console.warn(`[MarketDetail] market ${marketId} fell back to raw symbol - question/interval/expiry missing or unparsable`);
        }
      } else {
        // Fallback: use symbol as primary, honest about missing fields
        const fmt = formatMarket({ marketId, symbol: aRes.data.symbol, asset: "?", expiry: null, intervalSec: null, interval: null, question: null, strike: null });
        setFormatted({ label: fmt.primary, sublabel: fmt.secondary, title: fmt.tooltip });
      }
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message} (${err.status})` : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!marketId) {
    return (
      <div style={{ background: COLOR.ink, color: COLOR.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <p>Missing market id</p>
          <Link to="/markets" style={{ color: COLOR.accent }}>Back to markets</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: rgba(20, 19, 15, 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204, 136, 153, 0.14); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(244, 242, 237, 0.05), 0 6px 20px rgba(0, 0, 0, 0.35); }
        .sooth-amount-input::placeholder { color: ${COLOR.faint}; }
        .sooth-amount-input:focus { border-color: ${COLOR.accent} !important; outline: none; }
        @media (max-width: 1000px) { .sooth-detail-grid { grid-template-columns: 1fr !important; } }
      `}</style>
      <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 0, background: `radial-gradient(600px circle at 15% 10%, rgba(204,136,153,0.10), transparent 60%), radial-gradient(500px circle at 85% 60%, rgba(204,136,153,0.07), transparent 60%)`, pointerEvents: "none" }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ padding: "10px 20px" }}>
          <Link to="/markets" style={{ color: COLOR.muted, fontSize: 13, textDecoration: "none" }}>← Back to markets</Link>
        </div>
        {loading && <div style={{ padding: "40px 20px", color: COLOR.faint, fontFamily: "monospace" }}>Loading live analysis for {marketId}…</div>}
        {error && (
          <div style={{ margin: "16px 20px", border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: 12, background: "rgba(202,117,96,0.08)" }}>
            <div style={{ fontSize: 13, color: COLOR.down, fontWeight: 600 }}>Failed to load market {marketId}</div>
            <div style={{ fontSize: 12, color: COLOR.muted, marginTop: 4, fontFamily: "monospace", lineHeight: 1.5 }}>{error}</div>
            {error.includes("API not reachable") && (
              <div style={{ fontSize: 11, color: COLOR.muted, marginTop: 6 }}>
                Tip: start the API with <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>npm run api</code> from the repo root (port 3000). Check <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>VITE_API_BASE_URL</code> in <code style={{ background: COLOR.surface2, padding: "1px 6px", borderRadius: 4, color: COLOR.text }}>frontend/.env</code>.
              </div>
            )}
            <button onClick={() => void load()} className="sooth-focusable" style={{ marginTop: 10, padding: "6px 12px", borderRadius: 6, border: `1px solid ${COLOR.border}`, background: COLOR.surface2, color: COLOR.text, cursor: "pointer", fontSize: 12 }}>Retry</button>
          </div>
        )}
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "16px", display: "flex", flexDirection: "column", gap: 16 }}>
          {!loading && analysis && (
            <div className="sooth-detail-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) 360px", gap: 16, alignItems: "start" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <TopBar analysis={analysis} marketId={marketId} formatted={formatted} />
                <ReasoningTrace analysis={analysis} />
                <DepthChart bids={bids} asks={asks} />
                <ProbabilityChart marketId={marketId} analysis={analysis} />
                <BottomTabs marketId={marketId} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <EventLog marketId={marketId} />
                <OrderEntry marketId={marketId} marketProb={analysis.marketProbability} liquidity={analysis.liquidity} onPlaced={() => void load()} />
                <AccountOverview />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
