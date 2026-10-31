// takumi-motion — react/camera.tsx (v0.8, Bets D + C)
// Stagecraft: <Camera> (push-in / pan / shake / Ken Burns) and <Wiggle>
// (seed-locked organic motion).
//
// Both are pure per-frame transforms — no layout cost, no new math pipelines.
// Shake and Wiggle read the SAME deterministic noise (noiseFor on mulberry32,
// the v0.3 seed doctrine), so "camera shake" is literally <Wiggle> applied to
// the camera — clusters composing, as the v0.8 brainstorm intended.
//
// Lint tie-in (audit-as-data): a noise frequency above the frame grid's
// Nyquist limit (0.5 lattice cells per frame) cannot be represented by the
// output — it aliases into jitter. Both components diagnose ONCE per capture
// (at the scene's final frame) and report TM_NOISE_ALIASED into the registry
// channel that captureReactBanner drains into report.lint.

import { createElement, useContext, type ReactNode } from "react";
import { DriverContext, useFrame } from "./context.js";
import { easingDefinitionToFunction } from "../easing.js";
import { noiseFor, isNoiseAliased } from "./motion.js";
import { hashString } from "./motion.js";
import type { LintWarning } from "../lint.js";
import type { TakumiStyle } from "../style.js";
import type { Easing } from "../types.js";

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function pushLint(driver: { registry: { lints?: LintWarning[] } } | null, warning: LintWarning): void {
  if (!driver) return;
  driver.registry.lints ??= [];
  driver.registry.lints.push(warning);
}

/** Scene-final-frame hook pattern shared with <Animated>: run once per capture. */
function useSceneFinalLint(check: (frame: number, sceneFrames: number) => LintWarning | null): void {
  const { frame, sceneFrames } = useFrame();
  const driver = useContext(DriverContext);
  if (frame === sceneFrames - 1) {
    const warning = check(frame, sceneFrames);
    if (warning) pushLint(driver as never, warning);
  }
}

// ---------------------------------------------------------------------------
// <Wiggle> — Bet C, the organic pack's component face
// ---------------------------------------------------------------------------

export interface WiggleProps {
  /** Output amplitude in px. Default 4. */
  amplitude?: number;
  /** Lattice cells per frame — > 0.5 aliases against the frame grid and is
   *  reported as TM_NOISE_ALIASED. Default 0.15 (smooth drift). */
  frequency?: number;
  /** Seed — number or string. Same (seed, frame) → same bytes, always. */
  seed?: number | string;
  /** Organic rotation amplitude in degrees. Default 0. */
  rotateAmplitude?: number;
  /** Merged under the per-frame transform. */
  style?: TakumiStyle;
  children?: ReactNode;
}

/**
 * Seed-locked organic wander — the AE `wiggle()` shape for any subtree:
 *
 * ```tsx
 * <Wiggle amplitude={6} frequency={0.12} seed="float">
 *   <Sticker />
 * </Wiggle>
 * ```
 *
 * Deterministic by construction (seed → same bytes on every machine); smooth
 * by default (quintic-fade value noise); free when settled is impossible —
 * noise never settles, so put ambient wiggles on DECORATIVE layers and keep
 * loop seams honest via even-period pulses when you need strict looping.
 */
export function Wiggle(props: WiggleProps): ReactNode {
  const { frame } = useFrame();
  const amplitude = props.amplitude ?? 4;
  const frequency = props.frequency ?? 0.15;
  const rotateAmplitude = props.rotateAmplitude ?? 0;
  const seed = typeof props.seed === "string" ? hashString(props.seed) : (props.seed ?? 1) >>> 0;

  useSceneFinalLint(() =>
    isNoiseAliased(frequency)
      ? {
          code: "TM_NOISE_ALIASED",
          message: `<Wiggle> frequency ${frequency} exceeds the frame grid's Nyquist limit (0.5 lattice cells/frame) — the output will alias into jitter.`,
          hint: "Lower frequency below 0.5, or raise fps. At 20fps a frequency of 0.1–0.25 reads as organic drift.",
          severity: "warn",
        }
      : null,
  );

  const x = noiseFor(seed, frame * frequency, 0) * amplitude;
  const y = noiseFor(seed, frame * frequency, 1) * amplitude;

  const parts = [`translateX(${r6(x)}px)`, `translateY(${r6(y)}px)`];
  if (rotateAmplitude !== 0) {
    parts.push(`rotate(${r6(noiseFor(seed, frame * frequency, 2) * rotateAmplitude)}deg)`);
  }

  return createElement("div", {
    style: { ...props.style, transform: parts.join(" ") },
  }, props.children);
}

// ---------------------------------------------------------------------------
// <Camera> — Bet D, the stagecraft face
// ---------------------------------------------------------------------------

export interface CameraPushIn {
  /** Start scale. Default 1. */
  from?: number;
  /** End scale. Default 1.08 (a gentle Ken Burns push). */
  to?: number;
  /** Frames the push spans. Default: the whole scene. */
  durationFrames?: number;
  /** Default "easeOut" — pushes decelerate into their subject. */
  easing?: Easing;
}

export interface CameraPan {
  /** [startX, endX] in px. */
  x?: [number, number];
  /** [startY, endY] in px. */
  y?: [number, number];
  /** Frames the pan spans. Default: the whole scene. */
  durationFrames?: number;
  /** Default "easeInOut". */
  easing?: Easing;
}

export interface CameraShake {
  /** Shake amplitude in px. Default 3. */
  amplitude?: number;
  /** Lattice cells per frame. Default 0.2 (handheld tremor). > 0.5 aliases
   *  and is reported as TM_NOISE_ALIASED. */
  frequency?: number;
  /** Seed — number or string. Default "camera". */
  seed?: number | string;
  /** Roll amplitude in degrees. Default 0. */
  rotateAmplitude?: number;
  /** Finite-shake envelope: the amplitude decays LINEARLY to exactly 0 over
   *  this many frames (an impact tremor that settles — AE's wiggle with a
   *  decay). Default: infinite ambient shake. A finite shake also lets the
   *  encoder merge the frames after it settles. */
  durationFrames?: number;
}

export interface CameraProps {
  pushIn?: CameraPushIn;
  pan?: CameraPan;
  shake?: CameraShake;
  /** Transform origin for the WHOLE camera move — any CSS position ("left
   *  center", "0% 50%", "50% 30%"). Default center. Left-anchored layouts
   *  want "left center": a center-origin push-in shoves left-parked content
   *  off the canvas edge (scale 1.1 moves x=64 to x≈-1 at 1280w).
   *  takumi-native: transform-origin (default center). */
  transformOrigin?: string;
  /** Merged under the camera's base style (absolute inset-0). */
  style?: TakumiStyle;
  children?: ReactNode;
}

/**
 * The virtual camera — root-transform choreography over the scene:
 *
 * ```tsx
 * <Scene duration={90}>
 *   <Camera
 *     pushIn={{ from: 1, to: 1.1, durationFrames: 70 }}
 *     pan={{ y: [8, -8] }}
 *     shake={{ amplitude: 2, frequency: 0.2, seed: 7 }}
 *   >
 *     <Hero />
 *   </Camera>
 * </Scene>
 * ```
 *
 * Transform order: translate (pan) → rotate (roll) → scale (push). Zero
 * layout cost — the camera is a transform on one wrapper div; everything
 * inside stays authored in canvas coordinates.
 */
export function Camera(props: CameraProps): ReactNode {
  const { frame, sceneFrames, fps } = useFrame();

  const push = props.pushIn;
  const pan = props.pan;
  const shake = props.shake;

  const shakeFrequency = shake?.frequency ?? 0.2;
  useSceneFinalLint(() =>
    shake && isNoiseAliased(shakeFrequency)
      ? {
          code: "TM_NOISE_ALIASED",
          message: `<Camera shake> frequency ${shakeFrequency} exceeds the frame grid's Nyquist limit (0.5 lattice cells/frame) — handheld motion will alias into jitter.`,
          hint: "Lower frequency below 0.5 (0.15–0.3 reads as handheld), or raise fps.",
          severity: "warn",
        }
      : null,
  );

  const parts: string[] = [];

  // Pan (translate) — first in the chain, so scale/rotate act around the
  // panned origin.
  if (pan && (pan.x || pan.y)) {
    const easing = easingDefinitionToFunction(pan.easing ?? "easeInOut");
    const span = Math.max(1, pan.durationFrames ?? sceneFrames);
    const p = easing(Math.min(1, Math.max(0, frame / span)));
    if (pan.x) parts.push(`translateX(${r6(lerp(pan.x[0], pan.x[1], p))}px)`);
    if (pan.y) parts.push(`translateY(${r6(lerp(pan.y[0], pan.y[1], p))}px)`);
  }

  // Shake (noise translate + optional roll), optionally decaying to rest.
  if (shake) {
    const amplitude = shake.amplitude ?? 3;
    const seed = typeof shake.seed === "string" ? hashString(shake.seed) : (shake.seed ?? 1) >>> 0;
    let envelope = 1;
    if (shake.durationFrames !== undefined) {
      envelope = Math.max(0, 1 - frame / Math.max(1, shake.durationFrames));
    }
    if (envelope > 0) {
      const x = noiseFor(seed, frame * shakeFrequency, 0) * amplitude * envelope;
      const y = noiseFor(seed, frame * shakeFrequency, 1) * amplitude * envelope;
      parts.push(`translateX(${r6(x)}px)`, `translateY(${r6(y)}px)`);
      const roll = shake.rotateAmplitude ?? 0;
      if (roll !== 0) {
        parts.push(`rotate(${r6(noiseFor(seed, frame * shakeFrequency, 2) * roll)}deg)`);
      }
    }
  }

  // Push (scale) — last, so it zooms the already-panned/shaken frame.
  if (push) {
    const from = push.from ?? 1;
    const to = push.to ?? 1.08;
    const easing = easingDefinitionToFunction(push.easing ?? "easeOut");
    const span = Math.max(1, push.durationFrames ?? sceneFrames);
    const p = easing(Math.min(1, Math.max(0, frame / span)));
    parts.push(`scale(${r6(lerp(from, to, p))})`);
  }

  const style: TakumiStyle = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    ...props.style,
    ...(props.transformOrigin ? { transformOrigin: props.transformOrigin } : {}),
    ...(parts.length > 0 ? { transform: parts.join(" ") } : {}),
  } as TakumiStyle;

  // fps referenced for parity with the scene context (unused math-wise).
  void fps;
  return createElement("div", { style }, props.children);
}
