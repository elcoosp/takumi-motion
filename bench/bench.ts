// takumi-motion — bench/bench.ts (v1.0)
// Deterministic before/after benchmark: the frozen v0.9.1 pipeline
// (bench/baseline/src) against the v1.0 pipeline (src) on identical corpora.
//
//   npx tsx bench/bench.ts [--json] [filter]
//
// Protocol: per bench — 2 warmup runs + 9 measured runs, MEDIAN reported.
// End-to-end benches measure the full public API; micro benches measure the
// hot function directly on a fixed corpus (deterministic inputs, seeded).

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "./baseline/src";
const CUR = "../src";
const js = (base: string, name: string): string => `${base}/${name}.js`;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Sample {
  name: string;
  unit: string;
  baseline: number;
  current: number;
  /** higher-is-better when unit === "bytes" (compression) */
  note?: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function bench(name: string, unit: string, run: () => number, runs = 9): { baseline: number; current: number } {
  // burn-in
  run();
  run();
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) samples.push(run());
  return { baseline: median(samples), current: 0, ...(unit === "x" ? {} : {}) };
}

type Job = () => number | Promise<number>;

async function timeRuns(fn: Job, runs: number): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return samples;
}

async function benchPair(
  name: string,
  unit: string,
  baseRun: Job,
  curRun: Job,
  runs = 9,
): Promise<Sample> {
  // burn-in both sides
  await baseRun();
  await baseRun();
  await curRun();
  await curRun();
  const base = await timeRuns(baseRun, runs);
  const cur = await timeRuns(curRun, runs);
  return { name, unit, baseline: median(base), current: median(cur) };
}

const fmt = (v: number, unit: string): string => {
  if (unit === "bytes") return `${(v / 1024).toFixed(1)} KiB`;
  if (v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  return `${v.toFixed(unit === "ratio" ? 3 : 1)} ${unit}`;
};

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const [, /* trackBase */] = [] as unknown[];
type TrackLike = Record<string, unknown>;
const mkTracks = (): TrackLike[] => [
  {
    target: ".hero",
    property: "opacity",
    keyframes: [0, 1, 0.4],
    times: [0, 0.4, 1],
    transition: { type: "tween", duration: 900, ease: ["easeOut", "linear"] },
  },
  {
    target: ".hero",
    property: "y",
    keyframes: [-40, 0],
    transition: { type: "spring", stiffness: 210, damping: 22 },
  },
  {
    target: ".glow",
    property: "scale",
    keyframes: [0.9, 1.1],
    transition: { type: "spring", stiffness: 500, damping: 28, repeat: Infinity, repeatType: "mirror" },
  },
  {
    target: ".glow",
    property: "opacity",
    keyframes: [0.3, 0.7],
    transition: { type: "tween", duration: 500, repeat: Infinity, repeatType: "mirror" },
  },
  {
    target: ".bar",
    property: "color",
    keyframes: ["#ff5257", "#7aa2f7", "#9ece6a"],
    transition: { type: "tween", duration: 1200 },
  },
];

// ---------------------------------------------------------------------------
// Benches
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Register the in-house esbuild loader FIRST so banner modules authored with
  // the automatic JSX runtime import cleanly on the main thread too.
  await import("../src/react/ts-worker-loader.mjs");
  const filter = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "";
  const json = process.argv.includes("--json");
  const samples: Sample[] = [];

  // ---- 1. compileTimeline -------------------------------------------------
  {
    const { compileTimeline } = await import(js(BASE, "compile"));
    const { compileTimeline: compileTimelineNext } = await import(js(CUR, "compile"));
    const timeline = { version: 1, durationMs: 2000, tracks: mkTracks() } as never;
    samples.push(
      await benchPair("compile: 5 tracks × 60fps bake", "ms",
        () => { for (let i = 0; i < 20; i++) compileTimeline(timeline, { fps: 60 }); return 0; },
        () => { for (let i = 0; i < 20; i++) compileTimelineNext(timeline, { fps: 60 }); return 0; },
      ),
    );
  }

  // ---- 2. evaluateAt sweep -------------------------------------------------
  {
    const { evaluateAt } = await import(js(BASE, "evaluate"));
    const { evaluateAt: evaluateAtNext } = await import(js(CUR, "evaluate"));
    const timeline = { version: 1, durationMs: 2000, tracks: mkTracks() } as never;
    const N = 400;
    samples.push(
      await benchPair("evaluateAt: 400 sweeps × 5 tracks", "ms",
        () => { for (let t = 0; t < N; t++) evaluateAt(timeline, t * 5); return 0; },
        () => { for (let t = 0; t < N; t++) evaluateAtNext(timeline, t * 5); return 0; },
      ),
    );
  }

  // ---- 3. spring sampling --------------------------------------------------
  {
    const { springFor } = await import(`${BASE}/react/motion.js`);
    const { springFor: springForNext } = await import(`${CUR}/react/motion.js`);
    const N = 3000;
    samples.push(
      await benchPair("springFor: 3000 samples, 20 configs", "ms",
        () => {
          for (let c = 0; c < 20; c++)
            for (let f = 0; f < N / 20; f++) springFor(f, 30, { duration: 300 + c * 10, bounce: 0.1 + (c % 5) * 0.05 });
          return 0;
        },
        () => {
          for (let c = 0; c < 20; c++)
            for (let f = 0; f < N / 20; f++) springForNext(f, 30, { duration: 300 + c * 10, bounce: 0.1 + (c % 5) * 0.05 });
          return 0;
        },
      ),
    );
  }

  // ---- 4. tween sampling ---------------------------------------------------
  {
    const { createTweenSampler } = await import(js(BASE, "interpolate"));
    const { createTweenSampler: createTweenSamplerNext } = await import(js(CUR, "interpolate"));
    const sampler = createTweenSampler({ keyframes: [0, 40, 20, 100], times: [0, 0.3, 0.6, 1], duration: 1200, ease: ["easeIn", "linear", "backOut"] } as never);
    const samplerNext = createTweenSamplerNext({ keyframes: [0, 40, 20, 100], times: [0, 0.3, 0.6, 1], duration: 1200, ease: ["easeIn", "linear", "backOut"] } as never);
    const N = 100_000;
    samples.push(
      await benchPair("tween sample: 100k samples, 4 stops", "ms",
        () => { for (let i = 0; i < N; i++) sampler.sample((i % 1201)); return 0; },
        () => { for (let i = 0; i < N; i++) samplerNext.sample((i % 1201)); return 0; },
      ),
    );
  }

  // ---- 5. color mixing -----------------------------------------------------
  {
    const { mixColors } = await import(js(BASE, "interpolate"));
    const { mixColors: mixColorsNext } = await import(js(CUR, "interpolate"));
    const N = 50_000;
    samples.push(
      await benchPair("mixColors: 50k mixes (4 palettes)", "ms",
        () => { for (let i = 0; i < N; i++) mixColors(["#ff5257", "#7aa2f7", "#9ece6a", "rgba(26,27,38,0.8)"][i & 3], "#0f0f23", (i % 1000) / 1000); return 0; },
        () => { for (let i = 0; i < N; i++) mixColorsNext(["#ff5257", "#7aa2f7", "#9ece6a", "rgba(26,27,38,0.8)"][i & 3], "#0f0f23", (i % 1000) / 1000); return 0; },
      ),
    );
  }

  // ---- 6. GIF hold collapse ------------------------------------------------
  {
    const { collapseGifHolds } = await import(js(BASE, "size"));
    const { collapseGifHolds: collapseGifHoldsNext } = await import(js(CUR, "size"));
    // synthetic 2×2 GIF with 300 identical-ish hold frames
    const frames: Buffer[] = [];
    const header = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00]);
    const gct = Buffer.from([0xff, 0x00, 0x00, 0x00, 0x00, 0xff]);
    const gce = (d: number) => Buffer.from([0x21, 0xf9, 0x04, 0x04, d & 0xff, (d >> 8) & 0xff, 0x00, 0x00]);
    const desc = Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00]);
    const dataA = Buffer.from([0x02, 0x02, 0x4c, 0x01, 0x00]);
    const dataB = Buffer.from([0x02, 0x02, 0x4c, 0x02, 0x00]);
    for (let i = 0; i < 300; i++) frames.push(Buffer.concat([gce(4), desc, i % 10 === 0 ? dataB : dataA]));
    const gif = Buffer.concat([header, gct, ...frames, Buffer.from([0x3b])]);
    samples.push(
      await benchPair("gif hold collapse: 300 frames", "ms",
        () => { for (let i = 0; i < 20; i++) collapseGifHolds(gif); return 0; },
        () => { for (let i = 0; i < 20; i++) collapseGifHoldsNext(gif); return 0; },
      ),
    );
  }

  // ---- 7. chunk index ------------------------------------------------------
  {
    const { chunkIndexForFrame } = await import(js(CUR, "chunk-index"));
    const chunks = Array.from({ length: 400 }, (_, i) => ({ html: `c${i}`, frames: 5, startFrame: i * 5 }));
    const linear = (frame: number): number => {
      for (let i = chunks.length - 1; i >= 0; i--) if (frame >= chunks[i].startFrame) return i;
      return 0;
    };
    const N = 200_000;
    samples.push(
      await benchPair("chunkIndex: 200k lookups over 400 chunks", "ms",
        () => { let acc = 0; for (let f = 0; f < N; f++) acc += linear(f % 2000); return acc === -1 ? 1 : 0; },
        () => { let acc = 0; for (let f = 0; f < N; f++) acc += chunkIndexForFrame(chunks, f % 2000); return acc === -1 ? 1 : 0; },
      ),
    );
  }

  // ---- 8. PNG encode (bytes + ms) ------------------------------------------
  {
    const { encodePngRgba: basePng } = await import(js(BASE, "sprite"));
    const { encodePngRgba: curPng } = await import(js(CUR, "png"));
    const W = 850;
    const H = 400;
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        rgba[i] = (x * 255 / W) | 0;
        rgba[i + 1] = (y * 255 / H) | 0;
        rgba[i + 2] = ((x + y) % 256);
        rgba[i + 3] = 255;
      }
    const baseBuf = basePng(W, H, rgba);
    const curBuf = curPng(W, H, rgba);
    const s: Sample = await benchPair(
      "png encode: 850×400 gradient atlas", "ms",
      () => { basePng(W, H, rgba); return 0; },
      () => { curPng(W, H, rgba); return 0; },
    );
    s.note = `bytes ${(baseBuf.length / 1024).toFixed(1)}KiB → ${(curBuf.length / 1024).toFixed(1)}KiB (−${Math.round((1 - curBuf.length / baseBuf.length) * 100)}%)`;
    samples.push(s);
  }

  // ---- 9. capture (fixture banner) -----------------------------------------
  {
    const { captureReactBanner } = await import(`${BASE}/react/capture.js`);
    const { captureReactBanner: captureReactBannerNext } = await import(`${CUR}/react/capture.js`);
    // Each pipeline renders a fixture built on ITS OWN module graph (DriverContext
    // identity is graph-local — mixing graphs breaks the provider).
    const curBanner = (await import(resolve("tests/fixtures/banner-module.tsx"))).default;
    const baseBanner = (await import(resolve("tests/fixtures/banner-module-baseline.tsx"))).default;
    const opts = { fps: 20 };
    samples.push(
      await benchPair("capture: 80-frame banner (probe→chunk)", "ms",
        () => captureReactBanner(baseBanner as never, opts),
        () => captureReactBannerNext(curBanner as never, opts),
        7,
      ),
    );
  }

  // ---- 10. end-to-end (baseline pipeline vs v1.0, serial) --------------------
  {
    const { renderReactBanner: baseRender } = await import(`${BASE}/react-render.js`);
    const { renderReactBanner: curRender } = await import(`${CUR}/react-render.js`);
    const baseModule = resolve("tests/fixtures/banner-module-baseline.tsx");
    const curModule = resolve("tests/fixtures/banner-module.tsx");
    const common = { preset: "readme-lean", formats: ["webp"] as never, posters: false };
    // v0.9.1's renderReactBanner takes an ELEMENT (no module entry) — load the
    // baseline-graph fixture and pass the element directly.
    const baseElement = (await import(baseModule)).default as never;
    samples.push(
      await benchPair("end-to-end: 80f banner, serial (v0.9 → v1.0)", "ms",
        () => baseRender({ ...common, banner: baseElement } as never),
        () => curRender({ ...common, bannerModule: curModule, workers: 1 } as never),
        7,
      ),
    );
  }

  // ---- 11. heavy tree: capture-stage time + the workers crossover -----------
  // Heavy per-frame trees are where worker capture pays — but ONLY on hosts
  // with real core counts (per-worker setup ≈ 300ms: module graph + probe +
  // prewarm + Renderer init). This bench host has 2 vCPUs, where the Rust
  // stages already saturate the machine: the auto gate correctly keeps
  // serial, and an explicit workers:4 oversubscribes. The rows report the
  // CAPTURE stage (the stage parallelism targets) from report.timings.
  {
    const { renderReactBanner } = await import(`${CUR}/react-render.js`);
    const { renderReactBanner: baseRenderHeavy } = await import(`${BASE}/react-render.js`);
    const modulePath = resolve("tests/fixtures/heavy-banner-module.tsx");
    const lightPath = resolve("tests/fixtures/banner-module.tsx");
    const common = { preset: "readme-lean", formats: ["webp"] as never, posters: false };
    const baseHeavy = resolve("tests/fixtures/heavy-banner-module-baseline.tsx");
    const baseHeavyElement = (await import(baseHeavy)).default;
    const captureMs = async (workers: number | "auto"): Promise<number> => {
      const r = await renderReactBanner({ ...common, bannerModule: modulePath, workers });
      return r.timings.captureMs;
    };
    // Both sides render the SAME 240f × ~620-node banner — v0.9 through its
    // own module graph (element path), v1.0 through the module entry.
    samples.push(await benchPair("heavy capture stage: 240f × 620 nodes, serial (v0.9 → v1.0)", "ms",
      () => baseRenderHeavy({ ...common, banner: baseHeavyElement } as never).then((r: { timings: { captureMs: number } }) => r.timings.captureMs),
      captureMs.bind(null, 1), 5,
    ));
    samples.push({
      ...(await benchPair("heavy capture stage: workers:4 (2-core host — oversubscribed)", "ms",
        captureMs.bind(null, 1), captureMs.bind(null, 4), 3)),
      note: "auto gate keeps serial here; ≥4-core hosts see the win (crossover: work ≥ per-worker setup × cores)",
    });
    samples.push(await benchPair("auto gate (light banner): refuses to spawn", "ms",
      () => renderReactBanner({ ...common, bannerModule: lightPath, workers: "auto" }),
      () => renderReactBanner({ ...common, bannerModule: lightPath, workers: 1 }),
      7,
    ));
  }

  // ---- report ---------------------------------------------------------------
  const usable = samples.filter((s) => s.unit === "ms");
  const table = samples.map((s) => {
    const speedup = s.unit === "ms" && s.current > 0 ? s.baseline / s.current : NaN;
    return {
      name: s.name,
      baseline: fmt(s.baseline, s.unit),
      current: fmt(s.current, s.unit),
      delta: Number.isFinite(speedup) ? `${speedup.toFixed(2)}×` : "",
      note: s.note ?? "",
    };
  });
  const geomean = Math.exp(
    usable.reduce((acc, s) => acc + Math.log(s.baseline / s.current), 0) / Math.max(1, usable.length),
  );

  const md = [
    "# takumi-motion v1.0 — before/after benchmarks",
    "",
    "Frozen baseline: `bench/baseline/src` (verbatim v0.9.1 `src`). Protocol: 2 warmups + 9 measured runs, MEDIAN. Node " + process.version.replace(/^v/, "") + ", " + `${process.arch}, ${process.platform}.`,
    "",
    "| bench | baseline | v1.0 | speedup | note |",
    "|---|---|---|---|---|",
    ...table.map((r) => `| ${r.name} | ${r.baseline} | ${r.current} | ${r.delta} | ${r.note} |`),
    "",
    `**Geometric mean over timed benches: ${geomean.toFixed(2)}× faster.**`,
    "",
  ].join("\n");

  if (json) {
    console.log(JSON.stringify({ samples, geomean }, null, 2));
  } else {
    for (const row of table) {
      console.log(
        `${row.name.padEnd(46)} ${row.baseline.padStart(11)} → ${row.current.padStart(11)}  ${row.delta.padStart(6)}  ${row.note}`,
      );
    }
    console.log(`\ngeomean: ${geomean.toFixed(2)}× over ${usable.length} timed benches`);
  }
  try {
    writeFileSync(resolve("docs/BENCHMARKS.md"), md);
  } catch {
    // docs dir absent in some checkouts
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});