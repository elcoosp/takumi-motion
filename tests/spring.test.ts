// Golden tests: the takumi-motion spring port vs REAL motion@14.6.0 fixtures
// extracted by scripts/extract-fixtures.mjs.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { springGenerator, calcGeneratorDuration } from "../src/spring.js";

const fixtures = JSON.parse(
  readFileSync(fileURLToPath(new URL("../scripts/fixtures.json", import.meta.url)), "utf8")
);

const TOL = 1e-6;

function mapOpts(opts: Record<string, unknown>) {
  // Fixture options came from the raw generator layer: duration in ms.
  // visualDuration stays seconds.
  return opts;
}

describe("spring port vs real motion fixtures", () => {
  for (const [name, fx] of Object.entries(fixtures.spring as Record<string, any>)) {
    it(`matches motion generator: spring/${name}`, () => {
      const gen = springGenerator({
        keyframes: fx.options.keyframes,
        ...mapOpts(fx.options),
      });

      let maxErr = 0;
      for (const s of fx.samples) {
        const got = gen.next(s.t);
        maxErr = Math.max(maxErr, Math.abs(got.value - s.v));
        expect(Math.abs(got.value - s.v)).toBeLessThan(TOL);
        expect(got.done).toBe(s.done);
      }
      expect(maxErr).toBeLessThan(TOL);
    });

    it(`velocity matches: spring/${name}`, () => {
      const gen = springGenerator({ keyframes: fx.options.keyframes, ...mapOpts(fx.options) });
      for (const s of fx.samples) {
        expect(Math.abs(gen.velocity(s.t) - s.vel)).toBeLessThan(TOL * 10);
      }
    });

    it(`settle duration matches (50ms scan): spring/${name}`, () => {
      const gen = springGenerator({ keyframes: fx.options.keyframes, ...mapOpts(fx.options) });
      const settle = calcGeneratorDuration(gen);
      // fixtures encode "never settles within 20s" as null; the port returns Infinity
      const normalized = fx.settle === null ? Infinity : fx.settle;
      expect(settle).toBe(normalized);
    });
  }
});
