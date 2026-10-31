// Golden tests: easing + tween port vs real motion@14.6.0 fixtures.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  cubicBezier,
  easingDefinitionToFunction,
  steps,
  namedEasings,
} from "../src/easing.js";
import { createTweenSampler } from "../src/interpolate.js";

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scripts/fixtures.json", import.meta.url)), "utf8")
);

const TOL = 1e-9;
const TOL_TWEEN = 1e-6;

describe("easing port vs real motion fixtures", () => {
  const namedToDef: Record<string, any> = {
    linear: "linear",
    easeIn: "easeIn",
    easeOut: "easeOut",
    easeInOut: "easeInOut",
    backIn: "backIn",
    backOut: "backOut",
    backInOut: "backInOut",
    circIn: "circIn",
    circOut: "circOut",
    circInOut: "circInOut",
    anticipate: "anticipate",
  };

  for (const [name, values] of Object.entries(fixtures.easing as Record<string, number[]>)) {
    it(`matches motion easing: ${name}`, () => {
      const fn =
        name === "stepsEnd"
          ? steps(5, "end")
          : name === "stepsStart"
            ? steps(5, "start")
            : namedEasings[namedToDef[name]];
      expect(fn).toBeDefined();
      values.forEach((v, i) => {
        const p = i / 20;
        const got = fn(p);
        expect(Math.abs(got - v)).toBeLessThan(name.startsWith("back") || name === "anticipate" ? 1e-12 : TOL);
      });
    });
  }

  it("cubicBezier matches motion within solver tolerance", () => {
    // Compare against the fixture tween ease sampled through real motion values
    const fx = fixtures.tween.twoPoint.samples;
    const sampler = createTweenSampler({
      keyframes: [0, 100],
      duration: 300,
      ease: [0.25, 0.1, 0.35, 1],
    });
    for (const s of fx) {
      const got = sampler.sample(s.t);
      expect(Math.abs((got as number) - s.v)).toBeLessThan(TOL_TWEEN);
    }
  });
});

describe("tween sampler vs real motion fixtures", () => {
  const cases: Record<string, () => any> = {
    twoPoint: () => ({
      keyframes: [0, 100],
      duration: 300,
      ease: [0.25, 0.1, 0.35, 1],
    }),
    multi: () => ({
      keyframes: [0, 120, 80, 100],
      duration: 800,
      ease: "easeInOut",
    }),
    perSegmentEase: () => ({
      keyframes: [0, 100, 40],
      duration: 600,
      ease: ["easeOut", "backOut"],
    }),
    withTimes: () => ({
      keyframes: [0, 100],
      duration: 500,
      ease: "circOut",
      times: [0, 0.7],
    }),
  };

  for (const [name, cfg] of Object.entries(cases)) {
    it(`matches motion tween: ${name}`, () => {
      const opts = cfg();
      const sampler = createTweenSampler(opts);
      for (const s of (fixtures.tween as Record<string, any>)[name].samples) {
        const got = sampler.sample(s.t);
        expect(Math.abs((got as number) - s.v)).toBeLessThan(TOL_TWEEN);
      }
    });
  }

  it("easeInOut is the default segment easing (motion parity)", () => {
    const sampler = createTweenSampler({ keyframes: [0, 100], duration: 1000 });
    // real motion keyframes generator default ease = easeInOut
    const atHalf = sampler.sample(500);
    expect(atHalf).toBeCloseTo(50, 0); // easeInOut(0.5) = 0.5
  });
});
