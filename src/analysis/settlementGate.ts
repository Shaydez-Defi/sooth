/**
 * Step 6 (gate half) - settlement gate over real on-chain/indexer data.
 * A trade is only thinkable when the event, its expiry, and its on-chain
 * resolution state are all positively identified. Anything unclear forces
 * "TRADE BLOCKED - SETTLEMENT RISK" regardless of edge. Expect PASS most of
 * the time: discovery already filters to valid markets. Strike is
 * informational (real markets usually lack it) - never a blocker.
 */
export interface GateCheck {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface SettlementGateResult {
  readonly pass: boolean;
  readonly checks: GateCheck[];
}

export interface GateInput {
  readonly marketId: string;
  readonly symbol: string;
  readonly expiry?: number | null;
  readonly venueId?: string | null;
  readonly onchainStatus?: number | null;
  readonly strikePresent: boolean;
}

export const SETTLEMENT_BLOCKED = "TRADE BLOCKED - SETTLEMENT RISK";

export function checkSettlement(input: GateInput): SettlementGateResult {
  const checks: GateCheck[] = [];
  checks.push({
    name: "event-identified",
    pass: input.marketId !== "",
    detail: input.marketId !== "" ? `marketId ${input.marketId.slice(0, 18)}… present` : "marketId missing",
  });
  checks.push({
    name: "contract-identified",
    pass: input.symbol !== "",
    detail: input.symbol !== "" ? `symbol ${input.symbol} present` : "symbol missing",
  });
  const expiry = input.expiry;
  const expiryOk = typeof expiry === "number" && Number.isFinite(expiry) && expiry > 0;
  checks.push({
    name: "expiry-identified",
    pass: expiryOk,
    detail: expiryOk ? `expiry ${expiry.toFixed(0)} (unix)` : "expiry missing or not positive",
  });
  const status = input.onchainStatus;
  const statusOk = typeof status === "number" && Number.isFinite(status);
  checks.push({
    name: "resolution-readable",
    pass: statusOk,
    detail: statusOk ? `on-chain status ${status} readable` : "on-chain status unreadable - resolution mechanism not identifiable",
  });
  checks.push({
    name: "strike",
    pass: true,
    detail: input.strikePresent
      ? "strike present (context only)"
      : input.venueId
        ? `strike N/A - venue ${input.venueId.slice(0, 18)}… markets resolve without it (informational)`
        : "strike N/A (informational, not blocking)",
  });
  return { pass: checks.every((c) => c.pass), checks };
}
