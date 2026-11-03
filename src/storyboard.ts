// takumi-motion — storyboard.ts (v0.9 Bet F)
// The contact sheet: one PNG that shows the whole timeline.
//
// `renderStoryboard` samples N frames across the capture (default 12),
// rasterizes each through the REAL renderer at half resolution (dpr 0.5 —
// logical layout unchanged), and composites a labeled grid — which is then
// rendered through takumi itself (the sheet is a takumi document: dogfood
// all the way down). A sidecar JSON carries the sampling metadata.
//
// Authors use it to choreograph: scene rhythm, dead frames, and the loop
// seam are all visible at a glance — no scrubbing required.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { captureReactBanner, type CaptureResult } from "./react/capture.js";
import { chunkIndexForFrame } from "./chunk-index.js";
import { composeFrame } from "./react/plan.js";
import type { Renderer } from "takumi-js/node";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoryboardOptions {
  /** React banner (element or defineBanner() component). */
  banner: unknown;
  /** Data for the banner's data channel. */
  data?: unknown;
  /** Sample count across the timeline. Default 12. */
  frames?: number;
  /** Grid columns. Default 4. */
  columns?: number;
  /** Cell scale relative to the canvas. Default 0.5. */
  scale?: number;
  /** Output directory. Omit to receive buffers only. */
  outDir?: string;
  /** Base file name. Default "storyboard". */
  baseName?: string;
  /** Reuse a warm Renderer. Default: the shared template renderer. */
  renderer?: Renderer;
  /** Gap between cells, in sheet px. Default 10. */
  gap?: number;
  /** Sheet background. Default "#0b1120". */
  background?: string;
}

export interface StoryboardCell {
  frame: number;
  scene: number;
  chunkIndex: number;
}

export interface StoryboardResult {
  png: Buffer;
  cells: StoryboardCell[];
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
  frames: number;
  paths: { png: string | null; json: string | null };
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Evenly sample `count` frames across [0, totalFrames) — deterministic. */
export function sampleFrames(totalFrames: number, count: number): number[] {
  const n = Math.max(1, Math.min(count, totalFrames));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Math.min(totalFrames - 1, Math.round((i * (totalFrames - 1)) / Math.max(1, n - 1))));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function sceneAtFrame(capture: CaptureResult, frame: number): number {
  try {
    const composition = composeFrame(capture.plan, frame);
    return composition.mode === "single" ? composition.scene.index : composition.arriving.index;
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export async function renderStoryboard(options: StoryboardOptions): Promise<StoryboardResult> {
  if (options.banner === undefined || options.banner === null) {
    throw new Error("renderStoryboard: `banner` (a React element or defineBanner() component) is required.");
  }
  const { Renderer: NodeRenderer } = await import("takumi-js/node");
  const { fromHtml } = await import("@takumi-rs/helpers/html");

  const capture = await captureReactBanner(options.banner as never, {
    ...(options.data !== undefined ? { data: options.data } : {}),
  });
  const renderer = (options.renderer ?? new NodeRenderer()) as Renderer;

  const frames = sampleFrames(capture.outputFrames, options.frames ?? 12);
  const columns = Math.max(1, Math.min(options.columns ?? 4, frames.length));
  const scale = Math.min(1, Math.max(0.125, options.scale ?? 0.5));
  const gap = options.gap ?? 10;
  const background = options.background ?? "#0b1120";

  const meta = capture.meta;
  const cellW = Math.max(1, Math.round(meta.width * scale));
  const cellH = Math.max(1, Math.round(meta.height * scale));
  const frameMs = capture.plan.frameMs;

  // Rasterize each sampled frame at the scaled device size.
  const cells: StoryboardCell[] = [];
  const cellImages: Array<{ width: number; height: number; data: Uint8Array | ArrayBuffer }> = [];
  for (const frame of frames) {
    const chunkIndex = chunkIndexForFrame(capture.chunks, frame);
    const { node } = await fromHtml(capture.chunks[chunkIndex].html);
    const timeMs = (frame - capture.chunks[chunkIndex].startFrame) * frameMs;
    const raw = (await renderer.render(node as never, {
      width: cellW,
      height: cellH,
      devicePixelRatio: scale,
      format: "raw",
      timeMs,
    } as never)) as Buffer;
    cells.push({ frame, scene: sceneAtFrame(capture, frame), chunkIndex });
    cellImages.push({ width: cellW, height: cellH, data: raw });
  }

  const rows = Math.ceil(cells.length / columns);

  // The sheet IS a takumi document (dogfood): a flex grid of raw-RGBA image
  // cells with frame labels, rendered once through the same engine.
  const sheet = buildSheetTree(cellImages, cells, { columns, cellW, cellH, gap, background, labelColor: "#94a3b8" });
  const { fromJsx } = await import("@takumi-rs/helpers/jsx");
  const { node } = await fromJsx(sheet as never);
  const sheetWidth = columns * cellW + (columns + 1) * gap;
  const sheetHeight = rows * (cellH + 22) + (rows + 1) * gap;
  const png = (await renderer.render(node as never, {
    width: sheetWidth,
    height: sheetHeight,
    format: "png",
  } as never)) as Buffer;

  const result: StoryboardResult = {
    png,
    cells,
    columns,
    rows,
    cellWidth: cellW,
    cellHeight: cellH,
    width: sheetWidth,
    height: sheetHeight,
    frames: capture.outputFrames,
    paths: { png: null, json: null },
  };

  if (options.outDir) {
    const outDir = resolve(options.outDir);
    mkdirSync(outDir, { recursive: true });
    const base = options.baseName ?? "storyboard";
    const pngPath = join(outDir, `${base}.png`);
    const jsonPath = join(outDir, `${base}.json`);
    writeFileSync(pngPath, png);
    writeFileSync(jsonPath, JSON.stringify({
      ...result,
      png: undefined,
      paths: undefined,
      pngPath,
    }, null, 2));
    result.paths = { png: pngPath, json: jsonPath };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Sheet document
// ---------------------------------------------------------------------------

function buildSheetTree(
  images: Array<{ width: number; height: number; data: Uint8Array | ArrayBuffer }>,
  cells: StoryboardCell[],
  opts: { columns: number; cellW: number; cellH: number; gap: number; background: string; labelColor: string },
): ReactNode {
  const rows: ReactNode[] = [];
  for (let r = 0; r < images.length; r += opts.columns) {
    const rowImages = images.slice(r, r + opts.columns);
    const rowCells = cells.slice(r, r + opts.columns);
    rows.push(createElement("div", {
      key: `row-${r}`,
      style: { display: "flex", gap: opts.gap },
    }, rowImages.map((img, i) =>
      createElement("div", {
        key: `cell-${r}-${i}`,
        style: { display: "flex", flexDirection: "column", gap: 4 },
      },
        createElement("img", {
          src: img,
          width: opts.cellW,
          height: opts.cellH,
          style: { display: "block" },
        }),
        createElement("div", {
          style: {
            fontSize: 12,
            lineHeight: 1,
            color: opts.labelColor,
            whiteSpace: "pre",
            fontFamily: "sans-serif",
          },
        }, `f${rowCells[i].frame} · scene ${rowCells[i].scene}`),
      ),
    )));
  }
  return createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: opts.gap,
      padding: opts.gap,
      backgroundColor: opts.background,
      width: opts.columns * opts.cellW + (opts.columns + 1) * opts.gap,
      boxSizing: "border-box",
    },
  }, rows);
}
