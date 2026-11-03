// takumi-motion — sequence-export.ts (v0.4, parallelized in v0.5)
// PNG frame-sequence export: one PNG per timeline frame + a frames.json
// manifest. This is the pressure valve for "video": the user runs ffmpeg on
// the folder (documented one-liner) — the engine stays codec-free.
//
// Memory doctrine: at most `concurrency` frame buffers are alive at once —
// a 60s 1080p 30fps sequence never balloons. Identical frames (holds) render
// ONCE per run and the bytes are re-written per file: a hold-heavy banner
// pays encoding cost once, disk cost per frame.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Renderer } from "takumi-js/node";
import type { Node } from "@takumi-rs/helpers";
import { mapWithConcurrency, resolveConcurrency } from "./concurrency.js";

export interface SequenceExportOptions {
  outDir: string;
  /** Subdirectory for the frames (default "sequence"). */
  dirName?: string;
  /** Render every Nth frame (default 1). */
  every?: number;
  /** Base file name (default "frame" → frame_00000.png). */
  baseName?: string;
  /** v0.5 — bounded parallelism for frame rendering (napi tasks overlap;
   *  writes stay ordered by frame index). Output is byte-identical at any
   *  concurrency. Default: available cores (capped at 8). */
  concurrency?: number;
}

export interface SequenceExportResult {
  dir: string;
  manifestPath: string;
  frameCount: number;
  /** Total bytes written (frames + manifest). */
  bytes: number;
  ms: number;
  files: Array<{ index: number; file: string; bytes: number }>;
}

export interface SequenceFrameSource {
  /** What to render for a given timeline frame. */
  renderAt: (frame: number) => { node: Node; timeMs: number };
  css: string[];
  frames: number;
  frameMs: number;
  fps: number;
  width: number;
  height: number;
  devicePixelRatio: number;
  /** Map a timeline frame to its backing chunk index (react path) — identical
   *  frames in a chunk render once. Omit for the single-node declarative path. */
  chunkIndexForFrame?: (frame: number) => number;
  /** Chunk identity key per chunk index — two frames with the same key share render bytes. */
  chunkKey?: (chunkIndex: number) => string;
  /** True when NO css entry carries @keyframes/animation — chunk holds then
   *  render identically at any local time and can share PNG bytes. When css
   *  animations exist the engine plays them across a chunk's duration, so
   *  every frame must render at its own timeMs. Default true. */
  holdsStatic?: boolean;
}

export interface SequenceManifest {
  version: 1;
  generator: "takumi-motion";
  fps: number;
  frameMs: number;
  width: number;
  height: number;
  frameCount: number;
  framesPerFile: number;
  /** ffmpeg one-liner that turns this folder into an MP4. */
  ffmpeg: string;
  files: Array<{ index: number; file: string; sourceFrame: number }>;
}

/**
 * Export the timeline as a numbered PNG sequence. Bounded memory + bounded
 * parallelism (v0.5): the frame walk collapses into RUNS of identical frames
 * (holds), each run renders its PNG ONCE, and up to `concurrency` runs
 * overlap on Rust's thread pool. At most `concurrency` frame buffers are
 * alive at any moment — a 60s 1080p sequence never balloons in memory, and
 * the output is byte-identical at any concurrency (pure (node, timeMs) renders).
 */
export async function exportFrameSequence(
  renderer: Renderer,
  source: SequenceFrameSource,
  options: SequenceExportOptions,
): Promise<SequenceExportResult> {
  const t0 = performance.now();
  const every = options.every ?? 1;
  if (!Number.isInteger(every) || every < 1) {
    throw new Error(`exportFrameSequence: every must be a positive integer, got ${every}.`);
  }
  const concurrency = resolveConcurrency(options.concurrency);

  const dir = join(options.outDir, options.dirName ?? "sequence");
  mkdirSync(dir, { recursive: true });

  const frameCount = Math.ceil(source.frames / every);
  if (frameCount < 1) throw new Error("exportFrameSequence: no frames to export (empty timeline?).");

  // Chunk reuse REQUIRES chunk mapping; the declarative single-node path
  // (always animated css) opts out explicitly via holdsStatic: false.
  const holdsStatic = (source.holdsStatic ?? true) && source.chunkIndexForFrame !== undefined;

  // Pass 1 (metadata only): collapse the frame walk into RUNS of identical
  // renders — consecutive frames sharing a chunk key when holds are static,
  // every frame its own run otherwise. Same collapsing as the linear walk;
  // the runs are just an explicit unit of parallel work now.
  interface Run {
    key: string;
    renderFrame: number;
    cells: number[];
  }
  const runs: Run[] = [];
  {
    let cell = 0;
    for (let frame = 0; frame < source.frames && cell < frameCount; frame += every, cell++) {
      const chunkIndex = source.chunkIndexForFrame?.(frame) ?? 0;
      const key = holdsStatic ? (source.chunkKey?.(chunkIndex) ?? `f${frame}`) : `f${frame}`;
      const last = runs[runs.length - 1];
      if (last && last.key === key) last.cells.push(cell);
      else runs.push({ key, renderFrame: frame, cells: [cell] });
    }
  }

  // Per-cell outputs, filled by run completion (runs finish out of order —
  // cells are indexed so the manifest stays frame-ordered).
  const fileEntries: SequenceExportResult["files"] = new Array(frameCount);
  const manifestEntries: SequenceManifest["files"] = new Array(frameCount);
  let bytes = 0;

  const baseName = options.baseName ?? "frame";
  await mapWithConcurrency(runs, concurrency, async (run) => {
    const { node, timeMs } = source.renderAt(run.renderFrame);
    const png = await renderer.render(node as never, {
      width: source.width,
      height: source.height,
      devicePixelRatio: source.devicePixelRatio,
      format: "png",
      timeMs,
      ...(source.css.length > 0 ? { css: source.css as never } : {}),
    } as never);

    for (const cell of run.cells) {
      const file = `${baseName}_${String(cell).padStart(5, "0")}.png`;
      writeFileSync(join(dir, file), png);
      bytes += png.length;
      fileEntries[cell] = { index: cell, file, bytes: png.length };
      manifestEntries[cell] = { index: cell, file, sourceFrame: run.renderFrame };
    }
  });

  const files = fileEntries.filter(Boolean);
  const manifestFiles = manifestEntries.filter(Boolean);
  const cell = files.length;

  const manifest: SequenceManifest = {
    version: 1,
    generator: "takumi-motion",
    fps: source.fps / every,
    frameMs: source.frameMs * every,
    width: source.width,
    height: source.height,
    frameCount: cell,
    framesPerFile: every,
    ffmpeg: `ffmpeg -framerate ${(source.fps / every).toFixed(2)} -i ${options.dirName ?? "sequence"}/${options.baseName ?? "frame"}_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4`,
    files: manifestFiles,
  };
  const manifestPath = join(dir, "frames.json");
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  writeFileSync(manifestPath, manifestBytes);
  bytes += manifestBytes.length;

  return {
    dir,
    manifestPath,
    frameCount: cell,
    bytes,
    ms: performance.now() - t0,
    files,
  };
}
