// scripts/proof-v07.mts — the motion language release proof bar.
// Exercises every v0.7 bet end-to-end through the REAL pipeline, with the
// user's explicit constraint — PERFORMANCE — measured, not asserted:
//   1. Easing namespace + spring hygiene (settle solver, presets, clamp)
//   2. OKLCH color interpolation — deterministic, space-sensitive
//   3. Descriptor banner (Animated + presets + staggered + springify):
//      lint-clean, byte-deterministic, wall-clock timed
//   4. Keyframes banner: byte-deterministic, wall-clock timed
//   5. TM_TRANSITION_UNSETTLED — mid-motion cuts surface as report data
//   6. Perf microbench: ns/op for the per-frame resolvers + chunk-merge ratio
// Visual outputs go to examples-output/v07/ for QA.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";

import { renderReactBanner } from "../src/react-render.js";
import { captureReactBanner, chunkFrames } from "../src/react/capture.js";
import { renderStill } from "../src/still.js";
import {
  defineBanner,
  Banner,
  Scene,
  Animated,
  Keyframes,
  FadeInDown,
  FadeOutLeft,
  ZoomIn,
  BounceIn,
  staggered,
  springPresets,
  springSettleFrames,
  resolveTransitionAtFrame,
} from "../src/react/index.js";
import { Easing, mixColor, interpolateColorFor, colorToOklch } from "../src/index.js";
import { springFor } from "../src/react/motion.js";

const OUT = "examples-output/v07";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function bench(label: string, fn: () => void, iterations: number): number {
  // warmup
  for (let i = 0; i < Math.min(1000, iterations); i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0) / iterations;
  console.log(`  [BENCH] ${label}: ${ns < 1000 ? ns.toFixed(0) + " ns/op" : (ns / 1e6).toFixed(3) + " ms/op"} (${iterations} iters)`);
  return ns;
}

// ---------------------------------------------------------------------------
// 1. Easing namespace + spring hygiene
// ---------------------------------------------------------------------------

console.log("\n1. easing namespace + spring hygiene");
{
  const outBack = Easing.out(Easing.back(1.7));
  check("Easing.out(Easing.back) is an out-back curve", outBack(0.5) > 0.5 && Math.abs(outBack(0)) < 1e-12);
  check("named bounce easings resolve", Math.abs(Easing.bounceOut(1) - 1) < 1e-12 && Easing.poly(2)(0.5) === 0.25);

  const settle = springSettleFrames(30, { duration: 600, bounce: 0.45 });
  check("springSettleFrames solves finite settle", settle > 0 && settle < 630, `${settle}f at 30fps`);
  check("springFor lands exactly on `to` at settle", springFor(settle, 30, { duration: 600, bounce: 0.45 }) === 1);

  let clamped = true;
  for (let f = 0; f <= settle; f++) {
    const v = springFor(f, 30, { duration: 600, bounce: 0.6, from: 0, to: 100, overshootClamping: true });
    if (v < 0 || v > 100) clamped = false;
  }
  check("overshootClamping holds the range", clamped);
  check("spring presets spreadable", Object.keys(springPresets).length === 6);
}

// ---------------------------------------------------------------------------
// 2. OKLCH color interpolation
// ---------------------------------------------------------------------------

console.log("\n2. perceptual color (OKLCH default)");
{
  const oklch = mixColor("red", "yellow", 0.5);
  const srgb = mixColor("red", "yellow", 0.5, { space: "srgb" });
  check("OKLCH midpoint differs from sRGB midpoint", oklch !== srgb, `${oklch} vs ${srgb}`);
  const h = colorToOklch(oklch)!.h;
  check("red→yellow hue midpoint stays on the orange arc (short path)", h > 40 && h < 110, `hue ${h.toFixed(1)}°`);
  check("interpolateColorFor is deterministic", interpolateColorFor(7, [0, 14], ["#0f172a", "#f8fafc"]) === interpolateColorFor(7, [0, 14], ["#0f172a", "#f8fafc"]));
}

// ---------------------------------------------------------------------------
// 3. Descriptor banner — the motion vocabulary through the real pipeline
// ---------------------------------------------------------------------------

const MotionBanner = defineBanner(function MotionBanner() {
  const kf = {
    0: { opacity: 0, scale: 0.8 },
    15: { opacity: 1, scale: 1, easing: "backOut" },
    45: { opacity: 1 },
    55: { opacity: 0, easing: "easeIn" },
  };
  return createElement(
    Banner,
    { width: 640, height: 200, fps: 30, background: "#0b1220" },
    createElement(
      Scene,
      { duration: 60 },
      createElement(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "center", height: 200 } },
        createElement(
          Animated,
          { entering: staggered(FadeInDown, 0, { intervalFrames: 3 }), exiting: FadeOutLeft.duration(10) },
          createElement(
            Keyframes,
            { frames: kf },
            createElement("div", { style: { fontSize: 44, fontWeight: 700, color: "#f8fafc" } }, "motion language"),
          ),
        ),
      ),
    ),
    createElement(
      Scene,
      { duration: 50 },
      createElement(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "center", height: 200 } },
        createElement(
          Animated,
          { entering: ZoomIn.springify("snappy"), exiting: FadeOutLeft.duration(12) },
          createElement("div", { style: { fontSize: 30, color: "#93c5fd" } }, "v0.7 — the reanimated borrow"),
        ),
      ),
    ),
    createElement(
      Scene,
      { duration: 45 },
      createElement(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "center", height: 200 } },
        createElement(
          Animated,
          { entering: BounceIn.delay(4) },
          createElement("div", { style: { fontSize: 36, fontWeight: 700, color: "#fbbf24" } }, "bounce, deterministically"),
        ),
      ),
    ),
  );
}) as never;

console.log("\n3. descriptor banner (Animated + presets + staggered + springify + Keyframes)");
{
  const capture = await captureReactBanner(MotionBanner);
  check("capture lint is CLEAN", capture.lint.length === 0, capture.lint.map((w) => w.code).join(","));
  check("scenes planned", capture.plan.totalFrames === 155, `${capture.plan.totalFrames}f`);

  const t0 = process.hrtime.bigint();
  const a = await renderReactBanner({ banner: MotionBanner, formats: ["gif", "webp"] });
  const t1 = process.hrtime.bigint();
  const wallMs = Number(t1 - t0) / 1e6;
  check("renders gif+webp", a.files.length === 2, a.files.map((f) => `${f.path} ${(f.bytes / 1024).toFixed(0)}kB`).join(", "));
  console.log(`  [PERF] full pipeline wall: ${wallMs.toFixed(0)}ms for ${capture.plan.totalFrames}f @ 640×200`);

  const t2 = process.hrtime.bigint();
  const b = await renderReactBanner({ banner: MotionBanner, formats: ["gif", "webp"] });
  const t3 = process.hrtime.bigint();
  const wall2Ms = Number(t3 - t2) / 1e6;
  const same = a.files.every((f, i) => f.buffer.equals(b.files[i].buffer));
  check("byte-deterministic double render", same, `second pass ${wall2Ms.toFixed(0)}ms`);

  for (const f of a.files) writeFileSync(join(OUT, `descriptor.${f.format}`), f.buffer);

  // Engine-exact still of the mid-entrance frame for visual QA.
  const still = await renderStill({ banner: MotionBanner, frame: 10 });
  writeFileSync(join(OUT, "descriptor-frame-10.png"), still.png);
  check("renderStill at an enter mid-flight frame", still.png.length > 1000);
}

// ---------------------------------------------------------------------------
// 4. Keyframes-driven banner
// ---------------------------------------------------------------------------

const KfBanner = defineBanner(function KfBanner() {
  const wash = { 0: { backgroundColor: "#0f172a" }, 40: { backgroundColor: "#1d4ed8" }, 80: { backgroundColor: "#0f172a" } };
  return createElement(
    Banner,
    { width: 400, height: 120, fps: 30, background: null },
    createElement(
      Scene,
      { duration: 80 },
      createElement(
        Keyframes,
        { frames: wash },
        createElement(
          "div",
          { style: { display: "flex", alignItems: "center", justifyContent: "center", height: 120 } },
          createElement(
            Keyframes,
            {
              frames: {
                0: { opacity: 0, y: -30 },
                20: { opacity: 1, y: 0, easing: "backOut" },
                60: { opacity: 1 },
                79: { opacity: 0, y: 30, easing: "easeIn" },
              },
            },
            createElement("div", { style: { fontSize: 34, fontWeight: 700, color: "#f8fafc" } }, "OKLCH wash + keyframed text"),
          ),
        ),
      ),
    ),
  );
}) as never;

console.log("\n4. keyframes banner (nested Keyframes + OKLCH background wash)");
{
  const a = await renderReactBanner({ banner: KfBanner, formats: ["gif", "webp"] });
  const b = await renderReactBanner({ banner: KfBanner, formats: ["gif", "webp"] });
  const same = a.files.every((f, i) => f.buffer.equals(b.files[i].buffer));
  check("byte-deterministic double render", same);
  check("lint clean", a.lint.length === 0, a.lint.map((w) => w.code).join(","));
  for (const f of a.files) writeFileSync(join(OUT, `kf.${f.format}`), f.buffer);
}

// ---------------------------------------------------------------------------
// 5. TM_TRANSITION_UNSETTLED as data
// ---------------------------------------------------------------------------

console.log("\n5. transition-settle lint as report data");
{
  const Bad = defineBanner(function Bad() {
    return createElement(
      Banner,
      { width: 320, height: 100, fps: 30 },
      createElement(
        Scene,
        { duration: 12 },
        createElement(Animated, { entering: FadeInDown.duration(20).delay(4) }, createElement("div", null, "cut!")),
      ),
    );
  }) as never;
  const report = await renderReactBanner({ banner: Bad, formats: ["webp"] });
  const warning = report.lint.find((w) => w.code === "TM_TRANSITION_UNSETTLED");
  check("mid-motion cut surfaces as TM_TRANSITION_UNSETTLED", warning !== undefined, warning?.message ?? "none");
}

// ---------------------------------------------------------------------------
// 6. Perf microbench — the per-frame resolvers must be cheap
// ---------------------------------------------------------------------------

console.log("\n6. per-frame resolver microbench (30fps budget: 33.3ms/frame total)");
{
  const desc = FadeInDown.duration(20).delay(4);
  const resolve = () => resolveTransitionAtFrame(desc, 12, { fps: 30, totalFrames: 60 });
  const resolveNs = bench("resolveTransitionAtFrame (eased enter, mid-flight)", resolve, 200_000);
  check("descriptor resolve < 2µs/frame", resolveNs < 2000, `${resolveNs.toFixed(0)}ns`);

  const springNs = bench("springFor (physics spring, mid-flight)", () => springFor(12, 30, { duration: 600, bounce: 0.45 }), 200_000);
  check("springFor < 5µs/frame", springNs < 5000, `${springNs.toFixed(0)}ns`);

  const colorNs = bench("interpolateColorFor (warm cache, mid-flight)", () => interpolateColorFor(7, [0, 14, 28], ["#0f172a", "#1d4ed8", "#f8fafc"]), 200_000);
  check("interpolateColorFor < 10µs/frame", colorNs < 10_000, `${colorNs.toFixed(0)}ns`);

  const settleNs = bench("springSettleFrames (memoized hit)", () => springSettleFrames(30, { duration: 600, bounce: 0.45 }), 500_000);
  check("springSettleFrames memoized < 1µs", settleNs < 1000, `${settleNs.toFixed(0)}ns`);

  // Chunk-merge ratio: the r6 doctrine turning motion into few unique frames.
  const capture = await captureReactBanner(MotionBanner);
  const ratio = capture.htmlFrames.length / capture.chunks.length;
  console.log(`  [PERF] chunk-merge: ${capture.htmlFrames.length} raw frames → ${capture.chunks.length} unique (${ratio.toFixed(2)}× compression)`);
  check("r6 chunk-merge compresses the timeline", capture.chunks.length < capture.htmlFrames.length);
}

console.log(failures === 0 ? "\nALL PROOFS PASS" : `\n${failures} PROOF(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
