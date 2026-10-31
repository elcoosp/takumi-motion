#!/usr/bin/env node
// takumi-motion — cli.ts
// Terminal surface for the banner kit:
//
//   takumi-motion render banner.ts --preset readme --out ./out
//   takumi-motion render banner.ts --kit --out ./assets
//   takumi-motion render banner.ts --budget 800000
//   takumi-motion check  banner.ts            # extents + seam audit (CI gate)
//   takumi-motion preview banner.ts -o banner-preview.html
//   takumi-motion init                        # scaffold a banner project
//   takumi-motion templates | presets | fonts
//
// The render command loads a TS/TSX/JS module that default-exports (or names)
// `banner` / `element` + `timeline` — a template result ({ element, timeline,
// fonts? }), or an async/sync function returning one.

import { pathToFileURL } from "node:url";
import { resolve, join, dirname } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { renderBanner, formatReport } from "./render.js";
import { renderReactBanner, formatReactReport } from "./react-render.js";
import { captureReactBanner } from "./react/capture.js";
import { renderReactPreviewHtml } from "./preview-react.js";
import { isDefinedBanner, isReactElementValue } from "./react/index.js";
import { bannerPresets, formatBytes, resolvePreset } from "./presets.js";
import { bannerTemplates, buildTemplate, type TemplateInvocation } from "./templates/index.js";
import { renderKit, formatKitReport } from "./kit.js";
import { checkBanner } from "./audit.js";
import { renderPreviewForBanner } from "./preview.js";
import { fontCatalog, type FontSpec } from "./fonts.js";
import type { BannerResult } from "./templates/shared.js";
import type { AnimationFormat } from "./presets.js";

interface RenderArgs {
  file?: string;
  preset: string;
  out: string;
  formats?: string[];
  fps?: number;
  budget?: number;
  kit: boolean;
  quiet: boolean;
  noPoster: boolean;
  preview: boolean;
  react: boolean;
  // v0.4 — unconstrained surface + outputs + audit
  width?: number;
  height?: number;
  dpr?: number;
  background?: string;
  quality?: number;
  lossless: boolean;
  durationFrames?: number;
  cssFile?: string;
  fontFiles: string[];
  sequence: boolean;
  spriteSheet: boolean;
  spriteColumns?: number;
  spriteEvery?: number;
  json: boolean;
  // v0.5 — single-frame render + bounded parallelism
  still: boolean;
  stillFrame?: number;
  concurrency?: number;
  // v0.8 — windowed render (output-frame subrange)
  fromFrame?: number;
  toFrame?: number;
  // v0.9 Bet A — data file for the chart kit ("the animation knows the numbers")
  dataFile?: string;
  data?: unknown;
  // v0.9 Bet F — per-frame attribution report
  explain: boolean;
  // v0.6 — engine-exact filmstrip preview
  filmstrip: boolean;
  filmstripSpec?: string;
}

function parseArgs(argv: string[]): RenderArgs {
  const args: RenderArgs = {
    preset: "readme", out: "./out", kit: false, quiet: false, noPoster: false, preview: false, react: false,
    lossless: false, fontFiles: [], sequence: false, spriteSheet: false, json: false, still: false, filmstrip: false,
    explain: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--preset": args.preset = argv[++i] ?? args.preset; break;
      case "--out": case "-o": args.out = argv[++i] ?? args.out; break;
      case "--format": args.formats = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--fps": args.fps = Number(argv[++i]); break;
      case "--budget": args.budget = Number(argv[++i]); break;
      case "--kit": args.kit = true; break;
      case "--quiet": case "-q": args.quiet = true; break;
      case "--no-poster": args.noPoster = true; break;
      case "--preview": args.preview = true; break;
      case "--react": args.react = true; break;
      // v0.4
      case "--width": args.width = Number(argv[++i]); break;
      case "--height": args.height = Number(argv[++i]); break;
      case "--dpr": args.dpr = Number(argv[++i]); break;
      case "--background": args.background = argv[++i]; break;
      case "--quality": args.quality = Number(argv[++i]); break;
      case "--lossless": args.lossless = true; break;
      case "--duration": args.durationFrames = Number(argv[++i]); break;
      case "--css": args.cssFile = argv[++i]; break;
      case "--font-file": args.fontFiles.push(argv[++i] ?? ""); break;
      case "--sequence": args.sequence = true; break;
      case "--spritesheet": args.spriteSheet = true; break;
      case "--sprite-columns": args.spriteColumns = Number(argv[++i]); break;
      case "--sprite-every": args.spriteEvery = Number(argv[++i]); break;
      case "--json": args.json = true; break;
      // v0.9 Bet F
      case "--explain": args.explain = true; break;
      // v0.5
      case "--still": {
        const next = argv[i + 1];
        if (next !== undefined && /^\d+$/.test(next)) {
          args.stillFrame = Number(next);
          i++;
        }
        args.still = true;
        break;
      }
      case "--concurrency": args.concurrency = Number(argv[++i]); break;
      // v0.8
      case "--from": args.fromFrame = Number(argv[++i]); break;
      case "--to": args.toFrame = Number(argv[++i]); break;
      // v0.9 Bet A
      case "--data": args.dataFile = argv[++i] ?? ""; break;
      case "--filmstrip": {
        args.filmstrip = true;
        const next = argv[i + 1];
        if (next && /^[\d,\s]+$/.test(next)) {
          args.filmstripSpec = next.replace(/\s/g, "");
          i++;
        }
        break;
      }
      case "--help": case "-h": printUsage(); process.exit(0); break;
      default:
        if (!arg.startsWith("--") && !args.file) args.file = arg;
        else throw new Error(`Unknown option '${arg}'`);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`takumi-motion — deterministic server-side animation engine (rendered by Rust)

Usage:
  takumi-motion render <file.ts|tsx|js|mjs|html> [options]
  takumi-motion storyboard <file.ts|tsx> [--frames N] [--columns M] [--out dir]

    The file default-exports one of:
      · a React banner        <Banner> element or a defineBanner() component   (React runtime)
      · a template result     { element, timeline, fonts? }                      (declarative path)
      · a node + timeline     { node, timeline }
      · a (possibly async) function returning either
    A .html file renders the raw HTML path (pair with --css).

  Surface (every field user-given — presets are just recipes):
    --preset <name>   readme | readme-hd | readme-lean | readme-profile | readme-wide | og-card
    --width <px> --height <px>     logical canvas size (overrides the preset)
    --dpr <n>         device pixel ratio (output = logical × dpr)
    --fps <n>         sampling + encoder frame rate
    --background <c>  CSS color, or "transparent" for an alpha canvas
    --quality <0-100> WebP quality (mutually exclusive with --lossless)
    --lossless        lossless WebP
    --format <list>   comma list: gif,webp,apng  (overrides preset)
    --budget <bytes>  budget verdict (exit 2 when over)
    --data <file>     JSON file for the banner's data channel (chart kit reads
                      it via useChartData; loaded once — no fetches at render)
    --explain         per-frame attribution: why every frame exists (channels,
                      churn ranges — the size-budget X-ray)

  Outputs:
    --out <dir>       output directory (default ./out)
    --still [frame]   single-frame PNG instead of an animation (og-image mode;
                      frame defaults to the settled 60% frame)
    --sequence        PNG frame sequence (+ frames.json manifest — pipe to ffmpeg for MP4)
    --spritesheet     sprite-sheet atlas PNG + metadata JSON
    --sprite-columns <n> --sprite-every <n>   atlas shape / frame stride
    --no-poster       skip the poster PNG

  Inputs:
    --css <file>      stylesheet for the .html path (@keyframes work)
    --font-file <path>  register a local TTF/OTF file (repeatable; family = file stem)
    --react           force the React runtime for unmarked function exports
    --kit             render the full asset set (declarative banners only)

  Interface:
    --json            print the full report as JSON (embeddability: drive the CLI from scripts)
    --concurrency <n> bounded parallelism for parsing/measuring/frame renders (default: cores)
    --from <n> --to <n>  render only output frames [from, to) — fast partial previews (react path)
    --preview         also write a standalone HTML preview next to the output
    --filmstrip [n|f1,f2,…]  engine-exact contact sheet (real Rust-rendered stills) next to the output
    --quiet           suppress the report

  takumi-motion check <file> [--preset <name>] [--out <dir>]
                             extent audit + loop-seam + size budget — CI gate, exit 1 on error
  takumi-motion preview <file> [-o <file.html>] [--preset <name>]
                             standalone HTML preview (React banners play the exact captured frames)
  takumi-motion init [dir] [--react]
                             scaffold a banner project (banner.ts or React banner.tsx + package scripts)
  takumi-motion templates    list built-in recipes
  takumi-motion presets      list banner presets with size budgets
  takumi-motion fonts        list the curated Google Font catalog`);
}

type LoadedBanner =
  | { kind: "react"; banner: unknown }
  | ({ kind: "declarative" } & BannerResult & { node?: unknown });

/**
 * Nearest tsconfig.json (walking up from `file`) whose compilerOptions.jsx
 * enables the automatic React runtime ("react-jsx" / "react-jsxdev").
 * undefined when none qualifies — tsx then falls back to its own resolution.
 */
function nearestTsconfigWithReactJsx(file: string): string | undefined {
  let dir = dirname(file);
  for (;;) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { compilerOptions?: { jsx?: string } };
        const jsx = parsed.compilerOptions?.jsx;
        if (typeof jsx === "string" && jsx.startsWith("react-jsx")) return candidate;
      } catch {
        // malformed tsconfig — keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let tsxRegistered = false;

async function loadBannerModule(file: string, forceReact = false): Promise<LoadedBanner> {
  const abs = resolve(file);
  let mod: Record<string, unknown>;
  try {
    // tsx handles TS/TSX; plain .js/.mjs load through it as well.
    // IMPORTANT: use register() + native import() — NOT tsImport(). tsImport
    // runs an ISOLATED module registry, so the banner module's "takumi-motion"
    // (or relative runtime imports) get a SECOND copy of the runtime and
    // DriverContext identity breaks (<Banner> rendered outside the runtime).
    // register() patches the global loader → one shared module graph.
    // tsx resolves its tsconfig from CWD only, which breaks for banner files
    // outside the package root (examples/, user repos with nested configs).
    // Point TSX_TSCONFIG_PATH at the nearest tsconfig with a react jsx
    // setting, walking up from the banner file — BEFORE registering.
    if (!tsxRegistered) {
      const tsconfig = nearestTsconfigWithReactJsx(abs);
      if (tsconfig) process.env.TSX_TSCONFIG_PATH = tsconfig;
      const api = (await import("tsx/esm/api")) as { register: () => void };
      api.register();
      tsxRegistered = true;
    }
    mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Cannot find package 'tsx'") || message.includes("tsx/esm")) {
      throw new Error(`Loading '${file}' requires the tsx loader: npm i -D tsx`);
    }
    if (message.includes("React is not defined")) {
      throw new Error(
        `Loading '${file}' failed: the file uses JSX but no tsconfig.json with "jsx": "react-jsx" ` +
        `was found from its directory up to the filesystem root. Add one (see docs/), or set TSX_TSCONFIG_PATH.`,
      );
    }
    throw err;
  }

  let candidate: unknown = mod.default ?? mod.banner ?? mod.element;
  // CJS interop: a .ts file loaded from a CommonJS context wraps its default
  // export one extra level ({ default: result }). Unwrap until we see a shape.
  if (
    candidate && typeof candidate === "object" &&
    !(candidate as { then?: unknown }).then &&
    "default" in (candidate as object) &&
    !("timeline" in (candidate as object)) &&
    !isReactElementValue(candidate)
  ) {
    candidate = (candidate as { default: unknown }).default;
  }
  if (candidate && typeof (candidate as { then?: unknown }).then === "function") {
    candidate = await candidate;
  }

  // React banners: element exports and defineBanner()-marked components.
  if (isReactElementValue(candidate)) return { kind: "react", banner: candidate };
  if (typeof candidate === "function") {
    if (isDefinedBanner(candidate)) return { kind: "react", banner: candidate };
    if (forceReact) return { kind: "react", banner: candidate };

    // Unmarked function: v0.2 factory semantics — call it and inspect the result.
    let value = await (candidate as () => unknown)();
    if (value && typeof (value as { then?: unknown }).then === "function") value = await value;
    if (value && typeof value === "object" && !("timeline" in (value as object)) && "default" in (value as object)) {
      value = (value as { default: unknown }).default;
      if (value && typeof (value as { then?: unknown }).then === "function") value = await value;
    }
    if (isReactElementValue(value)) return { kind: "react", banner: value };
    if (value && typeof value === "object" && "timeline" in (value as object) && ("element" in (value as object) || "node" in (value as object))) {
      return { kind: "declarative", ...(value as BannerResult) };
    }
    throw new Error(
      `Module '${file}': the exported function returned an unrecognized shape. ` +
      `For React banners use defineBanner() (or export a <Banner> element, or pass --react).`,
    );
  }
  if (candidate && typeof candidate === "object" && "timeline" in (candidate as object) && ("element" in (candidate as object) || "node" in (candidate as object))) {
    return { kind: "declarative", ...(candidate as BannerResult) };
  }
  throw new Error(
    `Module '${file}' must default-export a banner: a React element, a defineBanner() component, ` +
    `or { element | node, timeline } (a template result).`,
  );
}

async function runRender(args: RenderArgs): Promise<number> {
  if (!args.file) throw new Error("render: a file argument is required. Try --help.");

  // v0.4 — raw HTML source path (no React, no timeline: html + css → animation).
  if (args.file.toLowerCase().endsWith(".html") || args.file.toLowerCase().endsWith(".htm")) {
    return runHtmlRender(args);
  }

  const banner = await loadBannerModule(args.file, args.react);

  if (banner.kind === "react") {
    return runReactRender(banner.banner, args);
  }

  const node = ((banner as { element?: unknown }).element ??
    (banner as { node?: unknown }).node) as never;
  const fonts = (banner as { fonts?: FontSpec[] }).fonts;

  mkdirSync(resolve(args.out), { recursive: true });

  if (args.filmstrip) await writeFilmstrip(args, { node, timeline: banner.timeline, ...(fonts ? { fonts } : {}) });

  if (args.preview) {
    const html = renderPreviewForBanner(banner, args.preset);
    const previewPath = resolve(args.out, "banner-preview.html");
    writeFileSync(previewPath, html);
    console.log(`preview → ${previewPath}`);
  }

  if (args.kit) {
    const kit = await renderKit(
      { element: banner.element, node: banner.node, timeline: banner.timeline, fonts },
      {
        outDir: args.out,
        posters: args.noPoster ? false : undefined,
      }
    );
    if (!args.quiet) console.log(formatKitReport(kit));
    return kit.variants.some((v) => v.report.overBudget) ? 2 : 0;
  }

  if (args.still) {
    const { renderStill } = await import("./still.js");
    const still = await renderStill({
      node,
      timeline: banner.timeline,
      preset: args.preset,
      ...(args.stillFrame !== undefined ? { frame: args.stillFrame } : {}),
      outDir: args.out,
      baseName: fileStem(args.file!),
      ...(fonts ? { fonts } : {}),
      ...surfaceStillOptionsFromArgs(args),
    });
    if (args.json) console.log(JSON.stringify(jsonSafe(still), null, 2));
    else if (!args.quiet) console.log(formatStillLine(still));
    return 0;
  }

  const report = await renderBanner({
    node,
    timeline: banner.timeline,
    preset: args.preset,
    ...(args.formats ? { formats: args.formats as AnimationFormat[] } : {}),
    ...(args.fps ? { fps: args.fps } : {}),
    outDir: args.out,
    posters: args.noPoster ? false : undefined,
    ...(fonts ? { fonts } : {}),
    ...surfaceOptionsFromArgs(args),
  });

  if (args.budget && report.overBudget) {
    // Budget ladder: re-render down fps/quality until it fits or the ladder ends.
    const { optimizeBudget } = await import("./size.js");
    const preset = resolvePreset(args.preset);
    const baseFps = report.fps;
    const ladder = [
      { label: `${preset.formats.join("+")} @${baseFps}fps`, format: preset.formats[0] as AnimationFormat, fps: baseFps },
      { label: `@${Math.max(6, Math.round(baseFps * 0.75))}fps`, format: preset.formats[0] as AnimationFormat, fps: Math.max(6, Math.round(baseFps * 0.75)) },
      { label: `@${Math.max(6, Math.round(baseFps * 0.5))}fps`, format: preset.formats[0] as AnimationFormat, fps: Math.max(6, Math.round(baseFps * 0.5)) },
    ].filter((a) => a.fps !== baseFps);
    const result = await optimizeBudget(
      args.budget,
      ladder as never,
      async (attempt) => {
        const r = await renderBanner({
          node,
          timeline: banner.timeline,
          preset: args.preset,
          formats: [attempt.format],
          fps: attempt.fps,
          outDir: args.out,
          posters: false,
          ...(fonts ? { fonts } : {}),
        });
        return r.files[0]!.buffer;
      }
    );
    console.log(`budget ladder (target ${formatBytes(args.budget)}):`);
    for (const a of result.attempts) {
      console.log(`  ${a.attempt.label.padEnd(18)} ${formatBytes(a.bytes).padStart(9)}  ${a.withinBudget ? "fits" : "over"}`);
    }
    console.log(`chosen: ${result.chosen.attempt.label} — ${formatBytes(result.chosen.bytes)} ${result.withinBudget ? "(fits)" : "(smallest available)"}`);
    return result.withinBudget ? 0 : 2;
  }

  if (!args.quiet && !args.json) console.log(formatReport(report));
  if (args.json) {
    console.log(JSON.stringify(jsonSafe(report), null, 2));
  }
  return report.overBudget ? 2 : 0;
}

// ---------------------------------------------------------------------------
// v0.4 — shared surface flags + JSON output + html path
// ---------------------------------------------------------------------------

function surfaceOptionsFromArgs(args: RenderArgs) {
  return {
    ...(args.width !== undefined ? { width: args.width } : {}),
    ...(args.height !== undefined ? { height: args.height } : {}),
    ...(args.dpr !== undefined ? { dpr: args.dpr } : {}),
    ...(args.background !== undefined ? { background: args.background } : {}),
    ...(args.quality !== undefined ? { quality: args.quality } : {}),
    ...(args.lossless ? { lossless: true } : {}),
    ...(args.budget !== undefined ? { budgetBytes: args.budget } : {}),
    ...(args.sequence ? { sequence: { ...(args.spriteEvery ? { every: args.spriteEvery } : {}) } } : {}),
    ...(args.spriteSheet
      ? { spriteSheet: { ...(args.spriteColumns ? { columns: args.spriteColumns } : {}), ...(args.spriteEvery ? { every: args.spriteEvery } : {}) } }
      : {}),
  };
}

/** Surface flags that apply to stills (no animation-only options). */
function surfaceStillOptionsFromArgs(args: RenderArgs) {
  return {
    ...(args.width !== undefined ? { width: args.width } : {}),
    ...(args.height !== undefined ? { height: args.height } : {}),
    ...(args.dpr !== undefined ? { dpr: args.dpr } : {}),
    ...(args.background !== undefined ? { background: args.background } : {}),
    ...(args.fps !== undefined ? { fps: args.fps } : {}),
  };
}

/** File stem for output naming ("./assets/card.html" → "card"). */
function fileStem(file: string): string {
  return file.replace(/\.[^.]+$/, "").split(/[\\/]/).pop() || "still";
}

/**
 * v0.9 Bet A — load `--data <file>` (JSON) into the banner's data channel.
 * The file is read ONCE here, at setup: the determinism doctrine allows file
 * reads, never network fetches at render time.
 */
function resolveDataArg(args: RenderArgs): unknown {
  if (!args.dataFile) return undefined;
  try {
    return JSON.parse(readFileSync(resolve(args.dataFile), "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`--data: could not load "${args.dataFile}" as JSON — ${reason}`);
  }
}

/** One-line human report for a still (CLI). */
function formatStillLine(still: {
  source: string;
  physicalWidth: number;
  physicalHeight: number;
  devicePixelRatio: number;
  frame: number;
  timeMs: number;
  bytes: number;
  path: string | null;
}): string {
  return (
    `still ${formatBytes(still.bytes).padStart(9)}  ` +
    `${still.physicalWidth}×${still.physicalHeight} @${still.devicePixelRatio}x · ` +
    `${still.source} · frame ${still.frame} (t=${Math.round(still.timeMs)}ms)` +
    `${still.path ? `  → ${still.path}` : ""}`
  );
}

/** Replace Buffer/Uint8Array fields with size placeholders (fast, no huge arrays). */
function jsonSafe(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return `<${value.length} bytes>`;
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = v === undefined ? undefined : jsonSafe(v);
  }
  return out;
}

async function runHtmlRender(args: RenderArgs): Promise<number> {
  const { renderHtmlAnimation } = await import("./html-source.js");

  const html = readFileSync(resolve(args.file!), "utf8");
  const css = args.cssFile ? readFileSync(resolve(args.cssFile), "utf8") : undefined;

  if (args.filmstrip) await writeFilmstrip(args, { html });

  if (args.still) {
    const { renderStill } = await import("./still.js");
    const still = await renderStill({
      html,
      ...(css ? { css } : {}),
      ...(args.stillFrame !== undefined ? { frame: args.stillFrame } : {}),
      outDir: args.out,
      baseName: fileStem(args.file!),
      ...(args.fontFiles.length > 0
        ? { fontFiles: args.fontFiles.filter(Boolean).map((p) => ({ source: p })) }
        : {}),
      ...surfaceStillOptionsFromArgs(args),
    });
    if (args.json) console.log(JSON.stringify(jsonSafe(still), null, 2));
    else if (!args.quiet) console.log(formatStillLine(still));
    return 0;
  }

  const report = await renderHtmlAnimation({
    html,
    ...(css ? { css } : {}),
    width: args.width,
    height: args.height,
    dpr: args.dpr,
    fps: args.fps,
    ...(args.durationFrames !== undefined ? { frames: args.durationFrames } : {}),
    ...(args.formats ? { formats: args.formats as ("gif" | "webp" | "apng")[] } : {}),
    background: args.background,
    outDir: args.out,
    baseName: args.file!.replace(/\.[^.]+$/, "").split(/[\\/]/).pop() || "animation",
    posters: args.noPoster ? false : undefined,
    ...(args.quality !== undefined ? { quality: args.quality } : {}),
    ...(args.lossless ? { lossless: true } : {}),
    ...(args.budget !== undefined ? { budgetBytes: args.budget } : {}),
    ...(args.fontFiles.length > 0
      ? { fontFiles: args.fontFiles.filter(Boolean).map((p) => ({ source: p })) }
      : {}),
  });

  if (args.json) {
    console.log(JSON.stringify(jsonSafe(report), null, 2));
  } else if (!args.quiet) {
    const { toSurfaceLine } = await import("./html-source.js");
    console.log(toSurfaceLine(report));
  }
  return report.overBudget ? 2 : 0;
}

async function runReactRender(banner: unknown, args: RenderArgs): Promise<number> {
  mkdirSync(resolve(args.out), { recursive: true });
  const data = resolveDataArg(args);

  if (args.filmstrip) await writeFilmstrip(args, { banner });

  if (args.preview) {
    const capture = await captureReactBanner(banner as never, {
      ...(args.fps ? { fps: args.fps } : {}),
      ...(data !== undefined ? { data } : {}),
    });
    const html = renderReactPreviewHtml(capture, { title: "takumi-motion — react banner" });
    const previewPath = resolve(args.out, "banner-preview.html");
    writeFileSync(previewPath, html);
    console.log(`preview → ${previewPath}`);
  }

  if (args.kit) {
    console.log("  ⚠ --kit applies to declarative template banners; rendering the react banner normally.");
  }

  if (args.still) {
    const { renderStill } = await import("./still.js");
    const still = await renderStill({
      banner,
      preset: args.preset,
      ...(data !== undefined ? { data } : {}),
      ...(args.stillFrame !== undefined ? { frame: args.stillFrame } : {}),
      outDir: args.out,
      baseName: fileStem(args.file!),
      ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
      ...surfaceStillOptionsFromArgs(args),
    });
    if (args.json) console.log(JSON.stringify(jsonSafe(still), null, 2));
    else if (!args.quiet) console.log(formatStillLine(still));
    return 0;
  }

  const report = await renderReactBanner({
    banner,
    preset: args.preset,
    ...(data !== undefined ? { data } : {}),
    ...(args.explain ? { explain: true } : {}),
    ...(args.formats ? { formats: args.formats as AnimationFormat[] } : {}),
    ...(args.fps ? { fps: args.fps } : {}),
    outDir: args.out,
    posters: args.noPoster ? false : undefined,
    ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
    ...(args.fromFrame !== undefined || args.toFrame !== undefined
      ? { fromFrame: args.fromFrame ?? 0, toFrame: args.toFrame }
      : {}),
    ...surfaceOptionsFromArgs(args),
  });

  if (args.json) {
    console.log(JSON.stringify(jsonSafe(report), null, 2));
    return report.overBudget ? 2 : 0;
  }

  if (args.budget && report.overBudget) {
    const { optimizeBudget } = await import("./size.js");
    const baseFps = report.fps;
    const primaryFormat = (args.formats?.[0] ?? report.files[0]?.format ?? "gif") as AnimationFormat;
    const ladder = [
      { label: `${primaryFormat} @${baseFps}fps`, format: primaryFormat, fps: baseFps },
      { label: `@${Math.max(6, Math.round(baseFps * 0.75))}fps`, format: primaryFormat, fps: Math.max(6, Math.round(baseFps * 0.75)) },
      { label: `@${Math.max(6, Math.round(baseFps * 0.5))}fps`, format: primaryFormat, fps: Math.max(6, Math.round(baseFps * 0.5)) },
    ].filter((a) => a.fps !== baseFps);
    const result = await optimizeBudget(
      args.budget,
      ladder as never,
      async (attempt) => {
        const r = await renderReactBanner({
          banner,
          preset: args.preset,
          ...(data !== undefined ? { data } : {}),
          formats: [attempt.format],
          fps: attempt.fps,
          outDir: args.out,
          posters: false,
        });
        return r.files[0]!.buffer;
      },
    );
    console.log(`budget ladder (target ${formatBytes(args.budget)}):`);
    for (const a of result.attempts) {
      console.log(`  ${a.attempt.label.padEnd(18)} ${formatBytes(a.bytes).padStart(9)}  ${a.withinBudget ? "fits" : "over"}`);
    }
    console.log(`chosen: ${result.chosen.attempt.label} — ${formatBytes(result.chosen.bytes)} ${result.withinBudget ? "(fits)" : "(smallest available)"}`);
    return result.withinBudget ? 0 : 2;
  }

  if (!args.quiet) console.log(formatReactReport(report));
  return report.overBudget ? 2 : 0;
}

async function runCheck(file: string, presetName: string, out: string | undefined, forceReact = false): Promise<number> {
  const banner = await loadBannerModule(file, forceReact);

  if (banner.kind === "react") {
    const preset = resolvePreset(presetName);
    // Size probe when an out dir is given: full render once, then audit.
    const report = await renderReactBanner({
      banner: banner.banner,
      preset: presetName,
      ...(out ? { outDir: out, formats: preset.formats } : { formats: [], posters: false }),
    });
    console.log(`check '${file}' @ ${report.width}×${report.height}:`);
    console.log(`  extents: ${report.extents.chunksChecked} chunks audited, ${report.extents.violations.length} findings`);
    for (const v of report.extents.violations) {
      console.log(`    ${v.decorative ? "warn" : "FAIL"} f${v.frame} ${v.detail}`);
    }
    console.log(`  seam: ${report.seam.mode}${report.seam.loop ? " (loop declared)" : ""} — ${report.seam.detail}`);
    for (const w of report.warnings) console.log(`  ⚠ ${w}`);
    const hardFails = report.extents.violations.filter((v) => !v.decorative);
    const seamFail = report.seam.loop && report.seam.mode === "differs";
    const ok = hardFails.length === 0 && !seamFail;
    console.log(ok ? "  OK — ship it" : "  FAILED — do not ship");
    return ok ? 0 : 1;
  }

  const node = ((banner as { element?: unknown }).element ?? (banner as { node?: unknown }).node) as never;
  const preset = resolvePreset(presetName);
  const fonts = (banner as { fonts?: FontSpec[] }).fonts;

  // Optional size probe when an out dir is given: render once and audit bytes.
  let fileSizes: Parameters<typeof checkBanner>[2]["fileSizes"];
  if (out) {
    const report = await renderBanner({
      node, timeline: banner.timeline, preset, outDir: out,
      ...(fonts ? { fonts } : {}),
    });
    fileSizes = report.files.map((f) => ({ format: f.format, bytes: f.bytes, budget: preset.budgetBytes }));
  }

  const result = await checkBanner(node, banner.timeline, {
    width: preset.width,
    height: preset.height,
    fileSizes,
  });

  console.log(`check '${file}' @ ${preset.width}×${preset.height}:`);
  console.log(`  extents: ${result.extents.checked} animated targets checked, ${result.extents.violations.length} findings`);
  if (result.extents.violations.length) {
    for (const v of result.extents.violations) {
      console.log(`    ${v.decorative ? "warn" : "FAIL"} ${v.detail}`);
    }
  }
  console.log(`  seam: ${result.seam.report.mode} mode, energy ${result.seam.energy}${result.seam.worst ? ` (worst ${result.seam.worst.target} ${result.seam.worst.property})` : ""}`);
  for (const f of result.sizes) {
    console.log(`  size ${f.format}: ${formatBytes(f.bytes)} / budget ${formatBytes(f.budget)} ${f.ok ? "ok" : "OVER"}`);
  }
  for (const f of result.findings) console.log(`  [${f.level}] ${f.message}`);
  console.log(result.ok ? "  OK — ship it" : "  FAILED — do not ship");
  return result.ok ? 0 : 1;
}

const INIT_BANNER_TS = `// banner.ts — edit me, then: npx takumi-motion render banner.ts --preset readme
import { cascadeBanner } from "takumi-motion";

export default cascadeBanner({
  title: "your-project",
  tagline: "springs for your README",
  theme: "tokyo-night",      // midnight | github-dark | github-light | tokyo-night | dracula | sunburst | paper-mono
  motion: "snappy",          // snappy | smooth | playful | mechanical
  // font: "Space Grotesk",  // any Google Font — fetched and registered automatically
});
`;

const INIT_BANNER_TSX = `// banner.tsx — a real React banner. Edit me, then:
//   npx takumi-motion render banner.tsx --preset readme
//   npx takumi-motion render banner.tsx --filmstrip        <- engine-exact contact sheet
//   npx takumi-motion check banner.tsx --preset readme
import {
  Banner, Scene, Layer, Series, SeriesSequence, defineBanner,
  Fill, FitText, CountUp, Glow,
  useCurrentFrame, useSpring, useFrameState,
} from "takumi-motion/react";

const FEATURES = ["zero browser", "spring physics", "multi-scene"];

export default defineBanner(function LaunchBanner() {
  return (
    <Banner preset="readme" theme="tokyo-night" font="Sora" transitionMs={250}>
      <Layer bottom>
        <Glow x={180} y={80} size={260} color="#7aa2f7" />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 18, height: 2, backgroundColor: "#7aa2f7", opacity: 0.35 }} />
      </Layer>

      <Scene duration={90} enter="rise">
        <Hero />
      </Scene>

      <Series>
        <SeriesSequence durationInFrames={75} enter="crossfade">
          <Carousel />
        </SeriesSequence>
        <SeriesSequence durationInFrames={75} enter="slide">
          <Stats />
        </SeriesSequence>
      </Series>

      <Layer top>
        <div style={{ position: "absolute", right: 24, top: 24, color: "#7982a9", fontSize: 14, fontFamily: "JetBrains Mono, monospace" }}>
          v0.6
        </div>
      </Layer>
    </Banner>
  );
});

function Hero() {
  const y = useSpring({ from: -28, to: 0, stiffness: 170, damping: 15 });
  return (
    <Fill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
      {/* FitText: measure-exact — the title can never overflow the canvas. */}
      <FitText
        text="your-project"
        max={44}
        fontWeight={700}
        maxWidth={700}
        style={{ color: "#c0caf5", letterSpacing: 1, transform: \`translateY(\${y.toFixed(2)}px)\` }}
      />
      <div style={{ color: "#7982a9", fontSize: 19 }}>
        springs for your README
      </div>
    </Fill>
  );
}

// A state machine that evolves with the timeline — deterministic replay.
function Carousel() {
  const active = useFrameState(
    (state, action: { type: "next" }) => (action.type === "next" ? (state + 1) % FEATURES.length : state),
    0,
    (frame) => (frame > 0 && frame % 45 === 0 ? { type: "next" as const } : null),
  );
  const slide = ((useCurrentFrame() % 45) / 45) * -12;
  return (
    <Fill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#c0caf5", fontSize: 30, fontWeight: 600, transform: \`translateX(\${slide.toFixed(2)}px)\` }}>
        {FEATURES[active]}
      </div>
    </Fill>
  );
}

function Stats() {
  return (
    <Fill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
      {/* CountUp: deterministic number animation — format it your way. */}
      <CountUp to={12800} durationFrames={50} delayFrames={6}
              format={(n) => \`\${Math.round(n).toLocaleString("en-US")}+ stars\`}
              style={{ color: "#c0caf5", fontSize: 40, fontWeight: 700 }} />
      <div style={{ color: "#7982a9", fontSize: 18 }}>and counting</div>
    </Fill>
  );
}
`;

/** v0.6 — engine-exact filmstrip contact sheet next to the render outputs. */
async function writeFilmstrip(
  args: RenderArgs,
  src: { banner?: unknown; node?: unknown; timeline?: unknown; fonts?: FontSpec[]; html?: string },
): Promise<void> {
  const { renderFilmstrip } = await import("./filmstrip.js");
  const spec = args.filmstripSpec;
  const list = spec?.includes(",") ? spec.split(",").map(Number).filter((n) => Number.isInteger(n)) : undefined;
  const css = src.html && args.cssFile ? readFileSync(resolve(args.cssFile), "utf8") : undefined;
  const strip = await renderFilmstrip({
    ...(src.banner !== undefined ? { banner: src.banner } : {}),
    ...(src.html !== undefined ? { html: src.html, ...(css ? { css } : {}) } : {}),
    ...(src.node !== undefined ? { node: src.node as never, timeline: src.timeline as never } : {}),
    preset: args.preset,
    outDir: args.out,
    baseName: `${fileStem(args.file ?? "banner")}-filmstrip`,
    ...(list ? { frames: list } : spec ? { count: Number(spec) } : {}),
    ...(args.fps ? { fps: args.fps } : {}),
    ...(src.fonts ? { fonts: src.fonts } : {}),
    ...(args.concurrency !== undefined ? { concurrency: args.concurrency } : {}),
    // React banners own their canvas — render-level background/quality don't apply.
    ...(src.banner === undefined
      ? {
          ...(args.width !== undefined ? { width: args.width } : {}),
          ...(args.height !== undefined ? { height: args.height } : {}),
          ...(args.dpr !== undefined ? { dpr: args.dpr } : {}),
          ...(args.background !== undefined ? { background: args.background } : {}),
        }
      : {}),
  } as never);
  if (!args.quiet) {
    console.log(`filmstrip → ${strip.path}  (${strip.frames.length} engine-exact frames, ${strip.columns}×${strip.rows} grid)`);
  }
}

const INIT_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "noEmit": true
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
`;

async function runInit(dir: string, react: boolean): Promise<void> {
  const target = resolve(dir);
  mkdirSync(target, { recursive: true });
  const bannerPath = resolve(target, react ? "banner.tsx" : "banner.ts");
  if (existsSync(bannerPath)) throw new Error(`init: ${bannerPath} already exists.`);
  writeFileSync(bannerPath, react ? INIT_BANNER_TSX : INIT_BANNER_TS);
  // Scaffold tsconfig: the tsx loader only honors a tsconfig whose include
  // matches the file — a self-contained project config guarantees the
  // automatic JSX runtime (and gives users strict types out of the box).
  const tsconfigPath = resolve(target, "tsconfig.json");
  if (!existsSync(tsconfigPath)) writeFileSync(tsconfigPath, INIT_TSCONFIG);
  const check = react ? "npx takumi-motion check banner.tsx --preset readme" : "npx takumi-motion check banner.ts --preset readme";
  const strip = react ? "\n  npx takumi-motion render banner.tsx --filmstrip   # engine-exact contact sheet" : "";
  console.log(`scaffolded:
  ${bannerPath}
  ${tsconfigPath}
next:
  npm i takumi-motion${react ? " react react-dom" : ""}
  npx takumi-motion render ${react ? "banner.tsx" : "banner.ts"} --preset readme --out ./out${strip}
  ${check}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    if (!command) process.exitCode = 1;
    return;
  }

  if (command === "templates") {
    console.log("Built-in templates (import from takumi-motion, default-export the result):");
    for (const [name, builder] of Object.entries(bannerTemplates)) {
      void builder;
      console.log(`  ${name.padEnd(12)} ${name}Banner({ title | text | stats, theme?, motion?, font?, ... })`);
    }
    return;
  }

  if (command === "presets") {
    console.log("Banner presets:");
    for (const [name, p] of Object.entries(bannerPresets)) {
      console.log(
        `  ${name.padEnd(16)} ${p.width}×${p.height} @${p.devicePixelRatio}x ${p.fps}fps ` +
          `[${p.formats.join(",")}] budget ${formatBytes(p.budgetBytes)}`
      );
    }
    return;
  }

  if (command === "fonts") {
    console.log("Curated Google Font catalog (any css2 family also loads):");
    for (const [role, list] of Object.entries(fontCatalog)) {
      console.log(`  ${role.padEnd(8)} ${list.join(", ")}`);
    }
    console.log("usage: { font: 'Space Grotesk' } or { font: { name: 'JetBrains Mono', weight: [400, 700] } }");
    return;
  }

  if (command === "render") {
    process.exitCode = await runRender(parseArgs(rest));
    return;
  }

  if (command === "storyboard") {
    const args = parseArgs(rest);
    if (!args.file) throw new Error("storyboard: a file argument is required. Try --help.");
    const banner = await loadBannerModule(args.file, args.react);
    if (banner.kind !== "react") {
      throw new Error("storyboard: the React runtime is required — the file must default-export a <Banner> element or a defineBanner() component.");
    }
    const data = resolveDataArg(args);
    const { renderStoryboard } = await import("./storyboard.js");
    const sheet = await renderStoryboard({
      banner: banner.banner,
      ...(data !== undefined ? { data } : {}),
      ...(args.width !== undefined ? { scale: Math.min(1, args.width / 850) } : {}),
      outDir: args.out,
    });
    console.log(
      `storyboard: ${sheet.cells.length} frames sampled (${sheet.columns}×${sheet.rows} grid, ${sheet.cellWidth}×${sheet.cellHeight} cells) — ${sheet.paths.png ?? `${sheet.png.length}B`}`,
    );
    for (const cell of sheet.cells) {
      console.log(`  f${String(cell.frame).padStart(4)}  scene ${cell.scene}`);
    }
    return;
  }

  if (command === "check") {
    const args = parseArgs(rest);
    if (!args.file) throw new Error("check: a file argument is required. Try --help.");
    process.exitCode = await runCheck(args.file, args.preset, args.out, args.react);
    return;
  }

  if (command === "preview") {
    const args = parseArgs(rest);
    if (!args.file) throw new Error("preview: a file argument is required. Try --help.");
    const banner = await loadBannerModule(args.file, args.react);
    let html: string;
    if (banner.kind === "react") {
      const capture = await captureReactBanner(banner.banner as never, { ...(args.fps ? { fps: args.fps } : {}) });
      html = renderReactPreviewHtml(capture, { title: "takumi-motion — react banner" });
    } else {
      html = renderPreviewForBanner(banner, args.preset);
    }
    const outPath = resolve(args.out.endsWith(".html") ? args.out : resolve(args.out, "banner-preview.html"));
    mkdirSync(resolve(outPath, ".."), { recursive: true });
    writeFileSync(outPath, html);
    console.log(`preview → ${outPath}  (open in a browser — no server needed)`);
    return;
  }

  if (command === "init") {
    const args = parseArgs(rest);
    const dir = args.file ?? ".";
    await runInit(dir, args.react);
    return;
  }

  throw new Error(`Unknown command '${command}'. Try --help.`);
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

// keep the TemplateInvocation type referenced for d.ts consumers
export type { TemplateInvocation };
