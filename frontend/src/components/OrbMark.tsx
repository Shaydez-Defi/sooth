import { COLOR } from "./theme";

export function OrbMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="24" stroke={COLOR.text} strokeWidth="1.5" fill="none" />
      <path d="M 32 8 A 24 24 0 0 1 51.85 43.72" stroke={COLOR.accent} strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
