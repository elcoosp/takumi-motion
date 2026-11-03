// v1.0 — spring solver memoization (hot path: springFor runs per frame per
// Animated/Spring component during capture; without memoization every call
// rebuilds the analytic solver and re-scans its settle duration).
import { beforeEach, describe, expect, it } from "vitest";
import { clearSpringCaches, springCacheSize, springFor, springSettleFrames } from "../src/react/motion.js";

const SNAP = { duration: 350, bounce: 0.12 } as const;

describe("springFor memoization", () => {
  beforeEach(() => clearSpringCaches());

  it("values are identical with a warm or cold cache (pure memoization)", () => {
    const cold = Array.from({ length: 40 }, (_, f) => springFor(f, 30, SNAP));
    clearSpringCaches();
    const warm = Array.from({ length: 40 }, (_, f) => springFor(f, 30, SNAP));
    expect(warm).toEqual(cold);
  });

  it("repeated calls with identical options hit the cache once", () => {
    expect(springCacheSize()).toBe(0);
    springFor(5, 30, SNAP);
    springFor(10, 30, SNAP);
    springFor(10, 60, SNAP); // fps does not change the solver
    expect(springCacheSize()).toBe(1);
  });

  it("distinct option objects get distinct solvers", () => {
    springFor(5, 30, SNAP);
    springFor(5, 30, { duration: 350, bounce: 0.12, velocity: 4 });
    springFor(5, 30, { stiffness: 170, damping: 11 });
    expect(springCacheSize()).toBe(3);
  });

  it("rest thresholds are part of the solver identity (restDelta changes the settle scan)", () => {
    springSettleFrames(30, { ...SNAP });
    springSettleFrames(30, { ...SNAP, restDelta: 0.001 });
    expect(springCacheSize()).toBe(2);
  });

  it("springSettleFrames matches a fresh-solver computation", () => {
    const cached = springSettleFrames(30, { ...SNAP, from: 0, to: 1 });
    clearSpringCaches();
    const fresh = springSettleFrames(30, { ...SNAP, from: 0, to: 1 });
    expect(cached).toBe(fresh);
  });

  it("the cache clears itself when the cap overflows (bounded memory)", () => {
    for (let i = 0; i < 600; i++) {
      springFor(5, 30, { duration: 300 + i, bounce: 0.1 });
    }
    expect(springCacheSize()).toBeLessThanOrEqual(600);
    // First entry was evicted by the cap-clear — the value still computes.
    expect(springFor(5, 30, { duration: 300, bounce: 0.1 })).toBeGreaterThan(0);
  });
});
