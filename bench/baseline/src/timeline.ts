// takumi-motion — timeline.ts
// Motion-compatible authoring API: createTimeline() with sequence-style `at`
// positions, springs/inertia/tweens, repeats, staggers, and React element
// targets (auto classed via clone).

import type {
  AddOptions,
  AnimatableProperty,
  KeyframesDefinition,
  ReactElementLike,
  TimelineJSON,
  TimelineOptions,
  TimelineTarget,
  TrackJSON,
  TransitionWithOptions,
} from "./types.js";
import { springDefaults } from "./spring.js";
import { isTransformProp } from "./transform.js";
import { resolveTrack } from "./sampler.js";

const TRANSFORM_PROPS_DEFAULTS: Record<string, number> = {
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, skew: 0, skewX: 0, skewY: 0,
};

const isReactElement = (t: unknown): t is ReactElementLike =>
  typeof t === "object" && t !== null && "type" in (t as object) && "props" in (t as object);

/**
 * Motion's getDefaultTransition table (motion-dom animation/utils/default-transitions.ts).
 * scale → critically damped spring 550; other transforms → spring 500/25;
 * >2 keyframes → 800ms; everything else → 300ms with Motion's signature ease.
 */
export function getDefaultTransition(
  property: string,
  keyframes: KeyframesDefinition
): TransitionWithOptions {
  if (keyframes.length > 2) {
    return { type: "tween", duration: 800 };
  }
  if (isTransformProp(property)) {
    if (property.startsWith("scale")) {
      const target = keyframes[keyframes.length - 1];
      return {
        type: "spring",
        stiffness: 550,
        damping: target === 0 ? 2 * Math.sqrt(550) : 30,
        restSpeed: 10,
      };
    }
    return { type: "spring", stiffness: 500, damping: 25, restSpeed: 10 };
  }
  return { type: "tween", ease: [0.25, 0.1, 0.35, 1], duration: 300 };
}

export interface Timeline {
  /** Add an animation. Returns the (classed) element when a React element target is given. */
  add(
    target: TimelineTarget,
    keyframes: Partial<Record<AnimatableProperty, KeyframesDefinition>>,
    options?: AddOptions
  ): TimelineTarget | TimelineTarget[];
  /** Label a position on the timeline for later `at` references. */
  label(name: string): void;
  toJSON(): TimelineJSON;
  /** All selectors this timeline animates, in first-seen order. */
  targets(): string[];
}

export function createTimeline(options: TimelineOptions = {}): Timeline {
  const fps = options.fps ?? 30;
  const tracks: TrackJSON[] = [];
  const classByElement = new WeakMap<object, string>();
  let autoId = 0;
  let lastAt = 0;
  const labels = new Map<string, number>();

  const resolveAt = (at: AddOptions["at"] | undefined): number => {
    if (at === undefined || at === "<") return lastAt;
    if (typeof at === "number") return at;
    if (at.startsWith("<+")) return lastAt + parseFloat(at.slice(2));
    if (at.startsWith("<-")) return Math.max(0, lastAt - parseFloat(at.slice(2)));
    if (labels.has(at)) return labels.get(at) as number;
    const parsed = parseFloat(at);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid 'at' position: '${at}'. Use ms, "<", "<+n", "<-n" or a label.`);
    }
    return parsed;
  };

  const selectorFor = (target: TimelineTarget): { selector: string; replaced?: TimelineTarget } => {
    if (typeof target === "string") return { selector: target };
    if (Array.isArray(target)) {
      throw new Error("Array targets must be handled via add() iteration, not selectorFor");
    }
    if (isReactElement(target)) {
      const existing = classByElement.get(target as unknown as object);
      if (existing) return { selector: existing, replaced: target };
      const cls = `tm-${++autoId}`;
      const props = target.props as Record<string, unknown>;
      const className = [props.className as string | undefined, cls].filter(Boolean).join(" ");
      const replaced = {
        ...target,
        props: { ...props, className },
      } as ReactElementLike;
      classByElement.set(replaced as unknown as object, `.${cls}`);
      return { selector: `.${cls}`, replaced };
    }
    throw new Error(`Unsupported timeline target: ${typeof target}`);
  };

  const add = (
    target: TimelineTarget,
    keyframes: Partial<Record<AnimatableProperty, KeyframesDefinition>>,
    opts: AddOptions = {}
  ): TimelineTarget | TimelineTarget[] => {
    const at = resolveAt(opts.at);
    lastAt = at;
    const stagger = opts.stagger ?? 0;

    let selectors: string[];
    let replacedOut: TimelineTarget | undefined;

    if (Array.isArray(target)) {
      selectors = target.map((t) => {
        if (typeof t !== "string") throw new Error("Array targets may only contain selectors in v0");
        return t;
      });
    } else {
      const { selector, replaced } = selectorFor(target);
      selectors = [selector];
      replacedOut = replaced;
    }

    selectors.forEach((selector, targetIndex) => {
      const staggerDelay = targetIndex * stagger;
      for (const [property, kf] of Object.entries(keyframes)) {
        if (!Array.isArray(kf)) {
          throw new Error(
            `Property '${property}': keyframes must be an array like [from, to] (single values would require reading the element's current style, which a static renderer cannot do).`
          );
        }
        const defaultTransition = getDefaultTransition(property, kf);
        const transition: TransitionWithOptions = {
          ...defaultTransition,
          ...(options.defaultTransition ?? {}),
          ...stripAt(opts),
        } as TransitionWithOptions;

        const track: TrackJSON = {
          target: selector,
          property,
          keyframes: kf as (number | string | null)[],
          transition: {
            ...transition,
            delay: at + (transition.delay ?? 0) + staggerDelay + (opts.delay ?? 0),
          },
        };
        if (opts.times) track.times = [...opts.times];
        if (property === "x" || property === "y") {
          // numerics only — enforced at sample time for springs
        }
        tracks.push(track);
      }
    });

    void springDefaults; // keep import parity with motion defaults documentation
    return Array.isArray(target) ? selectors : (replacedOut ?? target);
  };

  const stripAt = (opts: AddOptions): Partial<AddOptions> => {
    const { at, stagger, times, ...rest } = opts;
    void at;
    void stagger;
    void times;
    return rest;
  };

  return {
    add,
    label: (name: string) => {
      labels.set(name, lastAt);
    },
    targets: () => [...new Set(tracks.map((t) => t.target))],
    toJSON: (): TimelineJSON => {
      // durationMs = max track end, rounded up to the fps grid
      let maxEnd = 0;
      for (const t of tracks) {
        const tr = t.transition as TransitionWithOptions;
        void tr;
        maxEnd = Math.max(maxEnd, trackEndMs(t));
      }
      const frameMs = 1000 / fps;
      const durationMs = Math.ceil(maxEnd / frameMs) * frameMs;
      return { version: 1, durationMs, tracks: [...tracks] };
    },
  };
}

/** Track end in ms (delay + unrolled repeats), resolving spring/inertia settle times.
 *  Infinite repeats contribute one iteration (+ repeatDelay) — they loop via CSS
 *  iteration-count, so the scene duration only needs to cover their first pass. */
export function trackEndMs(track: TrackJSON): number {
  const resolved = resolveTrack(track);
  const transition = track.transition as TransitionWithOptions;
  const delay = transition.delay ?? 0;
  const span = Number.isFinite(resolved.totalMs)
    ? resolved.totalMs
    : resolved.iterationMs + resolved.repeatDelayMs;
  return delay + span;
}
