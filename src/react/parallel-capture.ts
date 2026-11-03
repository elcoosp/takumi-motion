// takumi-motion — react/parallel-capture.ts (v1.0)
// Worker-pool orchestration for the capture stage — the last SERIAL stage of
// the pipeline (parse/audit/encode already overlap on the Rust thread pool).
//
// Design:
//   - the banner is addressed as a MODULE (`bannerModule`), so each worker
//     imports it itself (functions/elements can't cross the thread boundary);
//   - the main thread probes once (one static render) to size the frame
//     windows, then spawns min(workers, frames) threads, each running the
//     EXACT serial capture on its window;
//   - the main thread concatenates htmlFrames in window order and re-chunks
//     ONCE → chunk boundaries, warnings, lint and morph attribution are
//     byte-identical to serial capture at ANY partition (golden-tested);
//   - the Math.random shim is frame-seeded (see capture.ts), so even banners
//     that consume it stay byte-stable across partitions.
//
// Overhead model: one probe + one prewarm per worker (~tens of ms). `auto`
// only engages when the frame count amortizes the spawn (≥ 64 frames).

import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { mapWithConcurrency } from "../concurrency.js";
import { chunkFrames, probeReactBanner, captureReactBanner, type CaptureOptions, type CaptureResult, type ProbeResult } from "./capture.js";
import type { CaptureWindowJob, CaptureWindowResult } from "./capture-worker.js";
import type { BannerPlan } from "./plan.js";
import type { LintWarning } from "../lint.js";

/** Hard ceiling — past this the spawn cost outpaces the render savings. */
const MAX_WORKERS = 16;

/**
 * Spawning a worker costs a thread start + one module graph + probe + prewarm
 * + a fresh Renderer (measured: ~200-300ms). `auto` therefore gates on BOTH
 * dimensions of the work:
 *   - `frames` — the window count amortizes only when each window is deep;
 *   - `estimatedWorkMs` — frames × per-frame render cost (measured during the
 *     probe, not guessed): parallelism only pays when the total capture work
 *     dwarfs the per-worker overhead.
 * Rule: cores when the machine has ≥ 4 cores AND frames ≥ 128 AND
 * estimatedWorkMs ≥ 400; else serial. (On 1-2-core hosts the Rust stages
 * already saturate the machine — spawning JS workers oversubscribes and
 * measures SLOWER; the gate refuses.)
 */
export function resolveWorkers(
  option: number | "auto" | undefined,
  frameCount: number,
  estimatedWorkMs = Infinity,
): number {
  const frames = Math.max(1, Math.floor(frameCount));
  if (option === undefined) return 1;
  if (option === "auto") {
    let cores = 2;
    try {
      cores = availableParallelism();
    } catch {
      // keep the fallback
    }
    if (cores < 4 || frames < 128 || estimatedWorkMs < 400) return 1;
    return Math.max(1, Math.min(cores, frames, MAX_WORKERS));
  }
  if (!Number.isInteger(option) || option < 1) return 1;
  return Math.max(1, Math.min(option, frames, MAX_WORKERS));
}

/**
 * execArgv that installs the bundled tsx ESM hooks INSIDE the worker before
 * the .ts entry loads: node --import <this file> → worker-register.mjs calls
 * register(). The shim is plain .mjs (loads hookless), resolves "tsx/esm/api"
 * from OUR package context, so consumers need no tsx of their own.
 * Returns [] only when tsx itself is unresolvable (worker capture then fails
 * with a clear error rather than a cryptic loader crash).
 */
/**
 * Nearest tsconfig.json (walking up from `file`) whose compilerOptions.jsx
 * enables the automatic React runtime ("react-jsx"/"react-jsxdev"). Shared
 * with the CLI loader: tsx only honors the jsx transform when
 * TSX_TSCONFIG_PATH points at such a config.
 */
export function nearestTsconfigWithReactJsx(file: string): string | undefined {
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

function tsxWorkerExecArgv(): string[] {
  try {
    const requireFromHere = createRequire(import.meta.url);
    // Resolve the shim via require (CJS path math) — but the shim is ESM; use
    // import.meta.resolve when available (Node ≥ 20.6), else the require hack.
    const here = new URL("./ts-worker-loader.mjs", import.meta.url);
    // validate tsx resolves from our context (the shim imports it)
    void requireFromHere.resolve("tsx/package.json");
    return ["--import", here.href];
  } catch {
    return [];
  }
}

/**
 * Import a banner module on the MAIN thread (serial path / probe sizing).
 * Default export wins; a bare namespace (mod itself is the element) works too.
 */
// v1.0 — module cache: repeated renders of the same bannerModule pay ZERO
// import cost after the first (the ES module registry dedupes by URL; this
// memo also dedupes the ERROR path and the default-export unwrap).
const moduleCache = new Map<string, Promise<unknown>>();

export function loadBannerModule(modulePath: string): Promise<unknown> {
  const hit = moduleCache.get(modulePath);
  if (hit) return hit;
  const job = (async (): Promise<unknown> => {
    const { pathToFileURL } = await import("node:url");
    const { resolve } = await import("node:path");
    const specifier = pathToFileURL(resolve(modulePath)).href;
    let mod: { default?: unknown };
    try {
      mod = (await import(specifier)) as { default?: unknown };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`renderReactBanner: bannerModule "${modulePath}" failed to load — ${message}`);
    }
    const element = mod.default ?? mod;
    if (element === undefined || element === null) {
      throw new Error(`renderReactBanner: bannerModule "${modulePath}" has no default export.`);
    }
    return element;
  })();
  moduleCache.set(modulePath, job);
  return job;
}

interface Window {
  from: number;
  to: number;
}

/** Contiguous windows covering [from, to) — `count` windows of near-equal size. */
export function windowGrid(from: number, to: number, count: number): Window[] {
  const total = Math.max(0, to - from);
  const workers = Math.max(1, Math.min(count, total));
  const size = Math.ceil(total / workers);
  const grid: Window[] = [];
  for (let start = from; start < to; start += size) {
    grid.push({ from: start, to: Math.min(start + size, to) });
  }
  return grid;
}

function spawnWindow(job: CaptureWindowJob, execArgv: string[]): Promise<CaptureWindowResult> {
  const tsxConfig = nearestTsconfigWithReactJsx(resolve(job.modulePath));
  return new Promise((resolvePromise, reject) => {
    const workerUrl = new URL("./capture-worker.ts", import.meta.url);
    // TSX_TSCONFIG_PATH: tsx honors the automatic JSX runtime ONLY through
    // this env var — point it at the banner file's nearest react-jsx config.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(tsxConfig ? { TSX_TSCONFIG_PATH: tsxConfig } : {}),
    };
    let worker: Worker;
    try {
      worker = new Worker(workerUrl, { execArgv, workerData: job, env });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      void worker.terminate();
    };
    worker.on("message", (message: CaptureWindowResult) => {
      finish(() => resolvePromise(message));
    });
    worker.on("error", (error) => {
      finish(() => reject(error));
    });
    worker.on("exit", (code) => {
      finish(() => {
        if (code !== 0) reject(new Error(`capture worker exited with code ${code} before posting a result.`));
      });
    });
  });
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Capture a banner module across a worker pool. `probe` comes from a
 * main-thread probeReactBanner call (sizes the grid); every worker re-probes
 * to the identical plan — cheap and deterministic by construction.
 */
export async function captureReactBannerParallel(
  modulePath: string,
  captureOptions: CaptureOptions,
  probe: ProbeResult,
  workers: number,
): Promise<CaptureResult> {
  const execArgv = tsxWorkerExecArgv();
  const fullFrom = Math.max(0, Math.min(captureOptions.fromFrame ?? 0, probe.outputTotal - 1));
  const fullTo = Math.max(fullFrom + 1, Math.min(captureOptions.toFrame ?? probe.outputTotal, probe.outputTotal));
  const windows = windowGrid(fullFrom, fullTo, workers);
  if (execArgv.length === 0 && windows.length > 1) {
    throw new Error(
      "renderReactBanner: worker capture needs the bundled esbuild loader (unresolvable). " +
      "Reinstall dependencies, or pass workers: 1.",
    );
  }

  const results = await mapWithConcurrency(windows, workers, async (window) =>
    spawnWindow(
      {
        modulePath,
        captureOptions,
        fromFrame: window.from,
        toFrame: window.to,
      },
      execArgv,
    ),
  );

  for (const result of results) {
    if (!result.ok) {
      throw new Error(`renderReactBanner: parallel capture failed — ${result.error ?? "unknown worker error"}`);
    }
  }

  // Plan agreement: every worker probed to the identical plan (determinism
  // assertion — a disagreement means a non-pure banner, which the doctrine
  // forbids; fail loudly rather than ship divergent windows).
  const first = results[0]!.capture!;
  const firstPlan = first.plan as BannerPlan;
  for (let i = 1; i < results.length; i++) {
    const otherPlan = results[i]!.capture!.plan as BannerPlan;
    if (otherPlan.totalFrames !== firstPlan.totalFrames || otherPlan.scenes.length !== firstPlan.scenes.length) {
      throw new Error(
        "renderReactBanner: worker windows probed to DIFFERENT plans — the banner's render is not a pure " +
        "function of (frame, props). Remove non-deterministic setup (the doctrine) or use workers: 1.",
      );
    }
  }

  // Concatenate in window order, then re-chunk ONCE — identical boundaries to
  // serial capture (chunkFrames indexes the concatenated array from fullFrom).
  const htmlFrames: string[] = [];
  for (const result of results) htmlFrames.push(...result.capture!.htmlFrames);
  const chunks = chunkFrames(htmlFrames);
  for (const chunk of chunks) chunk.startFrame += fullFrom;

  return {
    plan: first.plan as CaptureResult["plan"],
    outputFrames: htmlFrames.length,
    window: { from: fullFrom, to: fullTo, tempo: first.window.tempo },
    meta: first.meta as CaptureResult["meta"],
    htmlFrames,
    chunks,
    warnings: dedupeStrings(results.flatMap((r) => r.capture!.warnings)),
    lint: dedupeLint(results.flatMap((r) => r.capture!.lint)),
    morphActiveFrames: [...new Set(results.flatMap((r) => r.capture!.morphActiveFrames))].sort((a, b) => a - b),
  };
}

/** Lint dedupe: code+message identity, first occurrence wins (window order is
 *  fixed, so the surviving order is deterministic). */
function dedupeLint(warnings: LintWarning[]): LintWarning[] {
  const seen = new Set<string>();
  const out: LintWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}\u0000${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out;
}