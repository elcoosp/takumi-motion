// takumi-motion — surface.ts (v0.4)
// The unconstrained output surface: width / height / dpr / fps / formats /
// quality / lossless / background / budget are USER-GIVEN everywhere. The
// banner presets are just recipes — the engine itself carries zero banner
// assumptions (this is the v0.4 "general engine" doctrine).
//
// Precedence (highest wins):
//   explicit option / <Banner> prop  >  preset  >  engine defaults
//
// `background` semantics:
//   undefined  → preset/theme behavior (React banners paint their theme bg)
//   "transparent" | null → NOTHING is painted — the canvas stays transparent
//     (GIF binary transparency + alpha WebP/APNG; verified on takumi 2.17.1)
//   any CSS color → the canvas root paints that color

import { bannerPresets, resolvePreset, type AnimationFormat, type BannerPreset } from "./presets.js";

/** The ANIMATED output formats (PNG sequence / sprite sheets are extras). */
export type SurfaceFormat = AnimationFormat;

/** User-given output spec — every field optional, every field overrides the preset. */
export interface SurfaceSpec {
  /** Logical (CSS px) canvas width. Overrides the preset's. */
  width?: number;
  /** Logical (CSS px) canvas height. Overrides the preset's. */
  height?: number;
  /** Device pixel ratio. Output is logical × dpr DEVICE pixels (takumi convention). */
  dpr?: number;
  /** Frame rate for both the sampling grid and the encoder. */
  fps?: number;
  /** Animated formats to encode. */
  formats?: SurfaceFormat[];
  /** WebP quality 0–100 (ignored when lossless). */
  quality?: number;
  /** Encode WebP losslessly (takumi's default when neither quality nor lossless is given). */
  lossless?: boolean;
  /** Canvas background: "transparent"/null paints nothing; a CSS color paints the root. */
  background?: string | null;
  /** Soft per-file size budget in bytes — reports (and exits non-zero in CI) when exceeded. */
  budgetBytes?: number;
}

/** Fully resolved output surface — what the pipelines actually render. */
export interface ResolvedSurface {
  width: number;
  height: number;
  devicePixelRatio: number;
  fps: number;
  formats: SurfaceFormat[];
  quality: number;
  lossless: boolean;
  /** null → transparent canvas (nothing painted). undefined → pipeline default
   *  (React banners paint their theme background; html/timeline sources stay transparent). */
  background: string | null | undefined;
  budgetBytes: number;
  /** Preset name the surface started from ("custom" when none). */
  presetName: string;
  /** True when the caller supplied ANY explicit override. */
  customized: boolean;
}

const MAX_DIMENSION = 8192;
const DEFAULTS = {
  dpr: 1,
  fps: 30,
  formats: ["gif", "webp"] as SurfaceFormat[],
  quality: 82,
  budgetBytes: 4 * 1024 * 1024,
};

/**
 * Merge a user-given spec over an (optional) preset into a concrete surface.
 * Throws on non-positive / non-integer dimensions and on absurd sizes — the
 * engine is general, not unguarded: an 8192px edge is the sane ceiling for
 * rasterized animation (32MB RGBA per frame).
 */
export function resolveSurface(spec: SurfaceSpec = {}, preset?: string | BannerPreset): ResolvedSurface {
  const base: BannerPreset | null = preset ? resolvePreset(preset as string | BannerPreset) : null;

  const width = spec.width ?? base?.width;
  const height = spec.height ?? base?.height;
  if (width === undefined || height === undefined) {
    throw new Error(
      "resolveSurface: width and height are required — pass them explicitly or name a preset.",
    );
  }
  assertDimension("width", width);
  assertDimension("height", height);

  const dpr = spec.dpr ?? base?.devicePixelRatio ?? DEFAULTS.dpr;
  if (!Number.isFinite(dpr) || dpr <= 0 || dpr > 8) {
    throw new Error(`resolveSurface: dpr must be in (0, 8], got ${dpr}.`);
  }

  const fps = spec.fps ?? base?.fps ?? DEFAULTS.fps;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) {
    throw new Error(`resolveSurface: fps must be in (0, 120], got ${fps}.`);
  }

  const formats = spec.formats ?? base?.formats ?? DEFAULTS.formats;
  // An explicitly EMPTY list is legal: "encode no animation files" (audit-only
  // runs). Unknown names are still rejected.
  for (const f of formats) {
    if (f !== "gif" && f !== "webp" && f !== "apng") {
      throw new Error(`resolveSurface: unknown format '${f}'. Available: gif, webp, apng.`);
    }
  }

  const quality = spec.quality ?? base?.webpQuality ?? DEFAULTS.quality;
  if (!Number.isFinite(quality) || quality < 0 || quality > 100) {
    throw new Error(`resolveSurface: quality must be 0–100, got ${quality}.`);
  }

  const background = resolveBackground(spec.background);

  const customized =
    spec.width !== undefined || spec.height !== undefined || spec.dpr !== undefined ||
    spec.fps !== undefined || spec.formats !== undefined || spec.quality !== undefined ||
    spec.lossless !== undefined || spec.background !== undefined || spec.budgetBytes !== undefined;

  return {
    width,
    height,
    devicePixelRatio: dpr,
    fps,
    formats: [...formats],
    quality,
    lossless: spec.lossless ?? false,
    background,
    budgetBytes: spec.budgetBytes ?? base?.budgetBytes ?? DEFAULTS.budgetBytes,
    presetName: preset ? presetNameOf(base as BannerPreset) : "custom",
    customized,
  };
}

/** "transparent" (case-insensitive) and null both mean a transparent canvas.
 *  undefined keeps the caller's default (theme bg / none). */
export function resolveBackground(value: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string" && value.trim().toLowerCase() === "transparent") return null;
  return value;
}

/** Device-pixel dimensions (takumi width/height are DEVICE pixels — v0.1 lesson). */
export function deviceSize(surface: ResolvedSurface): { width: number; height: number } {
  return {
    width: Math.round(surface.width * surface.devicePixelRatio),
    height: Math.round(surface.height * surface.devicePixelRatio),
  };
}

function assertDimension(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`resolveSurface: ${name} must be a positive integer, got ${value}.`);
  }
  if (value > MAX_DIMENSION) {
    throw new Error(
      `resolveSurface: ${name} ${value} exceeds the ${MAX_DIMENSION}px ceiling ` +
      `(a ${MAX_DIMENSION}² RGBA frame is already ${(MAX_DIMENSION * MAX_DIMENSION * 4) / 1024 / 1024}MB).`,
    );
  }
}

function presetNameOf(preset: BannerPreset): string {
  for (const [name, p] of Object.entries(bannerPresets)) {
    if (p === preset) return name;
  }
  return "custom";
}
