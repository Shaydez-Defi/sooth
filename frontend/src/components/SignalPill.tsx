import { COLOR } from "./theme";

type Tier = "TRADE" | "NO_TRADE" | "TRADE_WAIT" | "WAIT" | "NO" | string;

const TIER_COLOR: Record<string, string> = {
  TRADE: COLOR.up,
  NO_TRADE: COLOR.faint,
  WAIT: COLOR.accent,
  NO: COLOR.faint,
};

export function SignalPill({ tier, size }: { tier: Tier; size?: "sm" | "md" }) {
  const normalized = tier.toUpperCase();
  const isTrade = normalized === "TRADE";
  const color = TIER_COLOR[normalized] ?? COLOR.faint;
  const sm = size === "sm";
  return (
    <span
      style={{
        fontFamily: "monospace",
        fontSize: sm ? 10 : 11,
        fontWeight: 700,
        letterSpacing: "0.03em",
        color: isTrade ? COLOR.ink : color,
        background: isTrade ? COLOR.up : "transparent",
        border: isTrade ? "none" : `1px solid ${COLOR.border}`,
        borderRadius: 4,
        padding: sm ? "1px 6px" : "2px 8px",
        display: "inline-block",
      }}
    >
      {normalized}
    </span>
  );
}
