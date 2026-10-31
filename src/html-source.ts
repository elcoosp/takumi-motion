// takumi-motion — html-source.ts (v0.4)
// Raw HTML + CSS string input — the no-React path into the engine.
//
//   renderHtmlAnimation({ html: "<div …>…</div>", css: ["@keyframes …"], … })
//
// takumi's fromHtml parses fragments (style attributes, className, nested
// tags); css strings are passed straight through as takumi CssSource (style
// rules + @keyframes both work). The engine stays a pure
// (input, output-spec) → file function: any dimensions, fps, duration,
// formats — zero banner assumptions.
//
// Pragmatics (documented behavior):
//   • A full document (<!doctype>/<html>/<body>) has its <body> innerHTML
//     extracted — deterministic regex on the user's own markup.
//   • <style> blocks inside the fragment are HOISTED into the css union and
//     stripped from the node (keeps takumi's tree clean, keeps css deduped).

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromHtml } from "@takumi-rs/helpers/html";
import type { Node } from "@takumi-rs/helpers";
import type { Renderer } from "takumi-js/node";
import {
  resolveSurface,
  deviceSize,
  type SurfaceSpec,
  type ResolvedSurface,
} from "./surface.js";
import { formatBytes } from "./presets.js";
import { collapseGifHolds, gifStats } from "./size.js";
import { ensureFonts, loadFontFiles, type FontLoadResult, type FontFileSpec, type FontFileResult, type FontSpec } from "./fonts.js";

export interface RenderHtmlOptions extends SurfaceSpec {
  /** HTML fragment (or a full document — the body is extracted). */
  html: string;
  /** Stylesheet strings (style rules + @keyframes). Passed as takumi CssSource. */
  css?: string | string[];
  /** Directory to write files into. Omit to receive buffers only. */
  outDir?: string;
  /** Base file name. Default "animation". */
  baseName?: string;
  /** Animation duration in FRAMES (frames = duration). Default 30. */
  frames?: number;
  /** Poster PNG timestamps in ms. Default: one at 60% of the duration. `false` disables. */
  posters?: number[] | false;
  /** Reuse a warm Renderer. Default: the shared template renderer. */
  renderer?: Renderer;
  /** Google Font specs (css2 pipeline). */
  fonts?: FontSpec[];
  /** Local/URL font files (TTF/OTF) registered directly. */
  fontFiles?: FontFileSpec[];
  /** Set false to skip GIF hold collapsing. Default true. */
  collapseGifHolds?: boolean;
}

export interface HtmlRenderedFile {
  path: string | null;
  format: string;
  bytes: number;
  ms: number;
  withinBudget: boolean;
  frames: number | null;
  buffer: Buffer;
}

export interface HtmlSourceReport {
  surface: SurfaceReportBlock;
  frames: number;
  durationMs: number;
  cssEntries: number;
  styleBlocksHoisted: number;
  files: HtmlRenderedFile[];
  posters: Array<{ path: string | null; timeMs: number; bytes: number; buffer: Buffer }>;
  fonts: FontLoadResult | null;
  fontFiles: FontFileResult | null;
  totalBytes: number;
  budgetBytes: number;
  overBudget: boolean;
  warnings: string[];
  collapse: { framesBefore: number; framesAfter: number } | null;
}

export interface SurfaceReportBlock {
  width: number;
  height: number;
  devicePixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  fps: number;
  background: string | null | undefined;
  presetName: string;
  customized: boolean;
}

export function toSurfaceBlock(surface: ResolvedSurface): SurfaceReportBlock {
  const device = deviceSize(surface);
  return {
    width: surface.width,
    height: surface.height,
    devicePixelRatio: surface.devicePixelRatio,
    physicalWidth: device.width,
    physicalHeight: device.height,
    fps: surface.fps,
    background: surface.background,
    presetName: surface.presetName,
    customized: surface.customized,
  };
}

/** Render a raw HTML + CSS string animation. The no-React engine entry. */
export async function renderHtmlAnimation(options: RenderHtmlOptions): Promise<HtmlSourceReport> {
  if (typeof options.html !== "string" || options.html.trim().length === 0) {
    throw new Error("renderHtmlAnimation: `html` (a non-empty HTML fragment string) is required.");
  }

  const surface = resolveSurface(
    { ...options, background: options.background ?? null },
    // No preset — the html path is fully user-specified. Width/height REQUIRED.
  );
  const device = deviceSize(surface);
  const warnings: string[] = [];

  const { node, css: hoisted, styleBlocks } = await parseFragment(options.html);
  const cssSet = new Map<string, string>();
  for (const entry of [...(hoisted), ...(Array.isArray(options.css) ? options.css : options.css ? [options.css] : [])]) {
    if (!cssSet.has(entry)) cssSet.set(entry, entry);
  }
  const css = [...cssSet.values()];

  const renderer = options.renderer ?? (await defaultRenderer());

  let fontResult: FontLoadResult | null = null;
  if (options.fonts && options.fonts.length > 0) {
    fontResult = await ensureFonts(renderer, options.fonts);
  }
  let fontFileResult: FontFileResult | null = null;
  if (options.fontFiles && options.fontFiles.length > 0) {
    fontFileResult = await loadFontFiles(renderer, options.fontFiles);
  }

  const frames = options.frames ?? 30;
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error(`renderHtmlAnimation: frames must be a positive integer, got ${frames}.`);
  }
  const frameMs = 1000 / surface.fps;
  const durationMs = frames * frameMs;

  // --- Encode ---------------------------------------------------------------
  const files: HtmlRenderedFile[] = [];
  let collapse: HtmlSourceReport["collapse"] = null;

  const encodeOne = async (format: string): Promise<{ raw: Buffer; ms: number }> => {
    const t0 = performance.now();
    const raw = await renderer.renderAnimation({
      scenes: [{ node, durationMs }],
      width: device.width,
      height: device.height,
      devicePixelRatio: surface.devicePixelRatio,
      fps: surface.fps,
      format: format as never,
      ...(css.length > 0 ? { css: css as never } : {}),
      ...(format === "webp" ? (surface.lossless ? { lossless: true } : { quality: surface.quality }) : {}),
    } as never);
    return { raw, ms: performance.now() - t0 };
  };

  for (const format of surface.formats) {
    const { raw, ms } = await encodeOne(format);
    let buffer: Buffer = raw;
    let frameCount: number | null = gifStats(raw)?.frames ?? null;

    if (format === "gif" && (options.collapseGifHolds ?? true)) {
      const result = collapseGifHolds(raw);
      if (result.collapsed) {
        collapse = { framesBefore: result.framesBefore, framesAfter: result.framesAfter };
        buffer = result.buffer;
      }
      frameCount = gifStats(buffer)?.frames ?? frameCount;
    }

    files.push({
      path: null,
      format,
      bytes: buffer.length,
      ms,
      withinBudget: buffer.length <= surface.budgetBytes,
      frames: frameCount,
      buffer,
    });
  }

  // --- Posters ---------------------------------------------------------------
  const posterTimes =
    options.posters === false ? [] : (options.posters ?? [Math.round(durationMs * 0.6)]);
  const posters: HtmlSourceReport["posters"] = [];
  for (const timeMs of posterTimes) {
    const buffer = await renderer.render(node as never, {
      width: device.width,
      height: device.height,
      devicePixelRatio: surface.devicePixelRatio,
      format: "png",
      timeMs,
      ...(css.length > 0 ? { css: css as never } : {}),
    } as never);
    posters.push({ path: null, timeMs, bytes: buffer.length, buffer });
  }

  // --- Budget -----------------------------------------------------------------
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  for (const f of files) {
    if (!f.withinBudget) {
      warnings.push(
        `${f.format} is ${formatBytes(f.bytes)} — over the ${formatBytes(surface.budgetBytes)} budget. ` +
        `Lower fps/frames, shrink the surface, or flatten visuals.`,
      );
    }
  }

  const report: HtmlSourceReport = {
    surface: toSurfaceBlock(surface),
    frames,
    durationMs,
    cssEntries: css.length,
    styleBlocksHoisted: styleBlocks,
    files,
    posters,
    fonts: fontResult,
    fontFiles: fontFileResult,
    totalBytes,
    budgetBytes: surface.budgetBytes,
    overBudget: files.some((f) => !f.withinBudget),
    warnings,
    collapse,
  };

  if (options.outDir) {
    const outDir = resolve(options.outDir);
    mkdirSync(outDir, { recursive: true });
    for (const file of files) {
      const ext = file.format === "apng" ? "png" : file.format;
      const path = join(outDir, `${options.baseName ?? "animation"}.${ext}`);
      writeFileSync(path, file.buffer);
      file.path = path;
    }
    for (const poster of posters) {
      const path = join(outDir, `${options.baseName ?? "animation"}-poster-${Math.round(poster.timeMs)}ms.png`);
      writeFileSync(path, poster.buffer);
      poster.path = path;
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// HTML preparation
// ---------------------------------------------------------------------------

/**
 * Async fragment parse (fromHtml may fetch/prepare <img> resources).
 * Full documents have their <body> innerHTML extracted; <style> blocks are
 * hoisted into the css union and stripped from the fragment. Deterministic;
 * no DOM parser — the regexes run on the user's own authored markup.
 */
export async function parseFragment(html: string): Promise<{ node: Node; css: string[]; styleBlocks: number; fragment: string }> {
  let working = html.trim();

  const bodyMatch = working.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) working = bodyMatch[1];

  const css: string[] = [];
  working = working.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, body: string) => {
    const trimmed = body.trim();
    if (trimmed) css.push(trimmed);
    return "";
  });

  const parsed = await fromHtml(working);
  return { node: parsed.node, css, styleBlocks: css.length, fragment: working };
}

async function defaultRenderer(): Promise<Renderer> {
  const shared = await import("./templates/shared.js");
  return shared.getSharedRenderer();
}

/** One-line human report for the html path (CLI). */
export function toSurfaceLine(report: HtmlSourceReport): string {
  const lines: string[] = [];
  const s = report.surface;
  lines.push(
    `${s.physicalWidth}×${s.physicalHeight} @ ${s.fps}fps · ${report.frames} frames · ${Math.round(report.durationMs)}ms · ` +
    `html source${report.styleBlocksHoisted > 0 ? ` (${report.styleBlocksHoisted} <style> hoisted)` : ""}`,
  );
  for (const f of report.files) {
    lines.push(
      `  ${f.format.padEnd(4)} ${formatBytes(f.bytes).padStart(9)}  ${f.ms.toFixed(0).padStart(5)}ms  ` +
      `${f.frames !== null ? `${f.frames}f  ` : ""}${f.withinBudget ? "ok" : "OVER BUDGET"}${f.path ? `  → ${f.path}` : ""}`,
    );
  }
  for (const p of report.posters) {
    lines.push(`  poster ${formatBytes(p.bytes).padStart(8)}  @ ${Math.round(p.timeMs)}ms${p.path ? `  → ${p.path}` : ""}`);
  }
  for (const w of report.warnings) lines.push(`  ⚠ ${w}`);
  return lines.join("\n");
}
