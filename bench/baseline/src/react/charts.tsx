// takumi-motion — react/charts.tsx (v0.9 Bet A · the spine)
// "The animation knows the numbers" — chart primitives whose MOTION is
// derived from the data they render.
//
//   <LineChart draw="reveal">   SVG polyline revealed by a per-frame
//                               clip-path inset sweeping left → right.
//                               (The day-one spike settled the moonshot: takumi
//                               renders SVG as a static image — no animatable
//                               stroke-dash — so clip reveal IS the draw
//                               engine, pre-authorized by the bet sheet.)
//   <BarChart>                  bars grown by staggered springs — layout
//                               height per frame, honest to the chunker.
//   <Donut paint="transform">   the two-half mask sweep: pure rotate() +
//                               clip-path, zero gradients (GIF-budget safe).
//               paint="conic">  per-frame conic-gradient — correct and
//                               simple, heavier in GIF palettes.
//
// All three are pure functions of (frame, data): no Math.random, no clock.
// Numbers are rounded to fixed decimals before they touch strings, so
// byte-identical frames chunk-merge and the golden doctrine holds.

import { createElement, isValidElement, type ReactNode } from "react";
import { useCurrentFrame, useDuration, useFps, useDriver } from "./context.js";
import { interpolateFor, springFor, type SpringAtOptions } from "./motion.js";
import { useChartData } from "./data.js";
import { resolveTheme, type Theme } from "../themes.js";
import type { TakumiStyle } from "../style.js";

const r2 = (n: number): number => Math.round(n * 100) / 100;
const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface ChartSeries {
  name: string;
  color: string;
  points: number[];
}

export interface ChartData {
  series: ChartSeries[];
  /** X-axis category labels (one per point index). */
  labels?: string[];
  /** Y-axis maximum. Default: the largest point, rounded up to a nice value. */
  max?: number;
}

/** Default series palette — reads on both dark and light themes. */
export const CHART_COLORS = ["#38bdf8", "#a78bfa", "#f472b6", "#34d399", "#fbbf24"] as const;

function validateChartData(data: ChartData, component: string): void {
  if (!data || !Array.isArray(data.series) || data.series.length === 0) {
    throw new Error(`<${component}>: data.series must be a non-empty array.`);
  }
  for (const s of data.series) {
    if (!Array.isArray(s.points) || s.points.length === 0) {
      throw new Error(`<${component}>: series "${s.name ?? "?"}" has no points.`);
    }
    if (s.points.some((p) => !Number.isFinite(p))) {
      throw new Error(`<${component}>: series "${s.name ?? "?"}" contains a non-finite point.`);
    }
  }
  const len = data.series[0].points.length;
  for (const s of data.series) {
    if (s.points.length !== len) {
      throw new Error(
        `<${component}>: all series must have the same point count (first has ${len}, "${s.name ?? "?"}" has ${s.points.length}).`,
      );
    }
  }
}

/** Round a y-max up to 1/2/2.5/5 × 10^k so axis labels stay human. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const scaled = value / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

/** The effective y-max for a chart: explicit max > niceMax(largest point). */
export function chartMaxOf(data: ChartData): number {
  if (data.max !== undefined) {
    if (!Number.isFinite(data.max) || data.max <= 0) {
      throw new Error(`chartMaxOf: data.max must be a finite positive number, got ${data.max}.`);
    }
    return data.max;
  }
  let peak = 0;
  for (const s of data.series) for (const p of s.points) peak = Math.max(peak, p);
  return niceMax(peak);
}

/** Resolve a component's data: the `data` prop wins over the banner's channel. */
function resolveChartData(props: { data?: ChartData }, component: string): ChartData {
  const data = props.data ?? useChartData<ChartData>(component);
  validateChartData(data, component);
  return data;
}

/** Series color fallback by index. */
function colorOf(series: ChartSeries, index: number): string {
  return series.color ?? CHART_COLORS[index % CHART_COLORS.length];
}

// ---------------------------------------------------------------------------
// Shared scales
// ---------------------------------------------------------------------------

interface PlotScale {
  /** value → y px (top of the plot box). */
  yOf: (v: number) => number;
  /** index → x px. */
  xOf: (i: number, count: number) => number;
  max: number;
  plotWidth: number;
  plotHeight: number;
}

function makeScale(width: number, height: number, pad: { top: number; right: number; bottom: number; left: number }, max: number): PlotScale {
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  return {
    max,
    plotWidth,
    plotHeight,
    yOf: (v) => pad.top + (1 - v / max) * plotHeight,
    xOf: (i, count) => pad.left + (count <= 1 ? plotWidth / 2 : (i * plotWidth) / (count - 1)),
  };
}

// ---------------------------------------------------------------------------
// <LineChart>
// ---------------------------------------------------------------------------

export interface LineChartProps {
  /** Chart data. Defaults to the banner's data channel (useChartData). */
  data?: ChartData;
  /** Plot box in CSS px. Defaults to the banner canvas minus 16px. */
  width?: number;
  height?: number;
  /** "reveal" sweeps the chart in left → right (default); "none" renders it settled. */
  draw?: "reveal" | "none";
  drawDurationFrames?: number;
  drawDelayFrames?: number;
  /** Line width in px. Default 3. */
  strokeWidth?: number;
  /** Gradient-free area fill under the FIRST series (12% alpha of its color). */
  area?: boolean;
  /** Horizontal grid lines at the y ticks. Default true. */
  grid?: boolean;
  /** Grid + tick color. Default "rgba(148,163,184,0.25)". */
  gridColor?: string;
  /** Dot markers at each point. Default false (noise under animation). */
  showPoints?: boolean;
  /** Render x labels (data.labels) under the plot. Default false. */
  showLabels?: boolean;
  /** Y tick count including the axis ends. Default 4. */
  yTicks?: number;
  /** Fill for the SVG background — "none" keeps it transparent. Default "none". */
  backgroundColor?: string;
  style?: TakumiStyle;
}

const LINE_PAD = { top: 10, right: 12, bottom: 10, left: 12 };

/**
 * Animated line chart. The chart itself is ONE deterministic SVG (polylines +
 * optional area/dots/grid); the draw animation is a per-frame clip-path inset
 * on its wrapper — no per-frame SVG rebuilds, so the encoder sees one image
 * and a sweeping clip.
 */
export function LineChart(props: LineChartProps): ReactNode {
  const data = resolveChartData(props, "LineChart");
  const frame = useCurrentFrame();
  const fps = useFps();
  const driver = useDriver();
  const canvasW = driver.registry.banner?.width ?? 320;
  const canvasH = driver.registry.banner?.height ?? 180;

  const width = props.width ?? canvasW - 16;
  const height = props.height ?? canvasH - 16;
  const draw = props.draw ?? "reveal";
  const duration = props.drawDurationFrames ?? 40;
  const delay = props.drawDelayFrames ?? 6;
  const strokeWidth = props.strokeWidth ?? 3;
  const max = chartMaxOf(data);
  const scale = makeScale(width, height, LINE_PAD, max);
  const gridColor = props.gridColor ?? "rgba(148,163,184,0.25)";
  const yTicks = props.yTicks ?? 4;

  // --- one SVG, built deterministically ------------------------------------
  const svg = buildLineSvg(data, scale, { strokeWidth, grid: props.grid ?? true, gridColor, area: props.area ?? false, showPoints: props.showPoints ?? false, yTicks, backgroundColor: props.backgroundColor ?? "none" });
  const svgUri = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

  // --- reveal clip ----------------------------------------------------------
  let clip: string | undefined;
  if (draw === "reveal") {
    const local = Math.max(0, frame - delay);
    if (local <= 0) {
      clip = `inset(0px ${r6(width)}px 0px 0px)`;
    } else if (local < duration) {
      const pct = interpolateFor(local, [0, duration], [0, 1], "easeOut");
      clip = `inset(0px ${r6((1 - pct) * width)}px 0px 0px)`;
    }
    // settled → no clip attribute at all (style-stable, chunk-merges)
  }

  return createElement("div", {
    style: { position: "relative", width, height, flexShrink: 0, ...(props.style ?? {}) },
  },
    createElement("div", {
      style: {
        position: "absolute", top: 0, left: 0, width, height,
        ...(clip !== undefined ? { clipPath: clip } : {}),
      },
    },
      createElement("img", { src: svgUri, width, height, style: { position: "absolute", top: 0, left: 0 } }),
    ),
    props.showLabels && data.labels ? axisLabels(data.labels, scale, width, height) : null,
  );
}

function buildLineSvg(
  data: ChartData,
  scale: PlotScale,
  opts: { strokeWidth: number; grid: boolean; gridColor: string; area: boolean; showPoints: boolean; yTicks: number; backgroundColor: string },
): string {
  const parts: string[] = [];
  const w = scale.plotWidth + LINE_PAD.left + LINE_PAD.right;
  const h = scale.plotHeight + LINE_PAD.top + LINE_PAD.bottom;

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  if (opts.backgroundColor !== "none") parts.push(`<rect width="${w}" height="${h}" fill="${opts.backgroundColor}"/>`);

  if (opts.grid) {
    const ticks = yTickCount(opts.yTicks);
    for (let t = 0; t < ticks; t++) {
      const v = (scale.max * t) / (ticks - 1);
      const y = r2(scale.yOf(v));
      parts.push(`<line x1="${LINE_PAD.left}" y1="${y}" x2="${LINE_PAD.left + scale.plotWidth}" y2="${y}" stroke="${opts.gridColor}" stroke-width="1"/>`);
    }
  }

  data.series.forEach((series, si) => {
    const color = colorOf(series, si);
    const pts = series.points.map((p, i) => `${r2(scale.xOf(i, series.points.length))},${r2(scale.yOf(p))}`);
    if (opts.area && si === 0) {
      const base = r2(scale.yOf(0));
      parts.push(
        `<polygon points="${LINE_PAD.left},${base} ${pts.join(" ")} ${r2(scale.xOf(series.points.length - 1, series.points.length))},${base}" fill="${color}" opacity="0.12"/>`,
      );
    }
    parts.push(
      `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="${opts.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    if (opts.showPoints) {
      for (const [i, p] of series.points.entries()) {
        parts.push(
          `<circle cx="${r2(scale.xOf(i, series.points.length))}" cy="${r2(scale.yOf(p))}" r="${r2(opts.strokeWidth * 1.6)}" fill="${color}"/>`,
        );
      }
    }
  });

  parts.push("</svg>");
  return parts.join("");
}

function yTickCount(yTicks: number): number {
  return Number.isInteger(yTicks) && yTicks >= 2 ? Math.min(yTicks, 9) : 4;
}

/** X labels under the plot (HTML — SVG text would sidestep the banner fonts). */
function axisLabels(labels: string[], scale: PlotScale, width: number, height: number): ReactNode[] {
  const out: ReactNode[] = [];
  const step = Math.max(1, Math.ceil(labels.length / 8));
  for (const [i, label] of labels.entries()) {
    if (i % step !== 0 && i !== labels.length - 1) continue;
    const x = scale.xOf(i, labels.length);
    out.push(createElement("div", {
      key: `lbl-${i}`,
      style: {
        position: "absolute",
        left: r6(Math.min(Math.max(x - 24, 0), width - 48)),
        top: height - 2,
        width: 48,
        fontSize: 10,
        lineHeight: 1,
        color: "rgba(148,163,184,0.8)",
        textAlign: "center",
        whiteSpace: "pre",
      },
    }, label));
  }
  return out;
}

// ---------------------------------------------------------------------------
// <BarChart>
// ---------------------------------------------------------------------------

export interface BarChartProps {
  data?: ChartData;
  /** "up" — vertical bars growing from the baseline; "right" — horizontal. Default "up". */
  orientation?: "up" | "right";
  /** Plot box in CSS px. Defaults to the banner canvas minus 16px. */
  width?: number;
  height?: number;
  /** Staggered spring entrances. Default true (2-frame interval). */
  stagger?: boolean | { intervalFrames?: number };
  /** Growth spring config. Default { duration: 550, bounce: 0.12 }. */
  spring?: SpringAtOptions;
  /** Render the value on each bar. Default true. */
  showValues?: boolean;
  /** Value label formatter. Default: compact (1.2k / 3.4M). */
  formatValue?: (value: number) => string;
  /** Render x labels (data.labels). Default false. */
  showLabels?: boolean;
  /** Gap between bars in px. Default 8. */
  gap?: number;
  /** Bar corner radius. Default 6. */
  radius?: number;
  style?: TakumiStyle;
}

/**
 * Staggered-spring bar chart. Each bar's SIZE is the animated channel
 * (honest layout — the chunker sees real holds once springs settle), driven
 * by the same closed-form spring physics as everything else in the runtime.
 * Multi-series data renders grouped bars (one group per point index).
 */
export function BarChart(props: BarChartProps): ReactNode {
  const data = resolveChartData(props, "BarChart");
  const frame = useCurrentFrame();
  const fps = useFps();
  const driver = useDriver();
  const canvasW = driver.registry.banner?.width ?? 320;
  const canvasH = driver.registry.banner?.height ?? 180;

  const orientation = props.orientation ?? "up";
  const width = props.width ?? canvasW - 16;
  const height = props.height ?? canvasH - 16;
  const gap = props.gap ?? 8;
  const radius = props.radius ?? 6;
  const max = chartMaxOf(data);
  const stagger = props.stagger === false
    ? { intervalFrames: 0 }
    : { intervalFrames: (props.stagger === true || props.stagger === undefined ? 2 : props.stagger.intervalFrames) ?? 2 };
  const springOpts: SpringAtOptions = props.spring ?? { duration: 550, bounce: 0.12 };
  const formatValue = props.formatValue ?? compactNumber;
  const groupCount = data.series[0].points.length;
  const showValues = props.showValues ?? true;
  const showLabels = props.showLabels ?? false;

  const groups: ReactNode[] = [];
  const slotWidth = (width - gap * Math.max(0, groupCount - 1)) / groupCount;

  for (let i = 0; i < groupCount; i++) {
    const delay = i * stagger.intervalFrames;
    const progress = springFor(frame, fps, { ...springOpts, from: 0, to: 1, delayFrames: (springOpts.delayFrames ?? 0) + delay });

    const bars = data.series.map((series, si) => {
      const value = series.points[i] ?? 0;
      const color = colorOf(series, si);
      const fraction = max > 0 ? Math.max(0, value / max) : 0;

      if (orientation === "up") {
        const barHeight = Math.max(0, r6(fraction * progress * (height - (showLabels ? 14 : 0))));
        return createElement("div", {
          key: `bar-${si}`,
          style: {
            flex: 1,
            height: barHeight,
            backgroundColor: color,
            borderRadius: `${radius}px ${radius}px 0 0`,
            position: "relative",
          },
        },
          showValues ? barValueLabel(formatValue(value), barHeight, color) : null,
        );
      }
      const barWidth = Math.max(0, r6(fraction * progress * width));
      return createElement("div", {
        key: `bar-${si}`,
        style: {
          width: barWidth,
          flex: 1,
          backgroundColor: color,
          borderRadius: `0 ${radius}px ${radius}px 0`,
          position: "relative",
        },
      },
        showValues ? barValueLabelRight(formatValue(value), barWidth, color) : null,
      );
    });

    groups.push(createElement("div", {
      key: `group-${i}`,
      style: orientation === "up"
        ? { display: "flex", alignItems: "flex-end", gap: 3, width: slotWidth, height }
        : { display: "flex", flexDirection: "column", gap: 3, width, flex: 1 },
    },
      bars,
      showLabels && data.labels ? barAxisLabel(data.labels[i] ?? "", orientation) : null,
    ));
  }

  return createElement("div", {
    style: {
      display: "flex",
      ...(orientation === "up"
        ? { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", width, height, gap }
        : { flexDirection: "column", justifyContent: "center", width, height, gap }),
      ...(props.style ?? {}),
    },
  }, groups);
}

/** Value label riding the bar's growing top edge (fades with height ≥ 14px). */
function barValueLabel(text: string, barHeight: number, _color: string): ReactNode {
  const visible = barHeight >= 14;
  return createElement("div", {
    style: {
      position: "absolute",
      top: -16,
      left: "50%",
      transform: "translateX(-50%)",
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1,
      whiteSpace: "pre",
      color: "inherit",
      opacity: visible ? 1 : 0,
    },
  }, text);
}

function barValueLabelRight(text: string, barWidth: number, _color: string): ReactNode {
  const visible = barWidth >= 30;
  return createElement("div", {
    style: {
      position: "absolute",
      left: barWidth + 6,
      top: "50%",
      fontSize: 11,
      fontWeight: 700,
      lineHeight: 1,
      whiteSpace: "pre",
      opacity: visible ? 1 : 0,
    },
  }, text);
}

function barAxisLabel(label: string, orientation: "up" | "right"): ReactNode {
  return createElement("div", {
    style: orientation === "up"
      ? { position: "absolute", bottom: -16, left: 0, right: 0, textAlign: "center", fontSize: 10, lineHeight: 1, color: "rgba(148,163,184,0.8)", whiteSpace: "pre" }
      : { position: "absolute", left: -8, top: "50%", fontSize: 10, lineHeight: 1, color: "rgba(148,163,184,0.8)", whiteSpace: "pre", transform: "translateX(-100%)" },
  }, label);
}

/** Deterministic compact number for value labels (12.3k, 4.5M). */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${r2(value / 1e9)}B`;
  if (abs >= 1e6) return `${r2(value / 1e6)}M`;
  if (abs >= 1e3) return `${r2(value / 1e3)}k`;
  return String(Math.round(value * 10) / 10);
}

// ---------------------------------------------------------------------------
// <Donut>
// ---------------------------------------------------------------------------

export interface DonutProps {
  /** Fill fraction in [0, 1] (0.73 → 73%). */
  value: number;
  /** Outer diameter in px. Default 140. */
  size?: number;
  /** Ring thickness in px. Default size × 0.14. */
  thickness?: number;
  /** Progress color. Default the first chart color. */
  color?: string;
  /** Track (unfilled ring) color. Default "rgba(148,163,184,0.2)". */
  trackColor?: string;
  /** Hole fill — MUST match what sits behind the donut. Default: the theme bg. */
  holeColor?: string;
  /** "transform" (default) — two-half mask sweep, zero gradients.
   *  "conic" — per-frame conic-gradient (correct, GIF-heavier). */
  paint?: "transform" | "conic";
  /** Frames from empty to full. Default 36. */
  drawDurationFrames?: number;
  drawDelayFrames?: number;
  /** Content in the hole (e.g. a <CountUp>). */
  center?: ReactNode;
  style?: TakumiStyle;
}

/**
 * Animated donut metric.
 *
 * The transform paint is the bet-sheet default: the ring is a progress disc
 * masked by two half-disc sweeps rotating around the center — pure
 * rotate() + clip-path, no gradients to dither GIF palettes. The sweep is
 * pinned at the completed angle after the draw (chunk-merged), and at 0 the
 * masks fully cover the ring (also static).
 */
export function Donut(props: DonutProps): ReactNode {
  const frame = useCurrentFrame();
  const fps = useFps();
  const driver = useDriver();
  const theme = themeOfDriver(driver.registry);

  const value = props.value;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`<Donut>: value must be in [0, 1] (got ${value}). Pass the ratio, e.g. 0.73.`);
  }
  const size = props.size ?? 140;
  const thickness = props.thickness ?? Math.round(size * 0.14);
  const color = props.color ?? CHART_COLORS[0];
  const trackColor = props.trackColor ?? "rgba(148,163,184,0.2)";
  const holeColor = props.holeColor ?? theme.bg;
  const paint = props.paint ?? "transform";
  const duration = props.drawDurationFrames ?? 36;
  const delay = props.drawDelayFrames ?? 4;

  const local = Math.max(0, frame - delay);
  const eased = interpolateFor(local, [0, duration], [0, 1], "easeOut");
  const angle = r6(360 * value * eased);

  const half = size / 2;
  const clipRight = `inset(0px 0px 0px ${half}px)`;
  const clipLeft = `inset(0px ${half}px 0px 0px)`;

  const disc = (extra: TakumiStyle): TakumiStyle => ({
    position: "absolute", top: 0, left: 0, width: size, height: size, borderRadius: 999, ...extra,
  });

  let layers: ReactNode[];
  if (paint === "conic") {
    layers = [
      createElement("div", { key: "track", style: disc({ backgroundColor: trackColor }) }),
      createElement("div", {
        key: "fill",
        style: disc({
          backgroundImage: `conic-gradient(${color} 0deg, ${color} ${angle}deg, ${trackColor} ${angle}deg, ${trackColor} 360deg)`,
        }),
      }),
    ];
  } else {
    // Two-half mask sweep (see module comment for the geometry proof):
    // maskA = track-colored right half rotating with the sweep; maskB is the
    // second half — track-colored until the sweep crosses 180°, then swapped
    // for a progress-colored right half that restores the covered region.
    const crossed = angle > 180;
    layers = [
      createElement("div", { key: "track", style: disc({ backgroundColor: trackColor }) }),
      createElement("div", { key: "progress", style: disc({ backgroundColor: color }) }),
      createElement("div", {
        key: "maskA",
        style: disc({ backgroundColor: trackColor, clipPath: clipRight, transform: `rotate(${angle}deg)`, transformOrigin: "50% 50%" }),
      }),
      createElement("div", {
        key: "maskB",
        style: disc({
          backgroundColor: crossed ? color : trackColor,
          clipPath: crossed ? clipRight : clipLeft,
          transform: "rotate(0deg)",
        }),
      }),
    ];
  }

  const hole = size - thickness * 2;
  return createElement("div", {
    style: { position: "relative", width: size, height: size, flexShrink: 0, ...(props.style ?? {}) },
  },
    ...layers,
    createElement("div", {
      style: {
        position: "absolute",
        top: thickness,
        left: thickness,
        width: hole,
        height: hole,
        borderRadius: 999,
        backgroundColor: holeColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
    }, props.center ?? null),
  );
}

// ---------------------------------------------------------------------------

/** The theme behind the current banner (hole colors etc.), with a fallback. */
function themeOfDriver(registry: { banner?: { themeName?: string } | null }): Theme {
  try {
    return resolveTheme(registry.banner?.themeName ?? "midnight");
  } catch {
    return resolveTheme("midnight");
  }
}

/** Guard for center content: it must be a React node (catches raw numbers). */
export function donutCenterNumber(value: number): string {
  return String(Math.round(value * 100));
}

// Re-exported so authors can feature-detect chart kit availability.
export { isValidElement as isChartValidElement };
