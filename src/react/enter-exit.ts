// takumi-motion — react/enter-exit.ts (v0.7)
// Declarative entering/exiting transitions — the Reanimated borrow.
//
// A descriptor is PURE DATA: { side, preset, durationFrames, delayFrames,
// easing, spring?, values }. The resolver maps (frame, fps, totalFrames) →
// { opacity, transform } with 6-decimal rounding so byte-identical frames
// chunk-merge (the v0.1 doctrine). No React, no capture coupling — the
// runtime glue lives in animated.tsx.
//
// ```tsx
// <Animated entering={FadeInDown.duration(18).delay(6)} exiting={FadeOutLeft}>
//   <Hero />
// </Animated>
// ```
//
// Units are FRAMES (engine-native — every other timing in the lib is frames;
// ms→frames via msToFrames()). Exiting anchors to the enclosing scene's
// duration via FrameContext: it STARTS at totalFrames − delay − duration so
// the element is fully hidden exactly as the scene window closes.

import {
  springFor,
  springSettleFrames,
  staggerDelay,
  springPresets,
  type SpringAtOptions,
  type SpringPresetName,
  type StaggerOptions,
} from "./motion.js";
import { easingDefinitionToFunction } from "../easing.js";
import type { Easing } from "../types.js";

// ---------------------------------------------------------------------------
// Descriptor model
// ---------------------------------------------------------------------------

export type TransitionSide = "enter" | "exit";

/** One animatable channel: [startValue, endValue] in VISUAL motion order. */
export type Channel = [number, number];

/** The channels a preset animates. Absent channels are left untouched. */
export interface PresetChannels {
  opacity?: Channel;
  /** px, + is right. */
  x?: Channel;
  /** px, + is down. */
  y?: Channel;
  /** uniform scale. */
  scale?: Channel;
  /** degrees, + is clockwise. */
  rotate?: Channel;
}

export interface TransitionDescriptor {
  readonly side: TransitionSide;
  /** Preset name for lint messages ("FadeInDown", "custom"). */
  readonly preset: string;
  readonly durationFrames: number;
  readonly delayFrames: number;
  readonly easing: Easing;
  /** Springified progress — overrides `easing` when present. */
  readonly spring?: SpringAtOptions;
  readonly channels: PresetChannels;
  /** v0.8 (chain grammar): receive the previous chain segment's terminal
   *  velocity as this segment's initial spring velocity. Only meaningful on
   *  springified segments inside a chain(); see chain.ts. */
  readonly carry?: boolean;
}

/** A preset factory — IS a descriptor (bare use = defaults) AND chainable.
 *
 * Note there is deliberately NO `.easing()` chainable (Reanimated's layout
 * factories don't expose one either — easing belongs to withTiming): presets
 * ship their curve; customize via `.springify()` or `defineTransition({ easing })`.
 */
export interface TransitionFactory extends TransitionDescriptor {
  /** Frames the transition runs for. */
  duration(frames: number): TransitionFactory;
  /** Frames to wait before starting. */
  delay(frames: number): TransitionFactory;
  /** Replace the eased progress with spring physics (preset name or config). */
  springify(config?: SpringPresetName | SpringAtOptions): TransitionFactory;
  /** Spring shorthand — damping. */
  damping(damping: number): TransitionFactory;
  /** Spring shorthand — stiffness. */
  stiffness(stiffness: number): TransitionFactory;
  /** Spring shorthand — mass. */
  mass(mass: number): TransitionFactory;
  /** Spring shorthand — bounce (0 = none, 1 = wild). */
  bounce(bounce: number): TransitionFactory;
  /** Spring shorthand — initial velocity (units/s of progress). */
  velocity(velocity: number): TransitionFactory;
  /** v0.8 — inside a chain(), receive the previous segment's terminal velocity
   *  as this segment's initial spring velocity (motion's withSequence
   *  velocity-continuity shape, opt-in per segment). */
  carryVelocity(): TransitionFactory;
}

class Descriptor implements TransitionFactory {
  readonly side: TransitionSide;
  readonly preset: string;
  readonly durationFrames: number;
  readonly delayFrames: number;
  readonly easing: Easing;
  readonly spring?: SpringAtOptions;
  readonly channels: PresetChannels;
  readonly carry?: boolean;

  constructor(
    side: TransitionSide,
    preset: string,
    channels: PresetChannels,
    durationFrames: number,
    easing: Easing,
    delayFrames = 0,
    spring?: SpringAtOptions,
    carry?: boolean,
  ) {
    this.side = side;
    this.preset = preset;
    this.channels = channels;
    this.durationFrames = durationFrames;
    this.delayFrames = delayFrames;
    this.easing = easing;
    this.spring = spring;
    this.carry = carry;
  }

  private with(fields: Partial<Pick<Descriptor, "durationFrames" | "delayFrames" | "easing" | "spring" | "carry">>): TransitionFactory {
    return Object.assign(
      new Descriptor(this.side, this.preset, this.channels, this.durationFrames, this.easing, this.delayFrames, this.spring, this.carry),
      fields,
    );
  }

  duration(frames: number): TransitionFactory {
    if (!Number.isFinite(frames) || frames <= 0) {
      throw new Error(`Transition .duration() must be a positive frame count, got ${frames}.`);
    }
    return this.with({ durationFrames: frames });
  }
  delay(frames: number): TransitionFactory {
    if (!Number.isFinite(frames) || frames < 0) {
      throw new Error(`Transition .delay() must be a non-negative frame count, got ${frames}.`);
    }
    return this.with({ delayFrames: frames });
  }
  springify(config: SpringPresetName | SpringAtOptions = "snappy"): TransitionFactory {
    const spring = typeof config === "string" ? { ...springPresets[config] } : { ...config };
    return this.with({ spring, easing: "linear" });
  }
  damping(damping: number): TransitionFactory {
    return this.springify({ ...(this.spring ?? springPresets.snappy), damping });
  }
  stiffness(stiffness: number): TransitionFactory {
    return this.springify({ ...(this.spring ?? springPresets.snappy), stiffness });
  }
  mass(mass: number): TransitionFactory {
    return this.springify({ ...(this.spring ?? springPresets.snappy), mass });
  }
  bounce(bounce: number): TransitionFactory {
    return this.springify({ ...(this.spring ?? springPresets.snappy), bounce });
  }
  velocity(velocity: number): TransitionFactory {
    return this.springify({ ...(this.spring ?? springPresets.snappy), velocity });
  }
  carryVelocity(): TransitionFactory {
    return this.with({ carry: true });
  }
}

function definePreset(preset: string, side: TransitionSide, channels: PresetChannels, durationFrames = 20, easing: Easing = "easeOut"): TransitionFactory {
  return new Descriptor(side, preset, channels, durationFrames, easing);
}

// ---------------------------------------------------------------------------
// The preset catalog (2D — takumi's transform subset has no perspective)
// ---------------------------------------------------------------------------

const IN_DISTANCE = 24;
const BIG_DISTANCE = 120;
const SLIDE_DISTANCE = 120;

// -- Enter: fades --
export const FadeIn = definePreset("FadeIn", "enter", { opacity: [0, 1] });
export const FadeInDown = definePreset("FadeInDown", "enter", { opacity: [0, 1], y: [-IN_DISTANCE, 0] });
export const FadeInUp = definePreset("FadeInUp", "enter", { opacity: [0, 1], y: [IN_DISTANCE, 0] });
export const FadeInLeft = definePreset("FadeInLeft", "enter", { opacity: [0, 1], x: [-IN_DISTANCE, 0] });
export const FadeInRight = definePreset("FadeInRight", "enter", { opacity: [0, 1], x: [IN_DISTANCE, 0] });
export const FadeInDownBig = definePreset("FadeInDownBig", "enter", { opacity: [0, 1], y: [-BIG_DISTANCE, 0] });
export const FadeInUpBig = definePreset("FadeInUpBig", "enter", { opacity: [0, 1], y: [BIG_DISTANCE, 0] });
export const FadeInLeftBig = definePreset("FadeInLeftBig", "enter", { opacity: [0, 1], x: [-BIG_DISTANCE, 0] });
export const FadeInRightBig = definePreset("FadeInRightBig", "enter", { opacity: [0, 1], x: [BIG_DISTANCE, 0] });

// -- Enter: zoom / slide / bounce --
export const ZoomIn = definePreset("ZoomIn", "enter", { opacity: [0, 1], scale: [0.6, 1] });
export const SlideInDown = definePreset("SlideInDown", "enter", { y: [-SLIDE_DISTANCE, 0] }, 22);
export const SlideInUp = definePreset("SlideInUp", "enter", { y: [SLIDE_DISTANCE, 0] }, 22);
export const SlideInLeft = definePreset("SlideInLeft", "enter", { x: [-SLIDE_DISTANCE, 0] }, 22);
export const SlideInRight = definePreset("SlideInRight", "enter", { x: [SLIDE_DISTANCE, 0] }, 22);
export const BounceIn = definePreset("BounceIn", "enter", { opacity: [0, 1], scale: [0.5, 1] }, 30, "linear").springify("bouncy");

// -- Exit: fades --
export const FadeOut = definePreset("FadeOut", "exit", { opacity: [1, 0] }, 18, "easeIn");
export const FadeOutDown = definePreset("FadeOutDown", "exit", { opacity: [1, 0], y: [0, IN_DISTANCE] }, 18, "easeIn");
export const FadeOutUp = definePreset("FadeOutUp", "exit", { opacity: [1, 0], y: [0, -IN_DISTANCE] }, 18, "easeIn");
export const FadeOutLeft = definePreset("FadeOutLeft", "exit", { opacity: [1, 0], x: [0, -IN_DISTANCE] }, 18, "easeIn");
export const FadeOutRight = definePreset("FadeOutRight", "exit", { opacity: [1, 0], x: [0, IN_DISTANCE] }, 18, "easeIn");

// -- Exit: zoom / slide / bounce --
export const ZoomOut = definePreset("ZoomOut", "exit", { opacity: [1, 0], scale: [1, 0.6] }, 18, "easeIn");
export const SlideOutDown = definePreset("SlideOutDown", "exit", { y: [0, SLIDE_DISTANCE] }, 20, "easeIn");
export const SlideOutUp = definePreset("SlideOutUp", "exit", { y: [0, -SLIDE_DISTANCE] }, 20, "easeIn");
export const SlideOutLeft = definePreset("SlideOutLeft", "exit", { x: [0, -SLIDE_DISTANCE] }, 20, "easeIn");
export const SlideOutRight = definePreset("SlideOutRight", "exit", { x: [0, SLIDE_DISTANCE] }, 20, "easeIn");
export const BounceOut = definePreset("BounceOut", "exit", { opacity: [1, 0], scale: [1, 0.5] }, 30, "linear").springify("bouncy");

/** All built-in presets — for tooling, docs tables, and the filmstrip UI. */
export const transitionPresets: Record<string, TransitionFactory> = {
  FadeIn, FadeInDown, FadeInUp, FadeInLeft, FadeInRight,
  FadeInDownBig, FadeInUpBig, FadeInLeftBig, FadeInRightBig,
  ZoomIn, SlideInDown, SlideInUp, SlideInLeft, SlideInRight, BounceIn,
  FadeOut, FadeOutDown, FadeOutUp, FadeOutLeft, FadeOutRight,
  ZoomOut, SlideOutDown, SlideOutUp, SlideOutLeft, SlideOutRight, BounceOut,
};

/** Build a custom preset — the escape hatch when the catalog doesn't fit. */
export function defineTransition(options: {
  name?: string;
  side: TransitionSide;
  channels: PresetChannels;
  durationFrames?: number;
  easing?: Easing;
}): TransitionFactory {
  return definePreset(options.name ?? "custom", options.side, options.channels, options.durationFrames ?? 20, options.easing ?? "easeOut");
}

// ---------------------------------------------------------------------------
// Stagger composition
// ---------------------------------------------------------------------------

/**
 * Bake unit `index`'s stagger slot into a copy of the descriptor:
 * `staggered(FadeInDown, 3, { intervalFrames: 2 })` enters 6 frames after
 * unit 0. Pure — the original descriptor is untouched.
 */
export function staggered(
  factory: TransitionFactory,
  index: number,
  options: StaggerOptions = {},
): TransitionFactory {
  return factory.delay(staggerDelay(index, options));
}

/**
 * v0.8 — the EXIT-side cascade: unit 0 leaves first, unit `index` leaves
 * `(count - 1 - index) × intervalFrames` earlier… and every unit still lands
 * hidden exactly at the scene's close (exit descriptors anchor to the window
 * end, so extra delay moves the START earlier, not the end later).
 *
 * ```tsx
 * {lines.map((line, i) => (
 *   <Animated key={i} exiting={cascadeExit(FadeOutRight, i, lines.length, { intervalFrames: 3 })}>
 *     {line}
 *   </Animated>
 * ))}
 * ```
 */
export function cascadeExit(
  factory: TransitionFactory,
  index: number,
  count: number,
  options: StaggerOptions = {},
): TransitionFactory {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`cascadeExit: count must be a positive integer, got ${count}.`);
  }
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`cascadeExit: index must be an integer in [0, ${count - 1}], got ${index}.`);
  }
  const intervalFrames = options.intervalFrames ?? 2;
  const startFrames = options.startFrames ?? 0;
  if (!Number.isFinite(intervalFrames) || intervalFrames < 0) {
    throw new Error(`cascadeExit: intervalFrames must be a non-negative number, got ${intervalFrames}.`);
  }
  return factory.delay(startFrames + (count - 1 - index) * intervalFrames);
}

// ---------------------------------------------------------------------------
// Resolution — (descriptor, frame, context) → styles | null
// ---------------------------------------------------------------------------

export interface TransitionContext {
  fps: number;
  /** The enclosing scene's (or layer's) full duration in frames. */
  totalFrames: number;
}

export interface ResolvedTransition {
  opacity?: number;
  transform?: string;
}

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function composeTransform(channels: PresetChannels, p: number): string | undefined {
  const parts: string[] = [];
  if (channels.x) parts.push(`translateX(${r6(lerp(channels.x[0], channels.x[1], p))}px)`);
  if (channels.y) parts.push(`translateY(${r6(lerp(channels.y[0], channels.y[1], p))}px)`);
  if (channels.rotate) parts.push(`rotate(${r6(lerp(channels.rotate[0], channels.rotate[1], p))}deg)`);
  if (channels.scale) parts.push(`scale(${r6(lerp(channels.scale[0], channels.scale[1], p))})`);
  if (parts.length === 0) return undefined;
  return parts.join(" ");
}

function progressAt(desc: TransitionDescriptor, frame: number, ctx: TransitionContext): number {
  if (desc.spring) {
    // Spring progress 0→1; delayFrames lives on the descriptor.
    return springFor(frame, ctx.fps, {
      ...desc.spring,
      from: 0,
      to: 1,
      delayFrames: desc.delayFrames,
    });
  }
  const raw = clamp01((frame - desc.delayFrames) / desc.durationFrames);
  return easingDefinitionToFunction(desc.easing)(raw);
}

/** The frame the transition's motion BEGINS at (for exits: within the scene window). */
export function transitionStartFrame(desc: TransitionDescriptor, ctx: TransitionContext): number {
  const nominal = desc.spring ? springSettleFrames(ctx.fps, { ...desc.spring, from: 0, to: 1, delayFrames: 0 }) : desc.durationFrames;
  return desc.side === "enter"
    ? desc.delayFrames
    : ctx.totalFrames - desc.delayFrames - nominal;
}

/** The frame the transition is visually DONE by (may exceed totalFrames — that's the lint's job). */
export function transitionEndFrame(desc: TransitionDescriptor, ctx: TransitionContext): number {
  const nominal = desc.spring ? springSettleFrames(ctx.fps, { ...desc.spring, from: 0, to: 1, delayFrames: 0 }) : desc.durationFrames;
  return transitionStartFrame(desc, ctx) + nominal;
}

/**
 * Resolve a descriptor at `frame`. Returns null once the transition is fully
 * settled (enter: past its end; exit: before its start) — null means "no
 * override", which keeps the element's style stable so identical frames
 * chunk-merge. Before an ENTER's start it returns the FULL start state
 * (opacity 0 etc. — the element is hidden, not absent).
 */
export function resolveTransitionAtFrame(
  desc: TransitionDescriptor,
  frame: number,
  ctx: TransitionContext,
): ResolvedTransition | null {
  const { channels } = desc;

  if (desc.side === "enter") {
    const end = desc.delayFrames + (desc.spring ? springSettleFrames(ctx.fps, { ...desc.spring, from: 0, to: 1, delayFrames: 0 }) : desc.durationFrames);
    if (frame >= end) return null;
    const p = progressAt(desc, frame, ctx);
    return applyChannels(channels, p);
  }

  // exit — anchored so it ENDS exactly at the scene window close.
  const start = transitionStartFrame(desc, ctx);
  if (frame < start) return null;
  const nominal = desc.spring ? springSettleFrames(ctx.fps, { ...desc.spring, from: 0, to: 1, delayFrames: 0 }) : desc.durationFrames;
  // Spring progress starts its own clock at the exit start (the descriptor's
  // delayFrames was already consumed by `start` — don't apply it twice).
  const eased = desc.spring
    ? springFor(frame - start, ctx.fps, { ...desc.spring, from: 0, to: 1 })
    : easingDefinitionToFunction(desc.easing)(clamp01((frame - start) / Math.max(1, nominal)));
  return applyChannels(channels, eased);
}

/** @internal — exported for chain.ts's hold-state resolution. */
export function applyChannels(channels: PresetChannels, p: number): ResolvedTransition {
  const out: ResolvedTransition = {};
  if (channels.opacity) out.opacity = r6(clamp01(lerp(channels.opacity[0], channels.opacity[1], p)));
  const transform = composeTransform(channels, p);
  if (transform) out.transform = transform;
  return out;
}

// ---------------------------------------------------------------------------
// Settle diagnosis (feeds the TM_TRANSITION_UNSETTLED lint)
// ---------------------------------------------------------------------------

/**
 * Human-readable reason the transition cannot complete within the scene
 * window, or null when it fits. Evaluated ONCE per descriptor at the scene's
 * final frame (see <Animated>) — never per frame.
 */
export function transitionSettleIssue(desc: TransitionDescriptor, ctx: TransitionContext): string | null {
  const start = transitionStartFrame(desc, ctx);
  const end = transitionEndFrame(desc, ctx);
  const kind = desc.spring ? "spring" : "duration";
  const nominal = end - start;
  if (desc.side === "enter" && end > ctx.totalFrames) {
    return `${desc.preset} (${kind} ${kind === "spring" ? `settle ≈${nominal}f` : `${nominal}f`}${desc.delayFrames ? ` + ${desc.delayFrames}f delay` : ""}) is still moving at the scene's last frame (${ctx.totalFrames}f).`;
  }
  if (desc.side === "exit" && start < 0) {
    return `${desc.preset} (${kind} ${nominal}f${desc.delayFrames ? ` + ${desc.delayFrames}f delay` : ""}) would need to start ${-start}f before the scene begins — the exit is cut mid-motion at frame 0.`;
  }
  return null;
}
