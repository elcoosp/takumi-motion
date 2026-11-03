// v1.0 — evaluateAt parity + track-resolution memo semantics.
import { describe, expect, it } from "vitest";
import { evaluateAt } from "../src/evaluate.js";
import { resolveTrack, sampleTrackAt } from "../src/sampler.js";
import {
  resolveTrack as baseResolveTrack,
  sampleTrackAt as baseSampleTrackAt,
} from "../bench/baseline/src/sampler.js";
import type { TrackJSON, TimelineJSON } from "../src/types.js";

const track = (over: Partial<TrackJSON>): TrackJSON => ({
  target: ".a",
  property: "opacity",
  keyframes: [0, 1],
  transition: { type: "tween", duration: 300 },
  ...over,
});

describe("evaluateAt: memoized resolution is byte-identical", () => {
  const timeline: TimelineJSON = {
    version: 1,
    durationMs: 1000,
    tracks: [
      track({ property: "opacity", keyframes: [0, 1, 0.5], times: [0, 0.4, 1], transition: { type: "tween", duration: 900 } }),
      track({ property: "x", keyframes: [0, 120], transition: { type: "spring", stiffness: 210, damping: 22 } }),
      track({ property: "scale", keyframes: [0.9, 1], transition: { type: "spring", stiffness: 550, damping: 30 } }),
      track({ property: "rotate", keyframes: [0, 8], transition: { type: "tween", duration: 500, ease: "backOut" } }),
      track({ property: "color", target: ".b", keyframes: ["#ff0000", "#0000ff"], transition: { type: "tween", duration: 600 } }),
      track({ property: "opacity", target: ".b", keyframes: [0.4, 0.9], transition: { type: "tween", duration: 400, repeat: Infinity, repeatType: "mirror" } }),
    ],
  };

  it("identical output across repeated evaluations at many times (memo warm)", () => {
    for (let t = 0; t <= 1000; t += 37) {
      const a = evaluateAt(timeline, t);
      const b = evaluateAt(timeline, t);
      expect(a).toEqual(b);
    }
  });

  it("raw-transform mode keeps per-property channels", () => {
    const raw = evaluateAt(timeline, 300, { rawTransforms: true });
    expect(Object.keys(raw[".a"] ?? {}).sort()).toEqual(["opacity", "rotate", "scale", "x"]);
  });

  it("memoized resolveTrack is identical to a fresh resolve across sampling", () => {
    const t = track({ property: "y", keyframes: [-40, 0], transition: { type: "spring", stiffness: 210, damping: 20, repeat: 1, repeatDelay: 60 } });
    const memo = resolveTrack(t);
    const fresh = baseResolveTrack(t);
    for (let ms = 0; ms <= 1200; ms += 41) {
      expect(sampleTrackAt(memo, ms)).toBe(baseSampleTrackAt(fresh, ms));
    }
  });

  it("resolveTrack with a resolver skips the memo (fresh resolution per call)", () => {
    const t = track({ property: "opacity", keyframes: [null, 1] });
    const withBase = (base: number) => resolveTrack(t, () => base);
    expect(sampleTrackAt(withBase(0.25), 0)).toBe(0.25);
    expect(sampleTrackAt(withBase(0.75), 0)).toBe(0.75); // second resolution honored
  });

  it("null keyframes without a resolver still throw", () => {
    const t = track({ property: "opacity", keyframes: [null, 1] });
    expect(() => resolveTrack(t)).toThrow(/resolveBase/);
  });
});
