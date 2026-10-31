// takumi-motion — color.ts (v0.7)
// Perceptual color interpolation for finite-output animation.
//
// WHY A NEW MODULE: interpolate.ts mixColors is the compile-path blender
// (motion's squared-channel sRGB mix) and is FROZEN — v0.6 outputs and tests
// depend on its exact bytes. This module is the v0.7 authoring surface:
//
//   - parseColor        hex / rgb() / hsl() / 148 named colors / transparent
//   - colorToOklch      sRGB → OKLCH (Björn Ottosson's OKLab, standard consts)
//   - mixColor          mix two colors in oklch | srgb | srgb-linear space
//   - interpolateColorFor  frame-indexed multi-stop color interpolation
//
// OKLCH is the DEFAULT space: perceptually uniform — no muddy midpoints, no
// neon overshoot between saturated hues (Reanimated offers RGB/LAB; OKLCH is
// the leapfrog). Hue travels the SHORT path (red→yellow, never the long way
// around the wheel) unless the two hues are antipodal, where it goes up.
//
// DETERMINISM: pure f64 math, no I/O, no randomness. Output channels are
// integers in 0–255 (the GIF/WebP palette quantizer rounds anyway; integer
// output also keeps the frame-chunk merger effective). Out-of-gamut OKLCH
// results clamp on output, never mid-mix.

import { getEasingForSegment } from "./easing.js";
import type { Easing } from "./types.js";

// ---------------------------------------------------------------------------
// Types + parsing
// ---------------------------------------------------------------------------

/** 8-bit-ish RGBA: channels 0–255, alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ColorSpace = "oklch" | "srgb" | "srgb-linear";

/** The 148 CSS extended color keywords (values as authoritatively specced). */
const NAMED_COLORS: Record<string, string> = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000",
  blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e",
  coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc",
  darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3",
  deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dimgrey: "#696969",
  dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22",
  fuchsia: "#ff00ff", gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700",
  goldenrod: "#daa520", gray: "#808080", green: "#008000", greenyellow: "#adff2f",
  grey: "#808080", honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c",
  indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa",
  lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6",
  lightcoral: "#f08080", lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3",
  lightgreen: "#90ee90", lightgrey: "#d3d3d3", lightpink: "#ffb6c1", lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa", lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32",
  linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585", midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5", navajowhite: "#ffdead", navy: "#000080", oldlace: "#fdf5e6",
  olive: "#808000", olivedrab: "#6b8e23", orange: "#ffa500", orangered: "#ff4500",
  orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98", paleturquoise: "#afeeee",
  palevioletred: "#db7093", papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f",
  pink: "#ffc0cb", plum: "#dda0dd", powderblue: "#b0e0e6", purple: "#800080",
  rebeccapurple: "#663399", red: "#ff0000", rosybrown: "#bc8f8f", royalblue: "#4169e1",
  saddlebrown: "#8b4513", salmon: "#fa8072", sandybrown: "#f4a460", seagreen: "#2e8b57",
  seashell: "#fff5ee", sienna: "#a0522d", silver: "#c0c0c0", skyblue: "#87ceeb",
  slateblue: "#6a5acd", slategray: "#708090", slategrey: "#708090", snow: "#fffafa",
  springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c", teal: "#008080",
  thistle: "#d8bfd8", tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee",
  wheat: "#f5deb3", white: "#ffffff", whitesmoke: "#f5f5f5", yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

const hexToRgba = (hex: string): Rgba | null => {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h.split("").map((c) => c + c).join("");
  }
  if (h.length !== 6 && h.length !== 8) return null;
  if (!/^[0-9a-f]+$/i.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
};

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/** Parse `rgb(255 0 0)` / `rgba(255, 0, 0, 0.5)` / `rgb(100% 0% 0% / 50%)`. */
const parseRgb = (body: string): Rgba | null => {
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const chan = (s: string): number | null => {
    const v = num(s);
    if (v === null) return null;
    return s.endsWith("%") ? (v / 100) * 255 : v;
  };
  const r = chan(parts[0]);
  const g = chan(parts[1]);
  const b = chan(parts[2]);
  if (r === null || g === null || b === null) return null;
  const aRaw = parts[3] !== undefined ? num(parts[3]) : 1;
  if (aRaw === null) return null;
  const a = parts[3]?.endsWith("%") ? aRaw / 100 : aRaw;
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: clamp01(a) };
};

/** Parse `hsl(120 50% 50%)` / `hsla(120, 50%, 50%, 0.5)`. */
const parseHsl = (body: string): Rgba | null => {
  const parts = body.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const h = num(parts[0]);
  const s = num(parts[1]);
  const l = num(parts[2]);
  if (h === null || s === null || l === null) return null;
  const aRaw = parts[3] !== undefined ? num(parts[3]) : 1;
  if (aRaw === null) return null;
  const a = parts[3]?.endsWith("%") ? aRaw / 100 : aRaw;
  const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, clamp01(s / 100), clamp01(l / 100));
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a: clamp01(a) };
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, v));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Parse cache — colors repeat across frames; parse each distinct string once. */
const parseCache = new Map<string, Rgba | null>();
const PARSE_CACHE_CAP = 1024;

/**
 * Parse any CSS color takumi accepts into RGBA: hex (3/4/6/8), rgb()/rgba()
 * (space and comma syntax, % channels), hsl()/hsla(), the 148 named colors,
 * and `transparent` → rgba(0,0,0,0). Returns null for unparseable input
 * (callers decide: pass-through or warn).
 */
export function parseColor(css: string): Rgba | null {
  const hit = parseCache.get(css);
  if (hit !== undefined) return hit;

  let out: Rgba | null = null;
  const str = css.trim().toLowerCase();
  if (str === "transparent") {
    out = { r: 0, g: 0, b: 0, a: 0 };
  } else if (str.startsWith("#")) {
    out = hexToRgba(str);
  } else if (str.startsWith("rgb")) {
    const m = str.match(/^rgba?\(([^)]+)\)$/);
    out = m ? parseRgb(m[1]) : null;
  } else if (str.startsWith("hsl")) {
    const m = str.match(/^hsla?\(([^)]+)\)$/);
    out = m ? parseHsl(m[1]) : null;
  } else {
    const named = NAMED_COLORS[str];
    if (named) out = hexToRgba(named);
  }

  if (parseCache.size >= PARSE_CACHE_CAP) parseCache.clear();
  parseCache.set(css, out);
  return out;
}

/** Format RGBA as a takumi-safe CSS color (integer channels, `rgba()` when alpha < 1). */
export function rgbaToCss(c: Rgba): string {
  const r = Math.round(clamp255(c.r));
  const g = Math.round(clamp255(c.g));
  const b = Math.round(clamp255(c.b));
  if (c.a >= 0.9995) return `rgb(${r} ${g} ${b})`;
  const a = Math.round(clamp01(c.a) * 1000) / 1000;
  return `rgba(${r} ${g} ${b} / ${a})`;
}

// ---------------------------------------------------------------------------
// OKLab / OKLCH (Björn Ottosson's standard matrices — high-precision constants)
// ---------------------------------------------------------------------------

export interface Oklch {
  /** 0–1 perceptual lightness. */
  l: number;
  /** 0–~0.37 chroma. */
  c: number;
  /** hue in degrees 0–360. */
  h: number;
  a: number;
}

const srgbToLinearChan = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgbChan = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** sRGB (0–255, alpha separate) → OKLCH. Pure f64. */
export function rgbaToOklch(c: Rgba): Oklch {
  const r = srgbToLinearChan(c.r / 255);
  const g = srgbToLinearChan(c.g / 255);
  const b = srgbToLinearChan(c.b / 255);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const chroma = Math.sqrt(A * A + B * B);
  let hue = (Math.atan2(B, A) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { l: L, c: chroma, h: hue, a: c.a };
}

/** OKLCH → sRGB (channels NOT clamped — clamp at output). */
export function oklchToRgba(o: Oklch): Rgba {
  const hp = (o.h * Math.PI) / 180;
  const A = o.c * Math.cos(hp);
  const B = o.c * Math.sin(hp);

  const l_ = o.l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = o.l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = o.l - 0.0894841775 * A - 1.291485548 * B;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: linearToSrgbChan(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    g: linearToSrgbChan(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    b: linearToSrgbChan(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
    a: o.a,
  };
}

/** Parse + convert in one step — the color-authoring introspection helper. */
export function colorToOklch(css: string): Oklch | null {
  const rgba = parseColor(css);
  return rgba ? rgbaToOklch(rgba) : null;
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

/** Shortest-path hue interpolation in degrees (antipodal hues go UP). */
const mixHue = (h1: number, h2: number, t: number): number => {
  const d = ((h2 - h1 + 540) % 360) - 180;
  return ((h1 + d * t) % 360 + 360) % 360;
};

/**
 * Mix two colors at `t ∈ [0,1]` in the given space. Default "oklch" —
 * perceptually uniform (a 50/50 mix of red and yellow LOOKS orange, not brown).
 *
 * ```ts
 * mixColor("#0f172a", "#f8fafc", 0.5);                       // OKLCH midpoint
 * mixColor("red", "blue", t, { space: "srgb" });             // legacy per-channel
 * ```
 */
export function mixColor(
  from: string,
  to: string,
  t: number,
  options: { space?: ColorSpace } = {},
): string {
  const space = options.space ?? "oklch";
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t < 0.5 ? from : to;
  const v = clamp01(t);

  if (space === "oklch") {
    const ca = rgbaToOklch(a);
    const cb = rgbaToOklch(b);
    // Chroma near zero → hue is undefined; snap both hues to the meaningful
    // one so greys interpolate without a random hue swing.
    const h1 = ca.c < 1e-6 ? cb.h : ca.h;
    const h2 = cb.c < 1e-6 ? ca.h : cb.h;
    return rgbaToCss(
      oklchToRgba({
        l: ca.l + (cb.l - ca.l) * v,
        c: ca.c + (cb.c - ca.c) * v,
        h: mixHue(h1, h2, v),
        a: ca.a + (cb.a - ca.a) * v,
      }),
    );
  }

  if (space === "srgb-linear") {
    const lr = { r: srgbToLinearChan(a.r / 255) * 255, g: srgbToLinearChan(a.g / 255) * 255, b: srgbToLinearChan(a.b / 255) * 255 };
    const lb = { r: srgbToLinearChan(b.r / 255) * 255, g: srgbToLinearChan(b.g / 255) * 255, b: srgbToLinearChan(b.b / 255) * 255 };
    return rgbaToCss({
      r: linearToSrgbChan(((lr.r + (lb.r - lr.r) * v) / 255)) * 255,
      g: linearToSrgbChan(((lr.g + (lb.g - lr.g) * v) / 255)) * 255,
      b: linearToSrgbChan(((lr.b + (lb.b - lr.b) * v) / 255)) * 255,
      a: a.a + (b.a - a.a) * v,
    });
  }

  // srgb — per-channel 0–255 lerp (the CSS "interpolate in rgb" behavior).
  return rgbaToCss({
    r: a.r + (b.r - a.r) * v,
    g: a.g + (b.g - a.g) * v,
    b: a.b + (b.b - a.b) * v,
    a: a.a + (b.a - a.a) * v,
  });
}

/**
 * Frame-indexed multi-stop color interpolation — the color twin of
 * interpolateFor(). Clamps outside the input range; per-segment easing
 * (a string applies to every segment, an array picks by segment); colors
 * interpolate in the given space (default OKLCH).
 *
 * ```ts
 * const bg = interpolateColorFor(frame, [0, 45], ["#0f172a", "#1d4ed8", "#f8fafc"]);
 * ```
 */
export function interpolateColorFor(
  frame: number,
  inputFrames: readonly number[],
  colors: readonly string[],
  options: { space?: ColorSpace; easing?: Easing | Easing[] } = {},
): string {
  if (inputFrames.length !== colors.length || inputFrames.length < 2) {
    throw new Error(
      `interpolateColorFor: input (${inputFrames.length}) and colors (${colors.length}) must be equal length ≥ 2.`,
    );
  }
  if (frame <= inputFrames[0]) return colors[0];
  if (frame >= inputFrames[inputFrames.length - 1]) return colors[colors.length - 1];

  let segment = 0;
  for (let i = 0; i < inputFrames.length - 1; i++) {
    if (frame >= inputFrames[i] && frame <= inputFrames[i + 1]) {
      segment = i;
      break;
    }
  }
  const t0 = inputFrames[segment];
  const t1 = inputFrames[segment + 1];
  const raw = t1 === t0 ? 1 : (frame - t0) / (t1 - t0);

  const eased = getEasingForSegment(options.easing ?? "linear", segment)(raw);
  return mixColor(colors[segment], colors[segment + 1], eased, { space: options.space });
}
