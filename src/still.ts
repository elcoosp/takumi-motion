// takumi-motion — still.ts (v0.5)
// renderStill() — the single-frame path as a first-class API.
//
// OG images, cards, posters: the degenerate animation (one frame) is the
// most-requested companion output for an animation engine. This is the
// Remotion `renderStill` equivalent over ALL three source paths:
//
//   { banner }                    → React runtime (capture once, render the frame)
//   { html, css? }                → raw HTML at timeMs = frame × frameMs
//   { node, timeline }            → declarative timeline sampled at timeMs
//
// The react still is byte-identical to the pipeline's poster for the same
// frame (same chunk node, same css union, same device surface) — golden-tested.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { fromHtml } from "@takumi-rs/helpers/html";
import type { Node } from "@takumi-rs/helpers";
import type { Renderer } from "takumi-js/node";
import { captureReactBanner } from "./react/capture.js";
import { compileTimeline, type CompiledTimeline } from "./compile.js";
import {
  resolveSurface,
  deviceSize,
  type SurfaceSpec,
  type ResolvedSurface,
} from "./surface.js";
import { parseFragment } from "./html-source.js";
import {
  ensureFonts,
  loadFontFiles,
  type FontFileSpec,
  type FontFileResult,
  type FontLoadResult,
  type FontSpec,
} from "./fonts.js";
import { mapWithConcurrency, resolveConcurrency } from "./concurrency.js";
import { toEngineMs } from "./engine-time.js";
import { chunkIndexForFrame } from "./chunk-index.js";
import type { ReactElementLike, TimelineJSON } from "./types.js";

// ---------------------------------------------------------------------------
// Options / result
// ---------------------------------------------------------------------------

export interface RenderStillOptions extends SurfaceSpec {
  /** React banner (element or defineBanner() component) — path 1. */
  banner?: unknown;
  /** v0.9 Bet A — data object for the banner's data channel (useChartData). */
  data?: unknown;
  /** Preset for the React path when the banner doesn't declare one. */
  preset?: string;
  /** Raw HTML fragment/document — path 2. */
  html?: string;
  /** Stylesheets for the html path (style rules + @keyframes). */
  css?: string | string[];
  /** Takumi node (or React-shaped element — fromJsx runs automatically)
   *  plus its authored timeline — path 3. */
  node?: Node | ReactElementLike;
  timeline?: TimelineJSON;
  /** Frame on the timeline. React: global frame index. html/declarative:
   *  frame × frameMs → timeMs. Default: the settled 60%-frame (react) or
   *  frame 0 (html/declarative). */
  frame?: number;
  /** Google Font specs (css2 pipeline). */
  fonts?: FontSpec[];
  /** Local/URL font files (TTF/OTF) registered directly. */
  fontFiles?: FontFileSpec[];
  /** Directory to write the PNG into. Omit to receive the buffer only. */
  outDir?: string;
  /** Base file name (no extension). Default "still". */
  baseName?: string;
  /** Reuse a warm Renderer. Default: the shared template renderer. */
  renderer?: Renderer;
  /** Bounded parallelism for the React path's chunk parsing. Default: cores. */
  concurrency?: number;
}

export interface StillResult {
  source: "react" | "html" | "declarative";
  /** The rendered frame (resolved default when omitted). */
  frame: number;
  /** The timeline position the frame maps to (ms). */
  timeMs: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  background: string | null | undefined;
  png: Buffer;
  bytes: number;
  ms: number;
  path: string | null;
}

// ---------------------------------------------------------------------------
// renderStill
// ---------------------------------------------------------------------------

export async function renderStill(options: RenderStillOptions): Promise<StillResult> {
  const source: StillResult["source"] =
    options.banner !== undefined ? "react" : options.html !== undefined ? "html" : "declarative";

  if (source === "react") return renderReactStill(options);
  if (source === "html") return renderHtmlStill(options);
  return renderDeclarativeStill(options);
}

// ---------------------------------------------------------------------------
// React path
// ---------------------------------------------------------------------------

async function renderReactStill(options: RenderStillOptions): Promise<StillResult> {
  if (options.banner === undefined || options.banner === null) {
    throw new Error("renderStill: `banner` (a React element or defineBanner() component) is required.");
  }
  const t0 = performance.now();

  const capture = await captureReactBanner(options.banner as never, {
    ...(options.fps ? { fps: options.fps } : {}),
    ...(options.preset ? { preset: options.preset } : {}),
    ...(options.fonts ? { fonts: options.fonts } : {}),
    ...(options.data !== undefined ? { data: options.data } : {}),
  });
  const meta = capture.meta;
  const fps = meta.fps;
  const frameMs = capture.plan.frameMs;

  const frame = options.frame ?? Math.min(capture.plan.totalFrames - 1, Math.round(capture.plan.totalFrames * 0.6));
  if (!Number.isInteger(frame) || frame < 0 || frame >= capture.plan.totalFrames) {
    throw new Error(
      `renderStill: frame ${frame} outside the banner timeline (0..${capture.plan.totalFrames - 1}).`,
    );
  }

  const surface: ResolvedSurface = resolveSurface(
    {
      ...(options.width !== undefined ? { width: options.width } : {}),
      ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
      fps,
      ...(options.quality !== undefined ? { quality: options.quality } : {}),
      ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
      ...(options.budgetBytes !== undefined ? { budgetBytes: options.budgetBytes } : {}),
      background: meta.background,
    },
    meta.preset,
  );
  const device = deviceSize(surface);

  const renderer = options.renderer ?? (await defaultRenderer());
  let fontResult: FontLoadResult | null = null;
  if (meta.fonts.length > 0) fontResult = await ensureFonts(renderer, meta.fonts);
  void fontResult;

  // Parse every chunk (bounded-parallel) — the css UNION matches the
  // pipeline's poster rendering exactly, so stills are byte-identical.
  const parsed = await mapWithConcurrency(capture.chunks, resolveConcurrency(options.concurrency), (chunk) =>
    fromHtml(chunk.html),
  );
  const chunkNodes: Node[] = parsed.map((p) => p.node);
  const cssSet = new Map<string, string>();
  for (const p of parsed) for (const entry of p.css) if (!cssSet.has(entry)) cssSet.set(entry, entry);
  const css = [...cssSet.values()];

  const chunkIndex = chunkIndexForFrame(capture.chunks, frame);
  // Whole-ms grid — the engine's napi layer takes i64 milliseconds.
  const timeMs = toEngineMs((frame - capture.chunks[chunkIndex].startFrame) * frameMs);

  const png = await renderer.render(chunkNodes[chunkIndex] as never, {
    width: device.width,
    height: device.height,
    devicePixelRatio: surface.devicePixelRatio,
    format: "png",
    timeMs,
    ...(css.length > 0 ? { css: css as never } : {}),
  } as never);

  return finalize({
    options,
    result: {
      source: "react",
      frame,
      timeMs,
      background: surface.background,
      png,
      ms: performance.now() - t0,
    },
    surface,
  });
}

// ---------------------------------------------------------------------------
// HTML path
// ---------------------------------------------------------------------------

async function renderHtmlStill(options: RenderStillOptions): Promise<StillResult> {
  if (typeof options.html !== "string" || options.html.trim().length === 0) {
    throw new Error("renderStill: `html` (a non-empty HTML fragment string) is required.");
  }
  const t0 = performance.now();

  const surface = resolveSurface({ ...options, background: options.background ?? null });
  const device = deviceSize(surface);
  const frameMs = 1000 / surface.fps;

  const frame = options.frame ?? 0;
  if (!Number.isInteger(frame) || frame < 0) {
    throw new Error(`renderStill: frame must be a non-negative integer, got ${frame}.`);
  }
  // Whole-ms grid — frame × frameMs accumulates float dust (15 ×
  // 1000/30 = 500.00000000000006) that would leak into reports/manifests.
  const timeMs = toEngineMs(frame * frameMs);

  const { node, css: hoisted } = await parseFragment(options.html);
  const cssSet = new Map<string, string>();
  for (const entry of [...hoisted, ...(Array.isArray(options.css) ? options.css : options.css ? [options.css] : [])]) {
    if (!cssSet.has(entry)) cssSet.set(entry, entry);
  }
  const css = [...cssSet.values()];

  const renderer = options.renderer ?? (await defaultRenderer());
  if (options.fonts && options.fonts.length > 0) await ensureFonts(renderer, options.fonts);
  let fontFileResult: FontFileResult | null = null;
  if (options.fontFiles && options.fontFiles.length > 0) {
    fontFileResult = await loadFontFiles(renderer, options.fontFiles);
  }
  void fontFileResult;

  const png = await renderer.render(node as never, {
    width: device.width,
    height: device.height,
    devicePixelRatio: surface.devicePixelRatio,
    format: "png",
    timeMs,
    ...(css.length > 0 ? { css: css as never } : {}),
  } as never);

  return finalize({
    options,
    result: {
      source: "html",
      frame,
      timeMs,
      background: surface.background,
      png,
      ms: performance.now() - t0,
    },
    surface,
  });
}

// ---------------------------------------------------------------------------
// Declarative path
// ---------------------------------------------------------------------------

const isReactShape = (n: unknown): n is ReactElementLike =>
  typeof n === "object" && n !== null && "props" in (n as object) && "type" in (n as object);

async function renderDeclarativeStill(options: RenderStillOptions): Promise<StillResult> {
  if (options.node === undefined || options.timeline === undefined) {
    throw new Error("renderStill: the declarative path needs `node` + `timeline`.");
  }
  const t0 = performance.now();

  const surface = resolveSurface(
    {
      ...(options.width !== undefined ? { width: options.width } : {}),
      ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
      ...(options.fps !== undefined ? { fps: options.fps } : {}),
      ...(options.quality !== undefined ? { quality: options.quality } : {}),
      ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
      ...(options.budgetBytes !== undefined ? { budgetBytes: options.budgetBytes } : {}),
    },
    options.preset ?? "readme",
  );
  const device = deviceSize(surface);
  const fps = surface.fps;
  const frameMs = 1000 / fps;

  const node: Node = isReactShape(options.node) ? (await fromJsx(options.node as never)).node : options.node;
  const compiled: CompiledTimeline = compileTimeline(options.timeline, { fps });
  const totalFrames = Math.max(1, Math.round((compiled.durationMs / 1000) * fps));

  const frame = options.frame ?? Math.min(totalFrames - 1, Math.round(totalFrames * 0.6));
  if (!Number.isInteger(frame) || frame < 0 || frame >= totalFrames) {
    throw new Error(`renderStill: frame ${frame} outside the timeline (0..${totalFrames - 1}).`);
  }
  const timeMs = toEngineMs(frame * frameMs);

  const renderer = options.renderer ?? (await defaultRenderer());
  if (options.fonts && options.fonts.length > 0) await ensureFonts(renderer, options.fonts);

  const png = await renderer.render(node as never, {
    width: device.width,
    height: device.height,
    devicePixelRatio: surface.devicePixelRatio,
    format: "png",
    timeMs,
    css: compiled.css as never,
  } as never);

  return finalize({
    options,
    result: {
      source: "declarative",
      frame,
      timeMs,
      background: surface.background,
      png,
      ms: performance.now() - t0,
    },
    surface,
  });
}

// ---------------------------------------------------------------------------
// Shared finalize
// ---------------------------------------------------------------------------

function finalize(args: {
  options: RenderStillOptions;
  result: Omit<StillResult, "width" | "height" | "devicePixelRatio" | "physicalWidth" | "physicalHeight" | "png" | "bytes" | "path"> & { png: Buffer };
  surface: ResolvedSurface;
}): StillResult {
  const { options, result, surface } = args;
  const device = deviceSize(surface);

  let path: string | null = null;
  if (options.outDir) {
    const outDir = resolve(options.outDir);
    mkdirSync(outDir, { recursive: true });
    path = join(outDir, `${options.baseName ?? "still"}.png`);
    writeFileSync(path, result.png);
  }

  return {
    ...result,
    width: surface.width,
    height: surface.height,
    devicePixelRatio: surface.devicePixelRatio,
    physicalWidth: device.width,
    physicalHeight: device.height,
    png: result.png,
    bytes: result.png.length,
    path,
  };
}

async function defaultRenderer(): Promise<Renderer> {
  const shared = await import("./templates/shared.js");
  return shared.getSharedRenderer();
}
