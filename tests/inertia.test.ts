// Inertia port test vs real motion fixture.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inertiaGenerator } from "../src/inertia.js";
import { calcGeneratorDuration } from "../src/spring.js";

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scripts/fixtures.json", import.meta.url)), "utf8")
);

describe("inertia port vs real motion fixture", () => {
  it("matches motion decay-with-boundary-bounce", () => {
    const fx = fixtures.inertia.decayWithBounce;
    const gen = inertiaGenerator({
      keyframes: fx.options.keyframes,
      velocity: fx.options.velocity,
      power: fx.options.power,
      timeConstant: fx.options.timeConstant,
      bounceStiffness: fx.options.bounceStiffness,
      bounceDamping: fx.options.bounceDamping,
      min: fx.options.min,
      max: fx.options.max,
      restDelta: fx.options.restDelta,
    });

    let maxErr = 0;
    for (const s of fx.samples) {
      const got = gen.next(s.t);
      maxErr = Math.max(maxErr, Math.abs(got.value - s.v));
      expect(Math.abs(got.value - s.v)).toBeLessThan(1e-6);
      expect(got.done).toBe(s.done);
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("decays without boundaries when min/max absent", () => {
    const gen = inertiaGenerator({ keyframes: [0], velocity: 1000, timeConstant: 325 });
    // friction target = origin + power*velocity = 800
    const late = gen.next(5000).value;
    expect(late).toBeCloseTo(800, 1);
    expect(gen.next(6000).done).toBe(true);
  });
});
