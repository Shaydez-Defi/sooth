// Single source of truth for design tokens - replaces copy-pasted COLOR/SPACE/PANEL_LABEL in each dropped .jsx
export const COLOR = {
  ink: "#0A0908",
  surface: "#14130F",
  surface2: "#1B1A15",
  border: "#2A281F",
  text: "#F4F2ED",
  muted: "#8C887E",
  faint: "#807C6B",
  accent: "#CC8899",
  accentDim: "#722F37",
  up: "#6B9E78",
  down: "#CA7560",
} as const;

export const EASE = "cubic-bezier(0.32, 0.72, 0, 1)" as const;

export const SPACE = { header: 12, block: 16, panel: 20 } as const;

// PANEL_LABEL is a style object, not a component - shared between MarketDetail and StrategyLab
export const PANEL_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: COLOR.faint,
};
