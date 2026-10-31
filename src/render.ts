// takumi-motion — render.ts
// High-level banner render pipeline: TimelineJSON + node → compiled CSS →
// Takumi renderAnimation (one napi call per format) → hold-collapse → files
// + size report.
//
// v0.2: the pipeline defaults to the SHARED renderer (the one templates
// measure-fit on), so Google Fonts registered for measurement are exactly
// the faces that render. GIF buffers pass through collapseGifHolds() — the
// WebP encoder merges identical holds natively; GIF gets it post-hoc.
//
// Everything is deterministic: same node + timeline + preset ⇒ same bytes.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Renderer } from "takumi-js/node";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import type { Node } from "@takumi-rs/helpers";
import { compileTimeline, type CompiledTimeline } from "./compile.js";
import { bannerPresets, formatBytes, resolvePreset, type AnimationFormat, type BannerPreset } from "./presets.js";
import { collapseGifHolds, gifStats } from "./size.js";
import { ensureFonts, type FontLoadResult, type FontSpec } from "./fonts.js";
import type { ReactElementLike, TimelineJSON } from "./types.js";
import { resolveSurface, deviceSize, type SurfaceSpec } from "./surface.js";
import { toSurfaceBlock, type SurfaceReportBlock } from "./html-source.js";
import { exportFrameSequence, type SequenceExportResult } from "./sequence-export.js";
import { renderSpriteSheet, type SpriteSheetOptions, type SpriteSheetMeta } from "./sprite.js";

const isReactElement = (n: unknown): n is ReactElementLike =>
  typeof n === "object" && n !== null && "props" in (n as object) && "type" in (n as object);

export interface RenderBannerOptions extends SurfaceSpec {
  /** Takumi node tree, or a React-shaped element / template result (fromJsx is run automatically). */
  node: Node | ReactElementLike;
  /** Authored timeline. Seamless loops: pass it through fadeWrap() first. */
  timeline: TimelineJSON;
  /** Preset name ("readme", "readme-lean", ...) or a custom preset object. Default "readme".
   *  A preset is a RECIPE — explicit width/height/dpr/fps/formats/quality/lossless/
   *  background/budgetBytes options win over it (v0.4). */
  preset?: string | BannerPreset;
  /** Override the preset's formats. */
  formats?: AnimationFormat[];
  /** Override the preset's fps (compile grid + render fps are kept in sync). */
  fps?: number;
  /** Directory to write files into. When omitted, nothing is written — buffers come back in the report. */
  outDir?: string;
  /** Base file name (no extension). Default "banner". */
  baseName?: string;
  /** Poster PNG timestamps (ms). Default: one poster at 60% of the timeline —
   *  the settled, content-visible frame (t=0 is intentionally blank in
   *  seamless-loop banners). Pass `false` to skip, or explicit ms values. */
  posters?: number[] | false;
  /** Reuse a Renderer across calls. DEFAULT: the shared template renderer —
   *  fonts a template registered for measurement are already loaded there. */
  renderer?: Renderer;
  /** Google Font specs to register before rendering (deduped per renderer).
   *  Template results carry their own `fonts`; the CLI passes them through. */
  fonts?: FontSpec[];
  /** WebP quality override (preset default otherwise). Alias of `quality`. */
  webpQuality?: number;
  /** Set false to skip GIF hold collapsing (rarely wanted). Default true. */
  collapseGifHolds?: boolean;
  /** Export a PNG frame sequence (+ frames.json manifest) under outDir. Requires outDir. */
  sequence?: boolean | { every?: number; dirName?: string };
  /** Export a sprite-sheet atlas (+ metadata JSON) under outDir. Requires outDir. */
  spriteSheet?: boolean | SpriteSheetOptions;
  /** Encode formats concurrently. Default true. */
  parallel?: boolean;
}

export interface RenderedFile {
  /** Absolute path when outDir was given, null otherwise. */
  path: string | null;
  format: AnimationFormat;
  bytes: number;
  ms: number;
  /** true when bytes ≤ preset.budgetBytes. */
  withinBudget: boolean;
  /** Encoded frame count (post-collapse for GIF). */
  frames: number | null;
  buffer: Buffer;
}

export interface CollapseStats {
  framesBefore: number;
  framesAfter: number;
  bytesBefore: number;
  bytesAfter: number;
}

export interface BannerReport {
  preset: string;
  width: number;
  height: number;
  devicePixelRatio: number;
  physicalWidth: number;
  physicalHeight: number;
  fps: number;
  frames: number;
  durationMs: number;
  /** CSS entries the compiler emitted (springs baked on the fps grid). */
  cssEntries: number;
  files: RenderedFile[];
  posters: Array<{ path: string | null; timeMs: number; bytes: number; buffer: Buffer }>;
  /** GIF hold-collapse result when a GIF was rendered (WebP collapses natively). */
  collapse: CollapseStats | null;
  /** Fonts registered for this render (deduped against the renderer's state). */
  fonts: FontLoadResult | null;
  totalBytes: number;
  budgetBytes: number;
  overBudget: boolean;
  warnings: string[];
  /** v0.4 — the fully resolved output surface. */
  surface: SurfaceReportBlock;
  /** v0.4 — PNG frame sequence export result (when requested). */
  sequence?: SequenceExportResult;
  /** v0.4 — sprite-sheet export result (when requested). */
  spriteSheet?: { png: Buffer; meta: SpriteSheetMeta; bytes: number; ms: number; paths: { png: string | null; json: string | null } };
  /** v0.6 — the authoring lint (compile-time findings: TM_SPRING_DURATION …). */
  lint: import("./lint.js").LintWarning[];
}

const EXT: Record<AnimationFormat, string> = { gif: "gif", webp: "webp", apng: "png" };

/** Lazily resolve the shared template renderer (keeps this module import-light). */
async function defaultRenderer(): Promise<Renderer> {
  const shared = await import("./templates/shared.js");
  return shared.getSharedRenderer();
}

export async function renderBanner(options: RenderBannerOptions): Promise<BannerReport> {
  const rawNode = options.node;
  const node: Node = isReactElement(rawNode) ? (await fromJsx(rawNode as never)).node : rawNode;
  const timeline = options.timeline;
  const warnings: string[] = [];

  // Surface: explicit options > preset (a preset is a recipe, not a constraint).
  const surface = resolveSurface(
    {
      ...(options.width !== undefined ? { width: options.width } : {}),
      ...(options.height !== undefined ? { height: options.height } : {}),
      ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
      ...(options.fps !== undefined ? { fps: options.fps } : {}),
      ...(options.formats ? { formats: options.formats } : {}),
      ...(options.webpQuality !== undefined ? { quality: options.webpQuality } : {}),
      ...(options.quality !== undefined ? { quality: options.quality } : {}),
      ...(options.lossless !== undefined ? { lossless: options.lossless } : {}),
      ...(options.budgetBytes !== undefined ? { budgetBytes: options.budgetBytes } : {}),
    },
    options.preset ?? "readme",
  );
  const fps = surface.fps;
  const baseName = options.baseName ?? "banner";

  // Compile on the same grid the renderer samples.
  const compiled: CompiledTimeline = compileTimeline(timeline, { fps });
  const frames = Math.max(1, Math.round((compiled.durationMs / 1000) * fps));

  const renderer = options.renderer ?? (await defaultRenderer());

  // Register requested fonts on THIS renderer (deduped — no re-fetch when the
  // template already loaded the same families for measurement).
  let fontResult: FontLoadResult | null = null;
  if (options.fonts && options.fonts.length > 0) {
    fontResult = await ensureFonts(renderer, options.fonts);
  }

  const files: RenderedFile[] = [];
  const posters: BannerReport["posters"] = [];
  let collapse: CollapseStats | null = null;

  // IMPORTANT: takumi's width/height options are DEVICE pixels, not CSS pixels.
  // The CSS layout viewport is (width / devicePixelRatio) × (height / devicePixelRatio)
  // — see takumi-core Viewport::to_device ("viewport.size, layout boxes and everything
  // downstream are device pixels"; CSS px values are multiplied by the dpr). Surface
  // width/height are logical CSS px, so we scale up here.
  const device = deviceSize(surface);
  const deviceWidth = device.width;
  const deviceHeight = device.height;

  const encodeFormat = async (format: AnimationFormat): Promise<RenderedFile> => {
    const t0 = performance.now();
    const raw = await renderer.renderAnimation({
      scenes: [{ node, durationMs: compiled.durationMs }],
      width: deviceWidth,
      height: deviceHeight,
      devicePixelRatio: surface.devicePixelRatio,
      fps,
      format,
      css: compiled.css as never,
      ...(format === "webp" ? (surface.lossless ? { lossless: true } : { quality: surface.quality }) : {}),
    });
    let buffer: Buffer = raw;
    let frameCount: number | null = gifStats(raw)?.frames ?? null;

    // GIF hold collapse: merge byte-identical frames (frozen ambient holds)
    // with accumulated delays. WebP does this natively in the encoder.
    if (format === "gif" && (options.collapseGifHolds ?? true)) {
      const result = collapseGifHolds(raw);
      if (result.collapsed) {
        const bytesBefore = raw.length;
        buffer = result.buffer;
        collapse = {
          framesBefore: result.framesBefore,
          framesAfter: result.framesAfter,
          bytesBefore,
          bytesAfter: result.buffer.length,
        };
      }
      frameCount = gifStats(buffer)?.frames ?? frameCount;
    }

    const ms = performance.now() - t0;
    return {
      path: null,
      format,
      bytes: buffer.length,
      ms,
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

  const posterTimes =
    options.posters === false
      ? []
      : (options.posters ?? [Math.round(compiled.durationMs * 0.6)]);
  for (const timeMs of posterTimes) {
    const buffer = await renderer.render(node, {
      width: deviceWidth,
      height: deviceHeight,
      devicePixelRatio: surface.devicePixelRatio,
      format: "png",
      timeMs,
      css: compiled.css as never,
    });
    posters.push({ path: null, timeMs, bytes: buffer.length, buffer });
  }

  // --- v0.4 outputs: PNG sequence + sprite sheet ---------------------------
  let sequence: SequenceExportResult | undefined;
  let spriteSheet: BannerReport["spriteSheet"];
  if ((options.sequence || options.spriteSheet) && !options.outDir) {
    throw new Error("renderBanner: `sequence`/`spriteSheet` export requires `outDir` (files are written to disk).");
  }
  const frameSource = {
    renderAt: (frame: number) => ({ node, timeMs: frame * (1000 / fps) }),
    css: compiled.css as unknown as string[],
    frames,
    frameMs: 1000 / fps,
    fps: surface.fps,
    width: deviceWidth,
    height: deviceHeight,
    devicePixelRatio: surface.devicePixelRatio,
    // Timeline css always animates — every frame renders at its own timeMs.
    holdsStatic: false,
  };
  if (options.sequence && options.outDir) {
    const seqOpts = options.sequence === true ? {} : options.sequence;
    sequence = await exportFrameSequence(renderer, frameSource, {
      outDir: resolve(options.outDir),
      ...(seqOpts.dirName ? { dirName: seqOpts.dirName } : {}),
      ...(seqOpts.every ? { every: seqOpts.every } : {}),
      baseName: "frame",
    });
  }
  if (options.spriteSheet && options.outDir) {
    const spriteOpts = options.spriteSheet === true ? {} : options.spriteSheet;
    const result = await renderSpriteSheet(renderer, frameSource, spriteOpts);
    spriteSheet = { png: result.png, meta: result.meta, bytes: result.bytes, ms: result.ms, paths: { png: null, json: null } };
  }

  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const overBudgetFiles = files.filter((f) => !f.withinBudget);
  if (overBudgetFiles.length > 0) {
    for (const f of overBudgetFiles) {
      warnings.push(
        `${f.format} is ${formatBytes(f.bytes)} — over the '${surface.presetName}' budget of ` +
          `${formatBytes(surface.budgetBytes)}. Try preset 'readme-lean', fewer frames (lower fps / shorter ` +
          `duration), or simpler visuals (fewer blurred layers).`
      );
    }
  }

  const report: BannerReport = {
    preset: surface.presetName,
    width: surface.width,
    height: surface.height,
    devicePixelRatio: surface.devicePixelRatio,
    physicalWidth: deviceWidth,
    physicalHeight: deviceHeight,
    fps,
    frames,
    durationMs: compiled.durationMs,
    cssEntries: compiled.css.length,
    files,
    posters,
    collapse,
    fonts: fontResult,
    totalBytes,
    budgetBytes: surface.budgetBytes,
    overBudget: overBudgetFiles.length > 0,
    warnings,
    surface: toSurfaceBlock(surface),
    lint: compiled.lint,
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
      const path = join(outDir, `${baseName}-poster${posters.length > 1 ? `-${Math.round(poster.timeMs)}` : ""}.png`);
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

function presetName(preset: BannerPreset): string {
  for (const [name, p] of Object.entries(bannerPresets)) {
    if (p === preset) return name;
  }
  return "custom";
}

/** Human-readable one-line-per-file report (used by the CLI and examples). */
export function formatReport(report: BannerReport): string {
  const lines: string[] = [];
  lines.push(
    `${report.physicalWidth}×${report.physicalHeight} @ ${report.fps}fps · ${report.frames} timeline frames · ` +
      `${Math.round(report.durationMs)}ms · preset '${report.preset}'`
  );
  for (const file of report.files) {
    lines.push(
      `  ${file.format.padEnd(4)} ${formatBytes(file.bytes).padStart(9)}  ${file.ms.toFixed(0).padStart(5)}ms  ` +
        `${file.frames !== null ? `${file.frames}f  ` : ""}` +
        `${file.withinBudget ? "ok" : "OVER BUDGET"}${file.path ? `  → ${file.path}` : ""}`
    );
  }
  if (report.collapse) {
    const c = report.collapse;
    const saved = c.bytesBefore - c.bytesAfter;
    lines.push(
      `  gif holds: ${c.framesBefore}f → ${c.framesAfter}f  (−${formatBytes(saved)}, holds merged)`
    );
  }
  for (const poster of report.posters) {
    lines.push(
      `  poster ${formatBytes(poster.bytes).padStart(8)}  @ ${Math.round(poster.timeMs)}ms` +
        `${poster.path ? `  → ${poster.path}` : ""}`
    );
  }
  for (const warning of report.warnings) lines.push(`  ⚠ ${warning}`);
  return lines.join("\n");
}
