// v1.0 — the engine time boundary
import { describe, expect, it } from "vitest";
import { toEngineMs } from "../src/engine-time.js";

describe("toEngineMs", () => {
  it("rounds fractional frame times to whole milliseconds", () => {
    // 1000/30 = 33.333… — the engine (napi i64) rejects fractions.
    expect(toEngineMs((1 * 1000) / 30)).toBe(33);
    expect(toEngineMs((2 * 1000) / 30)).toBe(67);
    expect(toEngineMs((11 * 1000) / 30)).toBe(367);
    expect(toEngineMs(336.66666)).toBe(337);
  });

  it("passes whole milliseconds through unchanged", () => {
    expect(toEngineMs(0)).toBe(0);
    expect(toEngineMs(50)).toBe(50);
    expect(toEngineMs(12345)).toBe(12345);
  });

  it("clamps negatives and non-finite values to 0 (first frame)", () => {
    expect(toEngineMs(-3)).toBe(0);
    expect(toEngineMs(-0.4)).toBe(0);
    expect(toEngineMs(Number.NaN)).toBe(0);
    expect(toEngineMs(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("never returns -0", () => {
    expect(Object.is(toEngineMs(-0.2), 0)).toBe(true);
  });
});
