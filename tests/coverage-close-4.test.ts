// v1.0 — coverage close-out, batch 4: sampler errors, spring option edges,
// inertia bounds, interpolate fallbacks, transform unit table, timeline,
// loop windows, motion branches.
import { describe, expect, it } from "vitest";
import { resolveTrack, sampleTrackAt, TrackError } from "../src/sampler.js";
import { springGenerator, springDefaults, maxGeneratorDuration, calcGeneratorDuration } from "../src/spring.js";
import { inertiaGenerator } from "../src/inertia.js";
import { createTweenSampler, mixColors, mixComplex } from "../src/interpolate.js";
import { valueToCss, buildTransform, buildTransformKeyframe, isTransformProp, transformPropOrder } from "../src/transform.js";
import { createTimeline, trackEndMs } from "../src/timeline.js";
import { fadeWrap } from "../src/loop.js";
import { evenWindow, loopPeriod, gridCeil } from "../src/templates/shared.js";

describe("sampler error paths", () => {
  it("spring tracks reject non-numeric and single keyframes", () => {
    expect(() => resolveTrack({
      target: ".a", property: "y",
      keyframes: [0, "40px" as never],
      transition: { type: "spring", stiffness: 200 },
    })).toThrow(TrackError);
    expect(() => resolveTrack({
      target: ".a", property: "y",
      keyframes: [7] as never,
      transition: { type: "spring", stiffness: 200 },
    })).toThrow(/\[from, to\]/);
  });

  it("inertia tracks reject non-numeric keyframes", () => {
    expect(() => resolveTrack({
      target: ".a", property: "y",
      keyframes: ["x" as never, 10],
      transition: { type: "inertia" },
    })).toThrow(TrackError);
  });

  it("time-defined springs honor visualDuration and velocity params", () => {
    const visual = resolveTrack({
      target: ".a", property: "y",
      keyframes: [0, 10],
      transition: { type: "spring", visualDuration: 0.4, bounce: 0.2 },
    });
    expect(visual.iterationMs).toBeGreaterThan(300);
    const carried = resolveTrack({
      target: ".a", property: "y",
      keyframes: [0, 10],
      transition: { type: "spring", stiffness: 210, damping: 18, velocity: 5 },
    });
    expect(sampleTrackAt(carried, 1)).toBeGreaterThan(0);
  });
});

describe("spring option edges", () => {
  it("invalid physics falls back to defaults (non-finite guard)", () => {
    const gen = springGenerator({ keyframes: [0, 1], stiffness: Number.NaN, damping: Number.NaN });
    expect(gen.next(0).value).toBeCloseTo(0);
    expect(springDefaults.stiffness).toBe(100);
  });

  it("maxGeneratorDuration + extreme scans terminate", () => {
    expect(maxGeneratorDuration).toBe(20_000);
    // a spring that never rests reports Infinity past the scan cap
    const gen = springGenerator({ keyframes: [0, 1], stiffness: 0.1, damping: 0.01 });
    const settle = calcGeneratorDuration(gen);
    expect(settle === Infinity || settle <= maxGeneratorDuration).toBe(true);
  });

  it("retarget recomputes coefficients (velocity carried)", () => {
    const gen = springGenerator({ keyframes: [0, 1], stiffness: 220, damping: 24 });
    gen.retarget([1, 2], 0.5);
    expect(gen.next(0).value).toBeCloseTo(1);
    expect(gen.next(4000).done).toBe(true);
  });
});

describe("inertia bounds", () => {
  it("min/max clamp the decay and the bounce springs", () => {
    const bounded = inertiaGenerator({ keyframes: [0, 50], velocity: 5, min: 0, max: 30 });
    for (let t = 0; t <= 4000; t += 250) {
      const v = bounded.next(t).value as number;
      expect(v).toBeLessThanOrEqual(30.0001);
    }
    const bouncing = inertiaGenerator({ keyframes: [0, 30], velocity: 3, min: 5, bounceStiffness: 300, bounceDamping: 30 });
    expect(Number.isFinite(bouncing.next(2000).value as number)).toBe(true);
  });
});

describe("interpolate fallback branches", () => {
  it("mixColors with unparseable colors picks by progress; mixComplex mismatch passes", () => {
    expect(mixColors("nope", "#ff0000", 0.25)).toBe("nope");
    expect(mixColors("#ff0000", "nope", 0.75)).toBe("nope");
    expect(mixComplex("1px 2px", "3px", 0.5)).toBe("3px"); // token mismatch → later
  });

  it("tween samplers clamp and hold across the covered range only", () => {
    const s = createTweenSampler({ keyframes: [0, 100], times: [0, 0.5], duration: 1000 });
    expect(s.sample(-10)).toBe(0);
    expect(s.sample(999)).toBeCloseTo(100); // beyond the last time → clamped
  });
});

describe("transform unit table", () => {
  it("valueToCss appends px/deg; buildTransform skips defaults and NaN", () => {
    expect(valueToCss("x", 12)).toBe("12px");
    expect(valueToCss("rotate", 30)).toBe("30deg");
    expect(valueToCss("opacity", 0.5)).toBe("0.5");
    expect(valueToCss("fontWeight", 700)).toBe("700");
    expect(buildTransform({ x: 0 })).toBe("none"); // default skipped
    expect(buildTransform({ x: Number.NaN })).toBe("none");
    expect(buildTransform({ x: 10, y: 20, rotate: 90 })).toBe("translateX(10px) translateY(20px) rotate(90deg)");
    const keyframe = buildTransformKeyframe(["x", "scale"], { x: 5, scale: 2 });
    expect(keyframe).toBe("translateX(5px) scale(2)");
    expect(keyframe.startsWith("none")).toBe(false);
    expect(isTransformProp("scaleX")).toBe(true);
    expect(isTransformProp("margin")).toBe(false);
    expect(transformPropOrder).toContain("skewY");
  });
});

describe("timeline gaps", () => {
  it("array targets, invalid 'at', array-selector errors and trackEndMs with repeats", () => {
    const tl = createTimeline({ fps: 20 });
    expect(() => tl.add(".a" as never, { opacity: [0, 1] }, { at: "nonsense" })).toThrow(/Invalid 'at'/);
    expect(() => tl.add([7 as never], { opacity: [0, 1] })).toThrow(/Array targets may only contain selectors/);
    expect(() => tl.add(".a", { opacity: 5 as never })).toThrow(/must be an array/);
    tl.add(".b", { y: [0, 10] }, { at: 0, times: [0, 1] });
    const track = tl.toJSON().tracks[0];
    expect(track.times).toEqual([0, 1]);
    expect(trackEndMs(track)).toBeGreaterThan(0);
  });

  it("getDefaultTransition picks springs for transforms and tweens otherwise", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add(".a", { scale: [0.5, 1] }); // spring 550
    tl.add(".b", { opacity: [0, 1] }); // tween with the signature ease
    const tracks = tl.toJSON().tracks;
    expect((tracks[0].transition as { type: string }).type).toBe("spring");
    expect((tracks[1].transition as { type: string }).type).toBe("tween");
    expect(tracks[1].transition.duration).toBe(300);
  });
});

describe("loop windows", () => {
  it("evenWindow snaps to even frame counts without overlapping neighbors", () => {
    const [start, end] = evenWindow(103, 340, 20, 90);
    expect(start).toBeGreaterThanOrEqual(100); // snapped DOWN to the grid
    expect((end - start) % 2).toBe(0); // even frame count
    const tighter = evenWindow(105.2, 339.9, 20, 99.9);
    expect(tighter[0]).toBeGreaterThan(99.9);
  });

  it("loopPeriod forces even frame counts; gridCeil rounds up", () => {
    expect(loopPeriod(417, 20)).toBeGreaterThan(417);
    expect(gridCeil(416.7, 20)).toBeCloseTo(450, 3);
  });

  it("fadeWrap validates period alignment + the duration floor", () => {
    const tl = { version: 1 as const, durationMs: 300, tracks: [] };
    expect(() => fadeWrap(tl, { selector: ".root", inMs: 150, outMs: 150 })).toThrow(/must exceed/);
    const wrapped = fadeWrap(tl, { selector: ".root", inMs: 50, outMs: 50, periodMs: 900, fps: 20 });
    expect(wrapped.durationMs).toBeCloseTo(900, 3);
  });
});
