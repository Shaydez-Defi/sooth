// Real market formatting - never fabricate a question, only use fields that are actually true
// Handles: asset, expiry timestamp, interval, genuine question if available, raw symbol as secondary

export type MarketForFormat = {
  marketId: string;
  symbol: string;
  asset: string;
  expiry: string | null;
  intervalSec?: number | null;
  interval?: string | null;
  question?: string | null;
  strike?: string | null;
};

function formatInterval(intervalSec: number | null | undefined, intervalStr: string | null | undefined): string | null {
  if (typeof intervalStr === "string" && intervalStr.trim() !== "") return intervalStr.trim();
  if (typeof intervalSec === "number" && Number.isFinite(intervalSec) && intervalSec > 0) {
    if (intervalSec % 3600 === 0) return `${intervalSec / 3600}h`;
    if (intervalSec % 60 === 0) return `${intervalSec / 60}m`;
    return `${intervalSec}s`;
  }
  return null;
}

function formatExpiry(expiry: string | null): { text: string; iso: string | null; date: Date | null } {
  if (!expiry) return { text: "-", iso: null, date: null };
  const sec = Number(expiry);
  if (!Number.isFinite(sec) || sec <= 0) return { text: "-", iso: null, date: null };
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return { text: "-", iso: null, date: null };
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  const date = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d);
  return { text: `${time}, ${date}`, iso: d.toISOString(), date: d };
}

function parseSymbol(symbol: string): { asset: string; datePart: string | null } {
  const base = symbol.split("/")[0] ?? symbol;
  const parts = base.split("-");
  if (parts.length >= 3) {
    const asset = parts[0]?.trim() || "?";
    const date = parts[2] ?? null;
    const time = parts[3] ?? null;
    if (date && time) return { asset, datePart: `${date}-${time}` };
    if (date) return { asset, datePart: date };
    return { asset, datePart: null };
  }
  return { asset: "?", datePart: null };
}

// Main label builder - honest, never invents a price question
export function formatMarket(market: MarketForFormat): {
  primary: string;
  secondary: string;
  tooltip: string;
  expiryText: string;
  intervalText: string | null;
  hasQuestion: boolean;
} {
  const rawSymbol = market.symbol;
  const intervalText = formatInterval(market.intervalSec ?? null, market.interval ?? null);
  const expiry = formatExpiry(market.expiry);

  // Try to derive asset from symbol if asset is "?" or missing
  let asset = (market.asset ?? "?").toString().trim() || "?";
  if (asset === "?" || asset === "") {
    const parsed = parseSymbol(rawSymbol);
    if (parsed.asset !== "?") asset = parsed.asset;
  }

  const question = typeof market.question === "string" ? market.question.trim() : "";
  const hasQuestion = question.length > 0;

  if (hasQuestion) {
    const parts: string[] = [];
    parts.push(asset);
    if (intervalText) parts.push(intervalText);
    if (expiry.text !== "-") parts.push(`expires ${expiry.text}`);
    const timing = parts.join(" · ");
    return {
      primary: question,
      secondary: timing ? `${timing} · ${rawSymbol}` : rawSymbol,
      tooltip: `${question} — ${rawSymbol}${expiry.iso ? ` — expiry ${expiry.iso}` : ""}`,
      expiryText: expiry.text,
      intervalText,
      hasQuestion: true,
    };
  }

  // Honest fallback: asset + timing, never a fabricated question
  const parts: string[] = [];
  if (asset !== "?") parts.push(asset);
  if (intervalText) parts.push(intervalText);
  if (expiry.text !== "-") parts.push(`expires ${expiry.text}`);
  // If we still have no parts (e.g., expiry missing), try to parse symbol datePart as fallback
  if (parts.length === 0) {
    const parsed = parseSymbol(rawSymbol);
    if (parsed.asset !== "?" && parsed.datePart) {
      return {
        primary: `${parsed.asset} · ${parsed.datePart}`,
        secondary: rawSymbol,
        tooltip: `${parsed.asset} · ${parsed.datePart} — ${rawSymbol}`,
        expiryText: expiry.text,
        intervalText,
        hasQuestion: false,
      };
    }
    return {
      primary: rawSymbol,
      secondary: "",
      tooltip: rawSymbol,
      expiryText: expiry.text,
      intervalText,
      hasQuestion: false,
    };
  }
  const primary = parts.join(" · ");
  const secondary = rawSymbol;
  return {
    primary,
    secondary,
    tooltip: `${primary} — ${rawSymbol}`,
    expiryText: expiry.text,
    intervalText,
    hasQuestion: false,
  };
}

// URL slugs use ~ in place of / (readable, unambiguous - symbols never contain ~).
export function marketSlug(symbol: string): string {
  return symbol.replaceAll("/", "~");
}

// Convenience for rendering - returns primary and secondary as separate React-friendly strings
export function getMarketLabel(market: MarketForFormat): { label: string; sublabel: string; title: string } {
  const f = formatMarket(market);
  return { label: f.primary, sublabel: f.secondary, title: f.tooltip };
}

// For cases where we only have symbol string (e.g., positions with just symbol) and no extra fields,
// parse symbol as fallback - but still honest, just show symbol with asset/date if parsable
export function formatSymbolFallback(symbol: string): { label: string; sublabel: string; title: string } {
  const parsed = parseSymbol(symbol);
  if (parsed.asset !== "?" && parsed.datePart) {
    return { label: `${parsed.asset} · ${parsed.datePart}`, sublabel: symbol, title: `${parsed.asset} · ${parsed.datePart} — ${symbol}` };
  }
  return { label: symbol, sublabel: "", title: symbol };
}
