// takumi-motion — react/animated.tsx (v0.7)
// The declarative motion wrappers: <Animated> (entering/exiting) and
// <Keyframes> (multi-stop), plus the useEntering/useExiting hooks.
//
// Both are RUNTIME components inside a <Scene> (FrameContext): per frame they
// resolve pure descriptors to style overrides and merge them under the user's
// style. Resolution is O(props) small math with r6 rounding — byte-identical
// frames chunk-merge, and settled frames emit NO overrides at all (null), so
// a settled <Animated> is style-stable and free.
//
// The scene-end settle check (TM_TRANSITION_UNSETTLED) runs exactly once per
// capture — at the scene's final frame — and pushes into the registry lint
// channel that captureReactBanner drains into report.lint.

import { createElement, useContext, type ReactNode } from "react";
import { DriverContext, useFrame, type DriverInfo } from "./context.js";
import {
  resolveTransitionAtFrame,
  transitionSettleIssue,
  type ResolvedTransition,
  type TransitionContext,
  type TransitionDescriptor,
} from "./enter-exit.js";
import {
  isChainDescriptor,
  resolveChainAtFrame,
  chainSettleIssue,
  chainVelocityIssues,
  type ChainDescriptor,
} from "./chain.js";
import { mixColor, parseColor, type ColorSpace } from "../color.js";
import { getEasingForSegment } from "../easing.js";
import type { LintWarning } from "../lint.js";
import type { TakumiStyle } from "../style.js";
import type { Easing } from "../types.js";

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function transitionContextOf(fps: number, totalFrames: number): TransitionContext {
  return { fps, totalFrames };
}

/** Merge resolved overrides UNDER the user's style (motion wins while moving). */
function mergeStyles(
  style: TakumiStyle | undefined,
  resolved: ResolvedTransition | null,
  resolved2?: ResolvedTransition | null,
): TakumiStyle | undefined {
  const overrides: Record<string, string | number> = {};
  for (const res of [resolved, resolved2]) {
    if (!res) continue;
    if (res.opacity !== undefined) overrides.opacity = res.opacity;
    if (res.transform !== undefined) overrides.transform = res.transform;
  }
  if (Object.keys(overrides).length === 0) return style;
  return { ...(style ?? {}), ...overrides } as TakumiStyle;
}

function pushLint(driver: DriverInfo | null, warning: LintWarning): void {
  if (!driver) return;
  const store = driver.registry as { lints?: LintWarning[] };
  store.lints ??= [];
  store.lints.push(warning);
}

/** Resolve either descriptor kind at `frame` — plain presets and chains. */
function resolveDescriptor(
  desc: TransitionDescriptor | ChainDescriptor,
  frame: number,
  ctx: TransitionContext,
): ResolvedTransition | null {
  return isChainDescriptor(desc)
    ? resolveChainAtFrame(desc, frame, ctx)
    : resolveTransitionAtFrame(desc, frame, ctx);
}

/** Preset name for lint messages (chains carry their composed name). */
function presetOf(desc: TransitionDescriptor | ChainDescriptor): string {
  return desc.preset;
}

// ---------------------------------------------------------------------------
// <Animated> — entering / exiting
// ---------------------------------------------------------------------------

export interface AnimatedProps {
  /** How the subtree ARRIVES. Defaults: 20f easeOut. A chain() composite works too. */
  entering?: TransitionDescriptor | ChainDescriptor;
  /** How the subtree LEAVES — anchored to the enclosing scene's end. */
  exiting?: TransitionDescriptor | ChainDescriptor;
  /** Merged under the per-frame overrides. */
  style?: TakumiStyle;
  children?: ReactNode;
}

/**
 * Declarative enter/exit wrapper — the Reanimated `entering`/`exiting` props,
 * frame-indexed and deterministic:
 *
 * ```tsx
 * <Scene duration={60}>
 *   <Animated entering={FadeInDown.duration(18).delay(4)} exiting={FadeOutLeft}>
 *     <Hero />
 *   </Animated>
 * </Scene>
 * ```
 *
 * - `entering` resolves from scene-local frame 0; before it starts the subtree
 *   renders at the descriptor's start state (hidden), after it settles the
 *   wrapper emits NO overrides (chunk-merge stays effective).
 * - `exiting` is anchored so it ENDS exactly as the scene window closes.
 * - While both run (short scene), exiting wins on shared channels.
 * - The wrapper is a plain div — put transforms you animate yourself on an
 *   inner element, not on <Animated style>.
 *
 * At the scene's final frame the settle check runs once: a transition that
 * cannot complete within the scene window becomes a TM_TRANSITION_UNSETTLED
 * warning in report.lint.
 */
export function Animated(props: AnimatedProps): ReactNode {
  const { frame, sceneFrames, fps } = useFrame();
  const driver = useContext(DriverContext);
  const ctx = transitionContextOf(fps, sceneFrames);

  if (frame === sceneFrames - 1) {
    // Scene-final pass: diagnose both descriptors once (spring settles use
    // the memoized solver — cost is one Map lookup per descriptor).
    for (const desc of [props.entering, props.exiting]) {
      if (!desc) continue;
      const preset = presetOf(desc);
      if (isChainDescriptor(desc)) {
        const issue = chainSettleIssue(desc, ctx);
        if (issue) {
          pushLint(driver, {
            code: "TM_TRANSITION_UNSETTLED",
            message: `<Animated ${desc.side}="${preset}"> ${issue}`,
            hint:
              desc.side === "enter"
                ? "Give the scene more frames, shorten a segment (.duration()), shrink a hold, or reduce delays."
                : "Shorten segments/holds or extend the scene so the exit chain fits inside the window.",
            severity: "warn",
          });
        }
        for (const dropped of chainVelocityIssues(desc)) {
          pushLint(driver, {
            code: "TM_VELOCITY_DROPPED",
            message: `<Animated ${desc.side}="${preset}"> ${dropped}`,
            hint: "carryVelocity() hands momentum between segments — make the receiver springified and the producer cut short, or drop the request.",
            severity: "info",
          });
        }
        continue;
      }
      const issue = transitionSettleIssue(desc, ctx);
      if (issue) {
        pushLint(driver, {
          code: "TM_TRANSITION_UNSETTLED",
          message: `<Animated ${desc.side}="${preset}"> ${issue}`,
          hint:
            desc.side === "enter"
              ? "Give the scene more frames, shorten the transition (.duration()), or reduce .delay()."
              : "Shorten the exit (.duration()), reduce .delay(), or extend the scene so the exit starts inside the window.",
          severity: "warn",
        });
      }
    }
  }

  const entering = props.entering ? resolveDescriptor(props.entering, frame, ctx) : null;
  const exiting = props.exiting ? resolveDescriptor(props.exiting, frame, ctx) : null;
  const style = mergeStyles(props.style, entering, exiting);

  return createElement("div", { style }, props.children);
}

// ---------------------------------------------------------------------------
// Hooks — for applying descriptors to YOUR OWN elements
// ---------------------------------------------------------------------------

/** Resolve an entering descriptor (or chain) at the current frame → overrides | null. */
export function useEntering(desc: TransitionDescriptor | ChainDescriptor): ResolvedTransition | null {
  const { frame, sceneFrames, fps } = useFrame();
  return resolveDescriptor(desc, frame, transitionContextOf(fps, sceneFrames));
}

/** Resolve an exiting descriptor (or chain) at the current frame → overrides | null. */
export function useExiting(desc: TransitionDescriptor | ChainDescriptor): ResolvedTransition | null {
  const { frame, sceneFrames, fps } = useFrame();
  return resolveDescriptor(desc, frame, transitionContextOf(fps, sceneFrames));
}

// ---------------------------------------------------------------------------
// <Keyframes> — declarative multi-stop animation
// ---------------------------------------------------------------------------

/** Per-stop transform channels (x/y px, scale uniform, rotate deg). */
export interface KeyframeTransform {
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
}

/** One stop's value: number (lerped), color string (space-interpolated), verbatim string, or transform channels. */
export type KeyframeValue = number | string | KeyframeTransform;

/** A stop: properties + optional easing INTO this stop (Reanimated semantics). */
export type KeyframeStop = { easing?: Easing } & Record<string, KeyframeValue>;

export interface KeyframesProps {
  /** Frame-keyed stops: { 0: {opacity: 0, y: -24}, 45: {opacity: 1, easing: "backOut"} }. */
  frames: Record<number, KeyframeStop>;
  /** Merged under the per-frame overrides. */
  style?: TakumiStyle;
  /** Color interpolation space for color strings. Default "oklch". */
  space?: ColorSpace;
  children?: ReactNode;
}

interface ParsedStop {
  frame: number;
  easing: Easing;
  props: Map<string, KeyframeValue>;
}

interface ParsedStops {
  stops: ParsedStop[];
  hasTransform: boolean;
  props: Set<string>;
}

const TRANSFORM_KEYS = new Set(["x", "y", "scale", "scaleX", "scaleY", "rotate"]);
const DEFAULT_EASING: Easing = "easeInOut";
const TRANSFORM_DEFAULTS = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1 };

/**
 * Parse-once cache keyed by the AUTHORING OBJECT identity — the frames prop is
 * expected to be module-level or useMemo'd; a fresh object per render would
 * reparse (the WeakMap holds nothing). Parsing is authoring-time cost; the
 * per-frame resolve only walks the parsed structure.
 */
const parsedCache = new WeakMap<object, ParsedStops>();

/** Parse + cache the stops. Exported for tests — internal otherwise. */
export function parseKeyframes(frames: Record<number, KeyframeStop>): ParsedStops {
  const cached = parsedCache.get(frames);
  if (cached) return cached;

  const frameKeys = Object.keys(frames)
    .map(Number)
    .filter((f) => Number.isInteger(f) && f >= 0)
    .sort((a, b) => a - b);
  if (frameKeys.length === 0) {
    throw new Error("<Keyframes>: frames must have at least one integer-keyed stop (e.g. { 0: {…} }).");
  }

  const stops: ParsedStop[] = frameKeys.map((f) => {
    const { easing, ...rest } = frames[f] ?? {};
    const props = new Map<string, KeyframeValue>();
    for (const [key, value] of Object.entries(rest)) {
      if (key === "easing") continue;
      props.set(key, value);
    }
    // scale → scaleX/scaleY (uniform part becomes two interpolatable parts).
    if (props.get("scale") !== undefined) {
      const s = props.get("scale") as number;
      props.delete("scale");
      if (props.get("scaleX") === undefined) props.set("scaleX", s);
      if (props.get("scaleY") === undefined) props.set("scaleY", s);
    }
    return { frame: f, easing: easing ?? DEFAULT_EASING, props };
  });

  const propNames = new Set<string>();
  for (const stop of stops) {
    for (const key of stop.props.keys()) propNames.add(key);
  }

  const parsed: ParsedStops = {
    stops,
    hasTransform: [...propNames].some((key) => TRANSFORM_KEYS.has(key)),
    props: propNames,
  };
  parsedCache.set(frames, parsed);
  return parsed;
}

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Last stop declaring `key` at or before `index`; null when none. */
function lastDeclaring(stops: ParsedStop[], index: number, key: string): ParsedStop | null {
  for (let j = index; j >= 0; j--) {
    if (stops[j].props.has(key)) return stops[j];
  }
  return null;
}

/** First stop declaring `key` after `index`; null when none. */
function nextDeclaring(stops: ParsedStop[], index: number, key: string): ParsedStop | null {
  for (let j = index + 1; j < stops.length; j++) {
    if (stops[j].props.has(key)) return stops[j];
  }
  return null;
}

/**
 * Declarative multi-stop animation — the `<Keyframes>` component (the
 * Reanimated Keyframe / CSS-@keyframes shape, resolved to per-frame styles):
 *
 * ```tsx
 * <Keyframes
 *   frames={{
 *     0:  { opacity: 0, y: -24, easing: "easeOut" },
 *     30: { opacity: 1, y: 0 },
 *     50: { opacity: 1 },                       // hold
 *     60: { opacity: 0, y: 24, easing: "easeIn" },
 *   }}
 * >
 *   <Line />
 * </Keyframes>
 * ```
 *
 * Semantics (CSS-keyframes flavored):
 * - properties FILL FORWARD — a property declared at stop N holds its value
 *   across stops that don't declare it;
 * - `easing` on a stop applies to the segment ARRIVING at that stop (each
 *   property's own segment — fill-forward spans keep their own timing);
 * - numbers lerp; colors mix in the given space (default OKLCH); transform
 *   channels interpolate part-wise; any other string is verbatim (hold);
 * - before the first / after the last declaring stop the nearest value holds.
 */
export function Keyframes(props: KeyframesProps): ReactNode {
  const { frame } = useFrame();
  const parsed = parseKeyframes(props.frames);
  const { stops } = parsed;

  // Index of the segment containing `frame` (last stop with frame ≤ current).
  let index = 0;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].frame <= frame) index = i;
  }

  const style: Record<string, string | number> = {};
  const transformParts: string[] = [];

  for (const key of parsed.props) {
    if (TRANSFORM_KEYS.has(key)) continue;

    const left = lastDeclaring(stops, index, key);
    if (!left) continue; // unreachable — propNames only contains declaring stops
    const right = nextDeclaring(stops, index, key);

    if (!right || frame <= left.frame) {
      // Before first declaration / after last declaration / exactly on a stop.
      applyStatic(style, key, left.props.get(key) as KeyframeValue, props.space);
      continue;
    }

    const from = left.props.get(key) as KeyframeValue;
    const to = right.props.get(key) as KeyframeValue;
    if (typeof from !== typeof to) {
      // Mixed categories: hold the earlier value (no cross-type morphing).
      applyStatic(style, key, from, props.space);
      continue;
    }

    const span = right.frame - left.frame;
    const raw = span === 0 ? 1 : (frame - left.frame) / span;
    const eased = getEasingForSegment(right.easing, 0)(Math.min(1, Math.max(0, raw)));

    if (typeof from === "number" && typeof to === "number") {
      style[key] = r6(lerp(from, to, eased));
    } else if (typeof from === "string" && typeof to === "string") {
      const la = parseColor(from);
      const ra = parseColor(to);
      style[key] = la && ra ? mixColor(from, to, eased, { space: props.space }) : from;
    }
  }

  // Transform channels: part-wise over each part's own declaring span.
  if (parsed.hasTransform) {
    const resolved: { x: number; y: number; rotate: number; scaleX: number; scaleY: number } = { ...TRANSFORM_DEFAULTS };
    for (const key of TRANSFORM_KEYS) {
      const left = lastDeclaring(stops, index, key);
      if (!left) continue;
      const right = nextDeclaring(stops, index, key);
      const from = left.props.get(key) as number | undefined;
      if (from === undefined) continue;

      if (!right) {
        resolved[key as keyof typeof resolved] = from as never;
        continue;
      }
      const to = right.props.get(key) as number;
      const span = right.frame - left.frame;
      const raw = span === 0 ? 1 : (frame - left.frame) / span;
      const eased = getEasingForSegment(right.easing, 0)(Math.min(1, Math.max(0, raw)));
      resolved[key as keyof typeof resolved] = r6(lerp(from, to, eased)) as never;
    }
    if (resolved.x !== 0) transformParts.push(`translateX(${resolved.x}px)`);
    if (resolved.y !== 0) transformParts.push(`translateY(${resolved.y}px)`);
    if (resolved.rotate !== 0) transformParts.push(`rotate(${resolved.rotate}deg)`);
    if (resolved.scaleX !== 1 || resolved.scaleY !== 1) {
      transformParts.push(
        resolved.scaleX === resolved.scaleY
          ? `scale(${resolved.scaleX})`
          : `scale(${resolved.scaleX}, ${resolved.scaleY})`,
      );
    }
  }

  const outStyle: TakumiStyle = {
    ...(props.style ?? {}),
    ...(style as TakumiStyle),
    ...(transformParts.length > 0 ? { transform: transformParts.join(" ") } : {}),
  } as TakumiStyle;

  return createElement("div", { style: outStyle }, props.children);
}

function applyStatic(
  style: Record<string, string | number>,
  key: string,
  value: KeyframeValue,
  space?: ColorSpace,
): void {
  if (typeof value === "number") {
    style[key] = r6(value);
  } else if (typeof value === "string") {
    const rgba = parseColor(value);
    // Colors hold as their normalized rgb() form so chunk-merge sees stable
    // strings; non-colors pass through verbatim.
    style[key] = rgba ? mixColor(value, value, 0, { space: space ?? "oklch" }) : value;
  }
  // Transform objects are handled by the part-wise walker.
}
