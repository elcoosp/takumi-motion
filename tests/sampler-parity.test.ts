// v1.0 — differential parity: the optimized tween sampler must be
// byte-identical to the frozen v0.9.1 implementation across the whole
// authoring surface (numbers, colors, complex strings, easings, times).
import { describe, expect, it } from "vitest";
import { createTweenSampler, mixColors, mixComplex, mixValues } from "../src/interpolate.js";
import {
  createTweenSampler as baseSampler,
  mixColors as baseMixColors,
  mixComplex as baseMixComplex,
  mixValues as baseMixValues,
} from "../bench/baseline/src/interpolate.js";

const GRID = [0, 1, 7, 33.5, 150, 299, 300, 301, 599, 600, 601, 1000, 1500];

const CASES: Array<Parameters<typeof createTweenSampler>[0]> = [
  { keyframes: [0, 100], duration: 300 },
  { keyframes: [0, 50, 100], duration: 600 },
  { keyframes: [0, 50, 20, 100], times: [0, 0.2, 0.5, 1], duration: 600 },
  { keyframes: [0, 50, 20, 100], times: [0, 0.2, 0.5, 1], duration: 600, ease: "backOut" },
  { keyframes: [0, 100], duration: 400, ease: [0.22, 1, 0.36, 1] },
  { keyframes: [0, 40, 100], duration: 900, ease: ["easeIn", "linear", "easeOut"] },
  { keyframes: [0, 40, 100], duration: 900, ease: [{ steps: 5, direction: "end" }, "circOut", "anticipate"] },
  { keyframes: ["#ff0000", "#0000ff"], duration: 300 },
  { keyframes: ["rgba(255,0,0,0.2)", "hsl(120, 50%, 50%)"], duration: 450 },
  { keyframes: ["translateX(0px) scale(1)", "translateX(120px) scale(1.5)"], duration: 500 },
  { keyframes: [0, null, 100], duration: 600 },
  { keyframes: [null, 64], duration: 300 },
  { keyframes: [42], duration: 300 },
  { keyframes: ["10deg", "-30deg", "90deg"], duration: 700 },
];

describe("tween sampler parity with v0.9.1 baseline", () => {
  for (const [ci, opts] of CASES.entries()) {
    it(`case ${ci}: ${JSON.stringify(opts.keyframes)} @${opts.duration}ms`, () => {
      const next = createTweenSampler(opts, 7);
      const base = baseSampler(opts, 7);
      for (const t of GRID) {
        expect(next.sample(t)).toEqual(base.sample(t));
      }
    });
  }

  it("mix* functions stay byte-identical", () => {
    const pairs: Array<[string, string]> = [
      ["#ff0000", "#00ff00"],
      ["rgba(10, 20, 30, 0.5)", "#102030"],
      ["hsl(200, 80%, 60%)", "hsla(10, 90%, 40%, 0.3)"],
      ["translateX(0px)", "translateX(64px)"],
      ["1 2 3", "4 5 6"],
      ["rgb(255 0 0)", "rgb(0 0 255)"],
    ];
    for (const [a, b] of pairs) {
      for (const v of [0, 0.001, 0.25, 0.5, 0.777, 0.999, 1]) {
        expect(mixColors(a, b, v)).toBe(baseMixColors(a, b, v));
        expect(mixComplex(a, b, v)).toBe(baseMixComplex(a, b, v));
        expect(mixValues(a, b, v)).toBe(baseMixValues(a, b, v));
      }
    }
  });
});
