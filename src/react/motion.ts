// takumi-motion — react/motion.ts
// Pure frame-indexed motion math for React scene components.
//
// The doctrine: a scene's render must be a PURE FUNCTION OF (frame, props).
// These helpers take an explicit frame, so components stay deterministic and
// the capture loop can replay any frame. The spring solver is the exact
// motion-ported closed-form spring from ../spring.js (same math that backs
// the declarative path — one physics engine, two authoring models).

import { springGenerator, calcGeneratorDuration, maxGeneratorDuration, type SpringOptions } from "../spring.js";
import { easingDefinitionToFunction } from "../easing.js";
import type { Easing } from "../types.js";

/** Milliseconds for a frame index at a given fps. */
export function frameToMs(frame: number, fps: number): number {
  return (frame * 1000) / fps;
}

/** Frames for a duration in ms at a given fps (rounds UP — durations never under-shoot). */
export function msToFrames(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`msToFrames: ms must be a finite non-negative number, got ${ms}.`);
  }
  return Math.ceil((ms * fps) / 1000);
}

// ---------------------------------------------------------------------------
// Spring
// ---------------------------------------------------------------------------

export interface SpringAtOptions extends Omit<SpringOptions, "keyframes"> {
  /** Start value. Default 0. */
  from?: number;
  /** End value. Default 1. */
  to?: number;
  /** Frames to hold before the spring starts. Default 0. */
  delayFrames?: number;
  /**
   * Clamp the spring to [min(from, to), max(from, to)] — no overshoot past the
   * target (Reanimated's overshootClamping). Use for slides that must never
   * bounce past their final position. Default false.
   */
  overshootClamping?: boolean;
}

/**
 * Sample the spring at `frame`. Settles exactly on `to` once done; negative
 * effective time (inside the delay) returns `from`.
 *
 * Same physics as the declarative path: underdamped / critical / overdamped
 * closed-form solution, Newton-refined duration.
 */
export function springFor(frame: number, fps: number, options: SpringAtOptions = {}): number {
  const from = options.from ?? 0;
  const to = options.to ?? 1;
  const delayFrames = options.delayFrames ?? 0;
  const tMs = frameToMs(frame - delayFrames, fps);
  if (tMs <= 0) return from;

  const springOpts: SpringOptions = {
    ...(options as Omit<SpringAtOptions, "from" | "to" | "delayFrames" | "overshootClamping">),
    keyframes: [from, to],
  };
  const gen = springGenerator(springOpts);
  const duration = calcGeneratorDuration(gen) ?? maxGeneratorDuration;

  const { done, value } = gen.next(Math.min(tMs, duration));
  const v = done ? to : value;
  if (options.overshootClamping && !done) {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return v < lo ? lo : v > hi ? hi : v;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Spring hygiene (v0.7 — the finite-output problem)
// ---------------------------------------------------------------------------

/**
 * Named spring configurations — the "I don't want to think about physics"
 * surface. Spread them into useSpring/springFor and override what you need:
 *
 * ```tsx
 * <Animated entering={FadeInUp.springify("bouncy")}>…</Animated>
 * useSpring({ ...springPresets.snappy, from: 24, to: 0 })
 * ```
 *
 * - snappy  — duration 350ms, bounce 0.12 — UI-grade default
 * - bouncy  — duration 600ms, bounce 0.45 — playful entrances
 * - gentle  — duration 550ms, bounce 0.06 — near-critical, calm
 * - wobbly  — stiffness 170, damping 11  — jelly physics
 * - stiff   — stiffness 420, damping 34  — mechanical, no bounce
 * - slow    — duration 900ms, bounce 0.05 — drifting, cinematic
 */
export const springPresets = {
  snappy: { duration: 350, bounce: 0.12 },
  bouncy: { duration: 600, bounce: 0.45 },
  gentle: { duration: 550, bounce: 0.06 },
  wobbly: { stiffness: 170, damping: 11 },
  stiff: { stiffness: 420, damping: 34 },
  slow: { duration: 900, bounce: 0.05 },
} as const satisfies Record<string, SpringAtOptions>;

export type SpringPresetName = keyof typeof springPresets;

/** Settle-frames memo — keyed by (fps, options JSON). Bounded; cost per miss is a bounded generator scan. */
const settleCache = new Map<string, number>();
const SETTLE_CACHE_CAP = 256;

/**
 * How many frames until the spring visually settles (velocity AND offset below
 * Motion's rest thresholds), INCLUDING delayFrames. This is the answer to the
 * question Reanimated can't ask — its springs are open-ended, but a GIF/WebP
 * is finite: give the spring at least this many frames or it will be cut
 * mid-motion (the capture lint reports that as TM_SPRING_UNSETTLED).
 *
 * Returns Infinity for springs that never settle (absurd configs).
 */
export function springSettleFrames(fps: number, options: SpringAtOptions = {}): number {
  const delayFrames = options.delayFrames ?? 0;
  const key = `${fps}\u0000${delayFrames}\u0000${options.from ?? 0}\u0000${options.to ?? 1}\u0000${options.duration ?? ""}\u0000${options.bounce ?? ""}\u0000${options.stiffness ?? ""}\u0000${options.damping ?? ""}\u0000${options.mass ?? ""}\u0000${options.visualDuration ?? ""}\u0000${options.velocity ?? ""}\u0000${options.overshootClamping ? 1 : 0}`;
  const hit = settleCache.get(key);
  if (hit !== undefined) return hit;

  const gen = springGenerator({
    ...(options as Omit<SpringAtOptions, "from" | "to" | "delayFrames" | "overshootClamping">),
    keyframes: [options.from ?? 0, options.to ?? 1],
  });
  const ms = calcGeneratorDuration(gen);
  const frames = Number.isFinite(ms)
    ? delayFrames + Math.ceil(ms / (1000 / fps))
    : Infinity;

  if (settleCache.size >= SETTLE_CACHE_CAP) settleCache.clear();
  settleCache.set(key, frames);
  return frames;
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Map `frame` through input/output frame ranges with an easing between stops.
 * Frames before input[0] clamp to output[0]; after input[last] clamp to output[last].
 */
export function interpolateFor(
  frame: number,
  inputFrames: readonly number[],
  output: readonly number[],
  easing: Easing = "linear",
): number {
  if (inputFrames.length !== output.length || inputFrames.length < 2) {
    throw new Error(
      `interpolateFor: input (${inputFrames.length}) and output (${output.length}) must be equal length ≥ 2.`,
    );
  }
  if (frame <= inputFrames[0]) return output[0];
  if (frame >= inputFrames[inputFrames.length - 1]) return output[output.length - 1];

  let segment = 0;
  for (let i = 0; i < inputFrames.length - 1; i++) {
    if (frame >= inputFrames[i] && frame <= inputFrames[i + 1]) {
      segment = i;
      break;
    }
  }
  const t0 = inputFrames[segment];
  const t1 = inputFrames[segment + 1];
  const raw = t1 === t0 ? 1 : (frame - t0) / (t1 - t0);

  // Per-segment easing: strings apply to every segment; arrays pick by segment.
  const easeDef = Array.isArray(easing) ? (easing[segment] ?? "linear") : easing;
  const eased = easingDefinitionToFunction(easeDef as Easing)(raw);
  return output[segment] + (output[segment + 1] - output[segment]) * eased;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic pseudo-random in [0, 1) from a seed + salt. Stable across
 * runs, frames and machines — the ONLY sanctioned randomness inside scenes
 * (the capture loop shims Math.random to stay deterministic; this is the
 * explicit alternative).
 */
export function randomFor(seed: number, ...salt: number[]): number {
  let h = seed >>> 0;
  for (const s of salt) {
    h = (Math.imul(h ^ s, 0x9e3779b1) + 0x85ebca6b) | 0;
  }
  return mulberry32(h)();
}

// ---------------------------------------------------------------------------
// Pulses (mirror loops, breathing, blinks)
// ---------------------------------------------------------------------------

/**
 * 0 → 1 → 0 triangle-sine pulse with period `periodFrames`. Frame-aligned:
 * period 8 at frames 0, 8, 16… lands exactly on 0, so mirror cycles are
 * seam-safe by construction (v0.2 even-window doctrine, hook-shaped).
 */
export function pulseFor(frame: number, periodFrames: number): number {
  if (periodFrames <= 0) return 0;
  const phase = (frame % periodFrames) / periodFrames; // 0..1
  return 1 - Math.abs(2 * phase - 1); // triangle 0→1→0
}

/** Smooth (sine-shaped) variant of pulseFor, same period semantics. */
export function smoothPulseFor(frame: number, periodFrames: number): number {
  if (periodFrames <= 0) return 0;
  const phase = (frame % periodFrames) / periodFrames;
  return Math.sin(Math.PI * phase);
}

// ---------------------------------------------------------------------------
// Stagger vocabulary (v0.5)
// ---------------------------------------------------------------------------

export interface StaggerOptions {
  /** Frames between consecutive unit starts. Default 2. */
  intervalFrames?: number;
  /** Frames before the FIRST unit starts. Default 0. */
  startFrames?: number;
}

/**
 * The frame where unit `index` starts animating: `startFrames + index ×
 * intervalFrames`. Deterministic by construction — the same building block
 * the declarative path's deceleratingStagger uses.
 */
export function staggerDelay(index: number, options: StaggerOptions = {}): number {
  const intervalFrames = options.intervalFrames ?? 2;
  const startFrames = options.startFrames ?? 0;
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`staggerDelay: index must be a non-negative integer, got ${index}.`);
  }
  if (!Number.isFinite(intervalFrames) || intervalFrames < 0) {
    throw new Error(`staggerDelay: intervalFrames must be a non-negative number, got ${intervalFrames}.`);
  }
  if (!Number.isFinite(startFrames) || startFrames < 0) {
    throw new Error(`staggerDelay: startFrames must be a non-negative number, got ${startFrames}.`);
  }
  return startFrames + index * intervalFrames;
}

export interface StaggeredSpringOptions extends SpringAtOptions, StaggerOptions {}

/**
 * A spring delayed by the unit's stagger slot: unit 0 moves first, unit 1
 * `intervalFrames` later, and so on. Exactly `springFor(frame, fps, { …,
 * delayFrames: spring.delayFrames + staggerDelay(index) })`.
 */
export function staggeredSpringFor(
  index: number,
  frame: number,
  fps: number,
  options: StaggeredSpringOptions = {},
): number {
  const { intervalFrames, startFrames, ...springOpts } = options;
  const delay = staggerDelay(index, { intervalFrames, startFrames });
  return springFor(frame, fps, {
    ...springOpts,
    delayFrames: (springOpts.delayFrames ?? 0) + delay,
  });
}

// ---------------------------------------------------------------------------
// Deterministic value noise (v0.4)
// ---------------------------------------------------------------------------

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10); // quintic smoothstep

/** Deterministic lattice value in [-1, 1) for one noise cell. */
function lattice(seed: number, ix: number, iy: number): number {
  return randomFor(seed, ix, iy) * 2 - 1;
}

/**
 * 2D value noise in [-1, 1) — deterministic for a given (seed, x, y) across
 * frames, runs and machines. Quintic-fade interpolation between hashed
 * lattice points; integer inputs land exactly ON lattice values.
 *
 * Use it for organic per-frame wander (jitter, shimmer, drift):
 *   noiseFor(seed, frame)        — 1D walk over frames
 *   noiseFor(seed, frame, salt)  — independent layer per salt
 */
export function noiseFor(seed: number, x: number, y = 0): number {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`noiseFor: coordinates must be finite, got (${x}, ${y}).`);
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fade(fx);
  const v = fade(fy);

  const n00 = lattice(seed, x0, y0);
  const n10 = lattice(seed, x0 + 1, y0);
  const n01 = lattice(seed, x0, y0 + 1);
  const n11 = lattice(seed, x0 + 1, y0 + 1);

  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return nx0 + (nx1 - nx0) * v;
}

// ---------------------------------------------------------------------------
// Organic motion pack (v0.8 — Bet C)
// ---------------------------------------------------------------------------

/** FNV-1a string hash — for string seeds. (Moved here from context.tsx in
 *  v0.8 so the PURE math layer owns it; context re-exports the same symbol.) */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface WiggleOptions {
  /** Output scale (px for transforms). Default 4. */
  amplitude?: number;
  /** Lattice cells per FRAME — the noise walk's speed. The frame grid's
   *  Nyquist limit is 0.5: above it, lattice crossings happen between frames
   *  and the motion aliases into jitter (reported as TM_NOISE_ALIASED by
   *  <Wiggle>/<Camera shake>). Default 0.15 (one lattice cell ≈ every 6-7
   *  frames — smooth drift). */
  frequency?: number;
  /** Seed — number or string. Deterministic for a given (seed, frame). */
  seed?: number | string;
}

/**
 * Seed-locked organic wander in [-amplitude, amplitude) — the After Effects
 * `wiggle()` shape, deterministic by construction (built on noiseFor, which
 * is built on mulberry32 — the v0.3 seed doctrine).
 *
 * ```tsx
 * style={{ transform: `translateY(${wiggleFor("drift", frame, { amplitude: 6 }).toFixed(3)}px)` }}
 * ```
 */
export function wiggleFor(seed: number | string, frame: number, options: WiggleOptions = {}): number {
  const amplitude = options.amplitude ?? 4;
  const frequency = options.frequency ?? 0.15;
  const numericSeed = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  return noiseFor(numericSeed, frame * frequency) * amplitude;
}

/**
 * The frame-grid Nyquist check behind TM_NOISE_ALIASED: a wiggle frequency
 * above 0.5 lattice cells per frame cannot be represented by the output's
 * frame grid — it aliases. Exported so tooling can pre-flight configs.
 */
export function isNoiseAliased(frequency: number): boolean {
  return Number.isFinite(frequency) && frequency > 0.5;
}
