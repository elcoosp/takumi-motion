// takumi-motion — react/context.tsx
// Frame context + hooks for the frame-driven React runtime.
//
// The runtime renders the user's component tree once per frame with a
// DriverContext carrying the phase and global frame. <Banner> consumes the
// driver context, consults the plan, and hands each active <Scene> a
// FrameContext with its SCENE-LOCAL frame — so useCurrentFrame() restarts at
// 0 for every scene (Remotion convention) while useAbsoluteFrame() still sees
// the global grid.
//
// THE DETERMINISM DOCTRINE: a scene's render output must be a pure function
// of (frame, props). Events and wall-clock do not exist here — state evolves
// through useFrameState, which replays a reducer deterministically from
// frame 0 to the current frame on every render.

import { createContext, useContext, type ReactNode } from "react";
import { randomFor, springFor, interpolateFor, pulseFor, smoothPulseFor, noiseFor, staggeredSpringFor, hashString, type SpringAtOptions, type StaggeredSpringOptions } from "./motion.js";
import type { Easing } from "../types.js";

export { noiseFor, hashString };

// ---------------------------------------------------------------------------
// Driver context (runtime → Banner)
// ---------------------------------------------------------------------------

/** What the capture driver tells <Banner> on each render pass. */
export interface DriverInfo {
  /** "probe" — plan discovery pass (Banner reports its scenes, renders null).
   *  "frame" — capture pass for absoluteFrame. */
  phase: "probe" | "frame";
  /** Global frame on the banner timeline (0-based). */
  absoluteFrame: number;
  fps: number;
  /** Probe-phase side channel: Banner registers its resolved metadata here. */
  registry: DriverRegistry;
}

export interface BannerMeta {
  presetName: string;
  width: number;
  height: number;
  fps: number;
  themeName: string;
  fontFamily: string;
  loop: boolean;
  transitionMs: number;
  /** Resolved canvas background: null = transparent canvas. */
  background: string | null;
  /** FontSpec list requested by <Banner fonts={...}> (registration happens in the driver). */
  fonts: unknown[];
  personality?: string;
  /** The RESOLVED preset object (custom objects + v0.4 w/h/dpr overrides survive the probe round-trip). */
  preset?: unknown;
  /** v0.8 — composition-wide tempo (time-stretch). 1 = authored speed; 2 =
   *  twice as fast (half the output frames); 0.5 = half speed. Applied by the
   *  capture driver's frame mapping — scenes never see it. */
  tempo?: number;
}

/** Everything the probe pass extracts from the user's tree. */
export interface DriverRegistry {
  banner?: BannerMeta;
  /** Raw <Scene> props in declaration order. */
  sceneInputs?: Array<{ durationFrames: number; enter?: unknown; exit?: unknown }>;
  /** Layer props (top/bottom) in declaration order. */
  layerInputs?: Array<{ top?: boolean; bottom?: boolean }>;
  /** Planned plan (capture fills this between probe and frames). */
  planned?: unknown;
  errors: string[];
}

export const DriverContext = createContext<DriverInfo | null>(null);

export function useDriver(): DriverInfo {
  const ctx = useContext(DriverContext);
  if (!ctx) {
    throw new Error(
      "takumi-motion: <Banner> rendered outside the runtime. " +
      "Default-export it through defineBanner() (or export the <Banner> element) and render via the CLI / renderReactBanner().",
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Frame context (Banner → scene components)
// ---------------------------------------------------------------------------

export interface FrameInfo {
  /** Scene-local frame: 0 at the scene's window start (enter overlap included). */
  frame: number;
  /** Global frame on the banner timeline. */
  absolute: number;
  /** This scene's content duration in frames. */
  sceneFrames: number;
  /** Total frames of the whole banner. */
  bannerFrames: number;
  fps: number;
  /** Milliseconds since the scene window start. */
  timeMs: number;
}

export const FrameContext = createContext<FrameInfo | null>(null);

/** Full frame info — throws with a helpful message outside a scene. */
export function useFrame(): FrameInfo {
  const ctx = useContext(FrameContext);
  if (!ctx) {
    throw new Error(
      "takumi-motion: useFrame() called outside a scene. Frame hooks (useCurrentFrame, useSpring, …) " +
      "must run inside components rendered under <Banner><Scene>…</Scene></Banner>.",
    );
  }
  return ctx;
}

/** Scene-local frame (0-based, restarts per scene). */
export function useCurrentFrame(): number {
  return useFrame().frame;
}

/** Global banner frame (does not restart per scene). */
export function useAbsoluteFrame(): number {
  return useFrame().absolute;
}

/** Current scene's duration in frames. */
export function useDuration(): number {
  return useFrame().sceneFrames;
}

/** Banner fps. */
export function useFps(): number {
  return useFrame().fps;
}

// ---------------------------------------------------------------------------
// Deterministic state replay
// ---------------------------------------------------------------------------

/**
 * A reducer-driven state machine that evolves WITH THE TIMELINE.
 *
 * `events(frame)` declares which actions fire on each frame; the hook replays
 * actions for frames 0..current (inclusive) on every render. The result is
 * real state-machine semantics — conditionals, transitions between states,
 * accumulated counters — that stay a pure function of the frame, so capture
 * is deterministic and any frame can be rendered in isolation.
 *
 * ```tsx
 * const [active, dispatch] = ... — no. Shape:
 * const active = useFrameState(
 *   (state, action) => action.type === "next" ? (state + 1) % items.length : state,
 *   0,
 *   (frame) => (frame > 0 && frame % 30 === 0 ? { type: "next" } : null),
 * );
 * ```
 *
 * Cost is O(currentFrame) per render — negligible at banner scale.
 */
export function useFrameState<S, A>(
  reducer: (state: S, action: A, frame: FrameInfo) => S,
  initial: S | ((first: FrameInfo) => S),
  events?: (frame: FrameInfo) => A | A[] | null | undefined,
): S {
  const info = useFrame();
  const frameInfoFor = (f: number): FrameInfo => ({
    ...info,
    frame: f,
    timeMs: (f * 1000) / info.fps,
  });

  let state = typeof initial === "function" ? (initial as (first: FrameInfo) => S)(frameInfoFor(0)) : initial;
  for (let f = 0; f <= info.frame; f++) {
    const fi = frameInfoFor(f);
    const fired = events?.(fi);
    if (!fired) continue;
    for (const action of Array.isArray(fired) ? fired : [fired]) {
      state = reducer(state, action, fi);
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Motion hooks (sugar over the pure frame math in motion.ts)
// ---------------------------------------------------------------------------

/** Spring sampled at the current scene-local frame. See springFor() for options. */
export function useSpring(options: SpringAtOptions = {}): number {
  const { frame, fps } = useFrame();
  return springFor(frame, fps, options);
}

/**
 * A spring delayed by unit `index`'s stagger slot (v0.5): unit 0 moves first,
 * unit 1 `intervalFrames` later, … The kinetic-typography workhorse — pair
 * with <SplitText renderUnit> for per-character entrances.
 */
export function useStaggeredSpring(index: number, options: StaggeredSpringOptions = {}): number {
  const { frame, fps } = useFrame();
  return staggeredSpringFor(index, frame, fps, options);
}

/** Frame-indexed interpolation with an easing between stops. */
export function useInterpolate(
  inputFrames: readonly number[],
  output: readonly number[],
  easing?: Easing,
): number {
  const { frame } = useFrame();
  return interpolateFor(frame, inputFrames, output, easing);
}

/** Linear 0→1→0 triangle pulse with the given period (seam-safe at even periods). */
export function usePulse(periodFrames: number): number {
  const { frame } = useFrame();
  return pulseFor(frame, periodFrames);
}

/** Smooth (sine) 0→1→0 pulse with the given period. */
export function useSmoothPulse(periodFrames: number): number {
  const { frame } = useFrame();
  return smoothPulseFor(frame, periodFrames);
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * Deterministic random in [0, 1) — stable for a given seed + salts, and
 * stable across frames unless you salt with the frame. The capture loop
 * SHIMS Math.random (seeded + warned), so accidental Math.random usage still
 * renders deterministically; useRandom is the explicit, warning-free way.
 */
export function useRandom(seed: number | string, ...salt: number[]): number {
  const numericSeed = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  return randomFor(numericSeed, ...salt);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Children type helper for primitives (kept here to avoid import cycles). */
export type SceneChild = ReactNode;

// ---------------------------------------------------------------------------
// Deterministic value noise (v0.4)
// ---------------------------------------------------------------------------

export interface UseNoiseOptions {
  /** Output scale: value ∈ [-amplitude, amplitude). Default 1. */
  amplitude?: number;
  /** Domain units per frame — lower = smoother drift. Default 0.1. */
  frequency?: number;
  /** Second noise dimension — salt independent layers (one per value). */
  y?: number;
}

/**
 * Per-frame value noise in [-amplitude, amplitude). Deterministic (seeded —
 * NOT Math.random), smooth by default (frequency 0.1 ≈ one noise lattice per
 * 10 frames). For raw lattice jumps pass frequency: 1.
 */
export function useNoise(seed: number | string, options: UseNoiseOptions = {}): number {
  const { amplitude = 1, frequency = 0.1, y = 0 } = options;
  const { frame } = useFrame();
  const numericSeed = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  return noiseFor(numericSeed, frame * frequency, y) * amplitude;
}
