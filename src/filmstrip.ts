// takumi-motion — filmstrip.ts (v0.6)
// Engine-exact preview: N stills from the ACTUAL Rust engine arranged on a
// self-contained contact-sheet HTML. This is the authoring loop's look — not
// the CSS-approximation player (preview.ts), which replays browser layout:
// every cell here is a byte of what the engine will actually produce.
//
//   { banner }           → one capture, chunk nodes parsed once, N renders
//   { html, css? }       → one parse, N renders across the timeline
//   { node, timeline }   → one compile, N renders across the timeline
//
// The HTML artifact is byte-deterministic (sorted frames, fixed labels,
// embedded data URIs) — diffable in review, stable in CI.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { fromHtml } from "@takumi-rs/helpers/html";
import type { Node } from "@takumi-rs/helpers";
import type { Renderer } from "takumi-js/node";
import { captureReactBanner } from "./react/capture.js";
import { compileTimeline, type CompiledTimeline } from "./compile.js";
import { resolveSurface, deviceSize, type SurfaceSpec, type ResolvedSurface } from "./surface.js";
import { parseFragment } from "./html-source.js";
import { ensureFonts, type FontFileSpec, type FontSpec } from "./fonts.js";
import { mapWithConcurrency, resolveConcurrency } from "./concurrency.js";
import { imageDataUri } from "./react/components.js";
import type { ReactElementLike, TimelineJSON } from "./types.js";

// ---------------------------------------------------------------------------
// Options / result
// ---------------------------------------------------------------------------

export interface RenderFilmstripOptions extends SurfaceSpec {
  /** React banner (element or defineBanner() component) — path 1. */
  banner?: unknown;
  preset?: string;
  /** Raw HTML fragment/document — path 2. */
  html?: string;
  css?: string | string[];
  /** Timeline span for the html path (no plan exists there). Default 1000ms. */
  durationMs?: number;
  /** Takumi node (or React-shaped element) + timeline — path 3. */
  node?: Node | ReactElementLike;
  timeline?: TimelineJSON;
  /** Explicit frame indexes. Default: derived from `count`. */
  frames?: number[];
  /** How many evenly-spaced frames (inclusive of 0 and last). Default 6. */
  count?: number;
  /** Contact-sheet columns. Default: ceil(√n). */
  columns?: number;
  /** Google Font specs (react/declarative paths). */
  fonts?: FontSpec[];
  /** Local/URL font files (html path). */
  fontFiles?: FontFileSpec[];
  /** Directory to write the HTML into. Omit → buffer only. */
  outDir?: string;
  /** Base file name (no extension). Default "filmstrip". */
  baseName?: string;
  /** Reuse a warm Renderer. Default: the shared template renderer. */
  renderer?: Renderer;
  /** Bounded parallelism for chunk parsing + frame renders. Default: cores. */
  concurrency?: number;
}

export interface FilmstripResult {
  source: "react" | "html" | "declarative";
  /** The rendered frames (sorted, deduped, in-grid order). */
  frames: number[];
  /** Timestamps per cell (ms on the timeline). */
  timeMs: number[];
  width: number;
  height: number;
  devicePixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  columns: number;
  rows: number;
  /** The self-contained contact-sheet HTML (deterministic bytes). */
  html: Buffer;
  /** Individual PNGs, in the same order as `frames`. */
  pngs: Buffer[];
  bytes: number;
  path: string | null;
}

// ---------------------------------------------------------------------------
// Frame selection
// ---------------------------------------------------------------------------

/** Evenly-spaced frames inclusive of 0 and last (float-dust hardened). */
export function evenFrames(count: number, totalFrames: number): number[] {
  const n = Math.max(1, Math.min(count, totalFrames));
  const last = totalFrames - 1;
  if (n === 1) return [0];
  const out = new Set<number>();
  for (let i = 0; i < n; i++) {
    // Math.round is deterministic (ties toward +∞) — the grid positions are
    // pure arithmetic on integers, no float dust to bias against.
    out.add(Math.round((last * i) / (n - 1)));
  }
  out.add(0);
  out.add(last);
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// renderFilmstrip
// ---------------------------------------------------------------------------

export async function renderFilmstrip(options: RenderFilmstripOptions): Promise<FilmstripResult> {
  const source: FilmstripResult["source"] =
    options.banner !== undefined ? "react" : options.html !== undefined ? "html" : "declarative";

  const concurrency = resolveConcurrency(options.concurrency);
  const renderer = options.renderer ?? (await defaultRenderer());

  let surface: ResolvedSurface;
  let frames: number[];
  let pngs: Buffer[];

  if (source === "react") {
    if (options.banner === undefined || options.banner === null) {
      throw new Error("renderFilmstrip: `banner` (a React element or defineBanner() component) is required.");
    }
    const capture = await captureReactBanner(options.banner as never, {
      ...(options.fps ? { fps: options.fps } : {}),
      ...(options.preset ? { preset: options.preset } : {}),
      ...(options.fonts ? { fonts: options.fonts } : {}),
    });
    const meta = capture.meta;
    const fps = meta.fps;
    const frameMs = capture.plan.frameMs;
    surface = resolveSurface(
      {
        ...(options.width !== undefined ? { width: options.width } : {}),
        ...(options.height !== undefined ? { height: options.height } : {}),
        ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
        fps,
        background: meta.background,
      },
      meta.preset,
    );
    if (meta.fonts.length > 0) await ensureFonts(renderer, meta.fonts);

    frames = resolveFrames(options, capture.plan.totalFrames);
    // Parse every chunk ONCE (bounded-parallel), render each frame from its chunk.
    const parsed = await mapWithConcurrency(capture.chunks, concurrency, (chunk) => fromHtml(chunk.html));
    const chunkNodes: Node[] = parsed.map((p) => p.node);
    const cssSet = new Map<string, string>();
    for (const p of parsed) for (const entry of p.css) if (!cssSet.has(entry)) cssSet.set(entry, entry);
    const css = [...cssSet.values()];
    const device = deviceSize(surface);

    const chunkFor = (frame: number): number => {
      for (let i = capture.chunks.length - 1; i >= 0; i--) {
        if (frame >= capture.chunks[i].startFrame) return i;
      }
      return 0;
    };
    const cells = await mapWithConcurrency(frames, concurrency, (frame) => {
      const ci = chunkFor(frame);
      const timeMs = Math.round((frame - capture.chunks[ci].startFrame) * frameMs * 1e3) / 1e3;
      return renderer.render(chunkNodes[ci] as never, {
        width: device.width,
        height: device.height,
        devicePixelRatio: surface.devicePixelRatio,
        format: "png",
        timeMs,
        ...(css.length > 0 ? { css: css as never } : {}),
      } as never) as Promise<Buffer>;
    });
    pngs = cells;
    return finalize(source, frames, frames.map((f) => Math.round(f * frameMs * 1e3) / 1e3), surface, pngs, options);
  }

  if (source === "html") {
    if (typeof options.html !== "string" || options.html.trim().length === 0) {
      throw new Error("renderFilmstrip: `html` (a non-empty HTML fragment string) is required.");
    }
    surface = resolveSurface({ ...options, background: options.background ?? null });
    const device = deviceSize(surface);
    const fps = surface.fps;
    const frameMs = 1000 / fps;

    const { node, css: hoisted } = await parseFragment(options.html);
    const cssSet = new Map<string, string>();
    for (const entry of [...hoisted, ...(Array.isArray(options.css) ? options.css : options.css ? [options.css] : [])]) {
      if (!cssSet.has(entry)) cssSet.set(entry, entry);
    }
    const css = [...cssSet.values()];
    if (options.fontFiles && options.fontFiles.length > 0) {
      const { loadFontFiles } = await import("./fonts.js");
      await loadFontFiles(renderer, options.fontFiles);
    }

    // HTML has no plan — the strip spans `durationMs` (default one second).
    const totalFrames = options.frames
      ? Math.max(...options.frames) + 1
      : Math.max(1, Math.round(((options.durationMs ?? 1000) / 1000) * fps));
    frames = resolveFrames(options, totalFrames);
    const cells = await mapWithConcurrency(frames, concurrency, (frame) => {
      const timeMs = Math.round(frame * frameMs * 1e3) / 1e3;
      return renderer.render(node as never, {
        width: device.width,
        height: device.height,
        devicePixelRatio: surface.devicePixelRatio,
        format: "png",
        timeMs,
        ...(css.length > 0 ? { css: css as never } : {}),
      } as never) as Promise<Buffer>;
    });
    pngs = cells;
    return finalize(source, frames, frames.map((f) => Math.round(f * frameMs * 1e3) / 1e3), surface, pngs, options);
  }

  // Declarative
  if (options.node === undefined || options.timeline === undefined) {
    throw new Error("renderFilmstrip: the declarative path needs `node` + `timeline`.");
  }
  surface = resolveSurface({
    ...(options.width !== undefined ? { width: options.width } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
    ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
    ...(options.fps !== undefined ? { fps: options.fps } : {}),
  });
  const device = deviceSize(surface);
  const fps = surface.fps;
  const frameMs = 1000 / fps;
  const node: Node = isReactShape(options.node) ? (await fromJsx(options.node as never)).node : options.node;
  const compiled: CompiledTimeline = compileTimeline(options.timeline, { fps });
  if (options.fonts && options.fonts.length > 0) await ensureFonts(renderer, options.fonts);

  const totalFrames = Math.max(1, Math.round((compiled.durationMs / 1000) * fps));
  frames = resolveFrames(options, totalFrames);
  const cells = await mapWithConcurrency(frames, concurrency, (frame) => {
    const timeMs = Math.round(frame * frameMs * 1e3) / 1e3;
    return renderer.render(node as never, {
      width: device.width,
      height: device.height,
      devicePixelRatio: surface.devicePixelRatio,
      format: "png",
      timeMs,
      css: compiled.css as never,
    } as never) as Promise<Buffer>;
  });
  pngs = cells;
  return finalize(source, frames, frames.map((f) => Math.round(f * frameMs * 1e3) / 1e3), surface, pngs, options);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveFrames(options: RenderFilmstripOptions, totalFrames: number): number[] {
  if (options.frames && options.frames.length > 0) {
    const sorted = [...new Set(options.frames)].sort((a, b) => a - b);
    for (const f of sorted) {
      if (!Number.isInteger(f) || f < 0 || f >= totalFrames) {
        throw new Error(`renderFilmstrip: frame ${f} outside the timeline (0..${totalFrames - 1}).`);
      }
    }
    return sorted;
  }
  return evenFrames(options.count ?? 6, totalFrames);
}

function isReactShape(n: unknown): n is ReactElementLike {
  return typeof n === "object" && n !== null && "props" in (n as object) && "type" in (n as object);
}

function finalize(
  source: FilmstripResult["source"],
  frames: number[],
  timeMs: number[],
  surface: ResolvedSurface,
  pngs: Buffer[],
  options: RenderFilmstripOptions,
): FilmstripResult {
  const device = deviceSize(surface);
  const columns = options.columns ?? Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);
  const html = contactSheet({ frames, timeMs, pngs, columns, device: { width: device.width, height: device.height } });

  let path: string | null = null;
  if (options.outDir) {
    const outDir = resolve(options.outDir);
    mkdirSync(outDir, { recursive: true });
    path = join(outDir, `${options.baseName ?? "filmstrip"}.html`);
    writeFileSync(path, html);
  }

  return {
    source,
    frames,
    timeMs,
    width: surface.width,
    height: surface.height,
    devicePixelRatio: surface.devicePixelRatio,
    physicalWidth: device.width,
    physicalHeight: device.height,
    columns,
    rows,
    html,
    pngs,
    bytes: html.length,
    path,
  };
}

/**
 * Deterministic contact sheet: fixed structure, sorted frames, base64 PNGs,
 * no JS, no clock, no locale-dependent formatting.
 */
function contactSheet(args: {
  frames: number[];
  timeMs: number[];
  pngs: Buffer[];
  columns: number;
  device: { width: number; height: number };
}): Buffer {
  const { frames, timeMs, pngs, columns, device } = args;
  const cells = frames
    .map((frame, i) => {
      const uri = `data:image/png;base64,${pngs[i].toString("base64")}`;
      return (
        `<figure><img src="${uri}" width="${device.width}" height="${device.height}" alt="frame ${frame}"/>` +
        `<figcaption>frame ${frame} &middot; ${timeMs[i]}ms</figcaption></figure>`
      );
    })
    .join("\n");
  const doc =
    `<!doctype html>\n<!-- takumi-motion filmstrip — engine-exact stills, deterministic artifact -->\n` +
    `<title>takumi-motion filmstrip</title>\n` +
    `<style>body{background:#0b1220;color:#94a3b8;font:13px/1.4 monospace;margin:24px}` +
    `main{display:grid;grid-template-columns:repeat(${columns},1fr);gap:16px}` +
    `img{width:100%;height:auto;display:block;background:#111827;border-radius:6px}` +
    `figure{margin:0}figcaption{padding:6px 2px;font-size:11px;color:#64748b}</style>\n` +
    `<main>\n${cells}\n</main>\n`;
  return Buffer.from(doc, "utf8");
}

async function defaultRenderer(): Promise<Renderer> {
  const shared = await import("./templates/shared.js");
  return shared.getSharedRenderer();
}

// Image helper re-export for one-stop imports.
export { imageDataUri };
