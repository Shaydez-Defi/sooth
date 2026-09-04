import { useState } from "react";
import { ApiError, postDecisionReport, type DecisionReport } from "../lib/api";
import { COLOR } from "../components/theme";
import { PanelHeader } from "../components/PanelHeader";
import { ProvenanceTag } from "../components/ProvenanceTag";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 800, color: color ?? COLOR.text }}>{value}</div>
      <div style={{ fontSize: 12, color: COLOR.faint, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function Backtest() {
  const [report, setReport] = useState<DecisionReport | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPred, setOpenPred] = useState<number | null>(null);
  const [ran, setRan] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const res = await postDecisionReport({ limit: 20 });
      if (res.data.report) {
        setReport(res.data.report);
      } else {
        setReport(null);
        setNote("data" in res.data && typeof (res.data as { note?: unknown }).note === "string" ? String((res.data as { note?: unknown }).note) : "No settled markets.");
      }
      setRan(true);
    } catch (err) {
      const msg = err instanceof ApiError ? `${err.message} (${err.status})` : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-glass-card { position: relative; padding: 16px; background: rgba(20, 19, 15, 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204,136,153,0.14); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(244,242,237,0.05), 0 6px 20px rgba(0,0,0,0.35); }
      `}</style>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Backtest</h1>
            <p style={{ color: COLOR.muted, fontSize: 15, marginTop: 8 }}>Test Sooth&apos;s decisions against settled history.</p>
          </div>
          <button className="sooth-focusable" onClick={() => void run()} disabled={loading} style={{ background: COLOR.accent, color: COLOR.ink, border: "none", borderRadius: 6, padding: "10px 20px", fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: "inherit", fontSize: 13, opacity: loading ? 0.7 : 1 }}>
            {loading ? "Running…" : ran ? "Run again" : "Run backtest"}
          </button>
        </div>

        {error && (
          <div style={{ border: `1px solid ${COLOR.down}`, borderRadius: 8, padding: "10px 12px", background: "rgba(202,117,96,0.08)", fontSize: 12, color: COLOR.down, fontFamily: "monospace", lineHeight: 1.5 }}>
            {error} <button onClick={() => void run()} style={{ marginLeft: 8, background: "none", border: "none", color: COLOR.accent, cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline" }}>retry</button>
          </div>
        )}
        {note && !error && <div style={{ fontSize: 13, color: COLOR.faint }}>{note}</div>}

        {report && (
          <>
            <div className="sooth-glass-card">
              <PanelHeader>Decisions</PanelHeader>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <ProvenanceTag tag="HISTORICAL" small />
                <ProvenanceTag tag="DERIVED" small />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}>
                <Stat label="Markets analyzed" value={String(report.marketsEvaluated)} />
                <Stat label="Trades taken" value={String(report.tradesTaken)} color={COLOR.accent} />
                <Stat label="Watch" value={String(report.watchSnapshots)} color={COLOR.muted} />
                <Stat label="No trade" value={String(report.noTradeSnapshots)} color={COLOR.faint} />
              </div>
              <p style={{ fontSize: 12, color: COLOR.muted, marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
                Sooth doesn&apos;t need to trade every market to find opportunities.
              </p>
            </div>

            <div className="sooth-glass-card">
              <PanelHeader>Outcomes</PanelHeader>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 16 }}>
                <Stat label="Win rate" value={report.winRate !== null ? `${Math.round(report.winRate * 100)}%` : "-"} color={COLOR.up} />
                <Stat
                  label="Realized P&L"
                  value={`${report.totalPnL >= 0 ? "+" : ""}$${report.totalPnL.toFixed(2)}`}
                  color={report.totalPnL >= 0 ? COLOR.up : COLOR.down}
                />
                <Stat
                  label="Avg executable edge"
                  value={report.avgExecutableEdge !== null ? `+${(report.avgExecutableEdge * 100).toFixed(1)}%` : "-"}
                  color={COLOR.accent}
                />
                <Stat label="Trades rejected" value={String(report.watchSnapshots + report.noTradeSnapshots)} color={COLOR.faint} />
              </div>
              {Object.keys(report.rejectionReasons).length > 0 && (
                <div style={{ marginTop: 12, fontFamily: "monospace", fontSize: 11, color: COLOR.muted, lineHeight: 1.8 }}>
                  Main rejection reasons: {Object.entries(report.rejectionReasons).map(([k, n]) => `${k}=${n}`).join(" · ")}
                </div>
              )}
            </div>

            <div className="sooth-glass-card">
              <PanelHeader>Inspect decisions</PanelHeader>
              {report.predictions.length === 0 ? (
                <div style={{ fontSize: 12, color: COLOR.faint }}>No trades taken - nothing to inspect. Rejections are counted above.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {report.predictions.map((p, i) => (
                    <div key={`${p.marketId}-${i}`} style={{ borderBottom: i < report.predictions.length - 1 ? `1px solid ${COLOR.border}` : "none", padding: "10px 0" }}>
                      <button className="sooth-focusable" onClick={() => setOpenPred(openPred === i ? null : i)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace", color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.symbol}</span>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: p.correct === true ? COLOR.up : p.correct === false ? COLOR.down : COLOR.faint }}>
                          {p.actual === "UNKNOWN" ? "?" : p.correct ? "WIN" : "LOSS"}
                        </span>
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint, marginLeft: "auto" }}>{openPred === i ? "−" : "+"}</span>
                      </button>
                      {openPred === i && (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginTop: 10, padding: "10px 12px", background: COLOR.surface2, borderRadius: 6 }}>
                          <div><div style={{ fontSize: 11, color: COLOR.faint }}>Predicted</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2 }}>{p.predicted}</div></div>
                          <div><div style={{ fontSize: 11, color: COLOR.faint }}>Entry</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2 }}>${p.entryPrice.toFixed(3)}</div></div>
                          <div><div style={{ fontSize: 11, color: COLOR.faint }}>Edge</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2, color: COLOR.accent }}>+{(p.executableEdge * 100).toFixed(2)}%</div></div>
                          <div><div style={{ fontSize: 11, color: COLOR.faint }}>Actual</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2 }}>{p.actual}</div></div>
                          <div><div style={{ fontSize: 11, color: COLOR.faint }}>P&L</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2, color: p.pnl >= 0 ? COLOR.up : COLOR.down }}>{p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}</div></div>
                          <div><div style={{ fontSize: 11, color: COLOR.faint }}>Book</div><div style={{ fontFamily: "monospace", fontSize: 13, marginTop: 2, color: COLOR.faint }}>{p.bookTag}</div></div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
