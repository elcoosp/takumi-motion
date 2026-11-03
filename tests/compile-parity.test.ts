// v1.0 — compileTimeline parity: the optimized bake (structural step dedupe,
// shared frame grid, precomputed per-group boundaries) must emit byte-identical
// CSS against the frozen v0.9.1 compiler across the authoring surface.
import { describe, expect, it } from "vitest";
import { compileTimeline } from "../src/compile.js";
import { compileTimeline as baseCompile } from "../bench/baseline/src/compile.js";
import type { TimelineJSON, TrackJSON } from "../src/types.js";

const track = (over: Partial<TrackJSON>): TrackJSON => ({
  target: ".hero",
  property: "opacity",
  keyframes: [0, 1],
  transition: { type: "tween", duration: 300 },
  ...over,
});

const timelines: Array<{ name: string; timeline: TimelineJSON; fps: number }> = [
  {
    name: "simple tween",
    fps: 30,
    timeline: { version: 1, durationMs: 1000, tracks: [track({ property: "opacity", keyframes: [0, 1] })] },
  },
  {
    name: "spring with repeat + delay",
    fps: 20,
    timeline: {
      version: 1,
      durationMs: 1500,
      tracks: [
        track({
          property: "y",
          keyframes: [-40, 0],
          transition: { type: "spring", stiffness: 210, damping: 20, delay: 120, repeat: 2, repeatDelay: 80 },
        }),
        track({ property: "opacity", keyframes: [0, 1], transition: { type: "tween", duration: 400 } }),
      ],
    },
  },
  {
    name: "transform group merge",
    fps: 30,
    timeline: {
      version: 1,
      durationMs: 900,
      tracks: [
        track({ property: "x", keyframes: [0, 120], transition: { type: "tween", duration: 450, ease: "easeOut" } }),
        track({ property: "scale", keyframes: [0.8, 1], transition: { type: "tween", duration: 450, ease: "backOut" } }),
        track({ property: "rotate", keyframes: [0, 8], transition: { type: "tween", duration: 450 } }),
        track({ property: "color", keyframes: ["#ff0000", "#00ff00"], transition: { type: "tween", duration: 500 } }),
      ],
    },
  },
  {
    name: "mirror infinite ambient",
    fps: 25,
    timeline: {
      version: 1,
      durationMs: 2000,
      tracks: [
        track({
          property: "opacity",
          target: ".glow",
          keyframes: [0.4, 0.8],
          transition: { type: "tween", duration: 400, repeat: Infinity, repeatType: "mirror" },
        }),
      ],
    },
  },
  {
    name: "multi-stop keyframes with times",
    fps: 30,
    timeline: {
      version: 1,
      durationMs: 1200,
      tracks: [
        track({
          property: "opacity",
          keyframes: [0, 1, 1, 0],
          times: [0, 0.2, 0.7, 1],
          transition: { type: "tween", duration: 1200, ease: ["easeOut", "linear", "easeIn"] },
        }),
        track({ property: "width", keyframes: [0, 850], transition: { type: "tween", duration: 900, delay: 60 } }),
      ],
    },
  },
  {
    name: "steps easing + complex strings",
    fps: 30,
    timeline: {
      version: 1,
      durationMs: 800,
      tracks: [
        track({
          property: "letterSpacing",
          keyframes: [0, 8],
          transition: { type: "tween", duration: 500, ease: { steps: 6, direction: "end" } },
        }),
      ],
    },
  },
];

describe("compileTimeline parity with v0.9.1 baseline", () => {
  for (const { name, timeline, fps } of timelines) {
    it(name, () => {
      const next = compileTimeline(timeline, { fps });
      const base = baseCompile(timeline, { fps });
      expect(next.durationMs).toBe(base.durationMs);
      expect(next.fps).toBe(base.fps);
      expect(next.animations).toEqual(base.animations);
      expect(next.css).toEqual(base.css);
    });
  }

  it("with a resolveBase resolver (null keyframes)", () => {
    const resolveBase = (target: string, prop: string) => (prop === "opacity" ? 0.5 : 0);
    const timeline: TimelineJSON = {
      version: 1,
      durationMs: 600,
      tracks: [track({ property: "opacity", keyframes: [null, 1], transition: { type: "tween", duration: 400 } })],
    };
    const next = compileTimeline(timeline, { fps: 30, resolveBase });
    const base = baseCompile(timeline, { fps: 30, resolveBase });
    expect(next.css).toEqual(base.css);
    expect(next.durationMs).toBe(base.durationMs);
  });

  it("lint: false skips the authoring lint on both", () => {
    const timeline = timelines[1]!.timeline;
    expect(compileTimeline(timeline, { fps: 20, lint: false }).lint).toEqual([]);
    expect(baseCompile(timeline, { fps: 20, lint: false }).lint).toEqual([]);
  });
});
