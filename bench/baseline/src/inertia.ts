// takumi-motion — inertia.ts
// Verbatim-faithful port of Motion v14.6.0's inertia/decay generator
// (packages/motion-dom/src/animation/generators/inertia.ts).

import { springGenerator, type SpringGenerator } from "./spring.js";

export interface InertiaOptions {
  keyframes: number[];
  velocity?: number;
  power?: number;
  timeConstant?: number;
  bounceDamping?: number;
  bounceStiffness?: number;
  modifyTarget?: (ideal: number) => number;
  min?: number;
  max?: number;
  restDelta?: number;
  restSpeed?: number;
}

export interface InertiaGenerator {
  calculatedDuration: null;
  next(t: number): { done: boolean; value: number };
}

export function inertiaGenerator(options: InertiaOptions): InertiaGenerator {
  const {
    keyframes,
    velocity = 0.0,
    power = 0.8,
    timeConstant = 325,
    bounceDamping = 10,
    bounceStiffness = 500,
    modifyTarget,
    min,
    max,
    restDelta = 0.5,
    restSpeed,
  } = options;

  const origin = keyframes[0];

  const state = { done: false, value: origin };

  const isOutOfBounds = (v: number) => v < (min as number) || v > (max as number);

  const nearestBoundary = (v: number): number | undefined => {
    if (min === undefined) return max;
    if (max === undefined) return min;
    return Math.abs(min - v) < Math.abs(max - v) ? min : max;
  };

  let amplitude = power * velocity;
  const ideal = origin + amplitude;
  const target = modifyTarget ? modifyTarget(ideal) : ideal;

  if (target !== ideal) amplitude = target - origin;

  const calcDelta = (t: number) => -amplitude * Math.exp(-t / timeConstant);

  const applyFriction = (t: number) => {
    const delta = calcDelta(t);
    state.done = Math.abs(delta) <= restDelta;
    // target + delta can be off from origin by a float error at t = 0
    state.value = state.done ? target : t ? target + delta : origin;
  };

  let timeReachedBoundary: number | undefined;
  let spring: SpringGenerator | undefined;

  const checkCatchBoundary = (t: number) => {
    if (!isOutOfBounds(state.value)) return;

    timeReachedBoundary = t;

    spring = springGenerator({
      keyframes: [state.value, nearestBoundary(state.value) as number],
      /**
       * The friction curve is target + calcDelta(t), so its exact derivative
       * is -calcDelta(t) / timeConstant in units/ms, converted to units/second.
       */
      velocity: ((-calcDelta(t) / (timeConstant as number)) * 1000) as number,
      damping: bounceDamping,
      stiffness: bounceStiffness,
      restDelta,
      restSpeed,
    });
  };

  checkCatchBoundary(0);

  return {
    calculatedDuration: null,
    next: (t: number) => {
      let hasUpdatedFrame = false;
      if (!spring && timeReachedBoundary === undefined) {
        hasUpdatedFrame = true;
        applyFriction(t);
        checkCatchBoundary(t);
      }

      if (timeReachedBoundary !== undefined && t >= timeReachedBoundary) {
        return spring!.next(t - timeReachedBoundary);
      } else {
        if (!hasUpdatedFrame) applyFriction(t);
        return state;
      }
    },
  };
}
