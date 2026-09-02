import { COLOR } from "./theme";
import type { DataIntegrityTag } from "../lib/api";

// Must be typed and preserved in UI, not dropped — shows data-integrity tags per brief Step 5
const TAG_COLOR: Record<string, string> = {
  LIVE_ONCHAIN: "#6B9E78",
  LIVE_INDEXER: "#CC8899",
  DERIVED: "#8C887E",
  HISTORICAL: "#C9A86A",
  ESTIMATED: "#CA7560",
};

function colorFor(tag: string): string {
  const upper = tag.toUpperCase();
  for (const [k, v] of Object.entries(TAG_COLOR)) {
    if (upper.includes(k)) return v;
  }
  return COLOR.faint;
}

export function ProvenanceTag({ tag, small }: { tag: DataIntegrityTag; small?: boolean }) {
  const color = colorFor(tag);
  return (
    <span
      title={String(tag)}
      style={{
        fontFamily: "monospace",
        fontSize: small ? 10 : 11,
        letterSpacing: "0.04em",
        color,
        border: `1px solid ${color}55`,
        background: `${color}14`,
        borderRadius: 4,
        padding: small ? "1px 6px" : "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {tag}
    </span>
  );
}

export function ProvenanceRow({ tags }: { tags: Array<{ label: string; tag: DataIntegrityTag }> }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {tags.map((t) => (
        <span key={t.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: COLOR.faint }}>{t.label}:</span>
          <ProvenanceTag tag={t.tag} small />
        </span>
      ))}
    </div>
  );
}
