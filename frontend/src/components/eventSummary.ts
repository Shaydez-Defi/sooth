/** Human-readable bot-event summaries - shared by detail log and History screen. */

export function summarizeEvent(eventType: string, raw: string, pct: (v: number) => string): Array<{ k: string; v: string }> {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return raw === "" ? [] : [{ k: "data", v: raw.slice(0, 120) }];
  }
  if (typeof data !== "object" || data === null) {
    return [{ k: "value", v: String(data).slice(0, 120) }];
  }
  const rec = data as Record<string, unknown>;
  const scalar = (v: unknown): string | null => {
    if (typeof v === "string") return v.length > 120 ? `${v.slice(0, 120)}…` : v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return null;
  };
  const at = (path: ReadonlyArray<string>): unknown => {
    let cur: unknown = rec;
    for (const key of path) {
      if (typeof cur !== "object" || cur === null) return null;
      cur = (cur as Record<string, unknown>)[key];
    }
    return cur ?? null;
  };
  const pick = (...keys: string[]): Array<{ k: string; v: string }> => {
    const out: Array<{ k: string; v: string }> = [];
    for (const k of keys) {
      const s = scalar(rec[k]);
      if (s !== null && s !== "") out.push({ k, v: s });
    }
    return out;
  };
  const firstReason = (): string | null => {
    const reasons = at(["decision", "reasons"]);
    if (Array.isArray(reasons) && typeof reasons[0] === "string") return reasons[0];
    const r = at(["reason"]);
    return typeof r === "string" ? r : null;
  };
  switch (eventType.toUpperCase()) {
    case "BOT_STOP": {
      const rows = pick("reason", "tickCount");
      return rows.length > 0 ? rows : [{ k: "state", v: "stopped" }];
    }
    case "BOT_START": {
      const rows = pick("tickCount", "reason");
      return rows.length > 0 ? rows : [{ k: "state", v: "started" }];
    }
    case "EXECUTION": {
      const rows = pick("executed", "reason", "txHash", "side", "size");
      return rows;
    }
    case "RISK_CHECK": {
      const rows = pick("skipped", "approved", "reason");
      return rows;
    }
    case "STRATEGY_DECISION": {
      const action = scalar(at(["decision", "action"]));
      const reason = firstReason();
      const rows: Array<{ k: string; v: string }> = [];
      if (action) rows.push({ k: "action", v: action });
      if (reason) rows.push({ k: "reason", v: reason });
      return rows.length > 0 ? rows : pick("action", "reason");
    }
    case "MARKET_EVALUATED": {
      const rows: Array<{ k: string; v: string }> = [];
      const prob = at(["analysis", "marketProbability"]);
      const edge = at(["analysis", "edge"]);
      if (typeof prob === "number") rows.push({ k: "prob", v: pct(prob) });
      if (typeof edge === "number") rows.push({ k: "edge", v: `${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(1)}%` });
      return rows.length > 0 ? rows : pick("marketId", "symbol");
    }
    default: {
      return pick("reason", "action", "side", "size", "price", "txHash", "tickCount", "marketId", "symbol").slice(0, 3);
    }
  }
}

