// takumi-motion — sampler.ts
// Resolves a TrackJSON into a stateless, repeat-folded sampler.
// Shared by the TS reference evaluator (evaluate.ts) and the CSS compiler
// (compile.ts) so both paths always agree.

import { springGenerator, calcGeneratorDuration, maxGeneratorDuration } from "./spring.js";
import { inertiaGenerator } from "./inertia.js";
import { createTweenSampler, mixValues } from "./interpolate.js";
import { isTransformProp } from "./transform.js";
import type { TrackJSON, TransitionWithOptions } from "./types.js";

export interface ResolvedTrack {
  target: string;
  property: string;
  isTransform: boolean;
  delayMs: number;
  /** Duration of one iteration (spring settle / tween duration / inertia settle). */
  iterationMs: number;
  repeat: number;
  repeatType: "loop" | "reverse" | "mirror";
  repeatDelayMs: number;
  /** Total unrolled duration excluding delay. */
  totalMs: number;
  /** Value held before delay elapses (fill backwards). */
  firstValue: number | string;
  /** Value held after the animation ends. */
  lastValue: number | string;
  /** Sample within one iteration (0..iterationMs). */
  sampleIteration(tMs: number): number | string;
}

export class TrackError extends Error {}

function resolveIterationSampler(track: TrackJSON): { iterationMs: number; sample: (t: number) => number | string } {
  const kf = track.keyframes;
  // Transition fields are read loosely: the union is narrow at the authoring
  // surface, but the JSON layer is validated at runtime by resolveTrack.
  const transition = track.transition as TransitionWithOptions & Record<string, any>;
  const type = transition.type ?? (kf.length > 2 ? "keyframes" : "tween");

  if (type === "spring") {
    const numeric = kf.map((v, i) => {
      if (typeof v === "number") return v;
      throw new TrackError(
        `Spring tracks require numeric keyframes; track "${track.property}" on "${track.target}" has ${JSON.stringify(v)} at index ${i}`
      );
    });
    if (numeric.length < 2) {
      throw new TrackError(`Spring track "${track.property}" needs [from, to] keyframes`);
    }
    const gen = springGenerator({
      keyframes: numeric,
      stiffness: transition.stiffness,
      damping: transition.damping,
      mass: transition.mass,
      duration: transition.duration,
      bounce: transition.bounce,
      visualDuration: transition.visualDuration,
      velocity: transition.velocity,
      restSpeed: transition.restSpeed,
      restDelta: transition.restDelta,
    });
    const iterationMs =
      gen.calculatedDuration ?? calcGeneratorDuration(gen, 50, maxGeneratorDuration);
    return { iterationMs, sample: (t) => gen.next(t).value };
  }

  if (type === "inertia") {
    const numeric = kf.map((v, i) => {
      if (typeof v === "number") return v;
      throw new TrackError(
        `Inertia tracks require numeric keyframes; track "${track.property}" on "${track.target}" has ${JSON.stringify(v)} at index ${i}`
      );
    });
    const gen = inertiaGenerator({
      keyframes: numeric,
      velocity: transition.velocity ?? 0,
      power: transition.power,
      timeConstant: transition.timeConstant,
      bounceStiffness: transition.bounceStiffness,
      bounceDamping: transition.bounceDamping,
      min: transition.min,
      max: transition.max,
      restDelta: transition.restDelta,
    });
    const iterationMs = calcGeneratorDuration(gen, 50, maxGeneratorDuration);
    return { iterationMs, sample: (t) => gen.next(t).value };
  }

  // tween / keyframes
  const duration = transition.duration ?? (kf.length > 2 ? 800 : 300);
  const sampler = createTweenSampler(
    { keyframes: kf, times: track.times, ease: transition.ease ?? track.ease, duration },
    undefined
  );
  return { iterationMs: duration, sample: (t) => sampler.sample(t) };
}

/** Resolve a TrackJSON into a folded sampler. `base` supplies values for `null` keyframes. */
// ---------------------------------------------------------------------------
// v1.0 — the resolution memo (hot path)
//
// resolveTrack is pure and its result is expensive (generator construction +
// a bounded settle scan for springs/inertia). Compile, evaluate, preview and
// the loop checks all re-resolve the SAME track objects per frame/call, so
// the resolved sampler memoizes on the track object's identity (WeakMap —
// zero leaks when authoring code drops timelines). A caller-supplied base
// resolver changes the result, so tracks with null keyframes + a resolver
// resolve fresh every time (correctness over cache).
// ---------------------------------------------------------------------------

const resolveMemo = new WeakMap<TrackJSON, ResolvedTrack>();

export function resolveTrack(track: TrackJSON, base?: (target: string, prop: string) => number | string | undefined): ResolvedTrack {
  // v1.0 — memo hit: tracks WITHOUT null keyframes (or with no resolver)
  // resolve identically every time; reuse the resolved sampler.
  if (base === undefined) {
    const memoHit = resolveMemo.get(track);
    if (memoHit) return memoHit;
  }

  const transition = track.transition as TransitionWithOptions;
  const delayMs = transition.delay ?? 0;
  const repeat = transition.repeat ?? 0;
  const repeatType = transition.repeatType ?? "loop";
  const repeatDelayMs = transition.repeatDelay ?? 0;

  const { iterationMs, sample } = resolveIterationSampler(track);

  if (track.keyframes.includes(null) && !base) {
    throw new TrackError(
      `Track "${track.property}" on "${track.target}" contains null keyframes ("use base style") but no base-value resolver was provided. Pass explicit [from, to] or a resolveBase callback.`
    );
  }

  const firstRaw = track.keyframes[0] === null ? base?.(track.target, track.property) : track.keyframes[0];
  const lastRaw = track.keyframes[track.keyframes.length - 1] === null
    ? base?.(track.target, track.property)
    : track.keyframes[track.keyframes.length - 1];

  const totalMs =
    Number.isFinite(repeat)
      ? (repeat + 1) * iterationMs + repeat * repeatDelayMs
      : Infinity;

  const sampleIteration = (tMs: number): number | string => {
    const t = Math.min(Math.max(tMs, 0), iterationMs);
    return sample(t);
  };

  const sampleAt = (localMs: number): number | string => {
    // localMs in [0, totalMs)
    const iteration = iterationMs + repeatDelayMs;
    let idx: number;
    let local: number;

    if (!Number.isFinite(totalMs)) {
      idx = Math.floor(localMs / iteration);
      local = localMs - idx * iteration;
    } else {
      idx = Math.min(Math.floor(localMs / iteration), repeat);
      local = localMs - idx * iteration;
    }

    // Hold end-of-iteration value during the repeatDelay gap
    const inGap = local > iterationMs;
    let t = Math.min(local, iterationMs);
    // Alternate direction for reverse/mirror on odd iterations
    if (repeatType !== "loop" && idx % 2 === 1) {
      t = iterationMs - t;
      return inGap ? sampleIteration(0) : sampleIteration(t);
    }
    return sampleIteration(inGap ? iterationMs : t);
  };

  const fillValue = (raw: number | string | null | undefined, fallbackIndex: number): number | string => {
    if (raw !== null && raw !== undefined) return raw;
    const fallback = track.keyframes[fallbackIndex];
    if (fallback === null || fallback === undefined) return 0;
    return fallback;
  };

  const resolved: ResolvedTrack = {
    target: track.target,
    property: track.property,
    isTransform: isTransformProp(track.property),
    delayMs,
    iterationMs,
    repeat,
    repeatType,
    repeatDelayMs,
    totalMs,
    firstValue: fillValue(firstRaw, 1),
    lastValue: fillValue(lastRaw, Math.max(0, track.keyframes.length - 2)),
    sampleIteration,
    // expose folded sampling through a function property
    ...({ sampleAt } as object),
  } as ResolvedTrack & { sampleAt: (localMs: number) => number | string };

  if (base === undefined) resolveMemo.set(track, resolved);
  return resolved;
}

/** Sample a resolved track at an absolute timeline time (after delay). */
export function sampleTrackAt(resolved: ResolvedTrack, tAbsAfterDelay: number): number | string {
  const sampleAt = (resolved as ResolvedTrack & { sampleAt: (t: number) => number | string }).sampleAt;
  const t = Math.min(Math.max(tAbsAfterDelay, 0), resolved.totalMs);
  if (t <= 0) return resolved.firstValue;
  if (t >= resolved.totalMs) return resolved.lastValue;
  return sampleAt(t);
}

/** Mix helper re-exported for evaluators that blend between base and track values. */
export { mixValues };
