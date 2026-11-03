// takumi-motion — react/components.tsx (v0.6)
// The content-component layer: positioning, images, and measure-exact text.
//
// These are RUNTIME components — they render inside <Scene> (FrameContext) or
// standalone inside the capture tree, complementing the structural vocabulary
// (Banner/Scene/Layer/Sequence/Series/Loop) which stays deliberately minimal.
//
//   <Fill>     absolute inset-0 container — the AbsoluteFill convenience
//   <Img>      images with sync Buffer→dataURI conversion (server-safe)
//   <FitText>  measure-exact auto-fitting text (prewarmed fit cache)

import { createElement, type ReactNode } from "react";
import { DriverContext, useDriver, type DriverRegistry } from "./context.js";
import { fitFontSizeCached, type FitRequest } from "../measure.js";
import type { LintWarning } from "../lint.js";
import type { TakumiStyle } from "../style.js";

// ---------------------------------------------------------------------------
// <Fill>
// ---------------------------------------------------------------------------

export interface FillProps {
  /** Merged over the default absolute-inset-0 style. camelCase keys. */
  style?: TakumiStyle;
  children?: ReactNode;
}

/**
 * Full-canvas absolute container — takumi-motion's AbsoluteFill. The canvas
 * root is position:relative, so a <Fill> anchors to it:
 *
 * ```tsx
 * <Scene duration={60}>
 *   <Fill style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
 *     …content…
 *   </Fill>
 * </Scene>
 * ```
 */
export function Fill(props: FillProps): ReactNode {
  return createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // takumi's layout applies align-items/justify-content only under an
      // explicit flex display — a Fill is a centering container by default.
      display: "flex",
      ...(props.style ?? {}),
    },
  }, props.children);
}

// ---------------------------------------------------------------------------
// <Img> + image helpers
// ---------------------------------------------------------------------------

export interface ImgProps {
  /** Image source: a data: URI, an https? URL takumi can fetch, or a Buffer
   *  (converted to a data: URI synchronously — the server-safe path). */
  src: string | Buffer;
  /** MIME type for Buffer sources. Default "image/png". */
  mime?: string;
  width?: number;
  height?: number;
  style?: TakumiStyle;
  alt?: string;
}

/** Buffer → data: URI (sync — base64 conversion is pure CPU). */
export function imageDataUri(buffer: Buffer, mime = "image/png"): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

/**
 * Async helper for file/URL sources: read a local file or fetch a URL and
 * return a data: URI. Use it OUTSIDE the component tree (before capture) and
 * pass the result as `src` — keeps render a pure function of props.
 *
 * ```tsx
 * const logo = await imageDataUriFromFile("assets/logo.png");
 * <Img src={logo} width={64} height={64} />
 * ```
 */
export async function imageDataUriFromFile(pathOrUrl: string, mime?: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  if (/^https?:\/\//.test(pathOrUrl)) {
    const res = await fetch(pathOrUrl);
    if (!res.ok) throw new Error(`imageDataUriFromFile: fetch failed for ${pathOrUrl} (${res.status}).`);
    const type = mime ?? res.headers.get("content-type") ?? "image/png";
    return imageDataUri(Buffer.from(await res.arrayBuffer()), type.split(";")[0]);
  }
  const buffer = await readFile(pathOrUrl);
  return imageDataUri(buffer, mime);
}

/**
 * Declarative image. Buffers are inlined as data: URIs at render time; the
 * deterministic path is to pre-resolve files with imageDataUriFromFile() and
 * pass the URI string (render stays a pure function of props).
 */
export function Img(props: ImgProps): ReactNode {
  const src = typeof props.src === "string" ? props.src : imageDataUri(props.src, props.mime);
  return createElement("img", {
    src,
    ...(props.width !== undefined ? { width: props.width } : {}),
    ...(props.height !== undefined ? { height: props.height } : {}),
    ...(props.alt !== undefined ? { alt: props.alt } : {}),
    style: props.style,
  });
}

// ---------------------------------------------------------------------------
// <FitText>
// ---------------------------------------------------------------------------

export interface FitTextProps {
  /** The text to fit (rendered as a single run — use SplitText for per-unit animation). */
  text: string;
  /** Width budget in CSS px. Default: the banner's canvas width minus 2×16px padding. */
  maxWidth?: number;
  fontWeight?: number;
  letterSpacing?: number;
  /** Font family override (must be registered via <Banner fonts> to measure truly). */
  fontFamily?: string;
  /** Largest font size. Default 64. */
  max?: number;
  /** Smallest font size. Default 18. */
  min?: number;
  /** Safety margin fraction of maxWidth. Default 0.985. */
  pad?: number;
  style?: TakumiStyle;
}

const FIT_DEFAULTS = { max: 64, min: 18, pad: 0.985, fontWeight: 400, letterSpacing: 0 };

function fitRequestOf(props: FitTextProps, canvasWidth: number): FitRequest {
  return {
    text: props.text,
    maxWidth: props.maxWidth ?? canvasWidth - 32,
    fontWeight: props.fontWeight ?? FIT_DEFAULTS.fontWeight,
    letterSpacing: props.letterSpacing ?? FIT_DEFAULTS.letterSpacing,
    ...(props.fontFamily ? { fontFamily: props.fontFamily } : {}),
    max: props.max ?? FIT_DEFAULTS.max,
    min: props.min ?? FIT_DEFAULTS.min,
    pad: props.pad ?? FIT_DEFAULTS.pad,
  };
}

/**
 * Measure-exact auto-fitting text: the largest font size (≤ max) whose
 * takumi-measured width fits maxWidth. Overflow becomes impossible by
 * construction — no guessing, no CSS tricks.
 *
 * Measurement is ASYNC in takumi, but React render is sync — so the capture
 * runtime prewarms the fit cache: during the probe phase FitText registers
 * its request, captureReactBanner resolves all registered requests in one
 * async step (with the banner's fonts loaded), and the frame phase reads
 * sizes synchronously. Rendered OUTSIDE the runtime (plain renderToString),
 * FitText falls back to `max` and emits TM_FITTEXT_UNMEASURED.
 */
export function FitText(props: FitTextProps): ReactNode {
  const driver = useDriver();
  const canvasWidth = driver.registry.banner?.width ?? 850;
  const request = fitRequestOf(props, canvasWidth);

  if (driver.phase === "probe") {
    registerFitRequest(driver.registry, request);
    return createElement("div", { style: { fontSize: request.max, visibility: "hidden" } }, props.text);
  }

  const size = fitFontSizeCached(request);
  if (size === null) {
    // Cold cache — register for the next prewarm sweep and render the max
    // fallback WITHOUT warning: the capture runtime sweeps scenes, resolves
    // the batch, then re-renders; only requests still cold after the REAL
    // frame loop become TM_FITTEXT_UNMEASURED (capture adds them).
    registerFitRequest(driver.registry, request);
    return createElement("div", {
      style: { fontSize: request.max, whiteSpace: "pre", ...(props.style ?? {}) },
    }, props.text);
  }

  return createElement("div", {
    style: {
      fontSize: size,
      fontWeight: request.fontWeight,
      letterSpacing: request.letterSpacing || undefined,
      ...(request.fontFamily ? { fontFamily: request.fontFamily } : {}),
      whiteSpace: "pre",
      lineHeight: 1.2,
      ...(props.style ?? {}),
    },
  }, props.text);
}

// ---------------------------------------------------------------------------
// Fit-request plumbing (probe → prewarm → frame), via DriverRegistry
// ---------------------------------------------------------------------------

function registerFitRequest(registry: DriverRegistry, request: FitRequest): void {
  const store = registry as { fitRequests?: FitRequest[]; fitKeys?: Set<string> };
  store.fitRequests ??= [];
  store.fitKeys ??= new Set<string>();
  const key = `${request.text}\u0000${request.maxWidth}\u0000${request.fontWeight}\u0000${request.letterSpacing}\u0000${request.fontFamily ?? ""}`;
  if (store.fitKeys.has(key)) return;
  store.fitKeys.add(key);
  store.fitRequests.push(request);
}

/** Registry access for the capture prewarm (internal — exported for tests). */
export function takeFitRequests(registry: DriverRegistry): FitRequest[] {
  const requests = (registry as { fitRequests?: FitRequest[] }).fitRequests ?? [];
  return requests;
}

/**
 * Post-frame-loop check: fit requests that are STILL cold after the capture
 * prewarm ran (i.e. rendered outside the runtime) become TM_FITTEXT_UNMEASURED.
 * Exported for capture.ts — one warning per unique request.
 */
export function unmeasuredFitWarnings(registry: DriverRegistry): LintWarning[] {
  const requests = takeFitRequests(registry);
  const cold = requests.filter((req) => fitFontSizeCached(req) === null);
  if (cold.length === 0) return [];
  return cold.map((req) => ({
    code: "TM_FITTEXT_UNMEASURED" as const,
    message: `<FitText> rendered "${req.text.slice(0, 40)}${req.text.length > 40 ? "…" : ""}" without a prewarmed measurement — fell back to ${req.max}px.`,
    hint: "Render through captureReactBanner/renderReactBanner/CLI (the prewarm pass runs there), or precompute with fitFontSize().",
    severity: "warn" as const,
  }));
}

/** Re-export so capture.ts doesn't import React internals directly. */
export { DriverContext };
