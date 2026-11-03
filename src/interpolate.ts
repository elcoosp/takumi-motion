// takumi-motion — interpolate.ts
// Tween keyframe sampling, mirroring Motion's keyframes generator +
// interpolate/mix semantics: per-segment easings (default easeInOut),
// x² channel color blending, token-wise complex value mixing.

import { getEasingForSegment } from "./easing.js";

export interface TweenOptions {
  keyframes: (number | string | null)[];
  /** 0–1 offsets, same length as keyframes (or ignored). */
  times?: number[];
  ease?: import("./types.js").Easing | import("./types.js").Easing[];
  /** ms */
  duration: number;
}

const hexToRgba = (hex: string): [number, number, number, number] => {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
};

// v1.0 — parse memo. Scene code mixes the SAME handful of colors every frame;
// the regex parse dominates mixColors at frame counts. Bounded Map (clear on
// overflow) keeps it allocation-flat and deterministic.
const PARSE_MEMO_CAP = 512;
const parseMemo = new Map<string, [number, number, number, number] | null>();

const parseToRgba = (color: string): [number, number, number, number] | null => {
  const hit = parseMemo.get(color);
  if (hit !== undefined) return hit;
  const parsed = parseToRgbaUncached(color);
  if (parseMemo.size >= PARSE_MEMO_CAP) parseMemo.clear();
  parseMemo.set(color, parsed);
  return parsed;
};

const parseToRgbaUncached = (color: string): [number, number, number, number] | null => {
  const str = color.trim().toLowerCase();
  if (str.startsWith("#")) return hexToRgba(str);
  const m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const nums = parts.map((p) => parseFloat(p));
    if (nums.length >= 3 && nums.slice(0, 3).every((n) => !Number.isNaN(n))) {
      const alpha = nums[3] ?? (parts[3]?.endsWith("%") ? 1 : 255);
      return [nums[0], nums[1], nums[2], nums.length > 3 ? (alpha > 1 ? alpha : alpha * 255) : 255];
    }
    return null;
  }
  const hsl = str.match(/^hsla?\(([^)]+)\)$/);
  if (hsl) {
    const parts = hsl[1].split(/[\s,/]+/).filter(Boolean);
    const h = parseFloat(parts[0]) % 360;
    const s = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = parts[3] !== undefined ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m1 = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [(r + m1) * 255, (g + m1) * 255, (b + m1) * 255, a * 255];
  }
  return null;
};

const clamp255 = (v: number) => Math.min(255, Math.max(0, v));

/**
 * Mix two colors the way Motion's mixLinearColor does — per-channel
 * sqrt(v·(to² − from²) + from²) in 0–255 space (squared-channel blend),
 * alpha linear.
 */
export const mixColors = (from: string, to: string, v: number): string => {
  const a = parseToRgba(from);
  const b = parseToRgba(to);
  if (!a || !b) return v < 0.5 ? from : to;
  const mix = (f: number, t: number) => Math.round(clamp255(Math.sqrt(v * (t * t - f * f) + f * f)));
  const [r1, g1, b1, a1] = a;
  const [r2, g2, b2, a2] = b;
  const alpha = a1 + (a2 - a1) * v;
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  const hex = `#${toHex(mix(r1, r2))}${toHex(mix(g1, g2))}${toHex(mix(b1, b2))}`;
  return alpha < 0.999 ? `${hex}${toHex(Math.round(alpha * 255))}` : hex;
};

/** Split a complex value into number and non-number tokens (Motion's complex value model). */
const tokenizeComplex = (value: string): Array<{ type: "num" | "str"; v: string }> => {
  const tokens: Array<{ type: "num" | "str"; v: string }> = [];
  const re = /(-?\d*\.?\d+(?:e[-+]?\d+)?|\S)/gi;
  let match: RegExpExecArray | null;
  let last = 0;
  while ((match = re.exec(value)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "str", v: value.slice(last, match.index) });
    }
    tokens.push({ type: /^[-\d.]/.test(match[0]) ? "num" : "str", v: match[0] });
    last = match.index + match[0].length;
  }
  if (last < value.length) tokens.push({ type: "str", v: value.slice(last) });
  return tokens;
};

/** Mix two complex strings token-wise (numbers lerped, units/colors passed through). */
export const mixComplex = (from: string, to: string, v: number): string => {
  const a = tokenizeComplex(from);
  const b = tokenizeComplex(to);
  if (a.length !== b.length) return v < 0.5 ? from : to;
  let out = "";
  for (let i = 0; i < a.length; i++) {
    if (a[i].type === "num" && b[i].type === "num") {
      const f = parseFloat(a[i].v);
      const t = parseFloat(b[i].v);
      out += String(f + (t - f) * v);
    } else if (a[i].v === b[i].v) {
      out += a[i].v;
    } else {
      return v < 0.5 ? from : to;
    }
  }
  return out;
};

/** Mix two keyframe values. */
export const mixValues = (from: number | string, to: number | string, v: number): number | string => {
  if (typeof from === "number" && typeof to === "number") return from + (to - from) * v;
  const fs = String(from);
  const ts = String(to);
  if (parseToRgba(fs) && parseToRgba(ts)) return mixColors(fs, ts, v);
  return mixComplex(fs, ts, v);
};

export interface TweenSampler {
  duration: number;
  sample(tMs: number): number | string;
}

/**
 * Build a stateless tween sampler — the port of Motion's keyframes generator:
 * evenly-spaced default offsets, per-segment easing (default easeInOut),
 * null wildcards forward-filled by the caller (they mean "base style").
 */
export function createTweenSampler(opts: TweenOptions, baseValue?: number | string): TweenSampler {
  const filled = opts.keyframes.map((kf, i) =>
    kf === null ? (opts.keyframes.length === 1 ? (baseValue ?? 0) : (i > 0 ? (opts.keyframes[i - 1] !== null ? opts.keyframes[i - 1] : baseValue ?? 0) : (baseValue ?? 0))) : kf
  ) as (number | string)[];

  const n = filled.length;
  // Motion honors explicit times whenever the length matches (no 0/1 endpoints
  // required) — values hold outside the covered range via interpolation clamping.
  let offsets: number[];
  if (opts.times && opts.times.length === n) {
    offsets = [...opts.times];
  } else {
    offsets = Array.from({ length: n }, (_, i) => (n === 1 ? 0 : i / (n - 1)));
  }

  const timesMs = offsets.map((o) => o * opts.duration);
  const duration = opts.duration;

  // v1.0 — precompute per-segment eased functions + closed-form value pairs.
  // The baseline re-resolved the easing (closure construction for beziers)
  // and re-tokenized colors/complex strings on EVERY sample; both are pure
  // functions of the segment, so they bake once here.
  const ease = opts.ease ?? "easeInOut";
  const easings: Array<(p: number) => number> = [];
  for (let seg = 0; seg < n - 1; seg++) easings.push(getEasingForSegment(ease, seg));

  return {
    duration,
    sample(tMs: number): number | string {
      if (n === 1) return filled[0];
      // interpolate() clamps by default: hold first/last value outside the range
      const t = Math.min(Math.max(tMs, timesMs[0]), timesMs[n - 1]);
      // v1.0 — binary search for the segment (the baseline linearly scanned;
      // O(log n) vs O(n) per sample on multi-stop tracks). Picks the LEFTMOST
      // segment containing t, identical to the baseline's first-match scan.
      let lo = 0;
      let hi = n - 2;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (t <= timesMs[mid + 1]) hi = mid;
        else lo = mid + 1;
      }
      const seg = lo;
      const span = timesMs[seg + 1] - timesMs[seg];
      const local = span <= 0 ? 1 : (t - timesMs[seg]) / span;
      return mixValues(filled[seg], filled[seg + 1], easings[seg](local));
    },
  };
}

// ---------------------------------------------------------------------------
// Generic value interpolation (v0.4) — Remotion-flavored, frame-agnostic
// ---------------------------------------------------------------------------

import { easingDefinitionToFunction } from "./easing.js";
import type { Easing } from "./types.js";

export interface InterpolateOptions {
  /** Easing applied to EVERY segment (pass an array for per-segment easing). */
  easing?: Easing | Easing[];
  /** Behavior below inputRange[0]: "clamp" (default) or "extend". */
  extrapolateLeft?: "clamp" | "extend";
  /** Behavior above inputRange[last]: "clamp" (default) or "extend". */
  extrapolateRight?: "clamp" | "extend";
}

/**
 * Map `input` through `inputRange → outputRange` with an easing between stops.
 * Pure value math — no frame context — so it serves React scenes, declarative
 * timelines and raw HTML/CSS authors alike.
 *
 * Ranges must be monotonically increasing and equal length ≥ 2 (validated).
 * Outside the range the input clamps to the end values unless "extend" is set.
 */
export function interpolate(
  input: number,
  inputRange: readonly number[],
  outputRange: readonly number[],
  options: InterpolateOptions = {},
): number {
  if (inputRange.length !== outputRange.length || inputRange.length < 2) {
    throw new Error(
      `interpolate: input (${inputRange.length}) and output (${outputRange.length}) ranges must be equal length ≥ 2.`,
    );
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (inputRange[i] <= inputRange[i - 1]) {
      throw new Error(
        `interpolate: inputRange must be strictly increasing — got ${inputRange[i]} after ${inputRange[i - 1]} at ${i}.`,
      );
    }
  }
  if (!Number.isFinite(input)) {
    throw new Error(`interpolate: input must be a finite number, got ${input}.`);
  }

  const first = inputRange[0];
  const last = inputRange[inputRange.length - 1];
  if (input <= first) {
    if (options.extrapolateLeft === "extend" && input < first) {
      const seg = segmentSlope(inputRange, outputRange, 0);
      return outputRange[0] + (input - first) * seg;
    }
    return outputRange[0];
  }
  if (input >= last) {
    const lastIdx = inputRange.length - 1;
    if (options.extrapolateRight === "extend" && input > last) {
      const seg = segmentSlope(inputRange, outputRange, lastIdx - 1);
      return outputRange[lastIdx] + (input - last) * seg;
    }
    return outputRange[outputRange.length - 1];
  }

  let segment = 0;
  for (let i = 0; i < inputRange.length - 1; i++) {
    if (input >= inputRange[i] && input <= inputRange[i + 1]) {
      segment = i;
      break;
    }
  }

  const t0 = inputRange[segment];
  const t1 = inputRange[segment + 1];
  const raw = t1 === t0 ? 1 : (input - t0) / (t1 - t0);

  // Note: Easing itself contains an array variant (BezierDefinition = 4
  // numbers), so Array.isArray alone can't discriminate a single easing from
  // a per-segment easing list.
  const rawEase = options.easing;
  const isSingleBezier =
    Array.isArray(rawEase) && rawEase.length === 4 && rawEase.every((n) => typeof n === "number");
  const easeDef: Easing =
    Array.isArray(rawEase) && !isSingleBezier
      ? ((rawEase[segment] ?? "linear") as Easing)
      : ((rawEase ?? "linear") as Easing);
  const eased = easingDefinitionToFunction(easeDef)(raw);
  return outputRange[segment] + (outputRange[segment + 1] - outputRange[segment]) * eased;
}

function segmentSlope(
  inputRange: readonly number[],
  outputRange: readonly number[],
  segment: number,
): number {
  const dt = inputRange[segment + 1] - inputRange[segment];
  if (dt === 0) return 0;
  return (outputRange[segment + 1] - outputRange[segment]) / dt;
}
