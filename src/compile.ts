// takumi-motion — compile.ts
// Compiles a Timeline JSON into Takumi render inputs: structured CSS
// (AnimationRule @keyframes + per-selector animation longhands).
//
// Strategy: the ENTIRE timeline is baked explicitly. Springs, inertia,
// function easings, and repeat folding are all sampled onto the fps grid
// across [0, durationMs], producing one AnimationRule per (target, property
// group) with animation-duration = the timeline duration. Every per-frame
// value evaluation therefore happens inside Takumi's Rust engine (time_ms
// clock) with zero interpolation error at render frames. This is the POC
// embodiment of the RFC's "Rust-native clock"; Phase 1 replaces baking with
// a native spring() timing function inside takumi-core.

import type { AnimationRule, CssInput, Declarations, StyleRule } from "@takumi-rs/helpers";
import { resolveTrack, sampleTrackAt, type ResolvedTrack } from "./sampler.js";
import { buildTransformKeyframe, roundToCss, type TransformProp } from "./transform.js";
import type { TimelineJSON } from "./types.js";
import { lintTracks, type LintWarning } from "./lint.js";

export interface CompileOptions {
  /** Frame grid for baking (must match renderAnimation fps for frame-exact output). Default 30. */
  fps?: number;
  /** Supplies values for `null` keyframes ("use base style"). */
  resolveBase?: (target: string, prop: string) => number | string | undefined;
  /** v0.6 — run the authoring lint (TM_SPRING_DURATION etc.) during compile. Default true. */
  lint?: boolean;
}

export interface CompiledTimeline {
  /** Structured CSS entries to pass to renderAnimation/render via `css`. */
  css: CssInput[];
  /** Total duration in ms (fps-grid aligned) — pass as scene durationMs. */
  durationMs: number;
  fps: number;
  /** Selector → animation entry names (debug). */
  animations: Record<string, string[]>;
  /** v0.6 — authoring-lint findings (empty when `lint: false`). */
  lint: LintWarning[];
}

interface AnimationEntry {
  name: string;
  durationMs: number;
}

const bakedSpan = (track: ResolvedTrack): number => {
  if (Number.isFinite(track.totalMs)) return track.totalMs;
  // Infinite repeat → contribute one iteration (+ gap) to the scene duration;
  // the fold sampler keeps it oscillating across the whole timeline.
  return track.iterationMs + track.repeatDelayMs;
};

/** Group resolved tracks: transform props merge per target; others stay per-property. */
function groupTracks(resolved: ResolvedTrack[]): Array<{ key: string; tracks: ResolvedTrack[]; isTransform: boolean }> {
  const groups = new Map<string, { key: string; tracks: ResolvedTrack[]; isTransform: boolean }>();
  for (const track of resolved) {
    const key = track.isTransform ? `transform::${track.target}` : `${track.property}::${track.target}`;
    const existing = groups.get(key);
    if (existing) existing.tracks.push(track);
    else groups.set(key, { key, tracks: [track], isTransform: track.isTransform });
  }
  return [...groups.values()];
}

function cssNumberFor(prop: string, value: number): string {
  switch (prop) {
    case "width":
    case "height":
    case "letterSpacing":
      return `${roundToCss(value)}px`;
    default:
      return roundToCss(value);
  }
}

export function compileTimeline(timeline: TimelineJSON, options: CompileOptions = {}): CompiledTimeline {
  const fps = options.fps ?? 30;
  const frameMs = 1000 / fps;
  const resolvedTracks = timeline.tracks.map((t) => resolveTrack(t, options.resolveBase));

  const css: CssInput[] = [];
  const animations: Record<string, string[]> = {};
  const entriesByTarget = new Map<string, AnimationEntry[]>();
  let ruleIndex = 0;

  // Timeline duration: max finite end across tracks (infinite tracks contribute one iteration)
  let maxEnd = 0;
  for (const track of resolvedTracks) {
    maxEnd = Math.max(maxEnd, track.delayMs + bakedSpan(track));
  }
  const durationMs = Math.max(Math.ceil(maxEnd / frameMs) * frameMs, frameMs);

  const groups = groupTracks(resolvedTracks);

  for (const group of groups) {
    const name = `tmk-${++ruleIndex}`;

    // Sample grid: fps grid over the WHOLE timeline + structural boundaries
    // (track starts, iteration boundaries, iteration ends, track ends).
    const points = new Set<number>();
    for (let t = 0; t <= durationMs + 1e-9; t += frameMs) points.add(Math.round(t));
    points.add(Math.round(durationMs));
    for (const track of group.tracks) {
      const iteration = track.iterationMs + track.repeatDelayMs;
      const span = Number.isFinite(track.totalMs) ? track.totalMs : durationMs - track.delayMs;
      const reps = Math.min(
        Number.isFinite(track.repeat) ? track.repeat + 1 : Math.ceil(span / iteration),
        Math.ceil((durationMs - track.delayMs) / iteration) + 1
      );
      for (let i = 0; i <= reps; i++) {
        const b1 = track.delayMs + i * iteration; // iteration start
        const b2 = b1 + track.iterationMs;        // iteration end (pre-gap hold)
        if (b1 >= 0 && b1 <= durationMs) points.add(Math.round(b1));
        if (b2 >= 0 && b2 <= durationMs) points.add(Math.round(b2));
      }
      const end = track.delayMs + bakedSpan(track);
      if (end >= 0 && end <= durationMs) points.add(Math.round(end));
    }
    const sortedPoints = [...points].filter((t) => t >= 0 && t <= durationMs + 1e-9).sort((a, b) => a - b);

    // Emit steps; a step is dropped only when it equals BOTH neighbors
    // (linear-through). Dropping mere consecutive duplicates would erase the
    // hold-end anchor and turn every hold into a slow linear ramp across the
    // gap (the engine interpolates between the two surviving keyframes).
    const sampled = sortedPoints.map((t) => {
      const declarations: Declarations = {};
      if (group.isTransform) {
        const values: Partial<Record<TransformProp, number | string>> = {};
        for (const track of group.tracks) {
          values[track.property as TransformProp] = sampleTrackAt(track, t - track.delayMs);
        }
        declarations.transform = buildTransformKeyframe(
          group.tracks.map((tr) => tr.property as TransformProp),
          values
        );
      } else {
        const track = group.tracks[0];
        const value = sampleTrackAt(track, t - track.delayMs);
        (declarations as Record<string, string>)[track.property] =
          typeof value === "number" ? cssNumberFor(track.property, value) : (value as string);
      }
      return { t, declarations, serialized: JSON.stringify(declarations) };
    });

    const steps: Array<{ offset: string; style?: Declarations }> = [];
    let lastSerialized: string | null = null;
    for (let i = 0; i < sampled.length; i++) {
      const cur = sampled[i]!;
      const next = sampled[i + 1];
      const isFinal = i === sampled.length - 1;
      const sameAsPrev = lastSerialized !== null && lastSerialized === cur.serialized;
      const sameAsNext = next !== undefined && next.serialized === cur.serialized;
      // A step survives when its value differs from the previously EMITTED
      // step (start of a new segment / hold-end anchor) or when it is the
      // final anchor point. Interior steps equal on both sides are redundant.
      if (sameAsPrev && (sameAsNext || isFinal) && !isFinal) continue;
      lastSerialized = cur.serialized;
      steps.push({
        offset: durationMs > 0 ? `${roundToCss((cur.t / durationMs) * 100)}%` : "0%",
        style: cur.declarations,
      });
    }

    if (steps.length === 0) continue;
    if (steps.length === 1) steps.unshift({ ...steps[0], offset: "0%" });

    css.push({ keyframes: name, steps } as AnimationRule);

    const lead = group.tracks[0];
    const entry: AnimationEntry = { name, durationMs };
    const list = entriesByTarget.get(lead.target);
    if (list) list.push(entry);
    else entriesByTarget.set(lead.target, [entry]);
    (animations[lead.target] ??= []).push(name);
  }

  for (const [selector, entries] of entriesByTarget) {
    css.push({
      selector,
      style: {
        animationName: entries.map((e) => e.name).join(", "),
        animationDuration: entries.map((e) => `${roundToCss(e.durationMs)}ms`).join(", "),
        animationTimingFunction: entries.map(() => "linear").join(", "),
        animationDelay: entries.map(() => "0ms").join(", "),
        animationIterationCount: entries.map(() => "1").join(", "),
        animationDirection: entries.map(() => "normal").join(", "),
        animationFillMode: entries.map(() => "both").join(", "),
      },
    } as StyleRule);
  }

  return {
    css,
    durationMs,
    fps,
    animations,
    ...(options.lint === false ? { lint: [] } : { lint: lintTracks(timeline.tracks) }),
  };
}
