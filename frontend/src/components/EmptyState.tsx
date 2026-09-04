import type { ReactNode } from "react";
import { COLOR } from "./theme";

export function EmptyState({
  mark,
  title,
  height = 200,
  children,
}: {
  mark: string;
  title: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 8,
        background: COLOR.surface2,
        padding: 16,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: `1px solid ${COLOR.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontFamily: "monospace", fontSize: 14, color: COLOR.faint }}>{mark}</span>
      </div>
      <div style={{ fontSize: 13, color: COLOR.muted, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 12, color: COLOR.faint, maxWidth: 300, textAlign: "center", lineHeight: 1.5 }}>{children}</div>
    </div>
  );
}
