// takumi-motion — easing.ts
// Verbatim-faithful port of Motion v14.6.0 easing math
// (packages/motion-utils/src/easing/*). Zero dependencies.

import type { BezierDefinition, Easing as EasingDefinition, EasingName, StepsDefinition } from "./types.js";

// The Easing TYPE re-declared alongside the Easing VALUE namespace (same-name
// type + value exports from one module — the Reanimated shape). Users write
// `import { Easing } from "takumi-motion"` for the factories and
// `import type { Easing }` for the definition union — both resolve.
export type Easing = EasingDefinition;

// Returns x(t) given t, x1, and x2 — or y(t) given t, y1, and y2 (Bernstein form).
const calcBezier = (t: number, a1: number, a2: number) =>
  t * (3 * (1 - t) * ((1 - t) * a1 + t * a2) + t * t);

/**
 * Cubic bezier easing — ported from motion-utils cubic-bezier.ts.
 * Newton-Raphson safeguarded by bisection; ε² < 1e-28, ≤ 40 iterations.
 */
export function cubicBezier(mX1: number, mY1: number, mX2: number, mY2: number): (x: number) => number {
  // Linear gradient → linear easing
  if (mX1 === mY1 && mX2 === mY2) return (x: number) => x;

  return (x: number) => {
    let lowerBound = 0;
    let upperBound = 1;
    let t = x;

    for (let i = 0; ; i++) {
      if (!(t >= lowerBound && t <= upperBound)) {
        t = (lowerBound + upperBound) / 2;
      }

      const currentX = calcBezier(t, mX1, mX2) - x;
      if (currentX * currentX < 1e-28 || i === 40) break;
      currentX > 0 ? (upperBound = t) : (lowerBound = t);

      // Newton-Raphson step, with dx/dt from a forward difference
      t -= (currentX * 1e-7) / (calcBezier(t + 1e-7, mX1, mX2) - x - currentX);
    }

    return calcBezier(t, mY1, mY2);
  };
}

const reverseEasing = (easing: (p: number) => number) => (p: number) => 1 - easing(1 - p);

const mirrorEasing = (easing: (p: number) => number) => (p: number) =>
  p <= 0.5 ? easing(p * 2) / 2 : (2 - easing((1 - p) * 2)) / 2;

const easeIn = cubicBezier(0.42, 0, 1, 1);
const easeOut = cubicBezier(0, 0, 0.58, 1);
const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

const backOut = cubicBezier(0.33, 1.53, 0.69, 0.99);
const backIn = reverseEasing(backOut);
const backInOut = mirrorEasing(backIn);

// circIn: p => 1 - sin(acos(p))
const circIn = (p: number) => 1 - Math.sin(Math.acos(p));
const circOut = reverseEasing(circIn);
const circInOut = mirrorEasing(circIn);

const anticipate = (p: number) =>
  p >= 1 ? 1 : (p *= 2) < 1 ? 0.5 * backIn(p) : 0.5 * (2 - Math.pow(2, -10 * (p - 1)));

// bounceOut — the standard quartic-bounce envelope (Reanimated Easing.bounce
// formula, deterministic closed form; no transcendental surprises).
const bounceOut = (p: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (p < 1 / d1) return n1 * p * p;
  if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
  if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
  return n1 * (p -= 2.625 / d1) * p + 0.984375;
};
const bounceIn = (p: number) => 1 - bounceOut(1 - p);
const bounceInOut = (p: number) =>
  p < 0.5 ? bounceIn(p * 2) * 0.5 : bounceOut(p * 2 - 1) * 0.5 + 0.5;

// poly(n) — Reanimated Easing.poly: power curve.
const poly = (n: number): ((p: number) => number) => (p) => Math.pow(p, n);

// elastic(bounciness) — Reanimated Easing.elastic: decaying sinusoid.
// bounciness 0 → critically damped (plain easeOut shape).
const elastic = (bounciness = 1): ((p: number) => number) => {
  const p = bounciness * Math.PI;
  return (t) => (t === 0 || t === 1 ? t : 1 - Math.pow(Math.cos((t * Math.PI) / 2), 3) * Math.cos(t * p));
};

const linear = (p: number): number => p;

const easingLookup: Record<EasingName, (p: number) => number> = {
  linear,
  easeIn,
  easeInOut,
  easeOut,
  circIn,
  circInOut,
  circOut,
  backIn,
  backInOut,
  backOut,
  bounceIn,
  bounceInOut,
  bounceOut,
  anticipate,
};

/** Stepped easing — ported from motion-utils steps.ts. */
export function steps(numSteps: number, direction: "start" | "end" = "end"): (p: number) => number {
  return (progress: number) => {
    progress =
      direction === "end" ? Math.min(progress, 0.999) : Math.max(progress, 0.001);
    const expanded = progress * numSteps;
    const rounded = direction === "end" ? Math.floor(expanded) : Math.ceil(expanded);
    return Math.min(1, Math.max(0, rounded / numSteps));
  };
}

const isBezierDefinition = (easing: unknown): easing is BezierDefinition =>
  Array.isArray(easing) && easing.length === 4 && easing.every((n) => typeof n === "number");

const isStepsDefinition = (easing: unknown): easing is StepsDefinition =>
  typeof easing === "object" && easing !== null && "steps" in (easing as object);

/** Resolve an easing definition to a function — mirrors motion-utils easingDefinitionToFunction. */
export function easingDefinitionToFunction(definition: EasingDefinition): (p: number) => number {
  if (typeof definition === "function") return definition;
  if (isStepsDefinition(definition)) return steps(definition.steps, definition.direction);
  if (isBezierDefinition(definition)) return cubicBezier(definition[0], definition[1], definition[2], definition[3]);
  const fn = easingLookup[definition as EasingName];
  if (!fn) throw new Error(`Invalid easing type '${definition}'`);
  return fn;
}

/** Per-segment ease selection: array easings wrap, mirroring motion's getEasingForSegment. */
export function getEasingForSegment(easing: EasingDefinition | EasingDefinition[], index: number): (p: number) => number {
  if (!Array.isArray(easing) || typeof easing[0] === "number") {
    return easingDefinitionToFunction(easing as EasingDefinition);
  }
  const arr = easing as Easing[];
  const i = ((index % arr.length) + arr.length) % arr.length;
  return easingDefinitionToFunction(arr[i]);
}

/**
 * CSS representation for easings that CSS timing functions can express natively.
 * Function easings (circ*, back*, anticipate, custom fns) return null → the
 * compiler bakes them into sub-keyframes instead.
 */
export function easingToCssTiming(easing: EasingDefinition): string | null {
  if (typeof easing === "function") return null;
  if (isStepsDefinition(easing)) return `steps(${easing.steps}, ${easing.direction})`;
  if (isBezierDefinition(easing)) return `cubic-bezier(${easing.join(", ")})`;
  switch (easing) {
    case "linear": return "linear";
    case "easeIn": return "cubic-bezier(0.42, 0, 1, 1)";
    case "easeOut": return "cubic-bezier(0, 0, 0.58, 1)";
    case "easeInOut": return "cubic-bezier(0.42, 0, 0.58, 1)";
    case "backOut": return "cubic-bezier(0.33, 1.53, 0.69, 0.99)";
    default: return null; // backIn/backInOut/circ*/anticipate → baked
  }
}

export const namedEasings = easingLookup;

// ---------------------------------------------------------------------------
// The Easing namespace (v0.7 — Reanimated-shaped authoring surface)
// ---------------------------------------------------------------------------

// RN's exact factory semantics: the base curves (poly/back/elastic/quad…)
// are IN-shaped by definition, so `in` is the identity; `out` mirrors into an
// out-curve; `inOut` mirrors both ends around 0.5.

/** Reanimated Easing.in: base curves are already in-shaped — identity. */
const easingInFactory = (easing: (p: number) => number) => easing;

/** Reanimated Easing.out: mirror an in-shaped curve into an out-curve. */
const easingOutFactory = (easing: (p: number) => number) => (p: number) => 1 - easing(1 - p);

/** Reanimated Easing.inOut: mirror both ends around 0.5. */
const easingInOutFactory = (easing: (p: number) => number) => (p: number) =>
  p < 0.5 ? easing(p * 2) / 2 : 1 - easing(2 - p * 2) / 2;

/**
 * The full easing vocabulary as ONE namespace object — the Reanimated authoring
 * surface, backed by the same motion-ported math that names like "backOut"
 * resolve to.
 *
 * ```tsx
 * import { Easing } from "takumi-motion";
 *
 * const settle = Easing.out(Easing.back(2));          // custom out-back curve
 * const jelly  = Easing.elastic(1.2);
 * interpolateFor(frame, [0, 30], [0, 100], Easing.bezier(0.22, 1, 0.36, 1));
 * ```
 */
export const Easing = {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  circIn,
  circOut,
  circInOut,
  backIn,
  backOut,
  backInOut,
  bounceIn,
  bounceOut,
  bounceInOut,
  anticipate,
  /** Power curve — Easing.poly(3) ≈ cubic ease-in. */
  poly,
  /** Decaying sinusoid — Easing.elastic(1.2) for jelly settle. */
  elastic,
  /** RN back(s): overshoot factor — Easing.back(1.7) is the classic backIn; pair with .out(). */
  back: (s = 1.70158) => (p: number) => p * p * ((s + 1) * p - s),
  /** Cubic bezier — same solver as easingDefinitionToFunction([x1,y1,x2,y2]). */
  bezier: cubicBezier,
  /** Stepped easing — Easing.steps(5, "end"). */
  steps,
  /** Identity — the base curves are in-shaped (RN parity). */
  in: easingInFactory,
  /** Mirror an in-shaped curve into an out-curve. */
  out: easingOutFactory,
  /** Mirror both ends around 0.5. */
  inOut: easingInOutFactory,
} as const;
