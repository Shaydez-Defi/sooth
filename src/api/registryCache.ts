/**
 * Registry cache - single-flight TTL cache over the indexer's RegistryMarkets sweep
 * (bot-kit `activeMarkets`, which reloads the full registry per call).
 *
 * The public indexer 504s under load; without this, every UI read fails together.
 * Cached reads are labeled with age/staleness - never presented as fresh.
 *
 * Registry affinity: the SDK resolves symbols against the registry loaded into a
 * specific exchange context. Cached rows MUST be used with the same context that
 * swept them, so all cached reads share one long-lived context (same pattern the
 * bot runner uses across ticks). Never close it; never mix cached rows into a
 * fresh per-request context ("unknown symbol - call loadMarkets() first").
 * Caveat: KV-restored rows come from another instance's sweep. That path is only
 * live when KV env is configured (it isn't anywhere yet); if it ever serves rows
 * newer than the local registry, book reads for those rows 500 until refresh.
 */
import { activeMarkets, createExchange, type EcContext } from "@dreamdex-bot-kit/ec-core";
import type { UnifiedMarket } from "@somnia-chain/markets-sdk";
import { kvConfigured, kvGet, kvSet } from "./kvStore.js";

// Freshness window for the registry sweep - UI hot reads reuse it inside this window.
export const REGISTRY_CACHE_TTL_MS = 60_000;
// Shared (cross-instance) tier - bounds max staleness when the indexer is down.
export const KV_REGISTRY_KEY = "sooth:registry:v1";
export const KV_REGISTRY_TTL_SEC = 600;
const MS_PER_SEC = 1_000;
const BIGINT_MARKER = "$bigint";

interface RegistryEntry {
  readonly markets: UnifiedMarket[];
  readonly fetchedAt: number;
}

export interface CachedRegistry {
  readonly markets: UnifiedMarket[];
  readonly cacheAgeSec: number;
  readonly stale: boolean;
}

let entry: RegistryEntry | null = null;
let inflight: Promise<UnifiedMarket[]> | null = null;
let sharedCtx: EcContext | null = null;

/**
 * Find a market by full id, full symbol, or URL slug (symbol with / as ~).
 * Shared by every route that resolves a market identifier.
 */
export function findMarketById<T extends { symbol: string; info: unknown }>(markets: T[], id: string): T | undefined {
  const deslug = id.includes("~") ? id.replaceAll("~", "/") : id;
  return markets.find((m) => String((m.info as { marketId: string }).marketId) === id || m.symbol === id || m.symbol === deslug);
}

/** The one exchange context all cached reads share - see affinity note above. */
export function getSharedCtx(): EcContext {
  if (!sharedCtx) {
    sharedCtx = createExchange({ withSigner: false });
  }
  return sharedCtx;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fresh(now: number): CachedRegistry | null {
  if (!entry) return null;
  if (now - entry.fetchedAt >= REGISTRY_CACHE_TTL_MS) return null;
  return {
    markets: entry.markets,
    cacheAgeSec: Math.floor((now - entry.fetchedAt) / MS_PER_SEC),
    stale: false,
  };
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { [BIGINT_MARKER]: value.toString() };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value === "object" && value !== null && BIGINT_MARKER in value) {
    const inner: unknown = (value as Record<string, unknown>)[BIGINT_MARKER];
    if (typeof inner === "string") {
      try {
        return BigInt(inner);
      } catch {
        return value;
      }
    }
  }
  return value;
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null);
}

function parseEnvelope(raw: string): { fetchedAt: number; markets: UnifiedMarket[] } {
  const parsed: unknown = JSON.parse(raw, reviver);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("KV registry payload is not an object.");
  }
  const rec = parsed as Record<string, unknown>;
  if (typeof rec.fetchedAt !== "number" || !isRecordArray(rec.rows)) {
    throw new Error("KV registry payload has invalid shape.");
  }
  return { fetchedAt: rec.fetchedAt, markets: rec.rows as unknown as UnifiedMarket[] };
}

function serializeEnvelope(markets: UnifiedMarket[]): string {
  return JSON.stringify({ fetchedAt: Date.now(), rows: markets }, replacer);
}

/** Shared-tier read - returns null on miss/misconfig/failure (warns, never throws). */
async function readKvTier(): Promise<CachedRegistry | null> {
  if (!kvConfigured()) return null;
  try {
    const raw = await kvGet(KV_REGISTRY_KEY);
    if (!raw) return null;
    const { fetchedAt, markets } = parseEnvelope(raw);
    const ageSec = Math.floor((Date.now() - fetchedAt) / MS_PER_SEC);
    if (ageSec < 0) return null;
    entry = { markets, fetchedAt };
    return { markets, cacheAgeSec: ageSec, stale: ageSec * MS_PER_SEC >= REGISTRY_CACHE_TTL_MS };
  } catch (err) {
    console.warn(`[registryCache] KV read failed, falling back to origin: ${errorMessage(err)}`);
    return null;
  }
}

/** Shared-tier write - warn-only on failure, never fails the request. */
async function writeKvTier(markets: UnifiedMarket[]): Promise<void> {
  if (!kvConfigured()) return;
  try {
    await kvSet(KV_REGISTRY_KEY, serializeEnvelope(markets), KV_REGISTRY_TTL_SEC);
  } catch (err) {
    console.warn(`[registryCache] KV write failed, memory cache only: ${errorMessage(err)}`);
  }
}

export async function getActiveMarketsCached(): Promise<CachedRegistry> {
  const now = Date.now();
  const hit = fresh(now);
  if (hit) return hit;

  const shared = await readKvTier();
  if (shared) return shared;

  if (!inflight) {
    const started = activeMarkets(getSharedCtx());
    inflight = started.then(
      (markets) => {
        entry = { markets, fetchedAt: Date.now() };
        inflight = null;
        return markets;
      },
      (err: unknown) => {
        inflight = null;
        throw err;
      },
    );
  }

  try {
    const markets = await inflight;
    await writeKvTier(markets);
    return { markets, cacheAgeSec: 0, stale: false };
  } catch (err) {
    // Indexer down: serve last-known rows labeled stale instead of failing every read.
    if (entry) {
      return {
        markets: entry.markets,
        cacheAgeSec: Math.floor((Date.now() - entry.fetchedAt) / MS_PER_SEC),
        stale: true,
      };
    }
    throw err;
  }
}

/** Test hook - lets route tests start from an empty cache. */
export function clearRegistryCache(): void {
  entry = null;
  inflight = null;
}
