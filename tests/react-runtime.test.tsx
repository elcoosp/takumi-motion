// tests/react-runtime.test.tsx — planner, motion math, hooks, capture,
// chunking, transitions: the frame-driven React runtime's contract layer.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  planBanner,
  composeFrame,
  resolveTransition,
  DEFAULT_TRANSITION_MS,
  type ScenePlanInput,
} from "../src/react/plan.js";
import {
  springFor,
  interpolateFor,
  randomFor,
  pulseFor,
  smoothPulseFor,
  mulberry32,
  frameToMs,
} from "../src/react/motion.js";
import { transitionStyle } from "../src/react/transitions.js";
import {
  captureReactBanner,
  chunkFrames,
  type CaptureResult,
} from "../src/react/capture.js";
import {
  Banner,
  Scene,
  Layer,
  defineBanner,
  isDefinedBanner,
  useCurrentFrame,
  useAbsoluteFrame,
  useFrameState,
  useSpring,
  useRandom,
  useFrame,
} from "../src/react/index.js";
import { springGenerator } from "../src/spring.js";

const FPS = 20;

// ---------------------------------------------------------------------------
// A: planner
// ---------------------------------------------------------------------------

describe("planBanner", () => {
  it("single scene: starts at 0, total = duration", () => {
    const plan = planBanner([{ durationFrames: 30 }], { fps: FPS });
    expect(plan.totalFrames).toBe(30);
    expect(plan.scenes[0]).toMatchObject({ startFrame: 0, durationFrames: 30, enterFrames: 0, exitFrames: 0 });
    expect(plan.warnings).toHaveLength(0);
  });

  it("two scenes with cuts play back-to-back", () => {
    const plan = planBanner([{ durationFrames: 30 }, { durationFrames: 40 }], { fps: FPS });
    expect(plan.scenes[1].startFrame).toBe(30);
    expect(plan.totalFrames).toBe(70);
  });

  it("crossfade overlap pulls the arriving scene into the previous tail", () => {
    // 250ms @ 20fps = 5 frames
    const plan = planBanner(
      [{ durationFrames: 30, exit: "crossfade" }, { durationFrames: 40, enter: "crossfade" }],
      { fps: FPS },
    );
    expect(plan.scenes[0].exitFrames).toBe(5);
    expect(plan.scenes[1].enterFrames).toBe(5);
    expect(plan.scenes[1].startFrame).toBe(25); // 30 - 5
    expect(plan.totalFrames).toBe(65); // 30 + 40 - 5
  });

  it("enter alone creates the overlap; exit kind is irrelevant to the size", () => {
    const plan = planBanner(
      [{ durationFrames: 30 }, { durationFrames: 40, enter: { kind: "slide", ms: 300 } }],
      { fps: FPS },
    );
    expect(plan.scenes[1].enterFrames).toBe(6); // 300ms @ 20fps
    expect(plan.scenes[1].startFrame).toBe(24);
    expect(plan.totalFrames).toBe(64);
  });

  it("clamps overlap when scenes are too short and warns", () => {
    const plan = planBanner(
      [{ durationFrames: 3, exit: "crossfade" }, { durationFrames: 3, enter: "crossfade" }],
      { fps: FPS }, // wants 5 frames, max is 2
    );
    expect(plan.scenes[1].enterFrames).toBe(2);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.totalFrames).toBe(4);
  });

  it("degrades to a hard cut when not even one overlap frame fits", () => {
    const plan = planBanner(
      [{ durationFrames: 1, exit: "crossfade" }, { durationFrames: 10, enter: "crossfade" }],
      { fps: FPS },
    );
    expect(plan.scenes[1].enterFrames).toBe(0);
    expect(plan.scenes[1].startFrame).toBe(1);
    expect(plan.warnings.join(" ")).toContain("Degrading to a hard cut");
  });

  it("sequential overlaps respect the previous scene's remaining budget", () => {
    // Scene 1 (dur 10): head overlap 8 + tail overlap must clamp to 1.
    const plan = planBanner(
      [
        { durationFrames: 30 },
        { durationFrames: 10, enter: { kind: "crossfade", ms: 400 }, exit: { kind: "crossfade", ms: 400 } },
        { durationFrames: 30 },
      ],
      { fps: FPS },
    );
    expect(plan.scenes[1].enterFrames).toBe(8); // 400ms @ 20fps = 8
    // tail: wants 8, budget = 10 - 1 - 8 = 1
    expect(plan.scenes[1].exitFrames).toBe(1);
    expect(plan.scenes[2].enterFrames).toBe(1);
  });

  it("composeFrame: single mode with scene-local frames", () => {
    const plan = planBanner(
      [{ durationFrames: 20, exit: "crossfade" }, { durationFrames: 20, enter: "crossfade" }],
      { fps: FPS },
    );
    const mid = composeFrame(plan, 10);
    expect(mid).toMatchObject({ mode: "single", localFrame: 10 });
    if (mid.mode === "single") expect(mid.scene.index).toBe(0);

    const overlap = composeFrame(plan, 15); // overlap frames 15..19
    expect(overlap.mode).toBe("overlap");
    if (overlap.mode === "overlap") {
      expect(overlap.leaving.index).toBe(0);
      expect(overlap.arriving.index).toBe(1);
      expect(overlap.localFrame.leaving).toBe(15);
      expect(overlap.localFrame.arriving).toBe(0);
      expect(overlap.progress).toBeCloseTo(1 / 5);
    }
  });

  it("composeFrame rejects out-of-range frames", () => {
    const plan = planBanner([{ durationFrames: 5 }], { fps: FPS });
    expect(() => composeFrame(plan, 5)).toThrow(RangeError);
    expect(() => composeFrame(plan, -1)).toThrow(RangeError);
  });

  it("validates inputs", () => {
    expect(() => planBanner([], { fps: FPS })).toThrow();
    expect(() => planBanner([{ durationFrames: 0 }], { fps: FPS })).toThrow();
    expect(() => planBanner([{ durationFrames: 2.5 }], { fps: FPS })).toThrow();
    expect(() => planBanner([{ durationFrames: 5 }], { fps: 0 })).toThrow();
  });

  it("resolveTransition: strings take the default ms, objects override, cut cuts", () => {
    expect(resolveTransition(undefined, 250)).toEqual({ kind: "cut", ms: 0 });
    expect(resolveTransition("slide", 250)).toEqual({ kind: "slide", ms: 250 });
    expect(resolveTransition({ kind: "rise", ms: 100 }, 250)).toEqual({ kind: "rise", ms: 100 });
    expect(resolveTransition({ kind: "rise" }, 250)).toEqual({ kind: "rise", ms: DEFAULT_TRANSITION_MS });
    expect(resolveTransition("cut", 250)).toEqual({ kind: "cut", ms: 0 });
  });
});

// ---------------------------------------------------------------------------
// B: pure motion math
// ---------------------------------------------------------------------------

describe("springFor", () => {
  it("returns `from` at frame 0 and inside the delay", () => {
    expect(springFor(0, FPS, { from: -30, to: 0 })).toBe(-30);
    expect(springFor(2, FPS, { from: -30, to: 0, delayFrames: 5 })).toBe(-30);
  });

  it("settles exactly on `to`", () => {
    expect(springFor(200, FPS, { from: 0, to: 42, stiffness: 200, damping: 20 })).toBe(42);
  });

  it("matches the shared spring solver sample-for-sample", () => {
    const opts = { from: 10, to: -5, stiffness: 180, damping: 12 };
    const gen = springGenerator({ ...opts, keyframes: [10, -5] });
    for (let f = 1; f <= 30; f++) {
      const t = frameToMs(f, FPS);
      const expected = gen.next(t);
      const got = springFor(f, FPS, opts);
      if (expected.done) expect(got).toBe(-5);
      else expect(got).toBeCloseTo(expected.value, 6);
    }
  });
});

describe("interpolateFor", () => {
  it("clamps outside the input range", () => {
    expect(interpolateFor(-5, [0, 10], [0, 100])).toBe(0);
    expect(interpolateFor(50, [0, 10], [0, 100])).toBe(100);
  });

  it("interpolates linearly by default", () => {
    expect(interpolateFor(5, [0, 10], [0, 100])).toBe(50);
  });

  it("supports multi-stop ranges and per-segment easings", () => {
    // segment 0 linear: frame 5 → 50 exactly
    expect(interpolateFor(5, [0, 10, 20], [0, 100, 0], ["linear", "easeIn"])).toBe(50);
    // segment 1 easeIn (cubic-bezier): at t=0.2 eased < linear → value stays nearer 100
    const out = interpolateFor(12, [0, 10, 20], [0, 100, 0], ["linear", "easeIn"]);
    expect(out).toBeGreaterThan(80); // linear would give exactly 80
    expect(out).toBeLessThan(100);
  });

  it("rejects mismatched ranges", () => {
    expect(() => interpolateFor(5, [0, 10], [0, 1, 2])).toThrow();
  });
});

describe("randomness + pulses", () => {
  it("randomFor is deterministic and salt-sensitive", () => {
    expect(randomFor(42)).toBe(randomFor(42));
    expect(randomFor(42, 1)).not.toBe(randomFor(42, 2));
    const v = randomFor(7);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it("mulberry32 stays in [0,1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("pulseFor is a frame-aligned triangle: 0 at multiples of the period", () => {
    expect(pulseFor(0, 8)).toBe(0);
    expect(pulseFor(4, 8)).toBe(1);
    expect(pulseFor(8, 8)).toBe(0); // seam-safe
    expect(pulseFor(16, 8)).toBe(0);
  });

  it("smoothPulseFor peaks mid-period", () => {
    expect(smoothPulseFor(0, 8)).toBeCloseTo(0);
    expect(smoothPulseFor(4, 8)).toBeCloseTo(1);
  });
});

describe("transitionStyle", () => {
  it("cut produces nothing", () => {
    expect(transitionStyle("cut", "enter", 0.5)).toEqual({});
  });

  it("crossfade ramps opacity with eased progress", () => {
    expect(transitionStyle("crossfade", "enter", 0)).toEqual({ opacity: 0 });
    expect(transitionStyle("crossfade", "enter", 1)).toEqual({}); // fully arrived — no overrides
    const mid = transitionStyle("crossfade", "enter", 0.5).opacity;
    expect(mid).toBeGreaterThan(0.5); // easeOut
    const exitMid = transitionStyle("crossfade", "exit", 0.5).opacity;
    expect(exitMid).toBeGreaterThan(0.5); // easeIn exit: slow start, then fast
    expect(transitionStyle("crossfade", "exit", 0)).toEqual({}); // not yet leaving
    expect(transitionStyle("crossfade", "exit", 1).opacity).toBe(0);
  });

  it("slide offsets collapse to 0 by full arrival", () => {
    const start = transitionStyle("slide", "enter", 0);
    expect(start.transform).toBe("translateX(48px)");
    expect(transitionStyle("slide", "enter", 1)).toEqual({});
    expect(transitionStyle("slide", "exit", 0)).toEqual({});
    expect(transitionStyle("slide", "exit", 1).transform).toBe("translateX(-48px)");
  });

  it("rise moves vertically", () => {
    expect(transitionStyle("rise", "enter", 0).transform).toBe("translateY(48px)");
    expect(transitionStyle("rise", "exit", 1).transform).toBe("translateY(-48px)");
  });

  it("push slides full-width at full opacity — no double exposure", () => {
    const W = 850;
    const enterStart = transitionStyle("push", "enter", 0, W);
    const exitEnd = transitionStyle("push", "exit", 1, W);
    expect(enterStart.transform).toBe(`translateX(${W}px)`);
    expect(exitEnd.transform).toBe(`translateX(${-W}px)`);
    // Full opacity on BOTH sides — the scenes never superimpose.
    expect(enterStart.opacity).toBeUndefined();
    expect(transitionStyle("push", "exit", 0.5, W).opacity).toBeUndefined();
    // Lockstep adjacency: entering left edge == leaving right edge, always.
    const q = 0.42;
    const enter = transitionStyle("push", "enter", q, W).transform!;
    const exit = transitionStyle("push", "exit", q, W).transform!;
    const parse = (t: string) => Number(/translateX\((-?[\d.]+)px\)/.exec(t)![1]);
    // entering at (1-q)W from the right; leaving at -qW — the leaving scene's
    // right edge (-qW + W) must equal the arriving scene's left edge.
    expect(parse(enter)).toBeCloseTo(parse(exit) + W, 6);
    expect(transitionStyle("push", "enter", 1, W)).toEqual({}); // fully arrived — no overrides
  });
});

// ---------------------------------------------------------------------------
// C+D: capture runtime (probe, hooks, chunking, determinism shim)
// ---------------------------------------------------------------------------

function recordedFrames(): { frames: number[]; absolute: number[] } {
  const rec = { frames: [] as number[], absolute: [] as number[] };
  const Probe = (): null => {
    rec.frames.push(useCurrentFrame());
    rec.absolute.push(useAbsoluteFrame());
    return null;
  };
  return rec;
}

function makeBanner(children: ReturnType<typeof createElement>, props: Record<string, unknown> = {}) {
  return defineBanner(function TestBanner() {
    return createElement(Banner, { preset: "readme", ...props }, children);
  });
}

describe("captureReactBanner", () => {
  it("probe registers meta and the plan covers scene-local + absolute frames", async () => {
    const rec = { frames: [] as number[], absolute: [] as number[] };
    const banner = makeBanner([
      createElement(Scene, { key: "a", duration: 10 }, createElement(Probe0)),
      createElement(Scene, { key: "b", duration: 10 }, createElement(Probe1)),
    ]);
    // tiny inline probes (closure capture per scene)
    function Probe0(): null {
      rec.frames.push(useCurrentFrame());
      rec.absolute.push(useAbsoluteFrame());
      return null;
    }
    function Probe1(): null {
      rec.frames.push(useCurrentFrame() + 100);
      rec.absolute.push(useAbsoluteFrame());
      return null;
    }

    const capture = await captureReactBanner(banner);
    expect(capture.plan.totalFrames).toBe(20);
    expect(capture.meta.presetName).toBe("readme");
    expect(capture.meta.width).toBe(850);
    expect(capture.htmlFrames).toHaveLength(20);

    // v0.6: the prewarm sweep renders each scene's opening frame once BEFORE
    // the real frame loop (FitText discovery — outputs discarded), so the
    // recorders see [0, 100] first. The frame loop itself is unchanged.
    expect(rec.frames.slice(0, 2)).toEqual([0, 100]);
    expect(rec.absolute.slice(0, 2)).toEqual([0, 10]);

    // Scene-local frames restart at 0; absolute keeps counting.
    expect(rec.frames.slice(2, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rec.absolute.slice(2, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rec.frames.slice(12)).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(rec.absolute.slice(12)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("chunks identical consecutive frames (holds merge)", async () => {
    const Static = (): null => null;
    const banner = makeBanner(createElement(Scene, { duration: 12 }, createElement(Static)));
    const capture = await captureReactBanner(banner);
    expect(capture.chunks).toHaveLength(1);
    expect(capture.chunks[0].frames).toBe(12);
    expect(capture.chunks[0].startFrame).toBe(0);
  });

  it("chunkFrames merges runs of byte-identical html", () => {
    const chunks = chunkFrames(["a", "a", "a", "b", "b", "a"]);
    expect(chunks.map((c) => [c.html, c.frames, c.startFrame])).toEqual([
      ["a", 3, 0],
      ["b", 2, 3],
      ["a", 1, 5],
    ]);
  });

  it("Math.random is shimmed: warned once, output stays deterministic", async () => {
    const Widget = (): ReturnType<typeof createElement> => {
      const noise = Math.random();
      return createElement("div", {}, `n${noise.toFixed(6)}`);
    };
    const banner = makeBanner(createElement(Scene, { duration: 3 }, createElement(Widget)));

    const capture1 = await captureReactBanner(banner);
    expect(capture1.warnings.join(" ")).toContain("Math.random");
    const capture2 = await captureReactBanner(banner);
    expect(capture1.htmlFrames).toEqual(capture2.htmlFrames);
  });

  it("useFrameState replays a reducer deterministically up to the current frame", async () => {
    const seen: number[] = [];
    const Carousel = (): null => {
      const active = useFrameState(
        (state, action: { type: "next" }) => (action.type === "next" ? state + 1 : state),
        0,
        (f) => (f.frame > 0 && f.frame % 5 === 0 ? { type: "next" as const } : null),
      );
      seen.push(active);
      return null;
    };
    const banner = makeBanner(createElement(Scene, { duration: 13 }, createElement(Carousel)));
    await captureReactBanner(banner);
    // events fire ON frames 5 and 10; replay runs 0..current inclusive.
    // v0.6: one extra prewarm render (frame 0) precedes the loop.
    expect(seen[0]).toBe(0);
    expect(seen.slice(1)).toEqual([
      0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2,
    ]);
  });

  it("useSpring hook matches springFor at the current frame", async () => {
    const vals: number[] = [];
    const Springy = (): null => {
      vals.push(useSpring({ from: -10, to: 10, stiffness: 150, damping: 14 }));
      return null;
    };
    const banner = makeBanner(createElement(Scene, { duration: 5 }, createElement(Springy)));
    await captureReactBanner(banner);
    // v0.6: the prewarm render prepends one duplicate frame-0 sample.
    const real = vals.slice(-5);
    for (let f = 0; f < 5; f++) {
      expect(real[f]).toBeCloseTo(springFor(f, FPS, { from: -10, to: 10, stiffness: 150, damping: 14 }), 10);
    }
  });

  it("useRandom is deterministic across captures", async () => {
    const out1: number[] = [];
    const out2: number[] = [];
    const make = (sink: number[]) =>
      defineBanner(function R() {
        return createElement(
          Banner,
          { preset: "readme" },
          createElement(
            Scene,
            { duration: 3 },
            createElement((): null => {
              sink.push(useRandom("seed", 1));
              return null;
            }),
          ),
        );
      });
    await captureReactBanner(make(out1));
    await captureReactBanner(make(out2));
    expect(out1).toEqual(out2);
  });

  it("throws a helpful error when no <Banner> is present", async () => {
    const NotABanner = (): null => null;
    await expect(captureReactBanner(NotABanner)).rejects.toThrow(/no <Banner> found/i);
  });

  it("rejects non-scene children with a targeted message", async () => {
    const banner = defineBanner(function Bad() {
      return createElement(
        Banner,
        { preset: "readme" },
        createElement("div", { key: "x" }, "hello"),
      );
    });
    // v0.5: <Series> joined the vocabulary — the message now lists it too.
    await expect(captureReactBanner(banner)).rejects.toThrow(/must be <Scene>, <Layer> or <Series>/);
  });

  it("overlap frames render BOTH scene subtrees (composite)", async () => {
    const A = (): ReturnType<typeof createElement> =>
      createElement("div", { style: { color: "#ff0000" } }, "alpha-content");
    const B = (): ReturnType<typeof createElement> =>
      createElement("div", { style: { color: "#00ff00" } }, "beta-content");

    const banner = defineBanner(function Two() {
      return createElement(
        Banner,
        { preset: "readme" },
        createElement(Scene, { duration: 10, exit: "crossfade" as const }, createElement(A)),
        createElement(Scene, { duration: 10, enter: "crossfade" as const }, createElement(B)),
      );
    });
    const capture = await captureReactBanner(banner);
    expect(capture.plan.scenes[1].enterFrames).toBe(5);
    // overlap frames 5..9 → both contents present
    expect(capture.htmlFrames[5]).toContain("alpha-content");
    expect(capture.htmlFrames[5]).toContain("beta-content");
    // after the overlap, only scene B
    expect(capture.htmlFrames[10]).not.toContain("alpha-content");
    expect(capture.htmlFrames[10]).toContain("beta-content");
    // leaving scene gets exit opacity < 1, arriving gets enter opacity < 1
    expect(capture.htmlFrames[5]).toMatch(/opacity:0\.\d+/);
  });

  it("persistent layers render on every frame with absolute frames", async () => {
    const seen: number[] = [];
    const Persistent = (): null => {
      seen.push(useAbsoluteFrame());
      return createElement("div", {}, "persist");
    };
    const banner = defineBanner(function WithLayer() {
      return createElement(
        Banner,
        { preset: "readme" },
        createElement(Layer, { top: true }, createElement(Persistent)),
        createElement(Scene, { duration: 8 }, createElement("div", {}, "s")),
        createElement(Scene, { duration: 8 }, createElement("div", {}, "s2")),
      );
    });
    const capture = await captureReactBanner(banner);
    expect(capture.plan.totalFrames).toBe(16);
    // v0.6: the prewarm sweep renders each scene's opening frame first
    // (absolute 0 and 8) before the real loop walks 0..15.
    expect(seen.slice(0, 2)).toEqual([0, 8]);
    expect(seen.slice(2)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(capture.htmlFrames[0]).toContain("persist");
    expect(capture.htmlFrames[15]).toContain("persist");
  });

  it("captures the declared fonts in meta", async () => {
    const banner = makeBanner(createElement(Scene, { duration: 3 }, createElement("div", {}, "x")), {
      fonts: [{ name: "Sora", weight: 600 }],
    });
    const capture = await captureReactBanner(banner);
    expect(capture.meta.fonts).toEqual([{ name: "Sora", weight: 600 }]);
    expect(capture.meta.fontFamily).toContain("Sora");
  });
});

describe("defineBanner", () => {
  it("marks components and detects them", () => {
    const fn = (): null => null;
    expect(isDefinedBanner(fn)).toBe(false);
    defineBanner(fn);
    expect(isDefinedBanner(fn)).toBe(true);
  });
});

// keep the recorder type referenced
void recordedFrames;
