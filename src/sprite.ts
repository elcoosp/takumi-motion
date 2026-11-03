// takumi-motion — sprite.ts (v0.4)
// Sprite-sheet atlas export: every animation frame as a cell in one PNG grid
// plus a JSON metadata file — the classic game-engine / CSS-steps interchange
// format. Memory-driven frames (jitter via useNoise, React state) that the
// chunk encoder can't compress get a second life here.
//
// Zero-dependency PNG encoding: takumi renders each frame as raw RGBA
// (format: "raw" — verified 2.17.1), cells are bitblt'd into an atlas buffer,
// and the atlas is encoded with a minimal, deterministic PNG writer
// (node:zlib deflate, filter 0, color type 6). Byte-deterministic by
// construction: same frames ⇒ same atlas bytes.

import type { Renderer } from "takumi-js/node";
import type { Node } from "@takumi-rs/helpers";
import { mapWithConcurrency, resolveConcurrency } from "./concurrency.js";
import { toEngineMs } from "./engine-time.js";

// ---------------------------------------------------------------------------
// Minimal PNG encoder (RGBA, filter 0)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode an RGBA pixel buffer as a PNG (color type 6, 8-bit, filter 0).
 * Deterministic: zlib deflateSync with fixed defaults — no timestamps, no
 * adaptivity. ~90 lines so the engine keeps zero runtime deps.
 */
export { encodePngRgba, type PngEncodeOptions } from "./png.js";
import { encodePngRgba as encodePng } from "./png.js";

// ---------------------------------------------------------------------------
// Atlas builder
// ---------------------------------------------------------------------------

export interface SpriteSheetOptions {
  /** Cells per row. Default: ceil(sqrt(frames)) — a near-square atlas. */
  columns?: number;
  /** Render every Nth timeline frame (default 1 = all). */
  every?: number;
  /** Hard pixel budget for the atlas RGBA buffer. Default 64M px (~256MB). */
  maxPixels?: number;
  /** v0.5 — bounded parallelism for raw frame renders (windows of K cells;
   *  blits stay ordered). Output is byte-identical at any concurrency.
   *  Default: available cores (capped at 8). */
  concurrency?: number;
}

export interface SpriteFrameMeta {
  /** Timeline frame index this cell was rendered from. */
  frame: number;
  /** Cell position on the atlas (device px). */
  x: number;
  y: number;
  /** Duration the cell represents (ms) — framesPerCell × frameMs. */
  durationMs: number;
}

export interface SpriteSheetMeta {
  version: 1;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  /** How many timeline frames each cell stands for. */
  framesPerCell: number;
  fps: number;
  totalDurationMs: number;
  frames: SpriteFrameMeta[];
  /** CSS animation recipe (steps()) for 1:1 playback of the atlas. */
  css: string;
}

export interface SpriteSheetResult {
  png: Buffer;
  meta: SpriteSheetMeta;
  bytes: number;
  ms: number;
}

interface FrameSource {
  /** What to render for a given timeline frame (chunk node + local time). */
  renderAt: (frame: number) => { node: Node; timeMs: number };
  /** CSS entries accompanying the render (may be empty). */
  css: string[];
  /** Total timeline frame count. */
  frames: number;
  /** Frame duration in ms. */
  frameMs: number;
  fps: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

/**
 * Render the timeline into a sprite-sheet atlas + metadata.
 * Memory-bounded: cells stream into a preallocated atlas buffer; frames
 * render in windows of `concurrency` raw buffers (v0.5), blitted in cell
 * order. Byte-deterministic at any concurrency.
 */
export async function renderSpriteSheet(
  renderer: Renderer,
  source: FrameSource,
  options: SpriteSheetOptions = {},
): Promise<SpriteSheetResult> {
  const t0 = performance.now();
  const every = options.every ?? 1;
  if (!Number.isInteger(every) || every < 1) {
    throw new Error(`renderSpriteSheet: every must be a positive integer, got ${every}.`);
  }
  const concurrency = resolveConcurrency(options.concurrency);
  const maxPixels = options.maxPixels ?? 64 * 1024 * 1024;

  const cellCount = Math.ceil(source.frames / every);
  if (cellCount < 1) throw new Error("renderSpriteSheet: no frames to place (empty timeline?).");
  const columns = options.columns ?? Math.ceil(Math.sqrt(cellCount));
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error(`renderSpriteSheet: columns must be a positive integer, got ${columns}.`);
  }
  const rows = Math.ceil(cellCount / columns);
  if (columns * rows * source.width * source.height > maxPixels) {
    throw new Error(
      `renderSpriteSheet: atlas ${columns}×${rows} of ${source.width}×${source.height} cells exceeds the ` +
      `${maxPixels}px budget (${((columns * rows * source.width * source.height) / 1e6).toFixed(1)}M px). ` +
      `Raise 'every', shrink the surface, or split the export.`,
    );
  }

  const cellW = source.width;
  const cellH = source.height;
  const atlasW = columns * cellW;
  const atlasH = rows * cellH;
  const atlas = new Uint8Array(atlasW * atlasH * 4); // transparent until painted

  const meta: SpriteSheetMeta = {
    version: 1,
    frameWidth: cellW,
    frameHeight: cellH,
    columns,
    rows,
    frameCount: cellCount,
    framesPerCell: every,
    fps: source.fps,
    totalDurationMs: Math.round(cellCount * every * source.frameMs),
    frames: [],
    css: "",
  };

  // Precompute the cell → (frame, atlas position) layout, then render raw
  // frames in windows of `concurrency` and blit each window in cell order.
  interface CellJob {
    cell: number;
    frame: number;
    cx: number;
    cy: number;
  }
  const jobs: CellJob[] = [];
  {
    let cell = 0;
    for (let frame = 0; frame < source.frames && cell < cellCount; frame += every, cell++) {
      jobs.push({
        cell,
        frame,
        cx: (cell % columns) * cellW,
        cy: Math.floor(cell / columns) * cellH,
      });
    }
  }

  const scratch = new Uint8Array(cellW * cellH * 4);
  for (let start = 0; start < jobs.length; start += concurrency) {
    const window = jobs.slice(start, start + concurrency);
    const raws = await mapWithConcurrency(window, concurrency, async (job) => {
      const { node, timeMs } = source.renderAt(job.frame);
      const engineMs = toEngineMs(timeMs);
      return renderer.render(node as never, {
        width: cellW,
        height: cellH,
        devicePixelRatio: source.devicePixelRatio,
        format: "raw",
        timeMs: engineMs,
        ...(source.css.length > 0 ? { css: source.css as never } : {}),
      } as never);
    });
    for (let i = 0; i < window.length; i++) {
      const job = window[i];
      scratch.set(raws[i]);
      blit(atlas, atlasW, scratch, cellW, cellH, job.cx, job.cy);
      meta.frames.push({
        frame: job.frame,
        x: job.cx,
        y: job.cy,
        durationMs: Math.round(every * source.frameMs),
      });
    }
  }

  const png = encodePng(atlasW, atlasH, atlas);
  meta.css = spriteSheetCss(columns, cellCount, every, source.frameMs, cellW, cellH, atlasW);
  return { png, meta, bytes: png.length, ms: performance.now() - t0 };
}

/** Copy one cell's rows into the atlas. */
function blit(atlas: Uint8Array, atlasW: number, cell: Uint8Array, cellW: number, cellH: number, ox: number, oy: number): void {
  for (let y = 0; y < cellH; y++) {
    const src = y * cellW * 4;
    const dst = ((oy + y) * atlasW + ox) * 4;
    atlas.set(cell.subarray(src, src + cellW * 4), dst);
  }
}

/** A ready-to-paste CSS steps() animation for the atlas (1:1 playback). */
function spriteSheetCss(columns: number, frameCount: number, every: number, frameMs: number, cellW: number, cellH: number, atlasW: number): string {
  const durationS = ((frameCount * every * frameMs) / 1000).toFixed(3);
  return [
    `.takumi-sprite {`,
    `  width: ${cellW}px;`,
    `  height: ${cellH}px;`,
    `  background-image: url("spritesheet.png");`,
    `  background-size: ${atlasW}px auto;`,
    `  animation: takumi-sprite-play ${durationS}s steps(${frameCount}) infinite;`,
    `}`,
    `@keyframes takumi-sprite-play {`,
    `  from { background-position: 0 0; }`,
    `  to { background-position: -${columns * cellW}px 0; }`,
    `}`,
  ].join("\n");
}
