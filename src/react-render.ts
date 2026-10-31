// takumi-motion — react-render.ts
// Render pipeline for React-authored banners (v0.3).
//
//   captureReactBanner()  → HTML frames → chunks
//   fromHtml(chunk)       → takumi Node per chunk (+ css union)
//   auditChunks()         → per-chunk extent audit (text never clips)
//   renderAnimation()     → ONE napi call: sequential scene array → GIF/WebP/APNG
//   posters               → any frame rendered as PNG from its chunk node
//
// The declarative path (render.ts) and this pipeline share the Safety Net
// (size budgets, GIF hold collapse, byte determinism) but audit independently:
// React chunks carry per-frame inline styles instead of timelines, so the
// extent audit walks MEASURED trees rather than sampling tracks.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromHtml } from "@takumi-rs/helpers/html";
import type { Node } from "@takumi-rs/helpers";
import type { MeasuredNode, Renderer } from "takumi-js/node";
import { captureReactBanner, type CaptureResult } from "./react/capture.js";
import { bannerPresets, formatBytes, resolvePreset, type AnimationFormat, type BannerPreset } from "./presets.js";
import { collapseGifHolds, gifStats } from "./size.js";
import { ensureFonts, type FontLoadResult, type FontSpec } from "./fonts.js";
import {
  resolveSurface,
  resolveBackground,
  deviceSize,
  type SurfaceSpec,
  type ResolvedSurface,
} from "./surface.js";
import { toSurfaceBlock, type SurfaceReportBlock } from "./html-source.js";
import { exportFrameSequence, type SequenceExportResult } from "./sequence-export.js";
import {
  renderSpriteSheet,
  type SpriteSheetOptions,
  type SpriteSheetMeta,
} from "./sprite.js";
import { collectLintWarnings,
  formatLint,
  lintFontFiles,
  lintFontSpecs,
  lintGlowDither,
  type LintWarning,
} from "./lint.js";
import { explainCapture, formatExplain, type ExplainReport } from "./explain.js";
import { detectLayoutShifts, layoutShiftWarnings } from "./layout-shift.js";
import { composeFrame } from "./react/plan.js";
import { mapWithConcurrency, resolveConcurrency } from "./concurrency.js";

// ---------------------------------------------------------------------------
// Options / report
// ---------------------------------------------------------------------------

export interface RenderReactBannerOptions extends SurfaceSpec {
  /** React element or defineBanner()-marked component (the user's default export). */
  banner: unknown;
  /** Preset name or custom object. The <Banner> prop wins when it declares one,
   *  explicit options here win over BOTH (CLI > component > preset). */
  preset?: string | BannerPreset;
  /** Overrides the fps resolved from <Banner> props/preset. */
  fps?: number;
  /** Override formats. Default: preset's formats. */
  formats?: AnimationFormat[];
  /** Output directory. Omit to receive buffers only. */
  outDir?: string;
  /** Base file name. Default "banner". */
  baseName?: string;
  /** Extra fonts merged with the banner's own font props. */
  fonts?: FontSpec[];
  /** Poster FRAME indexes (global). Default: frame at 60% of the timeline. `false` disables. */
  posters?: number[] | false;
  /** Set false to skip GIF hold collapsing. Default true. */
  collapseGifHolds?: boolean;
  /** Reuse a warm Renderer (fonts included). Default: the shared template renderer. */
  renderer?: Renderer;
  /** Safe-zone inset (CSS px) for the extent audit. Default 8. */
  safeZone?: number;
  /** Export a PNG frame sequence (+ frames.json manifest) under outDir.
   *  Requires outDir. `true` or `{ every }` — frames.stream to ffmpeg for video. */
  sequence?: boolean | { every?: number; dirName?: string };
  /** Export a sprite-sheet atlas (+ metadata JSON). Requires outDir. */
  spriteSheet?: boolean | SpriteSheetOptions;
  /** Encode formats concurrently (napi tasks are async; the Rust engine is
   *  rayon-parallel per frame). Default true. Set false for strict ordering
   *  profiles or memory-tight environments. */
  parallel?: boolean;
  /** v0.5 — bounded parallelism for chunk parsing + extent measurement
   *  (napi tasks overlap on Rust's thread pool). Default: available cores
   *  (capped at 8). Output is byte-identical at ANY concurrency. */
  concurrency?: number;
  /** v0.8 — windowed render: first OUTPUT frame (default 0). Pairs with
   *  toFrame to render a subrange (fast partial previews, --from/--to). */
  fromFrame?: number;
  /** v0.8 — windowed render: exclusive last OUTPUT frame (default: all). */
  toFrame?: number;
  /**
   * v0.9 Bet A — the data object for the banner ("the animation knows the
   * numbers"). Provided to the tree via DataContext; components read it with
   * useChartData(). Load it ONCE before calling (fs read — determinism
   * doctrine forbids network fetches at render time).
   */
  data?: unknown;
  /**
   * v0.9 Bet F — run the per-frame X-ray: attribute every unique frame to
   * channels (opacity/transform/clip/layout/paint/text/structure) and count
   * expensive churn (layout/text/structure). Zero cost when false (default).
   */
  explain?: boolean;
}

export interface ReactExtentViolation {
  frame: number;
  /** Node path in the measured tree, e.g. "canvas > scene-1 > div > span". */
  target: string;
  edge: "left" | "right" | "top" | "bottom";
  overflowPx: number;
  /** Text content is hard-fail; decorative boxes warn. */
  decorative: boolean;
  detail: string;
}

export interface ChunkExtentReport {
  canvas: { width: number; height: number };
  safeZonePx: number;
  chunksChecked: number;
  /** v0.9.1 — chunks skipped because they render inside a scene-transition
   *  overlap (push/slide deliberately carry scenes across the canvas edge;
   *  the frame-local audit cannot attribute authored motion). */
  transitionChunksSkipped: number;
  violations: ReactExtentViolation[];
}

export interface ReactSeamReport {
  /** "exact" — frame 0 and last frame rendered byte-identical HTML. "differs" otherwise. */
  mode: "exact" | "differs";
  loop: boolean;
  detail: string;
}

export interface RenderedFile {
  path: string | null;
  format: AnimationFormat;
  bytes: number;
  ms: number;
  withinBudget: boolean;
  frames: number | null;
  buffer: Buffer;
}

export interface ReactBannerReport {
  preset: string;
  width: number;
  height: number;
  devicePixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  fps: number;
  frames: number;
  durationMs: number;
  /** Scene count declared in the banner. */
  scenes: number;
  /** Unique rendered chunks (≤ frames — identical frames merge). */
  chunks: number;
  /** frames − chunks: layout work avoided by chunk merging. */
  mergedFrames: number;
  cssEntries: number;
  files: RenderedFile[];
  posters: Array<{ path: string | null; frame: number; bytes: number; buffer: Buffer }>;
  extents: ChunkExtentReport;
  seam: ReactSeamReport;
  fonts: FontLoadResult | null;
  totalBytes: number;
  budgetBytes: number;
  overBudget: boolean;
  warnings: string[];
  /** GIF hold-collapse result when a GIF was rendered. */
  collapse: { framesBefore: number; framesAfter: number; bytesBefore: number; bytesAfter: number } | null;
  /** v0.4 — the fully resolved output surface (user spec > banner props > preset). */
  surface: SurfaceReportBlock;
  /** v0.4 — PNG frame sequence export result (when requested). */
  sequence?: SequenceExportResult;
  /** v0.4 — sprite-sheet export result (when requested). */
  spriteSheet?: { png: Buffer; meta: SpriteSheetMeta; bytes: number; ms: number; paths: { png: string | null; json: string | null } };
  /** v0.5 — per-stage wall-clock timings (observability; audit-as-data). */
  timings: RenderTimings;
  /** v0.6 — the authoring lint: coded warnings for silent-failure classes
   *  (TM_* codes — stable API; render as data, surface in your own tooling). */
  lint: LintWarning[];
  /** v0.8 — the tempo the output was rendered at (1 = authored speed). */
  tempo: number;
  /** v0.8 — the output window rendered: [from, to) in output frames (full
   *  range when no window was requested). */
  window: { from: number; to: number };
  /** v0.9 Bet F — per-frame attribution (WHY each frame exists). Present
   *  when `explain: true`. JSON-safe; formatExplain() renders the table. */
  explain?: ExplainReport;
}

export interface RenderTimings {
  /** Capture: probe + plan + per-frame renderToStaticMarkup. */
  captureMs: number;
  /** fromHtml parsing of every unique chunk (bounded-parallel). */
  parseMs: number;
  /** Extent audit: renderer.measure per chunk (bounded-parallel). */
  auditMs: number;
  /** Animation encodes (sum across formats). */
  encodeMs: number;
  /** Whole pipeline, capture through report assembly. */
  totalMs: number;
}

const EXT: Record<AnimationFormat, string> = { gif: "gif", webp: "webp", apng: "png" };

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export async function renderReactBanner(options: RenderReactBannerOptions): Promise<ReactBannerReport> {
  if (options.banner === undefined || options.banner === null) {
    throw new Error("renderReactBanner: `banner` (a React element or defineBanner() component) is required.");
  }
  const pipelineT0 = performance.now();
  const concurrency = resolveConcurrency(options.concurrency);

  const captureT0 = performance.now();
  const capture = await captureReactBanner(options.banner as never, {
    ...(options.fps ? { fps: options.fps } : {}),
    ...(options.preset ? { preset: options.preset } : {}),
    ...(options.fonts ? { fonts: options.fonts } : {}),
    ...(options.fromFrame !== undefined ? { fromFrame: options.fromFrame } : {}),
    ...(options.toFrame !== undefined ? { toFrame: options.toFrame } : {}),
    ...(options.data !== undefined ? { data: options.data } : {}),
  });
  const captureMs = performance.now() - captureT0;

  const meta = capture.meta;
  const fps = meta.fps;
  const baseName = options.baseName ?? "banner";
  const warnings: string[] = [...capture.warnings];

  // Surface: explicit options > banner-resolved preset (capture meta already
  // carries the <Banner width/height/dpr> overrides). fps is fixed from capture
  // (the plan grid is built on it — re-deriving would desync scenes). The
  // banner's resolved background (theme color or null for transparent) feeds
  // the surface block so reports reflect what is actually painted.
  const surface: ResolvedSurface = resolveSurface(
    {
      ...(options.width !== undefined ? { width: options.width } : {}),
      ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
      fps,
      ...(options.formats ? { formats: options.formats } : {}),
      ...(options.quality !== undefined ? { quality: options.quality } : {}),
      ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
      ...(options.budgetBytes !== undefined ? { budgetBytes: options.budgetBytes } : {}),
      background: meta.background,
    },
    meta.preset,
  );
  if (options.background !== undefined && resolveBackground(options.background) !== meta.background) {
    warnings.push(
      "renderReactBanner: the render-level `background` option is ignored for React banners — " +
      "the canvas background is part of the component tree. Set <Banner background={…}> instead.",
    );
  }

  const renderer = options.renderer ?? (await defaultRenderer());

  // Fonts: banner-declared + CLI pass-through, registered on THIS renderer.
  let fontResult: FontLoadResult | null = null;
  if (meta.fonts.length > 0) {
    fontResult = await ensureFonts(renderer, meta.fonts);
  }

  // Chunk nodes (+ css union for <style> escape hatches) — bounded-parallel
  // parse: fromHtml is an async napi task, K of them overlap on Rust threads.
  // Determinism is untouched: parsing is a pure function of the html string.
  const parseT0 = performance.now();
  const parsedChunks = await mapWithConcurrency(capture.chunks, concurrency, (chunk) => fromHtml(chunk.html));
  const chunkNodes: Node[] = [];
  const cssSet = new Map<string, string>();
  for (const parsed of parsedChunks) {
    chunkNodes.push(parsed.node);
    for (const entry of parsed.css) if (!cssSet.has(entry)) cssSet.set(entry, entry);
  }
  const css = [...cssSet.values()];
  const parseMs = performance.now() - parseT0;

  // Device-px convention (see render.ts): takumi width/height are DEVICE pixels.
  const device = deviceSize(surface);
  const deviceWidth = device.width;
  const deviceHeight = device.height;
  const frameMs = capture.plan.frameMs;

  // --- Safety Net: per-chunk extent audit ---------------------------------
  const auditT0 = performance.now();
  const measuredTrees = await measureChunks(renderer, chunkNodes, {
    width: surface.width,
    height: surface.height,
    concurrency,
  });
  const extents = await auditChunks(renderer, capture, chunkNodes, {
    width: surface.width,
    height: surface.height,
    safeZone: options.safeZone ?? 8,
    concurrency,
  }, measuredTrees);
  const auditMs = performance.now() - auditT0;

  // --- v0.9 Bet B: intra-scene layout-shift lint (same measured trees) -----
  // Findings inside an active <Morph> window are authored motion (FLIP scale
  // moves content by design) — exempt them.
  const morphActive = new Set(capture.morphActiveFrames);
  const shiftFindings = detectLayoutShifts(
    measuredTrees,
    capture.chunks.map((c) => c.startFrame),
    (frame) => {
      try {
        const composition = composeFrame(capture.plan, frame);
        return composition.mode === "single" ? composition.scene.index : composition.arriving.index;
      } catch {
        return -1;
      }
    },
  ).filter((f) => !morphActive.has(f.frame));

  // --- Safety Net: seam ----------------------------------------------------
  const first = capture.htmlFrames[0];
  const last = capture.htmlFrames[capture.htmlFrames.length - 1];
  const seam: ReactSeamReport = {
    mode: first === last ? "exact" : "differs",
    loop: meta.loop,
    detail:
      first === last
        ? "frame 0 and the final frame render byte-identical HTML — pixel-perfect loop seam."
        : meta.loop
          ? "loop is declared but frame 0 ≠ final frame — the seam will visibly jump. Make the last frame render the same tree as the first (or set loop: false)."
          : "one-shot banner (loop not declared) — seam is informational only.",
  };
  if (meta.loop && seam.mode === "differs") warnings.push(seam.detail);

  // --- Encode --------------------------------------------------------------
  const scenes = capture.chunks.map((chunk, i) => ({
    node: chunkNodes[i],
    durationMs: chunk.frames * frameMs,
  }));

  const files: RenderedFile[] = [];
  let collapse: ReactBannerReport["collapse"] = null;
  const encodeT0 = performance.now();

  const encodeFormat = async (format: AnimationFormat): Promise<RenderedFile> => {
    const t0 = performance.now();
    const raw = await renderer.renderAnimation({
      scenes: scenes as never,
      width: deviceWidth,
      height: deviceHeight,
      devicePixelRatio: surface.devicePixelRatio,
      fps,
      format,
      ...(css.length > 0 ? { css: css as never } : {}),
      ...(format === "webp" ? (surface.lossless ? { lossless: true } : { quality: surface.quality }) : {}),
    });
    let buffer: Buffer = raw;
    let frameCount: number | null = gifStats(raw)?.frames ?? null;

    if (format === "gif" && (options.collapseGifHolds ?? true)) {
      const result = collapseGifHolds(raw);
      if (result.collapsed) {
        collapse = {
          framesBefore: result.framesBefore,
          framesAfter: result.framesAfter,
          bytesBefore: raw.length,
          bytesAfter: result.buffer.length,
        };
        buffer = result.buffer;
      }
      frameCount = gifStats(buffer)?.frames ?? frameCount;
    }

    return {
      path: null,
      format,
      bytes: buffer.length,
      ms: performance.now() - t0,
      withinBudget: buffer.length <= surface.budgetBytes,
      frames: frameCount,
      buffer,
    };
  };

  if (options.parallel ?? true) {
    files.push(...(await Promise.all(surface.formats.map(encodeFormat))));
  } else {
    for (const format of surface.formats) {
      files.push(await encodeFormat(format));
    }
  }
  const encodeMs = performance.now() - encodeT0;

  // --- Posters -------------------------------------------------------------
  // Looping banners poster frame 0 by default — the seam frame IS the
  // landing frame a viewer sees when the GIF loops (Bet E doctrine).
  const posterFrames =
    options.posters === false
      ? []
      : (options.posters ?? (meta.loop ? [0] : [Math.min(capture.outputFrames - 1, Math.round(capture.outputFrames * 0.6))]));
  const posters: ReactBannerReport["posters"] = [];
  for (const frame of posterFrames) {
    const chunkIndex = chunkIndexForFrame(capture, frame);
    const timeMs = (frame - capture.chunks[chunkIndex].startFrame) * frameMs;
    const buffer = await renderer.render(chunkNodes[chunkIndex] as never, {
      width: deviceWidth,
      height: deviceHeight,
      devicePixelRatio: surface.devicePixelRatio,
      format: "png",
      timeMs,
      ...(css.length > 0 ? { css: css as never } : {}),
    } as never);
    posters.push({ path: null, frame, bytes: buffer.length, buffer });
  }

  // --- v0.4 outputs: PNG sequence + sprite sheet ---------------------------
  let sequence: SequenceExportResult | undefined;
  let spriteSheet: ReactBannerReport["spriteSheet"];
  if (options.sequence && !options.outDir) {
    throw new Error("renderReactBanner: `sequence` export requires `outDir` (frames are written to disk).");
  }
  if (options.sequence && options.outDir) {
    const seqOpts = options.sequence === true ? {} : options.sequence;
    sequence = await exportFrameSequence(renderer, reactFrameSource(capture, chunkNodes, css, surface, frameMs), {
      outDir: resolve(options.outDir),
      ...(seqOpts.dirName ? { dirName: seqOpts.dirName } : {}),
      ...(seqOpts.every ? { every: seqOpts.every } : {}),
      concurrency,
      baseName: "frame",
    });
  }
  if (options.spriteSheet) {
    const spriteOpts = options.spriteSheet === true ? {} : options.spriteSheet;
    const result = await renderSpriteSheet(renderer, reactFrameSource(capture, chunkNodes, css, surface, frameMs), {
      concurrency,
      ...spriteOpts,
    });
    spriteSheet = { png: result.png, meta: result.meta, bytes: result.bytes, ms: result.ms, paths: { png: null, json: null } };
  }

  // --- Budget --------------------------------------------------------------
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const overBudgetFiles = files.filter((f) => !f.withinBudget);
  for (const f of overBudgetFiles) {
    warnings.push(
      `${f.format} is ${formatBytes(f.bytes)} — over the '${meta.presetName}' budget of ${formatBytes(surface.budgetBytes)}. ` +
      `Lower fps, shorten scenes, or flatten visuals (state-heavy banners create more unique frames — WebP carries them cheaper than GIF).`,
    );
  }

  const report: ReactBannerReport = {
    preset: meta.presetName,
    width: surface.width,
    height: surface.height,
    devicePixelRatio: surface.devicePixelRatio,
    physicalWidth: deviceWidth,
    physicalHeight: deviceHeight,
    fps,
    frames: capture.outputFrames,
    durationMs: capture.outputFrames * frameMs,
    scenes: capture.plan.scenes.length,
    chunks: capture.chunks.length,
    mergedFrames: capture.outputFrames - capture.chunks.length,
    cssEntries: css.length,
    files,
    posters,
    extents,
    seam,
    fonts: fontResult,
    totalBytes,
    budgetBytes: surface.budgetBytes,
    overBudget: overBudgetFiles.length > 0,
    warnings,
    collapse,
    surface: toSurfaceBlock(surface),
    timings: {
      captureMs,
      parseMs,
      auditMs,
      encodeMs,
      totalMs: performance.now() - pipelineT0,
    },
    lint: collectLintWarnings([
      ...capture.lint,
      ...lintFontSpecs(meta.fonts),
      ...lintGlowDither(capture.chunks.map((c) => c.html), surface.formats, surface.devicePixelRatio),
      ...layoutShiftWarnings(shiftFindings),
      ...(meta.loop && seam.mode === "differs"
        ? [{
            code: "TM_LOOP_SEAM" as const,
            message: `loop is declared but frame 0 ≠ the final frame — the GIF will visibly jump at the seam.`,
            hint:
              "Declare enter=\"wrap\" (or exit=\"wrap\") on the LAST <Scene> so its exit crossfades into scene 1's frozen frame-0 layer — " +
              "the wrap tail makes the seam byte-exact by construction.",
            severity: "warn" as const,
          }]
        : []),
    ]),
    tempo: capture.window.tempo,
    window: { from: capture.window.from, to: capture.window.to },
    ...(options.explain ? { explain: explainCapture(capture) } : {}),
    ...(sequence ? { sequence } : {}),
    ...(spriteSheet ? { spriteSheet } : {}),
  };

  if (options.outDir) {
    const outDir = resolve(options.outDir);
    mkdirSync(outDir, { recursive: true });
    for (const file of files) {
      const path = join(outDir, `${baseName}.${EXT[file.format]}`);
      writeFileSync(path, file.buffer);
      file.path = path;
    }
    for (const poster of posters) {
      const path = join(outDir, `${baseName}-poster-f${poster.frame}.png`);
      writeFileSync(path, poster.buffer);
      poster.path = path;
    }
    if (spriteSheet) {
      const pngPath = join(outDir, `${baseName}-spritesheet.png`);
      const jsonPath = join(outDir, `${baseName}-spritesheet.json`);
      writeFileSync(pngPath, spriteSheet.png);
      writeFileSync(jsonPath, JSON.stringify(spriteSheet.meta, null, 2));
      spriteSheet.paths = { png: pngPath, json: jsonPath };
    }
  }

  return report;
}

/**
 * FrameSource adapter over a react capture: frame → (chunk node, local timeMs).
 * Holds are copy-safe only when no css entry animates (see sequence-export).
 */
function reactFrameSource(
  capture: CaptureResult,
  chunkNodes: Node[],
  css: string[],
  surface: ResolvedSurface,
  frameMs: number,
) {
  const holdsStatic = !css.some((entry) => /@keyframes|animation(-name|-duration)?\s*:/i.test(entry));
  return {
    renderAt: (frame: number) => {
      const ci = chunkIndexForFrame(capture, frame);
      return { node: chunkNodes[ci], timeMs: (frame - capture.chunks[ci].startFrame) * frameMs };
    },
    css,
    frames: capture.outputFrames,
    frameMs,
    fps: surface.fps,
    width: deviceSize(surface).width,
    height: deviceSize(surface).height,
    devicePixelRatio: surface.devicePixelRatio,
    chunkIndexForFrame: (frame: number) => chunkIndexForFrame(capture, frame),
    chunkKey: (ci: number) => `chunk-${ci}`,
    holdsStatic,
  };
}

/** Human-readable report (CLI). */
export function formatReactReport(report: ReactBannerReport): string {
  const lines: string[] = [];
  lines.push(
    `${report.physicalWidth}×${report.physicalHeight} @ ${report.fps}fps · ${report.frames} frames · ` +
    `${report.scenes} scenes → ${report.chunks} chunks (${report.mergedFrames} holds merged) · ` +
    `${Math.round(report.durationMs)}ms · preset '${report.preset}'` +
    (report.tempo !== undefined && report.tempo !== 1 ? ` · tempo ×${report.tempo}` : "") +
    (report.window && (report.window.from > 0 || report.window.to < report.frames + report.window.from)
      ? ` · window [${report.window.from}, ${report.window.to})`
      : ""),
  );
  for (const file of report.files) {
    lines.push(
      `  ${file.format.padEnd(4)} ${formatBytes(file.bytes).padStart(9)}  ${file.ms.toFixed(0).padStart(5)}ms  ` +
      `${file.frames !== null ? `${file.frames}f  ` : ""}` +
      `${file.withinBudget ? "ok" : "OVER BUDGET"}${file.path ? `  → ${file.path}` : ""}`,
    );
  }
  if (report.collapse) {
    const c = report.collapse;
    lines.push(
      `  gif holds: ${c.framesBefore}f → ${c.framesAfter}f  (−${formatBytes(c.bytesBefore - c.bytesAfter)}, holds merged)`,
    );
  }
  for (const poster of report.posters) {
    lines.push(
      `  poster ${formatBytes(poster.bytes).padStart(8)}  @ frame ${poster.frame}` +
      `${poster.path ? `  → ${poster.path}` : ""}`,
    );
  }
  lines.push(
    `  extents: ${report.extents.chunksChecked} chunks audited${
      report.extents.transitionChunksSkipped > 0 ? ` (${report.extents.transitionChunksSkipped} transition chunks exempted)` : ""
    }, ${report.extents.violations.length} findings`,
  );
  for (const v of report.extents.violations.slice(0, 8)) {
    lines.push(`    ${v.decorative ? "warn" : "FAIL"} f${v.frame} ${v.edge} +${v.overflowPx.toFixed(1)}px — ${v.target}`);
  }
  lines.push(`  seam: ${report.seam.mode}${report.seam.loop ? " (loop declared)" : ""}`);
  if (report.explain) {
    lines.push(formatExplain(report.explain));
  }
  if (report.surface.customized) {
    const s = report.surface;
    lines.push(
      `  surface: ${s.width}×${s.height} @${s.devicePixelRatio}x${
        s.background === null ? " · transparent" : s.background ? ` · bg ${s.background}` : ""
      } (user-given)`,
    );
  }
  if (report.sequence) {
    lines.push(
      `  sequence: ${report.sequence.frameCount} PNG frames → ${report.sequence.dir} (${formatBytes(report.sequence.bytes)})`,
    );
  }
  if (report.spriteSheet) {
    const m = report.spriteSheet.meta;
    lines.push(
      `  sprite: ${m.columns}×${m.rows} atlas of ${m.frameWidth}×${m.frameHeight} cells (${formatBytes(report.spriteSheet.bytes)})${report.spriteSheet.paths.png ? `  → ${report.spriteSheet.paths.png}` : ""}`,
    );
  }
  if (report.timings) {
    const t = report.timings;
    lines.push(
      `  timings: capture ${t.captureMs.toFixed(0)}ms · parse ${t.parseMs.toFixed(0)}ms · audit ${t.auditMs.toFixed(0)}ms · encode ${t.encodeMs.toFixed(0)}ms · total ${t.totalMs.toFixed(0)}ms`,
    );
  }
  for (const warning of report.warnings) lines.push(`  ⚠ ${warning}`);
  if (report.lint.length > 0) {
    lines.push(`  lint: ${report.lint.length} finding(s)`);
    lines.push(...formatLint(report.lint));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Chunk extent audit
// ---------------------------------------------------------------------------

function chunkIndexForFrame(capture: CaptureResult, frame: number): number {
  for (let i = capture.chunks.length - 1; i >= 0; i--) {
    if (frame >= capture.chunks[i].startFrame) return i;
  }
  return 0;
}

/**
 * Measure every unique chunk once (bounded-parallel). The trees feed BOTH
 * the extent audit and the v0.9 layout-shift lint — one measurement pass.
 */
export async function measureChunks(
  renderer: Renderer,
  chunkNodes: Node[],
  opts: { width: number; height: number; concurrency?: number },
): Promise<MeasuredNode[]> {
  return mapWithConcurrency(chunkNodes, resolveConcurrency(opts.concurrency), (node) =>
    renderer.measure(node as never, {
      width: opts.width,
      height: opts.height,
    } as never),
  );
}

/**
 * Walk each unique chunk's measured tree. takumi's MeasuredNode.transform is
 * ABSOLUTE — the translation components carry the final canvas position and
 * the full ancestor chain is already baked in (verified by probe: a nested
 * margin'ed box reports 100+20, 50+10). So each node's matrix is used as-is;
 * recursion only descends for labels. Text nodes hard-fail outside the
 * canvas (clipped glyphs = lost content, the v0.1 overflow disaster);
 * non-text boxes warn at the safe zone (decorative bleed is often
 * intentional).
 */
export async function auditChunks(
  renderer: Renderer,
  capture: CaptureResult,
  chunkNodes: Node[],
  opts: { width: number; height: number; safeZone: number; concurrency?: number },
  premeasured?: MeasuredNode[],
): Promise<ChunkExtentReport> {
  const violations: ReactExtentViolation[] = [];
  const canvas = { width: opts.width, height: opts.height };

  // v0.9.1 — scene-enter overlap frames are AUTHORED full-canvas motion:
  // push/slide carry the arriving scene in from beyond the canvas edge by
  // design. The frame-local audit cannot attribute that intent, so those
  // chunks are counted but not walked (real overflow inside a scene body is
  // still caught on every non-overlap chunk).
  const transitionFrames = new Set<number>();
  for (const scene of capture.plan.scenes) {
    for (let f = scene.startFrame; f < scene.startFrame + scene.enterFrames; f++) {
      transitionFrames.add(f);
    }
  }

  // Measure (or reuse the shared pass): bounded-parallel napi tasks, walked
  // in chunk order afterwards.
  const measured = premeasured ?? await measureChunks(renderer, chunkNodes, {
    width: canvas.width,
    height: canvas.height,
    concurrency: opts.concurrency,
  });
  let transitionChunksSkipped = 0;
  for (let i = 0; i < measured.length; i++) {
    const frame = capture.chunks[i].startFrame;
    if (transitionFrames.has(frame)) {
      transitionChunksSkipped++;
      continue;
    }
    walkMeasured(measured[i], "", frame, canvas, opts.safeZone, violations);
  }

  return { canvas, safeZonePx: opts.safeZone, chunksChecked: chunkNodes.length, transitionChunksSkipped, violations };
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];
void IDENTITY_MATRIX;

function walkMeasured(
  node: MeasuredNode,
  path: string,
  frame: number,
  canvas: { width: number; height: number },
  safeZone: number,
  out: ReactExtentViolation[],
): void {
  const m = node.transform as Matrix;

  const corners: Array<[number, number]> = [
    [0, 0], [node.width, 0], [0, node.height], [node.width, node.height],
  ].map(([x, y]) => [
    m[0] * x + m[2] * y + m[4],
    m[1] * x + m[3] * y + m[5],
  ]);

  const minX = Math.min(...corners.map((p) => p[0]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const maxY = Math.max(...corners.map((p) => p[1]));

  const hasText = node.runs.length > 0;
  const label = hasText
    ? `${path || "canvas"} text "${truncate(node.runs.map((r) => r.text).join(""))}"`
    : path || "canvas";

  // Note: MeasuredTextRun x/y are CONTENT-BOX-relative, not canvas space, so
  // extent checks use the node box — a conservative superset of its runs
  // (taffy wraps text inside the box). Text-bearing nodes hard-fail beyond
  // the canvas; plain boxes only warn.
  pushViolations(out, label, frame, canvas, safeZone, { minX, maxX, minY, maxY }, !hasText);

  node.children.forEach((child, i) => {
    walkMeasured(child, `${path ? `${path} > ` : ""}${i}`, frame, canvas, safeZone, out);
  });
}

function pushViolations(
  out: ReactExtentViolation[],
  target: string,
  frame: number,
  canvas: { width: number; height: number },
  safeZone: number,
  box: { minX: number; maxX: number; minY: number; maxY: number },
  decorative: boolean,
): void {
  const edges: Array<{ edge: "left" | "right" | "top" | "bottom"; over: number }> = [
    { edge: "left", over: safeZone - box.minX },
    { edge: "right", over: box.maxX - (canvas.width - safeZone) },
    { edge: "top", over: safeZone - box.minY },
    { edge: "bottom", over: box.maxY - (canvas.height - safeZone) },
  ];
  for (const { edge, over } of edges) {
    if (over <= 0) continue;
    const beyondCanvas =
      (edge === "left" && box.minX < 0) ||
      (edge === "right" && box.maxX > canvas.width) ||
      (edge === "top" && box.minY < 0) ||
      (edge === "bottom" && box.maxY > canvas.height);
    // Hard-fail only when content leaves the CANVAS; safe-zone softness warns.
    if (beyondCanvas) {
      out.push({
        frame,
        target,
        edge,
        overflowPx: over,
        decorative,
        detail: `${target} crosses the canvas ${edge} edge by ${over.toFixed(1)}px at frame ${frame}` +
          (decorative ? " (decorative — check if intentional)" : " — TEXT WILL CLIP"),
      });
    } else if (!decorative) {
      out.push({
        frame,
        target,
        edge,
        overflowPx: over,
        decorative: true,
        detail: `${target} enters the ${safeZone}px safe zone at the ${edge} edge by ${over.toFixed(1)}px (frame ${frame})`,
      });
    }
  }
}

function truncate(s: string, max = 24): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Lazily resolve the shared template renderer (fonts + measurement parity). */
async function defaultRenderer(): Promise<Renderer> {
  const shared = await import("./templates/shared.js");
  return shared.getSharedRenderer();
}

// Keep the presets table referenced for custom-preset reconstruction paths.
void bannerPresets;
