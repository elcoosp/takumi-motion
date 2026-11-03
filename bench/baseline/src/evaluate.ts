// takumi-motion — evaluate.ts
// TypeScript reference evaluator: (timeline, tMs) → per-target style map.
// Used for tests, live preview, and as the semantic spec for the Rust-native
// clock proposed in the RFC.

import { resolveTrack, sampleTrackAt, type ResolvedTrack } from "./sampler.js";
import { buildTransform, cssPropertyFor, valueToCss, isTransformProp, type TransformProp } from "./transform.js";
import type { TimelineJSON } from "./types.js";

export interface EvaluateOptions {
  /** Supplies values for `null` keyframes ("use base style"). */
  resolveBase?: (target: string, prop: string) => number | string | undefined;
  /** If true, return raw numbers for transform props instead of a composed transform string. */
  rawTransforms?: boolean;
}

export type EvaluatedStyles = Record<string, Record<string, number | string>>;

/**
 * Evaluate the timeline at time tMs → Map of target selector → CSS property → value.
 * Transform props are composed into a single `transform` string per target,
 * mirroring Motion's buildTransform.
 */
export function evaluateAt(timeline: TimelineJSON, tMs: number, options: EvaluateOptions = {}): EvaluatedStyles {
  const resolved: ResolvedTrack[] = timeline.tracks.map((t) => resolveTrack(t, options.resolveBase));
  const out: EvaluatedStyles = {};

  // group transform tracks per target
  const transformPropsByTarget = new Map<string, Set<TransformProp>>();
  for (const track of resolved) {
    if (!track.isTransform) continue;
    let set = transformPropsByTarget.get(track.target);
    if (!set) {
      set = new Set();
      transformPropsByTarget.set(track.target, set);
    }
    set.add(track.property as TransformProp);
  }

  for (const track of resolved) {
    const t = tMs - track.delayMs;
    const value = sampleTrackAt(track, t);

    if (track.isTransform && !options.rawTransforms) continue; // composed below
    const style = (out[track.target] ??= {});
    if (!track.isTransform) {
      style[cssPropertyFor(track.property)] = typeof value === "number" ? valueToCss(track.property, value) : value;
    } else {
      style[track.property] = value; // raw transforms mode
    }
  }

  if (!options.rawTransforms) {
    for (const [target, props] of transformPropsByTarget) {
      const style = (out[target] ??= {});
      const values: Partial<Record<TransformProp, number | string>> = {};
      for (const prop of props) {
        const track = resolved.find((r) => r.target === target && r.property === prop)!;
        values[prop] = sampleTrackAt(track, tMs - track.delayMs);
      }
      style.transform = buildTransform(values);
    }
  }

  return out;
}

/** Total duration helper (mirrors timeline.toJSON's frame-aligned duration). */
export function timelineDurationMs(timeline: TimelineJSON): number {
  return timeline.durationMs;
}

export { isTransformProp };
