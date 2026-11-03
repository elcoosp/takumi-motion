// takumi-motion — react/capture-worker.ts (v1.0)
// Worker-thread entry for parallel capture. Each worker imports the banner
// module itself (tsx hooks are registered per-thread), runs the EXACT serial
// capture pipeline on its window ([fromFrame, toFrame)), and posts the result
// back. Because every stage is a pure function of (frame, props) and the
// Math.random shim is frame-seeded, the concatenated windows are byte-identical
// to a serial capture — golden-tested at any worker count.
//
// The worker never sees chunk merging: the main thread concatenates htmlFrames
// across windows and re-chunks ONCE, so chunk boundaries match serial exactly.

import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { captureReactBanner, type CaptureOptions } from "./capture.js";
import type { LintWarning } from "../lint.js";

export interface CaptureWindowJob {
  /** Banner module specifier — resolved against cwd, then imported per-thread. */
  modulePath: string;
  /** Capture options (fps/preset/fonts/data passthrough). */
  captureOptions: CaptureOptions;
  /** First OUTPUT frame of this window. */
  fromFrame: number;
  /** Exclusive last OUTPUT frame of this window. */
  toFrame: number;
}

export interface CaptureWindowResult {
  ok: boolean;
  error?: string;
  stack?: string;
  capture?: {
    outputFrames: number;
    htmlFrames: string[];
    warnings: string[];
    lint: LintWarning[];
    morphActiveFrames: number[];
    plan: unknown;
    meta: unknown;
    window: { from: number; to: number; tempo: number };
  };
}

async function run(): Promise<void> {
  const job = workerData as CaptureWindowJob;

  // tsx hooks are installed by the --import bootstrap (worker-register.mjs)
  // BEFORE this file loads — no registration here (double-registering would
  // slow every import). Plain .js/.mjs banner modules load hookless anyway.

  const specifier = pathToFileURL(resolve(job.modulePath)).href;
  const mod = (await import(specifier)) as { default?: unknown };
  const element = mod.default ?? mod;
  if (element === undefined || element === null) {
    throw new Error(`capture-worker: module "${job.modulePath}" has no default export.`);
  }

  const capture = await captureReactBanner(element as never, {
    ...job.captureOptions,
    fromFrame: job.fromFrame,
    toFrame: job.toFrame,
  });

  // chunks are recomputed on the main thread from the concatenated frames —
  // never shipped (they'd double the message size for hold-heavy banners).
  const { chunks: _chunks, ...rest } = capture;
  void _chunks;

  parentPort!.postMessage({ ok: true, capture: rest } satisfies CaptureWindowResult);
}

run().catch((error: Error) => {
  parentPort!.postMessage({
    ok: false,
    error: error?.message ?? String(error),
    stack: error?.stack,
  } satisfies CaptureWindowResult);
});
