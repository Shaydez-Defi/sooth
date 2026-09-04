# Demo

Five minutes, no funds required for steps 1–6.

1. Open https://sooth-gray.vercel.app (or `npm run api` + `cd frontend && npm run dev` locally).
2. A live market appears on Markets, e.g. `ETH-0-04SEP26-0040/tUSDC`.
3. Open it: price, spread, depth chart, time to expiry, event log.
4. Sooth evaluates it: fair value, raw edge, executable edge, opportunity score.
5. Read TRADE, WATCH, or NO_TRADE with per-variable reasons and gate checks.
6. Force both outcomes on demand: `npm run decision:demo` prints a TRADE (90/100) and a NO_TRADE from labeled synthetic books.
7. If TRADE: set size, pass the risk check, place the order from the detail screen.
8. Receipt shows tx hash, block, and fill state (Stage 2 proved this on testnet: place block 472691462, cancel 472691491, wallet left clean).
9. Monitor: bot ticks, events, positions, and P&L on Bots and Portfolio.

Backtest the framework: `npm run backtest` (50 settled markets + decision report).
Replay a decision: `npm run stage9:verify` (settlement math on synthetic fills in a temp DB).
