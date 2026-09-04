/**
 * Decision demo - prints one TRADE and one NO_TRADE in product format.
 * Books below are SYNTHETIC fixtures (labeled in output), not market data.
 * Proves the decision layer says both TRADE and NO_TRADE on demand.
 */
import { collectVariables } from "../analysis/variables.js";
import { computeFairValue } from "../analysis/contextEngine.js";
import { checkSettlement } from "../analysis/settlementGate.js";
import { decideMarket, directionOf } from "../analysis/decision.js";

const TILTED_BIDS: ReadonlyArray<readonly [number, number]> = [
  [0.53, 2000],
  [0.525, 2000],
  [0.52, 2000],
];
const TILTED_ASKS: ReadonlyArray<readonly [number, number]> = [
  [0.55, 100],
  [0.555, 100],
  [0.56, 100],
];
const FLAT_BIDS: ReadonlyArray<readonly [number, number]> = [
  [0.53, 500],
  [0.525, 500],
  [0.52, 500],
];
const FLAT_ASKS: ReadonlyArray<readonly [number, number]> = [
  [0.55, 500],
  [0.555, 500],
  [0.56, 500],
];

function cents(p: number): string {
  return `${Math.round(p * 100)}¢`;
}

function demoCase(
  name: string,
  direction: string,
  bids: ReadonlyArray<readonly [number, number]>,
  asks: ReadonlyArray<readonly [number, number]>,
): void {
  const bestBid = bids[0]?.[0] ?? 0.53;
  const bestAsk = asks[0]?.[0] ?? 0.55;
  const mid = (bestBid + bestAsk) / 2;
  const variables = collectVariables({
    marketId: `0xdemo-${name}`,
    symbol: `ETH-DEMO/tUSDC`,
    asset: "ETH",
    strike: null,
    venueId: null,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    onchainStatus: 1,
    bids,
    asks,
    bestBid,
    bestAsk,
    marketProbability: mid,
    timeRemaining: 3600,
    referenceNow: null,
    referenceThen: null,
    contractHistory: [],
  });
  const fair = computeFairValue(variables);
  const gate = checkSettlement({
    marketId: `0xdemo-${name}`,
    symbol: "ETH-DEMO/tUSDC",
    expiry: Math.floor(Date.now() / 1000) + 3600,
    venueId: null,
    onchainStatus: 1,
    strikePresent: false,
  });
  const out = decideMarket({ variables, fair, gate });
  const dirWord = directionOf(out.rawEdge) === "FLAT" ? direction : directionOf(out.rawEdge);
  console.log(`ETH ${dirWord} (SYNTHETIC book - demo fixture, not market data)`);
  console.log(`Market price: ${cents(out.marketPrice)}`);
  console.log(`Sooth estimate: ${cents(out.fairValue)}`);
  console.log(`\nDecision: ${out.decision}`);
  console.log(`\nWhy:`);
  for (const r of out.reasons) console.log(`- ${r}`);
  console.log(`\nOpportunity: ${out.opportunityScore}/100`);
}

console.log("=== Sooth decision demo (synthetic books) ===\n");
demoCase("tilted", "UP", TILTED_BIDS, TILTED_ASKS);
console.log("\n---\n");
demoCase("flat", "DOWN", FLAT_BIDS, FLAT_ASKS);
