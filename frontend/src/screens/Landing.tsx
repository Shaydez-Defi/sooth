import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DecisionBadge } from "../components/decision";
// Original palette from sooth-landing-full-v7.jsx - preserved byte-for-byte, not unified
const COLOR = {
  ink: "#0A0908",
  surface: "#141310",
  border: "#242219",
  text: "#F4F2ED",
  muted: "#8C887E",
  faint: "#605C50",
  accent: "#CC8899",
  accentDim: "#722F37",
  up: "#6B9E78",
  down: "#CA7560",
};
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

function OrbMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="24" stroke={COLOR.text} strokeWidth="1.5" fill="none" />
      <path d="M 32 8 A 24 24 0 0 1 51.85 43.72" stroke={COLOR.accent} strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function EcosystemLayers() {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const rings = [152, 112, 76, 40];
  const layers = [
    { label: "Somnia", r: 152, deg: -90, inward: true },
    { label: "DreamDEX", r: 112, deg: -38, inward: false },
    { label: "Event Contracts", r: 76, deg: -142, inward: false },
  ];
  const ticks = Array.from({ length: 72 }, (_, i) => {
    const a = (i / 72) * Math.PI * 2;
    const major = i % 18 === 0;
    const r1 = major ? rings[0] - 9 : rings[0] - 5;
    return {
      x1: cx + Math.cos(a) * r1,
      y1: cy + Math.sin(a) * r1,
      x2: cx + Math.cos(a) * rings[0],
      y2: cy + Math.sin(a) * rings[0],
      major,
    };
  });
  const nodes = layers.map((l) => {
    const a = (l.deg * Math.PI) / 180;
    const x = cx + Math.cos(a) * l.r;
    const y = cy + Math.sin(a) * l.r;
    const lr = l.inward ? l.r - 30 : l.r + 22;
    const lx = cx + Math.cos(a) * lr;
    const ly = cy + Math.sin(a) * lr;
    return { ...l, x, y, lx, ly };
  });
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "relative" }}>
        <defs>
          <radialGradient id="sooth-radar-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={COLOR.accent} stopOpacity="0.12" />
            <stop offset="100%" stopColor={COLOR.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={rings[0]} fill="url(#sooth-radar-glow)" />
        <line x1={cx} y1={cy - rings[0]} x2={cx} y2={cy + rings[0]} stroke={COLOR.text} strokeOpacity="0.14" strokeWidth="1" />
        <line x1={cx - rings[0]} y1={cy} x2={cx + rings[0]} y2={cy} stroke={COLOR.text} strokeOpacity="0.14" strokeWidth="1" />
        {rings.map((r, i) => (
          <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke={i === rings.length - 1 ? COLOR.accent : COLOR.text} strokeOpacity={i === rings.length - 1 ? 0.9 : 0.18 + i * 0.06} strokeWidth={i === rings.length - 1 ? 1.5 : 1} />
        ))}
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.major ? COLOR.muted : COLOR.border} strokeWidth={t.major ? 1.5 : 1} />
        ))}
        {nodes.map((n) => (
          <g key={n.label}>
            <line x1={n.x} y1={n.y} x2={n.lx} y2={n.ly} stroke={COLOR.faint} strokeWidth="1" />
            <circle cx={n.x} cy={n.y} r="6" stroke={COLOR.accent} strokeWidth="1" opacity="0.4" fill="none" />
            <circle cx={n.x} cy={n.y} r="2.5" fill={COLOR.accent} />
            <text x={n.lx} y={n.ly} textAnchor="middle" dominantBaseline="central" fontSize="10" fontFamily="monospace" letterSpacing="0.5" fill={COLOR.text} style={{ textTransform: "uppercase" }}>
              {n.label.toUpperCase()}
            </text>
          </g>
        ))}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="monospace" letterSpacing="0.5" fill={COLOR.text} fontWeight="700">
          SOOTH
        </text>
      </svg>
    </div>
  );
}

const FAQS: Array<{ q: string; a: string }> = [
  { q: "What is Sooth?", a: "Sooth watches DreamDEX Event Contracts and tells you which ones are worth trading. It reads the live order book, prices the edge, and answers TRADE, WATCH, or NO TRADE - with reasons." },
  { q: "Is Sooth a prediction engine?", a: "No. Sooth doesn't force a prediction on every market. When there isn't a real edge, it says so - NO TRADE is a legitimate result, not an error." },
  {
    q: "Does the bot control my funds?",
    a: "Sooth trades from a dedicated wallet you fund separately - only that balance is at risk. Event Contracts don't currently support the on-chain operator-key restriction that spot trading does, so exposure is capped by the risk engine's position and loss limits in software, not by a contract-level withdrawal block. Fund only what you're willing to risk.",
  },
  { q: "What network is this on?", a: "Sooth is built on Somnia and trades through DreamDEX's on-chain CLOB. It's currently live on testnet." },
];

function GlowingOrb({ size = 200 }: { size?: number }) {
  const glowSize = size * 1.8;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={glowSize} height={glowSize} viewBox="0 0 200 200" style={{ position: "absolute", inset: `${-(glowSize - size) / 2}px` }}>
        <defs>
          <radialGradient id="sooth-orb-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={COLOR.accent} stopOpacity="0.35" />
            <stop offset="60%" stopColor={COLOR.accent} stopOpacity="0.08" />
            <stop offset="100%" stopColor={COLOR.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="100" fill="url(#sooth-orb-glow)" />
      </svg>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" style={{ position: "relative" }}>
        <defs>
          <filter id="sooth-orb-core-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>
        <circle cx="32" cy="32" r="24" stroke={COLOR.text} strokeWidth="1.2" fill="none" />
        <path d="M 32 8 A 24 24 0 0 1 51.85 43.72" stroke={COLOR.accent} strokeWidth="3.5" strokeLinecap="round" fill="none" opacity="0.6" filter="url(#sooth-orb-core-glow)" />
        <path d="M 32 8 A 24 24 0 0 1 51.85 43.72" stroke={COLOR.accent} strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}

function SectionHeading({ eyebrow, center, children }: { eyebrow?: string; center?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 48 }}>
      {eyebrow && <span style={{ fontFamily: "monospace", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: COLOR.faint }}>{eyebrow}</span>}
      <h2
        className="sooth-section-h2"
        style={{ maxWidth: "22ch", fontSize: 32, fontWeight: 600, margin: center ? `${eyebrow ? 12 : 0}px auto 0` : eyebrow ? "12px 0 0" : 0, lineHeight: 1.15, color: COLOR.text }}
      >
        {children}
      </h2>
    </div>
  );
}

const DEMO_WHY: ReadonlyArray<readonly [string, string]> = [
  ["Underlying momentum", "STRONG"],
  ["Buy pressure", "HIGH"],
  ["Liquidity", "GOOD"],
  ["Repricing", "DETECTED"],
  ["Risk", "PASSED"],
];

const STEPS: ReadonlyArray<readonly [string, string, string]> = [
  ["01", "WATCH", "Sooth continuously monitors live Event Contracts."],
  ["02", "ANALYZE", "It combines market price, order flow, liquidity, movement and time."],
  ["03", "DECIDE", "It determines whether the opportunity is worth taking."],
  ["04", "ACT", "If the conditions pass, Sooth can execute the trade."],
];

const SIGNALS: readonly string[] = ["PRICE", "ORDER FLOW", "LIQUIDITY", "MOMENTUM", "VOLATILITY", "TIME", "UNDERLYING", "REPRICING"];

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const navigate = useNavigate();

  return (
    <div style={{ background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif", minHeight: "100vh" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-link { color: ${COLOR.muted}; text-decoration: none; font-size: 14px; transition: color 150ms ${EASE}; }
        .sooth-link:hover { color: ${COLOR.text}; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-faq-btn { width: 100%; text-align: left; background: none; border: none; color: ${COLOR.text}; font-size: 17px; font-weight: 600; padding: 20px 0; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-family: inherit; }
        .sooth-faq-panel { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 280ms ${EASE}; }
        .sooth-faq-panel.open { grid-template-rows: 1fr; }
        .sooth-faq-panel > div { overflow: hidden; }
        .sooth-faq-icon { transition: transform 280ms ${EASE}; display: inline-block; }
        .sooth-faq-icon.open { transform: rotate(45deg); }
        .sooth-btn-primary { background: ${COLOR.accent}; color: ${COLOR.ink}; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 150ms ${EASE}, box-shadow 150ms ${EASE}, transform 100ms ${EASE}; box-shadow: 0 1px 2px rgba(204,136,153,0.15); }
        .sooth-btn-primary:hover { background: ${COLOR.accentDim}; box-shadow: 0 2px 10px rgba(204,136,153,0.28); }
        .sooth-btn-primary:active { transform: scale(0.97); box-shadow: 0 1px 4px rgba(204,136,153,0.2); }
        .sooth-btn-outline { background: transparent; color: ${COLOR.accent}; border: 1px solid ${COLOR.accent}; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: inherit; transition: background 150ms ${EASE}, color 150ms ${EASE}, transform 100ms ${EASE}; }
        .sooth-btn-outline:hover { background: ${COLOR.accent}; color: ${COLOR.ink}; }
        .sooth-btn-outline:active { transform: scale(0.97); }
        @media (prefers-reduced-motion: reduce) {
          .sooth-btn-primary:active, .sooth-btn-outline:active { transform: none !important; }
        }
        @media (max-width: 767px) {
          .sooth-desktop-nav { display: none !important; }
          .sooth-mobile-toggle { display: flex !important; }
          .sooth-grid-2 { grid-template-columns: 1fr !important; }
          .sooth-grid-4 { grid-template-columns: 1fr 1fr !important; }
          .sooth-hero-h1 { font-size: 34px !important; }
          .sooth-section-h2 { font-size: 24px !important; }
          .sooth-footer-grid { grid-template-columns: 1fr 1fr !important; gap: 32px !important; }
        }
      `}</style>

      <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 24px" }}>
        <header style={{ borderBottom: `1px solid ${COLOR.border}`, position: "sticky", top: 0, background: COLOR.ink, zIndex: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <OrbMark size={22} />
              <span style={{ fontWeight: 700, fontSize: 15 }}>SOOTH</span>
            </div>
            <nav className="sooth-desktop-nav" style={{ display: "flex", gap: 28 }}>
              <a href="#how" className="sooth-link">How it works</a>
              <a href="#why" className="sooth-link">Why Sooth</a>
              <a href="#faq" className="sooth-link">FAQ</a>
              <Link to="/docs" className="sooth-link">Docs</Link>
            </nav>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="sooth-mobile-toggle sooth-focusable" onClick={() => setMenuOpen((v) => !v)} style={{ display: "none", background: "none", border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: 8, color: COLOR.text }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
              <button className="sooth-focusable sooth-btn-primary" style={{ padding: "9px 18px", fontSize: 14 }} onClick={() => navigate("/markets")}>
                Launch app
              </button>
            </div>
          </div>
          {menuOpen && (
            <nav style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 16 }}>
              <a href="#how" className="sooth-link">How it works</a>
              <a href="#why" className="sooth-link">Why Sooth</a>
              <a href="#faq" className="sooth-link">FAQ</a>
              <Link to="/docs" className="sooth-link">Docs</Link>
            </nav>
          )}
        </header>

        <section style={{ padding: "72px 0 64px", borderBottom: `1px solid ${COLOR.border}` }}>
          <div className="sooth-grid-2" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 48, alignItems: "center" }}>
            <div>
              <h1 className="sooth-hero-h1" style={{ fontSize: 52, fontWeight: 600, lineHeight: 1.1, color: COLOR.text, margin: 0 }}>
                Know what to trade.
              </h1>
              <p style={{ maxWidth: "44ch", margin: "24px 0 0", color: COLOR.muted, fontSize: 18, lineHeight: 1.55 }}>
                Sooth watches DreamDEX Event Contracts in real time, analyzes the market from multiple signals, and tells you when a market is worth trading - or when to stay out.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 36, flexWrap: "wrap" }}>
                <button className="sooth-focusable sooth-btn-primary" style={{ padding: "13px 28px", fontSize: 14 }} onClick={() => navigate("/markets")}>
                  Explore Markets
                </button>
                <button className="sooth-focusable sooth-btn-outline" style={{ padding: "13px 28px", fontSize: 14 }} onClick={() => navigate("/intelligence")}>
                  See How It Works
                </button>
              </div>
            </div>
            <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 12, padding: 20, background: COLOR.surface }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>ETH UP</span>
                <span style={{ fontFamily: "monospace", fontSize: 10, color: COLOR.up, border: `1px solid ${COLOR.up}`, padding: "1px 6px", borderRadius: 3 }}>LIVE</span>
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 44, fontWeight: 800, marginTop: 8 }}>58¢</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 16, paddingTop: 16, borderTop: `1px solid ${COLOR.border}` }}>
                <span style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Sooth</span>
                <span style={{ fontFamily: "monospace", fontSize: 30, fontWeight: 800, color: COLOR.accent }}>67¢</span>
                <DecisionBadge decision="TRADE" />
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.up, marginTop: 6 }}>+9¢ difference</div>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${COLOR.border}`, display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint, marginBottom: 2 }}>Why?</div>
                {DEMO_WHY.map(([label, level]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: COLOR.muted }}>{label}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: COLOR.up }}>{level}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="The problem">Picking a direction is easy. Knowing when it&apos;s worth trading is harder.</SectionHeading>
          <p style={{ maxWidth: "60ch", color: COLOR.muted, fontSize: 17, lineHeight: 1.6 }}>
            DreamDEX gives traders Event Contracts. The question isn&apos;t only “Will ETH go up?” It is “Is this contract priced well enough to take?” Sooth answers that.
          </p>
        </section>

        <section id="how" style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="How Sooth works">Four steps, no black box.</SectionHeading>
          <div className="sooth-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32 }}>
            {STEPS.map(([num, title, detail]) => (
              <div key={num} style={{ borderTop: `1px solid ${COLOR.border}`, paddingTop: 16 }}>
                <div style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.accent }}>{num}</div>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: COLOR.text, marginTop: 8 }}>{title}</h3>
                <p style={{ fontSize: 14, color: COLOR.muted, marginTop: 8, lineHeight: 1.5 }}>{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Market → Sooth → Decision">The same market, two answers.</SectionHeading>
          <div className="sooth-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Market</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>ETH UP</div>
              <div style={{ fontFamily: "monospace", fontSize: 30, fontWeight: 800, marginTop: 4 }}>58¢</div>
              <div style={{ fontFamily: "monospace", fontSize: 16, color: COLOR.faint, margin: "12px 0" }}>↓</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Sooth</div>
              <div style={{ fontSize: 13, color: COLOR.muted, marginTop: 4 }}>Fair value</div>
              <div style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 800, color: COLOR.accent }}>67¢</div>
              <div style={{ fontFamily: "monospace", fontSize: 16, color: COLOR.faint, margin: "12px 0" }}>↓</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Decision</div>
              <div style={{ marginTop: 8 }}><DecisionBadge decision="TRADE" /></div>
            </div>
            <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 12, padding: 20, textAlign: "center" }}>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Market</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>BTC DOWN</div>
              <div style={{ fontFamily: "monospace", fontSize: 30, fontWeight: 800, marginTop: 4 }}>61¢</div>
              <div style={{ fontFamily: "monospace", fontSize: 16, color: COLOR.faint, margin: "12px 0" }}>↓</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Sooth</div>
              <div style={{ fontSize: 13, color: COLOR.muted, marginTop: 4 }}>Fair value</div>
              <div style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 800, color: COLOR.accent }}>62¢</div>
              <div style={{ fontFamily: "monospace", fontSize: 16, color: COLOR.faint, margin: "12px 0" }}>↓</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>Decision</div>
              <div style={{ marginTop: 8 }}><DecisionBadge decision="NO_TRADE" /></div>
              <p style={{ fontSize: 13, color: COLOR.muted, marginTop: 12 }}>“Not enough opportunity.”</p>
            </div>
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Intelligence">One market. Multiple signals.</SectionHeading>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxWidth: 640 }}>
            {SIGNALS.map((s) => (
              <span key={s} style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", color: COLOR.text, border: `1px solid ${COLOR.border}`, background: COLOR.surface, borderRadius: 6, padding: "8px 14px" }}>
                {s}
              </span>
            ))}
          </div>
          <p style={{ maxWidth: "60ch", color: COLOR.muted, fontSize: 17, lineHeight: 1.6, marginTop: 24 }}>
            Sooth combines these conditions to determine whether a market is actually worth trading. No single signal decides alone.
          </p>
        </section>

        <section id="why" style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Why">Every decision explains itself.</SectionHeading>
          <div className="sooth-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>ETH UP · 58¢</span>
                <DecisionBadge decision="TRADE" />
              </div>
              <div style={{ fontSize: 13, color: COLOR.muted, marginTop: 4 }}>Sooth estimate 67¢</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint, marginTop: 16, marginBottom: 8 }}>Why Sooth likes it</div>
              {[
                ["↑", "ETH is moving higher"],
                ["↑", "Buyers dominate the order book"],
                ["↑", "Contract hasn't fully repriced"],
                ["✓", "Enough liquidity to execute"],
                ["✓", "Risk checks passed"],
                ["✓", "Settlement verified"],
              ].map(([mark, text]) => (
                <div key={text} style={{ display: "flex", gap: 10, fontSize: 14, color: COLOR.text, lineHeight: 1.5, marginBottom: 6 }}>
                  <span style={{ fontFamily: "monospace", color: COLOR.up, flexShrink: 0 }}>{mark}</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
            <div style={{ border: `1px solid ${COLOR.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>BTC DOWN · 61¢</span>
                <DecisionBadge decision="NO_TRADE" />
              </div>
              <div style={{ fontSize: 13, color: COLOR.muted, marginTop: 4 }}>Sooth estimate 62¢</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint, marginTop: 16, marginBottom: 8 }}>Why</div>
              {[
                "Difference is too small",
                "Spread is too wide",
                "Not enough liquidity",
              ].map((text) => (
                <div key={text} style={{ display: "flex", gap: 10, fontSize: 14, color: COLOR.text, lineHeight: 1.5, marginBottom: 6 }}>
                  <span style={{ fontFamily: "monospace", color: COLOR.down, flexShrink: 0 }}>×</span>
                  <span>{text}</span>
                </div>
              ))}
              <p style={{ fontSize: 13, color: COLOR.muted, marginTop: 12, lineHeight: 1.5 }}>NO TRADE is an intelligent outcome, not a failure.</p>
            </div>
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Built on real infrastructure">Sooth is DreamDEX&apos;s mind.</SectionHeading>
          <div className="sooth-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, alignItems: "center" }}>
            <div>
              <p style={{ color: COLOR.muted, fontSize: 17, lineHeight: 1.6, margin: 0 }}>
                Live order books from DreamDEX Event Contracts on Somnia testnet. Venue-scoped markets, on-chain settlement, real receipts for every action.
              </p>
              <p style={{ color: COLOR.muted, fontSize: 15, lineHeight: 1.6, marginTop: 16 }}>
                Chain 50312 · venue 0x6797…e8a28c · 27-asset reference feed · snapshot-persisted history.
              </p>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <EcosystemLayers />
            </div>
          </div>
        </section>

        <section id="faq" style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="FAQ">Common questions</SectionHeading>
          <div>
            {FAQS.map((item, i) => {
              const isOpen = openFaq === i;
              return (
                <div key={item.q} style={{ borderTop: `1px solid ${COLOR.border}`, borderBottom: i === FAQS.length - 1 ? `1px solid ${COLOR.border}` : "none" }}>
                  <button className="sooth-faq-btn sooth-focusable" onClick={() => setOpenFaq(isOpen ? null : i)} aria-expanded={isOpen}>
                    {item.q}
                    <span className={`sooth-faq-icon ${isOpen ? "open" : ""}`} style={{ color: COLOR.faint, fontSize: 20, lineHeight: 1 }}>
                      +
                    </span>
                  </button>
                  <div className={`sooth-faq-panel ${isOpen ? "open" : ""}`}>
                    <div>
                      <p style={{ margin: "0 0 20px", color: COLOR.muted, fontSize: 15, lineHeight: 1.6, maxWidth: "60ch" }}>{item.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section style={{ padding: "88px 0", textAlign: "center", borderBottom: `1px solid ${COLOR.border}` }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
            <GlowingOrb size={100} />
          </div>
          <h2 style={{ maxWidth: "16ch", margin: "0 auto", fontSize: 32, fontWeight: 600, lineHeight: 1.2, color: COLOR.text }}>The market is speaking.</h2>
          <p style={{ maxWidth: "32ch", margin: "12px auto 0", color: COLOR.muted, fontSize: 17 }}>Sooth helps you read it.</p>
          <button className="sooth-focusable sooth-btn-primary" style={{ marginTop: 32, padding: "14px 32px", fontSize: 14 }} onClick={() => navigate("/markets")}>
            Enter Sooth
          </button>
        </section>

        <footer style={{ padding: "64px 0 32px" }}>
          <div className="sooth-footer-grid" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 40 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <OrbMark size={20} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>SOOTH</span>
              </div>
              <p style={{ color: COLOR.muted, fontSize: 13, marginTop: 12, maxWidth: "28ch", lineHeight: 1.5 }}>Know what to trade. Intelligence and execution for DreamDEX Event Contracts on Somnia.</p>
            </div>
            <div>
              <h4 style={{ fontSize: 12, color: COLOR.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Product</h4>
              <button onClick={() => navigate("/markets")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Markets</button>
              <button onClick={() => navigate("/intelligence")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Intelligence</button>
              <button onClick={() => navigate("/positions")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Positions</button>
              <button onClick={() => navigate("/backtest")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Backtest</button>
            </div>
            <div>
              <h4 style={{ fontSize: 12, color: COLOR.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Resources</h4>
              <Link to="/docs" className="sooth-link" style={{ display: "block", marginBottom: 10 }}>Documentation</Link>
              <a href="https://github.com/Shaydez-Defi/sooth" target="_blank" rel="noreferrer" className="sooth-link" style={{ display: "block", marginBottom: 10 }}>GitHub</a>
              <a href="https://github.com/somnia-chain/dreamdex-bot-kit" target="_blank" rel="noreferrer" className="sooth-link" style={{ display: "block", marginBottom: 10 }}>DreamDEX</a>
              <a href="https://testnet.somnia.network" target="_blank" rel="noreferrer" className="sooth-link" style={{ display: "block", marginBottom: 10 }}>Somnia</a>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${COLOR.border}`, marginTop: 40, paddingTop: 24, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>Built on Somnia × DreamDEX</span>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint }}>© 2026 Sooth. Testnet. Not financial advice.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
