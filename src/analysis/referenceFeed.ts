/**
 * Underlying/reference asset prices via the SDK price feed (testnet bundled).
 * All functions are null-safe: feed miss → null (caller marks N/A, never fabricates).
 * Verified live: 27 feeds, BTC/ETH one-shot + history working (see probe 2026-09-04).
 */
import type { EcContext } from "@dreamdex-bot-kit/ec-core";
import type { PricePoint } from "@somnia-chain/markets-sdk";

export interface ReferenceNow {
  readonly asset: string; // feed asset as requested (uppercased)
  readonly price: number; // LIVE human-unit price (e.g. USD per BTC)
  readonly ema: number | null; // LIVE feed EMA or null
  readonly blockTimestamp: number | null; // chain time of the observation or null
}

export interface ReferencePoint {
  readonly price: number;
  readonly atUnix: number;
}

function isFinitePrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export async function fetchReferenceNow(ctx: EcContext, asset: string): Promise<ReferenceNow | null> {
  const normalized = asset.trim().toUpperCase();
  if (normalized === "") return null;
  try {
    const p = await ctx.exchange.client.fetchPrice(normalized);
    if (!p || !isFinitePrice(p.price)) return null;
    return {
      asset: normalized,
      price: p.price,
      ema: typeof p.ema === "number" && Number.isFinite(p.ema) && p.ema > 0 ? p.ema : null,
      blockTimestamp: typeof p.blockTimestamp === "number" && Number.isFinite(p.blockTimestamp) ? p.blockTimestamp : null,
    };
  } catch {
    // Feed miss or feed error - caller records N/A. Documented null contract, not silent.
    return null;
  }
}

/** Nearest tick to time t (documented nearest-neighbor, no interpolation). */
export function nearestReferenceTick(
  ticks: ReadonlyArray<ReferencePoint>,
  t: number,
): ReferencePoint | null {
  let best: ReferencePoint | null = null;
  let bestDist = Infinity;
  for (const tick of ticks) {
    const d = Math.abs(tick.atUnix - t);
    if (d < bestDist) {
      bestDist = d;
      best = tick;
    }
  }
  return best;
}

/** Underlying ticks inside [fromUnix, toUnix], ascending by time. Empty when the feed lacks the range. */
export async function fetchReferenceWindow(
  ctx: EcContext,
  asset: string,
  fromUnix: number,
  toUnix: number,
  limit = 500,
): Promise<ReferencePoint[]> {
  const normalized = asset.trim().toUpperCase();
  if (normalized === "" || !Number.isFinite(fromUnix) || !Number.isFinite(toUnix) || toUnix <= fromUnix) return [];
  try {
    const ticks: PricePoint[] = await ctx.exchange.client.fetchPriceHistory(normalized, { limit, from: Math.floor(fromUnix), to: Math.floor(toUnix) });
    const out: ReferencePoint[] = [];
    for (const t of ticks) {
      if (!isFinitePrice(t.price)) continue;
      if (typeof t.blockTimestamp !== "number" || !Number.isFinite(t.blockTimestamp)) continue;
      out.push({ price: t.price, atUnix: t.blockTimestamp });
    }
    out.sort((a, b) => a.atUnix - b.atUnix);
    return out;
  } catch {
    return [];
  }
}
