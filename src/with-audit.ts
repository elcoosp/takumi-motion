// takumi-motion — with-audit.ts (v0.4)
// renderWithAudit() — one call, one JSON answer. The embeddability contract:
// a host platform (CI job, og-image server, banner service) calls this and
// gets back machine-readable verdicts — no stdout scraping.
//
// Works over ALL source paths:
//   { banner }                     → React runtime (v0.3 director)
//   { node, timeline }             → declarative path
//   { html, css? }                 → raw HTML path (v0.4)
//
// The audit block is pure data:
//   surface        — the resolved output spec that was actually used
//   budget         — per-file verdicts + totals
//   extents        — measured-tree audit (react path; null elsewhere)
//   seam           — loop seam verdict (react path)
//   determinism    — byte-determinism probe: the WHOLE render runs twice and
//                    the poster buffers are compared (a real second render,
//                    not a cache hit). Opt out with skipDeterminismProbe.
//   exitCode       — 0 pass · 1 content failure (extent/clipping) · 2 over budget

import { readFileSync } from "node:fs";
import { renderReactBanner, formatReactReport, type ReactBannerReport } from "./react-render.js";
import { renderBanner, formatReport, type BannerReport } from "./render.js";
import { renderHtmlAnimation, type HtmlSourceReport } from "./html-source.js";
import { formatBytes, resolvePreset, type BannerPreset } from "./presets.js";
import type { FontSpec, FontFileSpec } from "./fonts.js";
import type { SpriteSheetOptions } from "./sprite.js";
import type { Renderer } from "takumi-js/node";
import type { Node } from "@takumi-rs/helpers";
import type { TimelineJSON } from "./types.js";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface WithAuditOptions {
  /** React banner (element or defineBanner() component) — path 1. */
  banner?: unknown;
  /** Declarative source — path 2. */
  node?: Node;
  timeline?: TimelineJSON;
  /** Raw HTML source — path 3. */
  html?: string;
  css?: string | string[];
  /** Frames for the html path (duration in frames). Default 30. */
  frames?: number;

  // Surface — user-given, wins over presets/components (CLI > component > preset)
  width?: number;
  height?: number;
  dpr?: number;
  fps?: number;
  formats?: ("gif" | "webp" | "apng")[];
  quality?: number;
  lossless?: boolean;
  /** Canvas background ("transparent" supported; html path only). */
  background?: string | null;
  budgetBytes?: number;

  outDir?: string;
  baseName?: string;
  posters?: number[] | false;
  fonts?: FontSpec[];
  fontFiles?: FontFileSpec[];
  renderer?: Renderer;
  /** PNG frame sequence export alongside the files. Requires outDir. */
  sequence?: boolean | { every?: number; dirName?: string };
  /** Sprite-sheet export alongside the files. Requires outDir. */
  spriteSheet?: boolean | SpriteSheetOptions;
  /** Skip the byte-determinism probe (saves one full re-render). Default false. */
  skipDeterminismProbe?: boolean;
  /** Extent-audit safe zone (react path). Default 8. */
  safeZone?: number;
}

// ---------------------------------------------------------------------------
// Audit data model
// ---------------------------------------------------------------------------

export interface BudgetFileVerdict {
  format: string;
  bytes: number;
  withinBudget: boolean;
}

export interface SurfaceAudit {
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

export interface AuditReport {
  /** The engine version that produced this audit. */
  generator: "takumi-motion";
  generatorVersion: string;
  /** Which source path handled the render. */
  source: "react" | "declarative" | "html";
  surface: SurfaceAudit;
  timeline: { frames: number; durationMs: number };
  budget: {
    budgetBytes: number;
    totalBytes: number;
    overBudget: boolean;
    files: BudgetFileVerdict[];
  };
  /** Extent findings. react: measured trees per chunk; others: null. */
  extents: {
    checked: number;
    violations: Array<{ frame: number; target: string; edge: string; overflowPx: number; decorative: boolean }>;
    hardFailures: number;
  } | null;
  seam: { mode: string; loop: boolean } | null;
  determinism: {
    /** true = two full renders produced byte-identical posters. */
    deterministic: boolean | null;
    /** Bytes compared by the probe (0 when skipped). */
    checkedBytes: number;
    detail: string;
  };
  warnings: string[];
}

export interface WithAuditResult {
  /** The full pipeline report (ReactBannerReport | BannerReport | HtmlSourceReport). */
  report: ReactBannerReport | BannerReport | HtmlSourceReport;
  /** The machine-readable audit verdict. */
  audit: AuditReport;
  /** 0 pass · 1 content failure (text clipping / extent hard-fail) · 2 over budget. */
  exitCode: 0 | 1 | 2;
  /** Human-readable rendering of the pipeline report (for logs). */
  formatted: string;
}

const pkgVersion = readVersion();

export async function renderWithAudit(options: WithAuditOptions): Promise<WithAuditResult> {
  const source: WithAuditResult["audit"]["source"] =
    options.banner !== undefined ? "react" : options.html !== undefined ? "html" : "declarative";

  if (source === "react") {
    const report = await renderReactBanner({
      banner: options.banner,
      width: options.width,
      height: options.height,
      dpr: options.dpr,
      fps: options.fps,
      formats: options.formats,
      quality: options.quality,
      lossless: options.lossless,
      budgetBytes: options.budgetBytes,
      outDir: options.outDir,
      baseName: options.baseName,
      posters: options.posters,
      fonts: options.fonts,
      renderer: options.renderer,
      sequence: options.sequence,
      spriteSheet: options.spriteSheet,
      safeZone: options.safeZone,
    } as never);
    return finalize(report, source, options);
  }

  if (source === "html") {
    const report = await renderHtmlAnimation({
      html: options.html!,
      ...(options.css !== undefined ? { css: options.css } : {}),
      ...(options.frames !== undefined ? { frames: options.frames } : {}),
      width: options.width,
      height: options.height,
      dpr: options.dpr,
      fps: options.fps,
      formats: options.formats,
      quality: options.quality,
      lossless: options.lossless,
      background: options.background,
      budgetBytes: options.budgetBytes,
      outDir: options.outDir,
      baseName: options.baseName,
      posters: options.posters,
      fonts: options.fonts,
      fontFiles: options.fontFiles,
      renderer: options.renderer,
    });
    return finalize(report, source, options);
  }

  if (!options.node || !options.timeline) {
    throw new Error(
      "renderWithAudit: pass `banner` (React), `html` (+ optional `css`), or `node` + `timeline` (declarative).",
    );
  }
  const report = await renderBanner({
    node: options.node,
    timeline: options.timeline,
    ...(declarativePreset(options) ? { preset: declarativePreset(options) } : {}),
    ...(options.formats ? { formats: options.formats } : {}),
    ...(options.fps ? { fps: options.fps } : {}),
    outDir: options.outDir,
    ...(options.baseName ? { baseName: options.baseName } : {}),
    posters: options.posters,
    fonts: options.fonts,
    renderer: options.renderer,
    ...(options.quality !== undefined ? { webpQuality: options.quality } : {}),
  });
  return finalize(report, source, options);
}

// ---------------------------------------------------------------------------
// Audit assembly
// ---------------------------------------------------------------------------

async function finalize(
  report: ReactBannerReport | BannerReport | HtmlSourceReport,
  source: "react" | "declarative" | "html",
  options: WithAuditOptions,
): Promise<WithAuditResult> {
  const files = report.files;
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);

  // All three pipelines now report a resolved surface block.
  const surfaceAudit: SurfaceAudit = { ...report.surface };

  const frames = report.frames;
  const durationMs = report.durationMs;
  const budgetBytesValue = report.budgetBytes;
  const overBudget = report.overBudget;

  const determinism = await probeDeterminism(options, report.posters[0]?.buffer);

  const warnings: string[] = [...(report.warnings ?? [])];
  const extentsBlock = (report as ReactBannerReport).extents;
  if (extentsBlock?.violations) {
    for (const v of extentsBlock.violations) warnings.push(v.detail);
  }

  const hardFailures = extentsBlock ? extentsBlock.violations.filter((v) => !v.decorative).length : 0;

  const audit: AuditReport = {
    generator: "takumi-motion",
    generatorVersion: pkgVersion,
    source,
    surface: surfaceAudit,
    timeline: { frames, durationMs },
    budget: {
      budgetBytes: budgetBytesValue,
      totalBytes,
      overBudget,
      files: files.map((f) => ({ format: f.format, bytes: f.bytes, withinBudget: f.withinBudget })),
    },
    extents: extentsBlock
      ? {
          checked: extentsBlock.chunksChecked,
          violations: extentsBlock.violations.map((v) => ({
            frame: v.frame,
            target: v.target,
            edge: v.edge,
            overflowPx: v.overflowPx,
            decorative: v.decorative,
          })),
          hardFailures,
        }
      : null,
    seam: (report as ReactBannerReport).seam
      ? { mode: (report as ReactBannerReport).seam.mode, loop: (report as ReactBannerReport).seam.loop }
      : null,
    determinism,
    warnings,
  };

  const exitCode: 0 | 1 | 2 = hardFailures > 0 ? 1 : overBudget ? 2 : 0;

  const formatted =
    source === "react"
      ? formatReactReport(report as ReactBannerReport)
      : source === "declarative"
        ? formatReport(report as BannerReport)
        : htmlFormat(report as HtmlSourceReport);

  return { report, audit, exitCode, formatted };
}

/**
 * Byte-determinism probe: re-run the WHOLE render once (posters only, no
 * determinism recursion, no writes) and compare the first poster's bytes.
 * Catches Math.random leaks (the capture shim already warns) and wall-clock
 * reads in scene components.
 */
async function probeDeterminism(
  options: WithAuditOptions,
  firstPoster: Buffer | undefined,
): Promise<AuditReport["determinism"]> {
  if (options.skipDeterminismProbe) {
    return { deterministic: null, checkedBytes: 0, detail: "probe skipped (skipDeterminismProbe)" };
  }
  if (!firstPoster) {
    return { deterministic: null, checkedBytes: 0, detail: "no poster rendered to probe" };
  }
  try {
    const second = await renderWithAudit({
      ...options,
      skipDeterminismProbe: true,
      outDir: undefined,
      sequence: undefined,
      spriteSheet: undefined,
    });
    const secondPoster = second.report.posters[0]?.buffer;
    if (!secondPoster) {
      return { deterministic: null, checkedBytes: 0, detail: "probe re-run produced no poster" };
    }
    const same = firstPoster.length === secondPoster.length && firstPoster.equals(secondPoster);
    return {
      deterministic: same,
      checkedBytes: firstPoster.length,
      detail: same
        ? `full re-render byte-identical (poster, ${firstPoster.length} bytes)`
        : `full re-render DIFFERS (poster ${firstPoster.length} vs ${secondPoster.length} bytes) — check for Math.random/wall-clock use in scenes`,
    };
  } catch (err) {
    return {
      deterministic: null,
      checkedBytes: 0,
      detail: `probe failed to run: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function declarativePreset(options: WithAuditOptions): string | BannerPreset | undefined {
  if (
    options.width === undefined && options.height === undefined &&
    options.dpr === undefined && options.budgetBytes === undefined
  ) {
    return undefined; // default "readme" — v0.1–v0.3 behavior preserved
  }
  const base = resolvePreset("readme");
  return {
    ...base,
    ...(options.width !== undefined ? { width: options.width } : {}),
    ...(options.height !== undefined ? { height: options.height } : {}),
    ...(options.dpr !== undefined ? { devicePixelRatio: options.dpr } : {}),
    ...(options.budgetBytes !== undefined ? { budgetBytes: options.budgetBytes } : {}),
  };
}

function htmlFormat(report: HtmlSourceReport): string {
  const lines: string[] = [];
  const s = report.surface;
  lines.push(
    `${s.physicalWidth}×${s.physicalHeight} @ ${s.fps}fps · ${report.frames} frames · ${Math.round(report.durationMs)}ms · html source`,
  );
  for (const f of report.files) {
    lines.push(
      `  ${f.format.padEnd(4)} ${formatBytes(f.bytes).padStart(9)}  ${f.ms.toFixed(0).padStart(5)}ms  ` +
      `${f.frames !== null ? `${f.frames}f  ` : ""}${f.withinBudget ? "ok" : "OVER BUDGET"}`,
    );
  }
  for (const p of report.posters) {
    lines.push(`  poster ${formatBytes(p.bytes).padStart(8)}  @ ${Math.round(p.timeMs)}ms`);
  }
  for (const w of report.warnings) lines.push(`  ⚠ ${w}`);
  return lines.join("\n");
}

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.4.0";
  }
}
