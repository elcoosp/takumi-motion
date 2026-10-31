// tests/v08.test.ts — the Choreography Release, pure-math side:
// motion paths (arc-length tables), cue expressions, the chain grammar
// (windows, holds, velocity handoff), cascade exits, scaleTimeline (tempo),
// and the organic pack's determinism + Nyquist threshold.

import { describe, expect, it } from "vitest";

import {
  pathPointAt,
  pathLength,
  parsePathSegments,
} from "../src/react/path.js";
import {
  parseCue,
  resolveCue,
} from "../src/react/cue.js";
import {
  chain,
  hold,
  isHoldSegment,
  resolveChainAtFrame,
  chainSettleIssue,
  chainVelocityIssues,
} from "../src/react/chain.js";
import {
  cascadeExit,
  defineTransition,
  FadeInDown,
  FadeOutRight,
  ZoomIn,
  ZoomOut,
} from "../src/react/enter-exit.js";
import { wiggleFor, isNoiseAliased } from "../src/react/motion.js";
import { scaleTimeline } from "../src/timeline-transforms.js";
import type { TimelineJSON } from "../src/types.js";

const FPS = 20;
const ctx = (totalFrames: number) => ({ fps: FPS, totalFrames });

/** A LINEAR slide-in — the velocity-carry producer with a real end-slope. */
const SlideLinear = defineTransition({
  name: "SlideLinear",
  side: "enter",
  channels: { x: [-120, 0] },
  durationFrames: 10,
  easing: "linear",
});

// ---------------------------------------------------------------------------
// Bet B — motion paths
// ---------------------------------------------------------------------------

describe("pathPointAt / pathLength", () => {
  it("linear path: constant speed, exact endpoints, horizontal tangent", () => {
    const d = "M 0 0 L 100 0";
    expect(pathLength(d)).toBeCloseTo(100, 6);
    const start = pathPointAt(d, 0);
    const mid = pathPointAt(d, 0.5);
    const end = pathPointAt(d, 1);
    expect(start).toMatchObject({ x: 0, y: 0 });
    expect(mid.x).toBeCloseTo(50, 6);
    expect(end).toMatchObject({ x: 100, y: 0 });
    expect(start.angle).toBeCloseTo(0, 4);
  });

  it("arc-length parameterization: equal t-steps travel equal distances (L-shaped path)", () => {
    // Two 100px legs — offset-distance % would dash through the first leg.
    const d = "M 0 0 L 100 0 L 100 100";
    const a = pathPointAt(d, 0.25);
    const b = pathPointAt(d, 0.75);
    // t=0.25 → 50px along → mid first leg. t=0.75 → 150px → mid second leg.
    expect(a.x).toBeCloseTo(50, 6);
    expect(a.y).toBeCloseTo(0, 6);
    expect(b.x).toBeCloseTo(100, 6);
    expect(b.y).toBeCloseTo(50, 6);
  });

  it("cubic beziers flatten smoothly (points land on the path)", () => {
    const d = "M 0 0 C 0 100 100 100 100 0"; // arch
    expect(pathLength(d)).toBeGreaterThan(150); // arch is longer than the chord
    const mid = pathPointAt(d, 0.5);
    expect(mid.y).toBeGreaterThan(50); // arch peaks between the endpoints
  });

  it("relative commands, H/V, Z close, S/T reflections all parse", () => {
    expect(() => parsePathSegments("m 10 10 l 20 0 h 10 v 5 z")).not.toThrow();
    expect(() => parsePathSegments("M 0 0 C 10 0 20 10 30 10 S 50 30 60 30 T 90 30")).not.toThrow();
  });

  it("multiple subpaths and arcs throw with helpful messages", () => {
    expect(() => parsePathSegments("M 0 0 L 10 0 M 20 0 L 30 0")).toThrow(/one continuous/);
    expect(() => parsePathSegments("M 0 0 A 10 10 0 0 1 20 0")).toThrow(/arc/i);
  });

  it("t clamps outside [0, 1]", () => {
    const d = "M 0 0 L 100 0";
    expect(pathPointAt(d, -1).x).toBe(0);
    expect(pathPointAt(d, 2).x).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Bet A — cue expressions + labels
// ---------------------------------------------------------------------------

describe("parseCue / resolveCue", () => {
  const labels = { intro: 0, demo: 60, outro: 140 };

  it("parses the grammar", () => {
    expect(parseCue("intro")).toEqual({ label: "intro", offsetFrames: 0 });
    expect(parseCue("intro+12f")).toEqual({ label: "intro", offsetFrames: 12 });
    expect(parseCue("demo - 8f")).toEqual({ label: "demo", offsetFrames: -8 });
    expect(parseCue("  end-10f ")).toEqual({ label: "end", offsetFrames: -10 });
  });

  it("resolves labels to scene starts and 'end' to the last frame", () => {
    expect(resolveCue("demo+2f", labels, 200)).toBe(62);
    expect(resolveCue("end", labels, 200)).toBe(199);
    expect(resolveCue("end-10f", labels, 200)).toBe(189);
  });

  it("rejects malformed expressions and unknown labels (loudly)", () => {
    expect(() => parseCue("intro + 12")).toThrow(/cue expression/); // missing f
    expect(() => parseCue("12f")).toThrow(/cue expression/);
    expect(() => resolveCue("intor", labels, 200)).toThrow(/known labels: intro, demo, outro/);
  });
});

// ---------------------------------------------------------------------------
// Bet A — the chain grammar
// ---------------------------------------------------------------------------

describe("chain()", () => {
  it("validates construction", () => {
    expect(() => chain()).toThrow(/at least one/);
    expect(() => chain(hold(5))).toThrow(/at least one motion/);
    expect(() => chain(FadeInDown.duration(10), FadeOutRight.duration(10) as never)).toThrow(/mixed sides/);
    expect(() => hold(0)).toThrow(/positive integer/);
  });

  it("isHoldSegment discriminates", () => {
    const c = chain(hold(3), FadeInDown.duration(4));
    expect(isHoldSegment(c.segments[0])).toBe(true);
    expect(isHoldSegment(c.segments[1])).toBe(false);
  });

  it("windows: segments play back-to-back, holds freeze the previous end state", () => {
    const c = chain(FadeInDown.duration(10), hold(6), ZoomIn.duration(10));
    // 10 + 6 + 10 = 26
    expect(chainSettleIssue(c, ctx(30))).toBeNull();

    // Frame 0: first segment's start state (hidden, offset).
    const at0 = resolveChainAtFrame(c, 0, ctx(30));
    expect(at0?.opacity).toBe(0);

    // Frame 9: first segment's near-end (opacity near 1, y near 0).
    const at9 = resolveChainAtFrame(c, 9, ctx(30));
    expect(Number(at9?.opacity)).toBeGreaterThan(0.9);

    // Frames 10..15: the hold — FadeInDown's END state, constant across the
    // hold so chunk-merge still works.
    const at10 = resolveChainAtFrame(c, 10, ctx(30));
    const at15 = resolveChainAtFrame(c, 15, ctx(30));
    expect(at10?.opacity).toBe(1);
    expect(at15).toEqual(at10);

    // Frame 16: ZoomIn's start (scale 0.6).
    const at16 = resolveChainAtFrame(c, 16, ctx(30));
    expect(at16?.transform).toContain("scale(0.6)");

    // Frame 26+: settled → null (style-stable).
    expect(resolveChainAtFrame(c, 26, ctx(30))).toBeNull();
  });

  it("opacity continuity seeds from opacity-less segments (no mid-chain blink)", () => {
    // Regression (v0.8.1 demo reel): SlideLinear declares no opacity channel —
    // the ZoomIn that follows used to replay opacity [0,1] and blink the
    // element fully invisible at the handoff (frame 20 of the reel).
    const c = chain(SlideLinear.duration(10), hold(4), ZoomIn.duration(10));
    const atHandoff = resolveChainAtFrame(c, 14, ctx(30)); // ZoomIn's first frame
    expect(atHandoff?.opacity).toBe(1); // NOT 0 — already visible, stays visible
    expect(atHandoff?.transform).toContain("scale(0.6)"); // its own channel runs
    const mid = resolveChainAtFrame(c, 18, ctx(30));
    expect(mid?.opacity).toBe(1);
    const last = resolveChainAtFrame(c, 23, ctx(30));
    expect(last?.opacity).toBe(1);

    // First-segment fades still fade — continuity never patches segment 1.
    const fading = chain(FadeInDown.duration(10), ZoomIn.duration(10));
    expect(resolveChainAtFrame(fading, 0, ctx(30))?.opacity).toBe(0);
    const second = resolveChainAtFrame(fading, 10, ctx(30));
    expect(second?.opacity).toBe(1); // FadeInDown's end carries into ZoomIn
    expect(second?.transform).toContain("scale(0.6)");
  });

  it("carry segments keep the opacity patch (carry rebuild must not revert it)", () => {
    // Regression (v0.8.1 demo reel, second half): the carry path rebuilt the
    // segment from the RAW descriptor, discarding the patched opacity —
    // chain(Slide, …, ZoomIn.springify().carryVelocity()) blinked invisible
    // exactly when velocity continuity was active.
    const PHYS = { stiffness: 170, damping: 11 };
    const c = chain(SlideLinear, hold(4), ZoomIn.springify(PHYS).carryVelocity());
    const atHandoff = resolveChainAtFrame(c, 14, ctx(40)); // ZoomIn's first frame (10 + 4 hold)
    expect(atHandoff?.opacity).toBe(1); // NOT 0
    expect(atHandoff?.transform).toContain("scale(0.6)");
    // The carry still kicks: the carried spring outruns the from-rest spring.
    const rest = chain(SlideLinear, hold(4), ZoomIn.springify(PHYS));
    expect(resolveChainAtFrame(c, 20, ctx(40))).not.toEqual(resolveChainAtFrame(rest, 20, ctx(40)));
  });

  it("enter chains that overflow the scene window diagnose TM_TRANSITION_UNSETTLED", () => {
    const c = chain(FadeInDown.duration(20), hold(15), ZoomIn.duration(20));
    const issue = chainSettleIssue(c, ctx(30));
    expect(issue).toMatch(/spans 55f but the scene window is 30f/);
  });

  it("exit chains anchor their END to the scene close", () => {
    const c = chain(FadeOutRight.duration(10), hold(4), ZoomOut.springify("snappy"));
    const total = 60;
    // Before the exit chain starts: null (authored style stands).
    expect(resolveChainAtFrame(c, 0, ctx(total))).toBeNull();
    // At the close: inside the last window, mid-exit.
    const tail = resolveChainAtFrame(c, total - 1, ctx(total));
    expect(tail).not.toBeNull();
    // It fits a 60f window.
    expect(chainSettleIssue(c, ctx(total))).toBeNull();
  });

  it("carryVelocity injects the previous segment's terminal velocity into a physics spring", () => {
    // Physics-defined receivers (stiffness/damping) honor velocity — the
    // solver ignores it for time-defined springs (motion semantics).
    const PHYS = { stiffness: 170, damping: 11 };
    const withCarry = chain(SlideLinear, ZoomIn.springify(PHYS).carryVelocity());
    const without = chain(SlideLinear, ZoomIn.springify(PHYS));
    expect(chainVelocityIssues(withCarry)).toEqual([]);

    // Two frames after the handoff: the carried spring is AHEAD of the
    // from-rest spring (momentum kick).
    const carried = resolveChainAtFrame(withCarry, 11, ctx(40));
    const rest = resolveChainAtFrame(without, 11, ctx(40));
    expect(carried).not.toBeNull();
    expect(rest).not.toBeNull();
    expect(carried).not.toEqual(rest);
  });

  it("every unlandable carry is reported, not silent", () => {
    // A settled spring producer carries ≈0 velocity — physics, honestly reported.
    const settled = chain(FadeInDown.springify("snappy"), ZoomIn.springify({ stiffness: 170, damping: 11 }).carryVelocity());
    expect(chainVelocityIssues(settled)).toContainEqual(
      expect.stringMatching(/settled before the handoff/),
    );

    const springless = chain(SlideLinear, ZoomIn.duration(10).carryVelocity());
    expect(chainVelocityIssues(springless)).toContainEqual(
      expect.stringMatching(/not springified/),
    );

    // Time-defined receivers ignore velocity in the solver — the lint teaches the fix.
    const timed = chain(SlideLinear, ZoomIn.springify("snappy").carryVelocity());
    expect(chainVelocityIssues(timed)).toContainEqual(
      expect.stringMatching(/time-defined/),
    );

    const leading = chain(ZoomIn.springify({ stiffness: 170, damping: 11 }).carryVelocity());
    expect(chainVelocityIssues(leading)).toContainEqual(
      expect.stringMatching(/nothing precedes it/),
    );
  });
});

// ---------------------------------------------------------------------------
// Bet E — cascade exits + tempo
// ---------------------------------------------------------------------------

describe("cascadeExit / scaleTimeline", () => {
  it("unit 0 leaves first; every unit still lands at the scene close", () => {
    const first = cascadeExit(FadeOutRight, 0, 3, { intervalFrames: 2 });
    const last = cascadeExit(FadeOutRight, 2, 3, { intervalFrames: 2 });
    expect(first.delayFrames).toBe(4);
    expect(last.delayFrames).toBe(0);
    expect(() => cascadeExit(FadeOutRight, 3, 3)).toThrow(/index must be/);
  });

  it("scaleTimeline halves duration/delay at tempo 2 and is identity at 1", () => {
    const tl = {
      version: 1,
      durationMs: 2000,
      tracks: [
        {
          target: ".a",
          property: "opacity",
          keyframes: [0, 1],
          transition: { type: "tween", duration: 800, delay: 200 } as never,
        },
        {
          target: ".b",
          property: "x",
          keyframes: [0, 10],
          transition: { type: "spring", delay: 0 } as never,
        },
      ],
    } as TimelineJSON;

    expect(scaleTimeline(tl, 1)).toBe(tl);
    const scaled = scaleTimeline(tl, 2);
    expect(scaled.durationMs).toBe(1000);
    expect(scaled.tracks[0].transition).toMatchObject({ duration: 400, delay: 100 });
    expect(() => scaleTimeline(tl, 0)).toThrow(/tempo/);
  });
});

// ---------------------------------------------------------------------------
// Bet C — organic pack
// ---------------------------------------------------------------------------

describe("wiggleFor / isNoiseAliased", () => {
  it("is deterministic for (seed, frame) and scales with amplitude", () => {
    const a = wiggleFor("drift", 12, { amplitude: 6, frequency: 0.15 });
    const b = wiggleFor("drift", 12, { amplitude: 6, frequency: 0.15 });
    expect(a).toBe(b);
    expect(a).toBeLessThanOrEqual(6);
    expect(a).toBeGreaterThanOrEqual(-6);
    expect(wiggleFor("drift", 12, { amplitude: 3, frequency: 0.15 })).toBeCloseTo(a / 2, 8);
  });

  it("different seeds diverge", () => {
    expect(wiggleFor(1, 5)).not.toBe(wiggleFor(2, 5));
  });

  it("the Nyquist threshold sits at 0.5 lattice cells per frame", () => {
    expect(isNoiseAliased(0.15)).toBe(false);
    expect(isNoiseAliased(0.5)).toBe(false);
    expect(isNoiseAliased(0.51)).toBe(true);
  });
});
