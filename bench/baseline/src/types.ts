// takumi-motion — types.ts
// Authoring types (Motion-compatible surface) + Takumi Timeline JSON v1 (interchange format).
// The Timeline JSON is the RFC's proposed interchange artifact: JS declares it,
// a Rust-native clock (today: Takumi's CSS keyframes engine at time_ms) evaluates it.

export type EasingName =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "circIn"
  | "circOut"
  | "circInOut"
  | "backIn"
  | "backOut"
  | "backInOut"
  | "bounceIn"
  | "bounceOut"
  | "bounceInOut"
  | "anticipate";

export type BezierDefinition = [number, number, number, number];

export type StepsDefinition = { steps: number; direction: "start" | "end" };

export type Easing = EasingName | BezierDefinition | StepsDefinition | ((p: number) => number);

export interface SpringTransition {
  type: "spring";
  stiffness?: number;
  damping?: number;
  mass?: number;
  /** ms at the timeline layer (Motion's public API uses seconds; animate() converts). */
  duration?: number;
  bounce?: number;
  visualDuration?: number;
  /** Initial velocity in units/second. */
  velocity?: number;
  restSpeed?: number;
  restDelta?: number;
}

export interface TweenTransition {
  type: "tween";
  /** ms. Defaults: 800ms for >2 keyframes, 300ms otherwise. */
  duration?: number;
  ease?: Easing | Easing[];
}

export interface InertiaTransition {
  type: "inertia";
  velocity: number;
  power?: number;
  timeConstant?: number;
  bounceStiffness?: number;
  bounceDamping?: number;
  min?: number;
  max?: number;
  restDelta?: number;
}

export type Transition = SpringTransition | TweenTransition | InertiaTransition;

export interface PlaybackOptions {
  /** Delay before the animation starts, ms. */
  delay?: number;
  /** Extra repeats after the first play. Infinity = loop forever. */
  repeat?: number;
  repeatType?: "loop" | "reverse" | "mirror";
  /** Pause between repeats, ms. */
  repeatDelay?: number;
}

export type TransitionWithOptions = Transition & PlaybackOptions;

/** Motion-style keyframes: [from, to] (multi-stop allowed). `null` = "use the element's base style". */
export type KeyframesDefinition = (number | string | null)[];

/** Motion-style independent transform / CSS property names. */
export type AnimatableProperty =
  | "x" | "y" | "scale" | "scaleX" | "scaleY" | "rotate" | "skew" | "skewX" | "skewY"
  | "opacity"
  | "backgroundColor" | "color" | "borderColor"
  | "width" | "height" | "borderRadius" | "letterSpacing" | "fontSize" | "fontWeight"
  | "boxShadow" | "textShadow" | "filter" | "backgroundImage"
  | (string & {});

export interface TrackJSON {
  /** CSS selector for the target node (`.class`, `#id`, `div`, ...). */
  target: string;
  property: AnimatableProperty;
  keyframes: (number | string | null)[];
  /** 0–1 offsets; defaults to evenly spaced. */
  times?: number[];
  transition: TransitionWithOptions;
  /** Per-segment ease for tween tracks (overridden by transition.ease). */
  ease?: Easing | Easing[];
}

/**
 * Takumi Timeline JSON v1 — the declarative interchange format.
 * Declared by JS, evaluated by a Rust-native clock.
 */
export interface TimelineJSON {
  version: 1;
  /** Total timeline duration in ms (max track end, frame-grid aligned). */
  durationMs: number;
  tracks: TrackJSON[];
  /** Authoring metadata from fadeWrap(): the root selector whose opacity masks the loop seam.
   *  Ignored by compile/evaluate; read by checkLoopSeam to switch to masked mode. */
  wrap?: { selector: string };
}

/** A React-shaped element (React, Preact, or any compatible runtime). */
export interface ReactElementLike {
  type: string | symbol | ((props: never) => unknown) | (new (props: never) => unknown) | ReactElementLike;
  props: Record<string, unknown>;
  $$typeof?: symbol | string;
}

export type TimelineTarget = string | string[] | ReactElementLike;

export interface AddOptions extends PlaybackOptions {
  /** Position on the timeline: absolute ms, "<" (previous end), "<+200", "<-100", or a label. */
  at?: number | "<" | string;
  /** Stagger delay added per target when an array of selectors is given. */
  stagger?: number;
  /** Keyframe offsets (0–1) for multi-stop keyframes, applied to the emitted track(s). */
  times?: number[];
  [transitionKey: string]: unknown;
}

export interface TimelineOptions {
  defaultTransition?: TransitionWithOptions;
  /** Round durationMs up to this fps grid (for frame-exact loops). Default 30. */
  fps?: number;
}
