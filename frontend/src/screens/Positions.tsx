import { useEffect, useState, useCallback } from "react";
import { ApiError, getPortfolio, getPositions, getBotPerformance, postAnalyze, type PortfolioResponse } from "../lib/api";
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

type LiveQuote = { prob: number | null; timeRemaining: number | null };

export default function Positions() {
  const { address } = useWallet();
  const [portfolio, setPortfolio] = useState<PortfolioResponse["data"] | null>(null);
  const [positions, setPositions] = useState<Awaited<ReturnType<typeof getPositions>>["data"]["positions"]>([]);
  const [performance, setPerformance] = useState<Awaited<ReturnType<typeof getBotPerformance>>["data"] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
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
      const list = posRes ? posRes.data.positions : portRes.data.positions;
      setPositions(list);
      if (perfRes) setPerformance(perfRes.data);
      const open = list.filter((p) => p.status === "OPEN");
      const entries = await Promise.all(
        open.map(async (p) => {
          try {
            const r = await postAnalyze({ marketId: p.marketId });
            const a = r.data[0]?.analysis;
            return [p.marketId, { prob: a ? a.marketProbability : null, timeRemaining: a ? a.timeRemaining : null }] as const;
          } catch {
            return [p.marketId, { prob: null, timeRemaining: null }] as const;
          }
        }),
      );
      const next: Record<string, LiveQuote> = {};
      for (const [id, q] of entries) next[id] = q;
      setQuotes(next);
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
        <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Loading positions…</div>
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

  const open = positions.filter((p) => p.status === "OPEN");
  const walletShort = address ? shortAddress(address) : "Not connected";

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: linear-gradient(180deg, rgba(27,26,21,0.72), rgba(20,19,15,0.55)); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204,136,153,0.16); border-radius: 10px; box-shadow: inset 0 1px 0 rgba(244,242,237,0.07), inset 0 0 0 1px rgba(0,0,0,0.25), 0 14px 34px rgba(0,0,0,0.42); }
      `}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Positions</h1>
            <p style={{ color: COLOR.muted, fontSize: 15, marginTop: 8 }}>Active trades, watched by Sooth.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: COLOR.surface2, border: `1px solid ${COLOR.border}`, borderRadius: 8, padding: "7px 10px" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>{walletShort}</span>
            {address && <ProvenanceTag tag="LIVE_ONCHAIN" small />}
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontFamily: "monospace", fontSize: 13 }}>
          <span style={{ color: COLOR.muted }}>tUSDC <span style={{ color: COLOR.text }}>{portfolio.balances ? money(portfolio.balances.tUsdcHuman) : "-"}</span></span>
          <span style={{ color: COLOR.muted }}>STT <span style={{ color: COLOR.text }}>{portfolio.balances ? portfolio.balances.nativeHuman.toFixed(3) : "-"}</span></span>
          <span style={{ color: COLOR.muted }}>P&L <span style={{ color: (performance?.metrics?.netPnL ?? portfolio.totalRealizedPnL) >= 0 ? COLOR.up : COLOR.down }}>{performance?.metrics ? money(performance.metrics.netPnL, { signed: true }) : money(portfolio.totalRealizedPnL, { signed: true })}</span></span>
        </div>

        <div className="sooth-glass-card">
          <PanelHeader>Open</PanelHeader>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <ProvenanceTag tag="LIVE_ONCHAIN" small />
          </div>
          {open.length === 0 ? (
            <div style={{ fontSize: 12, color: COLOR.faint, padding: "12px 0" }}>No open positions. When Sooth executes, they appear here.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {open.map((p) => {
                const fmt = formatSymbolFallback(p.symbol);
                const q = quotes[p.marketId];
                const prob = q?.prob ?? null;
                const size = Math.abs(p.netPosition);
                const entry = p.avgEntryPrice;
                const current = prob !== null ? size * (p.side === "YES" ? prob : 1 - prob) : null;
                const pnl = current !== null && entry !== null ? current - size * entry : null;
                const timeLeft = q?.timeRemaining ?? null;
                return (
                  <div key={p.marketId} style={{ padding: "12px", background: COLOR.surface2, borderRadius: 6, border: `1px solid ${COLOR.border}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, color: p.side === "YES" ? COLOR.up : COLOR.down, border: `1px solid ${p.side === "YES" ? COLOR.up : COLOR.down}`, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>{p.side}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={fmt.title}>{fmt.label}</span>
                      </div>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.up, flexShrink: 0 }}>OPEN · MONITORING</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12, marginTop: 10 }}>
                      <div><div style={{ fontSize: 11, color: COLOR.faint }}>Entry</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2 }}>{entry !== null ? money(size * entry) : "-"}</div></div>
                      <div><div style={{ fontSize: 11, color: COLOR.faint }}>Current</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2 }}>{current !== null ? money(current) : "-"}</div></div>
                      <div><div style={{ fontSize: 11, color: COLOR.faint }}>P&L</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2, color: pnl !== null ? (pnl >= 0 ? COLOR.up : COLOR.down) : COLOR.faint }}>{pnl !== null ? money(pnl, { signed: true }) : "-"}</div></div>
                      <div><div style={{ fontSize: 11, color: COLOR.faint }}>Expires</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2 }}>{timeLeft !== null && timeLeft > 0 ? `${Math.floor(timeLeft / 3600)}h` : "-"}</div></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
