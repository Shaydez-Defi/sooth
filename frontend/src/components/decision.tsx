import { COLOR } from "./theme";
import type { DecisionOutput, DecisionSignal } from "../lib/api";

export function DecisionBadge({ decision }: { decision: DecisionOutput["decision"] }) {
  const style: React.CSSProperties =
    decision === "TRADE"
      ? { color: COLOR.ink, background: COLOR.accent, border: "none" }
      : decision === "WATCH"
        ? { color: COLOR.accent, background: "transparent", border: `1px solid ${COLOR.accent}` }
        : { color: COLOR.faint, background: "transparent", border: `1px solid ${COLOR.border}` };
  return (
    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.03em", padding: "3px 10px", borderRadius: 4, ...style }}>
      {decision.replace("_", " ")}
    </span>
  );
}

export function OpportunityScore({ score, big }: { score: number; big?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <span style={{ fontFamily: "monospace", fontSize: big ? 28 : 15, fontWeight: 800, color: COLOR.text }}>{score}</span>
      <span style={{ fontFamily: "monospace", fontSize: big ? 13 : 11, color: COLOR.faint }}>/ 100</span>
    </span>
  );
}

function cents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

export function FairValueComparison({ market, fair }: { market: number; fair: number }) {
  const diff = fair - market;
  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      <div>
        <div style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Market</div>
        <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, marginTop: 2 }}>{cents(market)}</div>
      </div>
      <div>
        <div style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Sooth estimate</div>
        <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, marginTop: 2, color: COLOR.accent }}>{cents(fair)}</div>
      </div>
      <div>
        <div style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Difference</div>
        <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, marginTop: 2, color: diff >= 0 ? COLOR.up : COLOR.down }}>
          {diff >= 0 ? "+" : ""}{Math.round(diff * 100)}¢
        </div>
      </div>
    </div>
  );
}

const SIGNAL_LABELS: Record<DecisionSignal["name"], string> = {
  "order-flow": "Order flow",
  momentum: "Momentum",
  dislocation: "Repricing",
  liquidity: "Liquidity",
  spread: "Spread",
  time: "Time to expiry",
  volatility: "Volatility",
  settlement: "Settlement",
  risk: "Risk",
};

function signalGlyph(level: DecisionSignal["level"]): { mark: string; color: string } {
  switch (level) {
    case "STRONG":
      return { mark: "↑", color: COLOR.up };
    case "GOOD":
    case "DETECTED":
    case "PASSED":
      return { mark: "✓", color: COLOR.up };
    case "WEAK":
    case "POOR":
    case "FAILED":
      return { mark: "×", color: COLOR.down };
    default:
      return { mark: "•", color: COLOR.faint };
  }
}

export function SignalList({ signals }: { signals: DecisionSignal[] }) {
  if (signals.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {signals.map((s) => {
        const g = signalGlyph(s.level);
        return (
          <div key={s.name} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13 }} title={s.detail}>
            <span style={{ fontFamily: "monospace", color: g.color, flexShrink: 0, width: 14, textAlign: "center" }}>{g.mark}</span>
            <span style={{ color: COLOR.text, fontWeight: 600, minWidth: 120 }}>{SIGNAL_LABELS[s.name]}</span>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: g.color }}>{s.level}</span>
            <span style={{ fontSize: 12, color: COLOR.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.detail}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DecisionReasons({ reasons }: { reasons: string[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {reasons.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: COLOR.muted, lineHeight: 1.5 }}>
          <span style={{ fontFamily: "monospace", color: COLOR.faint, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
          <span>{r}</span>
        </div>
      ))}
    </div>
  );
}

export function ChecksList({ checks }: { checks: ReadonlyArray<{ label: string; status: "PASS" | "FAIL" | "PENDING" }> }) {
  const colorFor = (s: string): string => (s === "PASS" ? COLOR.up : s === "FAIL" ? COLOR.down : COLOR.faint);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {checks.map((c) => (
        <span
          key={c.label}
          style={{ fontFamily: "monospace", fontSize: 10, color: colorFor(c.status), border: `1px solid ${colorFor(c.status)}`, borderRadius: 4, padding: "1px 6px", opacity: 0.9 }}
        >
          {c.label}: {c.status}
        </span>
      ))}
    </div>
  );
}

export function MarketCard({
  label,
  sublabel,
  direction,
  price,
  decision,
  score,
  onOpen,
}: {
  label: string;
  sublabel: string;
  direction: "UP" | "DOWN" | "FLAT";
  price: string;
  decision: DecisionOutput["decision"];
  score: number | null;
  onOpen: () => void;
}) {
  const dirColor = direction === "UP" ? COLOR.up : direction === "DOWN" ? COLOR.down : COLOR.muted;
  return (
    <button
      onClick={onOpen}
      className="sooth-focusable"
      style={{
        textAlign: "left",
        background: "rgba(20, 19, 15, 0.5)",
        border: "1px solid rgba(204,136,153,0.14)",
        borderRadius: 8,
        padding: 16,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: COLOR.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: dirColor, flexShrink: 0 }}>{direction}</span>
      </div>
      {sublabel !== "" && (
        <span style={{ fontSize: 11, color: COLOR.faint, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sublabel}</span>
      )}
      <div style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 800, color: COLOR.text }}>{price}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${COLOR.border}`, paddingTop: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Sooth</span>
          <DecisionBadge decision={decision} />
        </span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: COLOR.faint }}>Opportunity</span>
          {score !== null ? <OpportunityScore score={score} /> : <span style={{ fontFamily: "monospace", fontSize: 13, color: COLOR.faint }}>-</span>}
        </span>
      </div>
    </button>
  );
}
