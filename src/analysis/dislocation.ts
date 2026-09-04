/**
 * Repricing-dislocation detection: does the Event Contract's probability track
 * its underlying/reference asset over the same real window?
 *
 * gap = underlyingRoC - contractRoC (rate-of-change points, e.g. +0.009 means the
 * underlying moved 0.9 points more than the contract). Positive gap with an UP
 * market context means the contract is under-repriced (supports UP); the
 * context engine decides direction, this module only measures the gap.
 * Pure function over caller-supplied real points - no fetching, no fabrication.
 */

export interface DislocationInput {
  readonly underlyingThenPrice: number | null;
  readonly underlyingNowPrice: number | null;
  readonly contractThenProb: number | null;
  readonly contractNowProb: number | null;
  readonly windowSec: number | null;
}

export interface DislocationResult {
  readonly sufficient: boolean;
  readonly underlyingRoC: number | null; // (now-then)/then, unitless
  readonly contractRoC: number | null; // (now-then)/then, unitless
  readonly gap: number | null; // underlyingRoC - contractRoC
  readonly windowSec: number | null;
  readonly note: string;
}

function rateOfChange(thenV: number | null, nowV: number | null): number | null {
  if (thenV === null || nowV === null) return null;
  if (!Number.isFinite(thenV) || !Number.isFinite(nowV) || thenV <= 0) return null;
  return (nowV - thenV) / thenV;
}

export function computeDislocation(input: DislocationInput): DislocationResult {
  const underlyingRoC = rateOfChange(input.underlyingThenPrice, input.underlyingNowPrice);
  const contractRoC = rateOfChange(input.contractThenProb, input.contractNowProb);
  const w = input.windowSec;
  if (underlyingRoC === null || contractRoC === null || typeof w !== "number" || !(w > 0)) {
    const missing: string[] = [];
    if (underlyingRoC === null) missing.push("underlying window");
    if (contractRoC === null) missing.push("contract window");
    if (typeof w !== "number" || !(w > 0)) missing.push("window span");
    return {
      sufficient: false,
      underlyingRoC,
      contractRoC,
      gap: null,
      windowSec: input.windowSec,
      note: `dislocation N/A - missing ${missing.join(", ")}`,
    };
  }
  const gap = underlyingRoC - contractRoC;
  const windowSec = w;
  return {
    sufficient: true,
    underlyingRoC,
    contractRoC,
    gap,
    windowSec,
    note: `underlying ${(underlyingRoC * 100).toFixed(2)}% vs contract ${(contractRoC * 100).toFixed(2)}% over ${windowSec.toFixed(0)}s → gap ${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(2)}%`,
  };
}
