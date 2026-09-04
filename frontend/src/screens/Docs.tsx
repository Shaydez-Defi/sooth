import { useState } from "react";
import { COLOR, EASE, PANEL_LABEL_STYLE } from "../components/theme";

const TABS = ["Users", "Builders", "Judges"] as const;
type Tab = (typeof TABS)[number];

interface Section {
  readonly label: string;
  readonly title: string;
  readonly lines: readonly string[];
}

interface Endpoint {
  readonly method: string;
  readonly path: string;
  readonly desc: string;
}

const USER_SECTIONS: readonly Section[] = [
  {
    label: "start",
    title: "What Sooth is",
    lines: [
      "Live trading bots for Somnia event markets. Real testnet, real order books, fake money.",
      "Event markets are YES/NO questions with an expiry. The price is the crowd's probability.",
      "Sooth scores every market and flags only the mispriced ones. Most of the time it says: no trade.",
      "TRADE means edge over 2 percent with depth and spread in range. WAIT means edge without backing. NO means stay out.",
    ],
  },
  {
    label: "connect",
    title: "Connect in one click",
    lines: [
      "Hit Connect wallet. Your browser wallet opens. Approve, and Sooth moves you to Somnia Shannon testnet (chain 50312) by itself.",
      "No wallet on desktop: install MetaMask or similar. On mobile: open this page inside your wallet app's browser.",
      "Sooth trades from a dedicated wallet you fund. Only that balance is at risk. Fund only what you can lose.",
    ],
  },
  {
    label: "read",
    title: "Read the board",
    lines: [
      "Price is what the market says. Sooth Est. is what book imbalance implies. Edge is the gap.",
      "Every number carries a tag. LIVE_ONCHAIN means read from chain. LIVE_INDEXER means read from the indexer. DERIVED means computed by Sooth. HISTORICAL means settled fact. ESTIMATED means labeled guess.",
      "Thin markets are gated out before edge matters. A wide edge in an empty book still reads NO.",
      "A cached note with an age means the indexer hiccuped. The data is labeled, not hidden. Retry for live.",
    ],
  },
  {
    label: "act",
    title: "Do things",
    lines: [
      "Strategy Lab scores one market or all of them, and replays settled history as backtests.",
      "Portfolio shows equity, total P and L, positions, and bot performance.",
      "Bots runs one bot, id default. Start it, stop it, watch ticks and events.",
      "Backtests on a fresh venue show zero trades. That is the engine refusing to lie, not a bug.",
    ],
  },
];

const BUILDER_STACK: readonly Section[] = [
  {
    label: "stack",
    title: "Stack",
    lines: [
      "Backend: Fastify on :3000, strict TypeScript, SQLite WAL at data/snapshots.db.",
      "Chain kit: file:vendor bot-kit (ec-core) plus markets-sdk 0.28.1. No wallet SDK on the frontend. EIP-1193 only.",
      "Frontend: React plus Vite on :5173, react-router, lucide icons, Apache ECharts. Dev proxy points at :3000.",
      "Rules: tsc and lint clean before done. No silent catches. No magic numbers. Every number tagged.",
    ],
  },
  {
    label: "run",
    title: "Run it",
    lines: [
      "API and app first. Scripts and checks after. Every command below is copy-paste ready.",
    ],
  },
];

const BUILDER_COMMANDS: readonly string[] = [
  "npm run api",
  "cd frontend && npm run dev",
  "npm run typecheck",
  "npm run lint",
  "npm run lint --prefix frontend",
  "npm test",
  "npm run discover",
  "npm run discover:ec",
  "npm run analyze",
  "npm run backtest",
  "npm run snapshot",
  "npm run stage9:verify",
  "npm run bundle:api",
];

const BUILDER_ENV: readonly Endpoint[] = [
  { method: "NETWORK", path: "testnet", desc: "default network" },
  { method: "VENUE_ID", path: "0x6797...e8a28c", desc: "bytes32 venue scope (OPERATOR_ID also works)" },
  { method: "PORT", path: "3000", desc: "API listen port" },
  { method: "VITE_API_BASE_URL", path: "(empty local)", desc: "empty uses the dev proxy; /api path in prod" },
  { method: "SNAPSHOT_DB_PATH", path: "data/snapshots.db", desc: "/tmp path on serverless" },
  { method: "KV_REST_API_URL", path: "+ KV_REST_API_TOKEN", desc: "shared cache tier; memory-only without them" },
];

const BUILDER_ENDPOINTS: readonly Endpoint[] = [
  { method: "GET", path: "/health", desc: "uptime probe, never touches chain" },
  { method: "GET", path: "/markets", desc: "venue-scoped live list, 60s shared cache, answers cacheAgeSec and stale" },
  { method: "GET", path: "/markets/:id", desc: "one market, onchain plus indexer meta" },
  { method: "GET", path: "/markets/:id/orderbook", desc: "live YES book, depth 1 to 20" },
  { method: "GET", path: "/markets/:id/analysis", desc: "full MarketAnalysis for one market" },
  { method: "GET", path: "/markets/:id/history", desc: "snapshot series from local DB, newest first" },
  { method: "GET", path: "/positions", desc: "open positions with tags" },
  { method: "GET", path: "/portfolio", desc: "balances plus positions" },
  { method: "POST", path: "/orders", desc: "risk-gated write, 10 checks before anything executes" },
  { method: "POST", path: "/orders/:id/cancel", desc: "cancel one resting order" },
  { method: "POST", path: "/strategies/analyze", desc: "score one market or all with all:true" },
  { method: "POST", path: "/strategies/backtest", desc: "settled history replay, limit 1 to 200" },
  { method: "GET", path: "/bots", desc: "single bot, id default" },
  { method: "GET", path: "/bots/:id/performance", desc: "edge analytics or honest insufficient-data" },
  { method: "GET", path: "/bots/:id/events", desc: "paginated event log with type filter" },
  { method: "POST", path: "/bots/:id/start", desc: "start the loop" },
  { method: "POST", path: "/bots/:id/stop", desc: "stop the loop" },
  { method: "PATCH", path: "/bots/:id", desc: "tune config, loop interval floor 5000ms" },
];

const BUILDER_SECTIONS: readonly Section[] = [
  {
    label: "deploy",
    title: "Deploy",
    lines: [
      "One Vercel project. The Vite build serves the app. api/index.js serves the API under /api/*.",
      "The bundle is prebuilt with esbuild. Reason: the file: bot-kit ships TS, which plain Node cannot load.",
      "Rebuild it after every backend change: npm run bundle:api.",
      "Hobby caps functions at 10 seconds. The analyze sweep runs near that. The shared KV cache keeps reads alive.",
      "Serverless disk is read only except /tmp. The DB seeds itself from a committed snapshot on cold start.",
    ],
  },
  {
    label: "map",
    title: "Repo map",
    lines: [
      "src/api: Fastify server, routes, registry cache, KV client.",
      "src/analysis, src/backtest, src/strategy, src/risk: engine, history replay, pipeline, gates.",
      "src/bot: runner loop, events, fills, settlement poller.",
      "src/snapshots: SQLite logger schema and capture math.",
      "src/scripts: one CLI per stage, all runnable with tsx.",
      "frontend/src: screens, components, lib/api, lib/wallet.",
      "vendor/dreamdex-bot-kit: local clone, never edited.",
      "docs/: per-stage verification logs. This page is built from them.",
    ],
  },
];

const JUDGE_VERDICT: readonly Section[] = [
  {
    label: "verdict",
    title: "Verdict",
    lines: [
      "Sooth reads live Somnia markets, scores them with a book-only signal, gates with risk, runs a supervised bot, and serves it all over HTTP plus a React app.",
      "Every stage ran against testnet and logged proof. Negative results are reported, not buried.",
      "The live URL serves app and API from one domain. Wallet flow is injected-only. No mock data anywhere in the UI.",
    ],
  },
];

const JUDGE_STAGES: readonly Section[] = [
  {
    label: "s1",
    title: "S1 Reads",
    lines: [
      "Goal: read-only spot proof. Result: 3 markets, chain 50312, block 471841920.",
      "Proof: discover-markets script plus tsc plus vitest.",
    ],
  },
  {
    label: "s1.5",
    title: "S1.5 Venue",
    lines: [
      "Goal: scope binary markets to the DreamDEX venue. Result: 8 live markets on 0x6797.",
      "Proof: without VENUE_ID the run throws multi-venue. The failure proves scoping works.",
    ],
  },
  {
    label: "s2",
    title: "S2 Round trip",
    lines: [
      "Goal: place then cancel one real order, wallet left clean. Result: resting order at 0.4950 placed and cancelled, open orders 0, escrow returned.",
      "Proof: place block 472691462 and cancel block 472691491 on testnet.",
    ],
  },
  {
    label: "s3",
    title: "S3 Signal",
    lines: [
      "Goal: deterministic book-only scoring. Result: 0 of 8 TRADE, 7 books perfectly balanced.",
      "Proof: analyze-markets summary plus 18 tests. The engine said no. That is the point.",
    ],
  },
  {
    label: "s4",
    title: "S4 Backtest",
    lines: [
      "Goal: replay settled history honestly. Result: 50 finalized markets, 0 trades, capital 1000 to 1000.",
      "Proof: backtest log plus 27 tests. No books in history, no invented trades.",
    ],
  },
  {
    label: "s5",
    title: "S5 Pipeline",
    lines: [
      "Goal: strategy to risk to execution, in that order. Result: dry run 8 SKIP, 0 APPROVED, 0 orders.",
      "Proof: strategy-dry-run plus 30 tests. 10 risk checks, all enforced before any execution path.",
    ],
  },
  {
    label: "s6",
    title: "S6 Runner",
    lines: [
      "Goal: supervised loop with memory. Result: start and stop loop, 109 events logged, 0 fills, mid-move alerts flagged observability only.",
      "Proof: bot-smoke plus 38 tests. Nothing left running.",
    ],
  },
  {
    label: "s7",
    title: "S7 API",
    lines: [
      "Goal: everything over HTTP with tags. Result: 20 routes, 14 route tests, edge gaps reported where 0 fills make winRate uncomputable.",
      "Proof: 56 of 56 green plus live curl transcripts.",
    ],
  },
  {
    label: "s8",
    title: "S8 7702 probe",
    lines: [
      "Goal: test existing batching against EC pools. Result: no-go. Spot selector reverts with UseBinaryPlacement, binary path fails allowance.",
      "Proof: eth_call only, zero funds spent, gap report written, no contract deployed.",
    ],
  },
  {
    label: "s9",
    title: "S9 Settlement",
    lines: [
      "Goal: prove settlement math without live fills. Result: synthetic fills in a temp DB, 6 of 8 realized, winRate 0.571.",
      "Proof: stage9:verify census. Real fills still 0, stated plainly. Temp DB never touched prod data.",
    ],
  },
  {
    label: "s10",
    title: "S10 History",
    lines: [
      "Goal: replace estimated books with real snapshots. Result: 0 of 50 covered, expiries predate the logger.",
      "Proof: backtest withHistory report. Thin coverage reported, engine untouched.",
    ],
  },
  {
    label: "logger",
    title: "Logger",
    lines: [
      "Goal: capture books continuously for future backtests. Result: 1400 rows and growing, 8 rows per 45s poll, mids move from 0.827 to 0.8755.",
      "Proof: row counts plus distinct-mid queries. Symmetric house quotes explain the zero imbalance.",
    ],
  },
  {
    label: "frontend",
    title: "Frontend",
    lines: [
      "Goal: wire screens to live APIs, zero visual drift. Result: 6 routes, typed client, 2412 modules built, 8 markets rendered live.",
      "Proof: build plus lint plus dev plus curl.",
    ],
  },
];

const JUDGE_REPRO: readonly string[] = [
  "npm run typecheck",
  "npm run lint",
  "npm test",
  "npm run api",
  "curl http://localhost:3000/health",
  "curl http://localhost:3000/markets",
  "NETWORK=testnet npx tsx src/scripts/discover-event-contracts.ts",
  "npm run stage9:verify",
];

const JUDGE_LIMITS: readonly Section[] = [
  {
    label: "limits",
    title: "Limits, stated not hidden",
    lines: [
      "One bot only. Other ids 404 with a named limitation.",
      "Reads depend on the public indexer. When it 504s, the app serves labeled cache, not silence.",
      "Serverless functions cap at 10 seconds. Long sweeps flirt with it.",
      "Testnet only. No mainnet path, no real money.",
      "Books from before the logger exist only as labeled estimates.",
    ],
  },
];

function SectionCard({ section }: { section: Section }) {
  return (
    <div className="sooth-glass-card">
      <div style={PANEL_LABEL_STYLE}>{section.label}</div>
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "6px 0 12px", color: COLOR.text }}>{section.title}</h2>
      {section.lines.map((line) => (
        <p key={line} style={{ fontSize: 13.5, color: COLOR.muted, margin: "0 0 10px", lineHeight: 1.6 }}>
          {line}
        </p>
      ))}
    </div>
  );
}

function CmdBlock({ cmds }: { cmds: readonly string[] }) {
  return (
    <div className="sooth-glass-card">
      <div style={PANEL_LABEL_STYLE}>terminal</div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {cmds.map((cmd) => (
          <div key={cmd} style={{ display: "flex", gap: 10, alignItems: "baseline", fontFamily: "monospace", fontSize: 12.5 }}>
            <span style={{ color: COLOR.accent }}>$</span>
            <span style={{ color: COLOR.text, wordBreak: "break-all" }}>{cmd}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EndpointList({ endpoints }: { endpoints: readonly Endpoint[] }) {
  return (
    <div className="sooth-glass-card">
      <div style={PANEL_LABEL_STYLE}>reference</div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column" }}>
        {endpoints.map((ep) => (
          <div
            key={`${ep.method}-${ep.path}`}
            style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "8px 0", borderBottom: `1px solid ${COLOR.border}`, fontSize: 12.5 }}
          >
            <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: COLOR.accent, minWidth: 52, flexShrink: 0 }}>
              {ep.method}
            </span>
            <span style={{ fontFamily: "monospace", color: COLOR.text, flexShrink: 0 }}>{ep.path}</span>
            <span style={{ color: COLOR.muted }}>{ep.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Docs() {
  const [tab, setTab] = useState<Tab>("Users");

  return (
    <div style={{ minHeight: "100vh", background: COLOR.ink, color: COLOR.text, fontFamily: "'Manrope', system-ui, sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        .sooth-focusable:focus-visible { outline: 2px solid ${COLOR.accent}; outline-offset: 2px; }
        .sooth-tab { background: none; border: none; cursor: pointer; font-family: inherit; fontSize: 13px; padding: 6px 12px; border-radius: 6px; transition: background 150ms ${EASE}, color 150ms ${EASE}; }
        .sooth-glass-card { position: relative; padding: 16px; background: rgba(20, 19, 15, 0.5); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(204,136,153,0.14); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(244,242,237,0.05), 0 6px 20px rgba(0,0,0,0.35); }
      `}</style>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px" }}>
        <div style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLOR.faint }}>
          Docs
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "6px 0 0" }}>Documentation</h1>
        <p style={{ color: COLOR.muted, fontSize: 15, marginTop: 8 }}>
          One page, three readers. Pick yours.
        </p>

        <div style={{ display: "flex", gap: 4, background: COLOR.surface2, borderRadius: 8, padding: 4, marginTop: 20, marginBottom: 20, width: "fit-content" }}>
          {TABS.map((t) => (
            <button
              key={t}
              className="sooth-tab sooth-focusable"
              onClick={() => setTab(t)}
              style={{
                background: tab === t ? COLOR.accent : "transparent",
                color: tab === t ? COLOR.ink : COLOR.muted,
                fontWeight: tab === t ? 600 : 400,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {tab === "Users" && USER_SECTIONS.map((s) => <SectionCard key={s.label} section={s} />)}

          {tab === "Builders" && (
            <>
              {BUILDER_STACK.map((s) => (
                <SectionCard key={s.label} section={s} />
              ))}
              <EndpointList endpoints={BUILDER_ENDPOINTS} />
              <CmdBlock cmds={BUILDER_COMMANDS} />
              <EndpointList endpoints={BUILDER_ENV} />
              {BUILDER_SECTIONS.map((s) => (
                <SectionCard key={s.label} section={s} />
              ))}
            </>
          )}

          {tab === "Judges" && (
            <>
              {JUDGE_VERDICT.map((s) => (
                <SectionCard key={s.label} section={s} />
              ))}
              {JUDGE_STAGES.map((s) => (
                <SectionCard key={s.label} section={s} />
              ))}
              <CmdBlock cmds={JUDGE_REPRO} />
              {JUDGE_LIMITS.map((s) => (
                <SectionCard key={s.label} section={s} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
