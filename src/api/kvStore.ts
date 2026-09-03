/**
 * Minimal Upstash-compatible KV client over plain fetch - no extra dependency.
 * Used for the shared registry-cache tier on serverless (instances don't share
 * memory). All failures throw; callers fall back to memory/origin and warn.
 */
export const KV_OP_TIMEOUT_MS = 2_500;

export function kvConfigured(): boolean {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  return typeof url === "string" && url !== "" && typeof token === "string" && token !== "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function kvCommand(args: readonly [string, ...unknown[]]): Promise<unknown> {
  const base = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) {
    throw new Error("KV: missing KV_REST_API_URL / KV_REST_API_TOKEN.");
  }
  let res: Response;
  try {
    res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(KV_OP_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`KV: request failed (${errorMessage(err)}).`);
  }
  if (!res.ok) {
    throw new Error(`KV: HTTP ${res.status}.`);
  }
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("KV: invalid response shape.");
  }
  const rec = body as Record<string, unknown>;
  if (typeof rec.error === "string" && rec.error !== "") {
    throw new Error(`KV: ${rec.error}`);
  }
  if (!("result" in rec)) {
    throw new Error("KV: invalid response shape.");
  }
  return rec.result;
}

export async function kvGet(key: string): Promise<string | null> {
  const result = await kvCommand(["GET", key]);
  return typeof result === "string" ? result : null;
}

export async function kvSet(key: string, value: string, exSec: number): Promise<void> {
  await kvCommand(["SET", key, value, "EX", exSec]);
}
