import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Radar, BarChart3, History, CheckCircle2, Activity, Target, SlidersHorizontal, KeyRound, Rocket, Eye } from "lucide-react";

// Original palette from sooth-landing-full-v7.jsx — preserved byte-for-byte, not unified
const COLOR = {
  ink: "#0A0908",
  surface: "#141310",
  border: "#242219",
  text: "#F4F2ED",
  muted: "#8C887E",
  faint: "#605C50",
  accent: "#CC8899",
  accentDim: "#722F37",
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

function IllustrationDiscover() {
  return <Radar size={40} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationAnalyze() {
  return <BarChart3 size={40} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationBacktest() {
  return <History size={40} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationExecute() {
  return <CheckCircle2 size={40} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationMonitor() {
  return <Activity size={40} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationStrategy() {
  return <Target size={32} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationConfigure() {
  return <SlidersHorizontal size={32} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationAuthorize() {
  return <KeyRound size={32} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationDeploy() {
  return <Rocket size={32} color={COLOR.accent} strokeWidth={1.4} />;
}
function IllustrationWatch() {
  return <Eye size={32} color={COLOR.accent} strokeWidth={1.4} />;
}

const AUTOMATION_STEPS: Array<{ Illustration: () => React.JSX.Element; title: string; detail: string }> = [
  { Illustration: IllustrationStrategy, title: "Create strategy", detail: "Pick momentum, mean-reversion, or a plain edge threshold." },
  { Illustration: IllustrationConfigure, title: "Configure rules", detail: "Position size, loss limits, minimum liquidity — you set every bound." },
  { Illustration: IllustrationAuthorize, title: "Authorize", detail: "Grant a limited operator key. It can trade. It can't withdraw." },
  { Illustration: IllustrationDeploy, title: "Deploy", detail: "The bot starts reading live markets through the same pipeline." },
  { Illustration: IllustrationWatch, title: "Monitor", detail: "Watch it run, or stop it the moment a rule is violated." },
];

function EcosystemLayers({ reducedMotion }: { reducedMotion: boolean }) {
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const rings = [152, 112, 76, 40];
  const layerLabels = [
    { label: "Somnia", r: 152 },
    { label: "DreamDEX", r: 112 },
    { label: "Event Contracts", r: 76 },
  ];
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {!reducedMotion && (
        <div
          className="sooth-radar-sweep"
          style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `conic-gradient(from 0deg, ${COLOR.accent}55, transparent 70deg, transparent 360deg)` }}
        />
      )}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "relative" }}>
        <defs>
          <radialGradient id="sooth-radar-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={COLOR.accent} stopOpacity="0.25" />
            <stop offset="100%" stopColor={COLOR.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r="90" fill="url(#sooth-radar-glow)" />
        <line x1={cx} y1={cy - rings[0]} x2={cx} y2={cy + rings[0]} stroke={COLOR.text} strokeOpacity="0.08" strokeWidth="1" />
        <line x1={cx - rings[0]} y1={cy} x2={cx + rings[0]} y2={cy} stroke={COLOR.text} strokeOpacity="0.08" strokeWidth="1" />
        {rings.map((r, i) => (
          <circle key={r} cx={cx} cy={cy} r={r} fill="none" stroke={COLOR.text} strokeOpacity={0.12 + i * 0.1} strokeWidth="1" />
        ))}
        <circle cx={cx} cy={cy} r="40" fill={COLOR.accent} />
        {layerLabels.map((l) => (
          <text key={l.label} x={cx} y={cy - l.r + 18} textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="monospace" letterSpacing="0.5" fill={COLOR.faint} style={{ textTransform: "uppercase" }}>
            {l.label.toUpperCase()}
          </text>
        ))}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="11" fontFamily="monospace" letterSpacing="0.5" fill={COLOR.ink} fontWeight="700">
          SOOTH
        </text>
      </svg>
    </div>
  );
}

const PIPELINE: Array<{ Illustration: () => React.JSX.Element; title: string; detail: string }> = [
  { Illustration: IllustrationDiscover, title: "Discover", detail: "Browse real DreamDEX Event Contracts on Somnia — live state, not simulated markets." },
  { Illustration: IllustrationAnalyze, title: "Analyze", detail: "Liquidity, spread, and time to expiry become a single, honest edge calculation." },
  { Illustration: IllustrationBacktest, title: "Backtest", detail: "Run a strategy against historical conditions before it touches real capital." },
  { Illustration: IllustrationExecute, title: "Execute", detail: "Trade manually, or hand execution to a bot bound by the limits you set." },
  { Illustration: IllustrationMonitor, title: "Monitor", detail: "Positions, fills, and P&L update from on-chain events — never estimates." },
];

const WHY_SOOTH = [
  { title: "Intelligence", detail: "Turn raw order-book data into a signal you can actually act on." },
  { title: "Evidence", detail: "Test a strategy against history before committing capital to it." },
  { title: "Execution", detail: "Move from analysis to a real DreamDEX trade in one motion." },
  { title: "Automation", detail: "Let a defined strategy run without babysitting every tick." },
];

const PRODUCT_STEPS = ["Markets", "Market Detail", "Strategy Lab", "Bot Builder", "Portfolio"] as const;

const FAQS: Array<{ q: string; a: string }> = [
  { q: "What is Sooth?", a: "An intelligence and execution layer built around DreamDEX Event Contracts on Somnia — it reads the live order book, prices real edge, and can execute or automate a strategy." },
  { q: "Is Sooth a prediction engine?", a: "No. Sooth doesn't force a prediction on every market. When there isn't a real edge, it says so — NO TRADE is a legitimate result, not an error." },
  { q: "Does the bot control my funds?", a: "No. Automated strategies run through a limited operator key that can place and cancel orders but can never withdraw funds from your wallet." },
  { q: "What network is this on?", a: "Sooth is built on Somnia and trades through DreamDEX's on-chain CLOB. It's currently live on testnet." },
];

function GlowingOrb({ size = 200, reducedMotion }: { size?: number; reducedMotion: boolean }) {
  const glowSize = size * 1.8;
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={glowSize} height={glowSize} viewBox="0 0 200 200" className={reducedMotion ? "" : "sooth-orb-breathe"} style={{ position: "absolute", inset: `${-(glowSize - size) / 2}px` }}>
        <defs>
          <radialGradient id="sooth-orb-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={COLOR.accent} stopOpacity="0.35" />
            <stop offset="60%" stopColor={COLOR.accent} stopOpacity="0.08" />
            <stop offset="100%" stopColor={COLOR.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="100" fill="url(#sooth-orb-glow)" />
      </svg>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={reducedMotion ? "" : "sooth-orb-sweep"} style={{ position: "relative" }}>
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

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          obs.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={`sooth-reveal ${shown ? "in" : ""}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
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

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

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
        @keyframes sooth-breathe { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
        @keyframes sooth-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .sooth-orb-breathe { animation: sooth-breathe 4s ease-in-out infinite; }
        .sooth-orb-sweep { animation: sooth-sweep 22s linear infinite; transform-box: fill-box; transform-origin: 50% 50%; }
        @keyframes sooth-radar-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .sooth-radar-sweep { animation: sooth-radar-spin 6s linear infinite; }
        .sooth-reveal { transform: translateY(14px); opacity: 0.001; transition: transform 500ms ${EASE}, opacity 500ms ${EASE}; }
        .sooth-reveal.in { transform: translateY(0); opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .sooth-orb-breathe, .sooth-orb-sweep, .sooth-radar-sweep { animation: none !important; }
          .sooth-reveal { transform: none !important; opacity: 1 !important; transition: none !important; }
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
              <a href="#pipeline" className="sooth-link">How it works</a>
              <a href="#why" className="sooth-link">Why Sooth</a>
              <a href="#faq" className="sooth-link">FAQ</a>
              <a href="#" className="sooth-link">Docs</a>
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
              <a href="#pipeline" className="sooth-link">How it works</a>
              <a href="#why" className="sooth-link">Why Sooth</a>
              <a href="#faq" className="sooth-link">FAQ</a>
              <a href="#" className="sooth-link">Docs</a>
            </nav>
          )}
        </header>

        <section style={{ textAlign: "center", padding: "56px 0 40px" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <GlowingOrb size={180} reducedMotion={reducedMotion} />
          </div>
          <h1 className="sooth-hero-h1" style={{ fontSize: 52, fontWeight: 600, maxWidth: "16ch", margin: "0 auto", lineHeight: 1.1, color: COLOR.text }}>
            See what the market sees.
          </h1>
          <p style={{ maxWidth: "50ch", margin: "24px auto 0", color: COLOR.muted, fontSize: 18, lineHeight: 1.55 }}>
            Sooth turns DreamDEX Event Contracts into an intelligent, executable trading experience — real order book, real edge, real trades.
          </p>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 24, marginTop: 36 }}>
            <button className="sooth-focusable sooth-btn-primary" style={{ padding: "13px 28px", fontSize: 14 }} onClick={() => navigate("/markets")}>
              Explore markets
            </button>
            <a href="#pipeline" className="sooth-link">See how it works</a>
          </div>
        </section>

        <section style={{ borderTop: `1px solid ${COLOR.border}`, borderBottom: `1px solid ${COLOR.border}`, padding: "28px 0" }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 48, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontSize: 12, color: COLOR.faint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Built on</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: COLOR.muted }}>Somnia</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: COLOR.muted }}>DreamDEX</span>
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="The problem">Too many markets. Too little context.</SectionHeading>
          <p style={{ maxWidth: "60ch", color: COLOR.muted, fontSize: 17, lineHeight: 1.6 }}>
            Right now, trading an Event Contract means finding a market, inspecting the book by hand, guessing at probability, building a strategy on instinct, and hoping it holds up. Sooth collapses that chain into one continuous flow — from discovery to a monitored position.
          </p>
        </section>

        <section id="pipeline" style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="How it works">One pipeline, start to finish.</SectionHeading>
          <div className="sooth-grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 40 }}>
            {PIPELINE.map(({ Illustration, title, detail }, i) => (
              <Reveal key={title} delay={i * 60}>
                <Illustration />
                <h3 style={{ fontSize: 19, fontWeight: 600, marginTop: 20, color: COLOR.text }}>{title}</h3>
                <p style={{ fontSize: 14, color: COLOR.muted, marginTop: 8, lineHeight: 1.5 }}>{detail}</p>
              </Reveal>
            ))}
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Live market intelligence">Raw market. Real intelligence.</SectionHeading>
          <div style={{ border: `1px solid ${COLOR.border}`, maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${COLOR.border}` }}>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint, textTransform: "uppercase" }}>Market</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint, textTransform: "uppercase" }}>Edge</span>
            </div>
            {[
              { label: "SOMI > $1.20 by Fri", edge: "+7.0%" },
              { label: "DreamDEX daily vol > 5M", edge: "NO TRADE" },
              { label: "Somnia TPS > 800k (7d avg)", edge: "+3.0%" },
            ].map((row, i, arr) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderBottom: i < arr.length - 1 ? `1px solid ${COLOR.border}` : "none" }}>
                <span style={{ fontSize: 14 }}>{row.label}</span>
                <span style={{ fontFamily: "monospace", fontSize: 13, color: row.edge === "NO TRADE" ? COLOR.faint : COLOR.accent }}>{row.edge}</span>
              </div>
            ))}
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Strategy lab">Test the approach before you trust it.</SectionHeading>
          <p style={{ maxWidth: "56ch", color: COLOR.muted, fontSize: 17, lineHeight: 1.6, marginBottom: 32 }}>
            Sooth isn&apos;t making predictions — it&apos;s measuring whether a strategy has an exploitable edge, against real historical conditions, before any capital moves.
          </p>
          <div className="sooth-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, maxWidth: 640 }}>
            {[
              ["Trades", "128"],
              ["Win rate", "58%"],
              ["Avg edge", "4.2%"],
              ["Max drawdown", "-6.1%"],
            ].map(([label, value]) => (
              <div key={label} style={{ borderTop: `1px solid ${COLOR.border}`, paddingTop: 12 }}>
                <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 600 }}>{value}</div>
                <div style={{ fontSize: 12, color: COLOR.faint, marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Automation">You define the rules. Sooth executes them.</SectionHeading>
          <div className="sooth-grid-2" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 32 }}>
            {AUTOMATION_STEPS.map(({ Illustration, title, detail }, i) => (
              <Reveal key={title} delay={i * 60}>
                <Illustration />
                <h3 style={{ fontSize: 16, fontWeight: 600, marginTop: 18, color: COLOR.text }}>{title}</h3>
                <p style={{ fontSize: 13, color: COLOR.muted, marginTop: 6, lineHeight: 1.45 }}>{detail}</p>
              </Reveal>
            ))}
          </div>
          <p style={{ maxWidth: "56ch", color: COLOR.muted, fontSize: 15, marginTop: 40, lineHeight: 1.6 }}>Bots run through a limited operator key — it can place and cancel orders, but it can never withdraw from your wallet.</p>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Built on real infrastructure">Sooth is DreamDEX&apos;s mind.</SectionHeading>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <EcosystemLayers reducedMotion={reducedMotion} />
          </div>
        </section>

        <section style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Inside the app">Five screens. One continuous flow.</SectionHeading>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            {PRODUCT_STEPS.map((step) => (
              <div key={step} style={{ border: `1px solid ${COLOR.border}`, borderRadius: 6, padding: "24px 20px", flex: "1 1 180px" }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{step}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="why" style={{ padding: "80px 0", borderBottom: `1px solid ${COLOR.border}` }}>
          <SectionHeading eyebrow="Why Sooth">Four things it actually does.</SectionHeading>
          <div className="sooth-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32 }}>
            {WHY_SOOTH.map((item) => (
              <div key={item.title} style={{ borderTop: `1px solid ${COLOR.border}`, paddingTop: 16 }}>
                <h3 style={{ fontSize: 17, fontWeight: 600, color: COLOR.text }}>{item.title}</h3>
                <p style={{ fontSize: 14, color: COLOR.muted, marginTop: 8, lineHeight: 1.5 }}>{item.detail}</p>
              </div>
            ))}
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
            <GlowingOrb size={100} reducedMotion={reducedMotion} />
          </div>
          <h2 style={{ maxWidth: "16ch", margin: "0 auto", fontSize: 32, fontWeight: 600, lineHeight: 1.2, color: COLOR.text }}>The market is speaking.</h2>
          <p style={{ maxWidth: "32ch", margin: "12px auto 0", color: COLOR.muted, fontSize: 17 }}>Sooth helps you read it.</p>
          <button className="sooth-focusable sooth-btn-primary" style={{ marginTop: 32, padding: "14px 32px", fontSize: 14 }} onClick={() => navigate("/markets")}>
            Enter Sooth
          </button>
        </section>

        <footer style={{ padding: "64px 0 32px" }}>
          <div className="sooth-footer-grid" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 40 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <OrbMark size={20} />
                <span style={{ fontWeight: 700, fontSize: 14 }}>SOOTH</span>
              </div>
              <p style={{ color: COLOR.muted, fontSize: 13, marginTop: 12, maxWidth: "28ch", lineHeight: 1.5 }}>Intelligence and execution for DreamDEX Event Contracts on Somnia.</p>
            </div>
            <div>
              <h4 style={{ fontSize: 12, color: COLOR.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Product</h4>
              <button onClick={() => navigate("/markets")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Markets</button>
              <button onClick={() => navigate("/lab")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Strategy Lab</button>
              <button onClick={() => navigate("/bots")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Bots</button>
              <button onClick={() => navigate("/portfolio")} className="sooth-link sooth-focusable" style={{ display: "block", marginBottom: 10, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>Portfolio</button>
            </div>
            <div>
              <h4 style={{ fontSize: 12, color: COLOR.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Resources</h4>
              {["Documentation", "GitHub", "DreamDEX", "Somnia"].map((l) => (
                <a key={l} href="#" className="sooth-link" style={{ display: "block", marginBottom: 10 }}>
                  {l}
                </a>
              ))}
            </div>
            <div>
              <h4 style={{ fontSize: 12, color: COLOR.faint, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 }}>Community</h4>
              {["X", "Discord"].map((l) => (
                <a key={l} href="#" className="sooth-link" style={{ display: "block", marginBottom: 10 }}>
                  {l}
                </a>
              ))}
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
