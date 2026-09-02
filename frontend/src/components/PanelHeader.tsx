import { COLOR, SPACE, PANEL_LABEL_STYLE } from "./theme";
import type { LucideIcon } from "lucide-react";

export function PanelHeader({ icon: Icon, children, right }: { icon?: LucideIcon; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: SPACE.header }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {Icon ? <Icon size={13} color={COLOR.faint} /> : null}
        <span style={PANEL_LABEL_STYLE}>{children}</span>
      </div>
      {right}
    </div>
  );
}
