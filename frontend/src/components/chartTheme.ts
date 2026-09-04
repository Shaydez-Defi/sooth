import * as echarts from "echarts/core";
import { COLOR } from "./theme";

export const ECHARTS_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function areaGradient(color: string, fromAlpha: number): echarts.graphic.LinearGradient {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: hexToRgba(color, fromAlpha) },
    { offset: 1, color: hexToRgba(color, 0) },
  ]);
}

/** Dark tooltip shell matching the glass panels - content rows are [label, value, color]. */
export function tooltipBox(title: string, rows: ReadonlyArray<readonly [string, string, string]>): string {
  const items = rows
    .map(
      ([label, value, color]) =>
        `<div style="display:flex;justify-content:space-between;gap:16px;font-family:${ECHARTS_MONO};font-size:12px;margin-top:4px;">` +
        `<span style="color:${COLOR.muted}">${label}</span>` +
        `<span style="color:${color};font-weight:600">${value}</span></div>`,
    )
    .join("");
  return (
    `<div style="background:${COLOR.surface2};border:1px solid ${COLOR.border};border-radius:8px;padding:8px 12px;">` +
    `<div style="font-family:${ECHARTS_MONO};font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:${COLOR.faint}">${title}</div>` +
    `${items}</div>`
  );
}

export const AXIS_COMMON = {
  axisLine: { lineStyle: { color: COLOR.border } },
  axisTick: { show: false },
  axisLabel: { color: COLOR.faint, fontSize: 11, fontFamily: ECHARTS_MONO, hideOverlap: true },
  splitLine: { lineStyle: { color: COLOR.border } },
} as const;
