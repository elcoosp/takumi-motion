// takumi-motion — measure.ts (v0.6)
// Measure-exact text fitting, promoted from templates/shared.ts to a
// first-class module (the templates now re-export from here).
//
// v0.6 adds the SYNC fit cache: React components render inside
// renderToStaticMarkup, which cannot await takumi's async measure(). The
// capture runtime solves this with a prewarm pass — <FitText> registers its
// measurement requests during the probe phase (fit requests land in the
// DriverRegistry), captureReactBanner resolves them all in one async step,
// and the frame phase reads the cache synchronously. Exact measure, zero
// guessing, no async-in-render.

import type { Renderer } from "takumi-js/node";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { h } from "./jsx.js";

// ---------------------------------------------------------------------------
// Shared renderer + text measurement (moved from templates/shared.ts)
// ---------------------------------------------------------------------------

let sharedRenderer: Renderer | null = null;
let sharedRendererPromise: Promise<Renderer> | null = null;

/** Lazily-created Renderer used for measure-based text fitting. renderBanner
 *  and the capture runtime default to this same instance, so fonts registered
 *  for measurement are the faces that render. */
export async function getSharedRenderer(): Promise<Renderer> {
  if (!sharedRenderer) {
    sharedRendererPromise ??= import("takumi-js/node").then(({ Renderer: R }) => {
      sharedRenderer ??= new R();
      return sharedRenderer;
    });
    return sharedRendererPromise;
  }
  return sharedRenderer;
}

/** Test seam. */
export function setSharedRenderer(r: Renderer | null): void {
  sharedRenderer = r;
  sharedRendererPromise = null;
  fitCache.clear();
}

const measureCache = new Map<string, number>();

/** Reset the measure caches (test seam; also used when fonts change). */
export function clearMeasureCache(): void {
  measureCache.clear();
  fitCache.clear();
}

/**
 * Exact laid-out width (CSS px) of a text run at the given typography.
 * Uses takumi's layout engine — no font-metric guessing.
 */
export async function measureTextWidth(
  renderer: Renderer,
  text: string,
  opts: { fontSize: number; fontWeight?: number; letterSpacing?: number; fontFamily?: string }
): Promise<number> {
  const key = `${text}\u0000${opts.fontSize}\u0000${opts.fontWeight ?? 400}\u0000${opts.letterSpacing ?? 0}\u0000${opts.fontFamily ?? ""}`;
  const cached = measureCache.get(key);
  if (cached !== undefined) return cached;

  const el = h("div", {
    style: {
      fontSize: opts.fontSize,
      fontWeight: opts.fontWeight ?? 400,
      letterSpacing: opts.letterSpacing ?? 0,
      ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
      whiteSpace: "pre",
      color: "#000",
      position: "absolute",
    },
    children: text,
  });
  const { node } = await fromJsx(el as never);
  // Generous viewport; the run width is what matters, not the node box.
  const measured = await renderer.measure(node, { width: 8192, height: 1024 });
  const run = measured.runs[0];
  const width = run ? run.width : measured.width;
  measureCache.set(key, width);
  return width;
}

export interface FitTextOptions {
  text: string;
  /** The laid-out width the text must fit inside (CSS px). */
  maxWidth: number;
  fontWeight?: number;
  letterSpacing?: number;
  fontFamily?: string;
  /** Largest allowed font size. Default 64. */
  max?: number;
  /** Smallest allowed font size. Default 18. */
  min?: number;
  /** Safety margin fraction of maxWidth. Default 0.985. */
  pad?: number;
  renderer?: Renderer;
}

// ---------------------------------------------------------------------------
// v0.6 — the synchronous fit cache
// ---------------------------------------------------------------------------

/** One pending <FitText> measurement request. */
export interface FitRequest {
  text: string;
  maxWidth: number;
  fontWeight: number;
  letterSpacing: number;
  fontFamily?: string;
  max: number;
  min: number;
  pad: number;
}

/** Cache key for a fit request (also the FitText component's identity). */
export function fitKey(req: Omit<FitRequest, "max" | "min" | "pad">): string {
  return `${req.text}\u0000${req.maxWidth}\u0000${req.fontWeight}\u0000${req.letterSpacing}\u0000${req.fontFamily ?? ""}`;
}

const fitCache = new Map<string, number>();

/**
 * Async: compute and store fit sizes for a batch of requests (the capture
 * prewarm pass). Uses fitFontSize's two-measure exact algorithm.
 */
export async function resolveFitRequests(requests: Iterable<FitRequest>, renderer?: Renderer): Promise<void> {
  const r = renderer ?? (await getSharedRenderer());
  for (const req of requests) {
    const key = fitKey(req);
    if (fitCache.has(key)) continue;
    const size = await fitFontSize({
      text: req.text,
      maxWidth: req.maxWidth,
      fontWeight: req.fontWeight,
      letterSpacing: req.letterSpacing,
      ...(req.fontFamily ? { fontFamily: req.fontFamily } : {}),
      max: req.max,
      min: req.min,
      pad: req.pad,
      renderer: r,
    });
    fitCache.set(key, size);
  }
}

/**
 * Sync: read a prewarmed fit size. Returns null when the cache is cold —
 * the caller (<FitText>) falls back to `max` and emits TM_FITTEXT_UNMEASURED.
 */
export function fitFontSizeCached(req: Omit<FitRequest, "max" | "min" | "pad">): number | null {
  return fitCache.get(fitKey(req)) ?? null;
}

/** Test seam: inspect the cache. */
export function fitCacheSize(): number {
  return fitCache.size;
}

// ---------------------------------------------------------------------------
// The two-measure exact fit (moved from templates/shared.ts verbatim)
// ---------------------------------------------------------------------------

/**
 * Largest integer font size ≤ max whose measured text width fits maxWidth.
 * Text width is linear in font size for a fixed typeface, so we measure once
 * at `max`, scale, then re-measure once to correct for rounding — exact fit
 * in two measure calls.
 */
export async function fitFontSize(opts: FitTextOptions): Promise<number> {
  const max = opts.max ?? 64;
  const min = opts.min ?? 18;
  const pad = opts.pad ?? 0.985;
  const weight = opts.fontWeight ?? 400;
  const ls = opts.letterSpacing ?? 0;
  const budget = opts.maxWidth * pad;

  const renderer = opts.renderer ?? (await getSharedRenderer());
  const measure = (size: number) =>
    measureTextWidth(renderer, opts.text, {
      fontSize: size, fontWeight: weight, letterSpacing: ls,
      ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
    });

  const widthAtMax = await measure(max);
  if (widthAtMax <= budget) return max;

  const estimate = (max * budget) / widthAtMax;
  const candidate = Math.max(min, Math.floor(estimate));
  if (candidate <= min) return min;

  const widthAtCandidate = await measure(candidate);
  if (widthAtCandidate <= budget) return candidate;
  // Rounding pushed it over — scale down once more from the measured truth.
  return Math.max(min, Math.floor((candidate * budget) / widthAtCandidate));
}
