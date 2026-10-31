// takumi-motion — kit.ts
// One banner, the whole asset set: render a template result across a preset
// ladder (standard GIF+WebP, retina WebP, lean GIF) plus the poster and its
// static twin (the prefers-reduced-motion fallback). Repo owners get a
// complete README asset kit from one source of truth.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderBanner, type BannerReport } from "./render.js";
import { resolvePreset } from "./presets.js";
import type { FontSpec } from "./fonts.js";
import type { ReactElementLike, TimelineJSON } from "./types.js";

export interface KitBanner {
  element?: ReactElementLike;
  node?: unknown;
  timeline: TimelineJSON;
  /** Font specs the banner needs (template results carry these). */
  fonts?: FontSpec[];
}

export interface KitOptions {
  outDir: string;
  /** Preset names to render. Default ["readme", "readme-hd", "readme-lean"]. */
  presets?: string[];
  /** Base file name. Default "banner". Files: <base>.<ext> per variant is
   *  ambiguous across presets — kit names files <base>-<preset>.<ext>. */
  baseName?: string;
  /** Poster timestamps in ms (per variant, same times). Default 60% frame. */
  posters?: number[] | false;
  /** Emit the static twin PNG (poster copy named <base>-static.png). Default true. */
  staticTwin?: boolean;
}

export interface KitReport {
  variants: Array<{ preset: string; report: BannerReport }>;
  files: Array<{ path: string; role: string }>;
  totalBytes: number;
}

const DEFAULT_KIT_PRESETS = ["readme", "readme-hd", "readme-lean"];

export async function renderKit(banner: KitBanner, options: KitOptions): Promise<KitReport> {
  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });
  const baseName = options.baseName ?? "banner";
  const presets = options.presets ?? DEFAULT_KIT_PRESETS;
  const files: KitReport["files"] = [];
  const variants: KitReport["variants"] = [];
  let totalBytes = 0;

  for (const presetName of presets) {
    const preset = resolvePreset(presetName);
    const report = await renderBanner({
      node: (banner.element ?? banner.node) as never,
      timeline: banner.timeline,
      preset,
      fonts: banner.fonts,
      outDir,
      baseName: `${baseName}-${presetName}`,
      posters: options.posters,
    });
    variants.push({ preset: presetName, report });
    totalBytes += report.totalBytes;

    for (const file of report.files) {
      if (file.path) files.push({ path: file.path, role: `${presetName} ${file.format}` });
    }
    for (const poster of report.posters) {
      if (poster.path) files.push({ path: poster.path, role: `${presetName} poster` });
    }

    // Static twin: the first variant's first poster doubles as the
    // prefers-reduced-motion fallback.
    if ((options.staticTwin ?? true) && variants.length === 1 && report.posters[0]) {
      const twinPath = join(outDir, `${baseName}-static.png`);
      writeFileSync(twinPath, report.posters[0].buffer);
      files.push({ path: twinPath, role: "static twin (reduced-motion fallback)" });
    }
  }

  return { variants, files, totalBytes };
}

/** vite-style kit report for the CLI. */
export function formatKitReport(kit: KitReport): string {
  const lines: string[] = [];
  lines.push(`kit: ${kit.variants.length} variants, ${kit.files.length} files, ${formatTotal(kit.totalBytes)}`);
  for (const v of kit.variants) {
    const sizes = v.report.files.map((f) => `${f.format} ${formatBytes2(f.bytes)}`).join(" · ");
    lines.push(`  ${v.preset.padEnd(14)} ${sizes}`);
  }
  for (const f of kit.files) lines.push(`  → ${f.path}`);
  return lines.join("\n");
}

function formatBytes2(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function formatTotal(bytes: number): string {
  return formatBytes2(bytes);
}
