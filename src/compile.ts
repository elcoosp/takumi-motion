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

  // v1.0 — the fps grid is GROUP-INDEPENDENT: build it once, share it.
  // The baseline re-walked frameMs×frames for every (target, property-group),
  // re-adding ~frames points per group into a fresh Set.
  const gridPoints: number[] = [];
  {
    const seen = new Set<number>();
    for (let t = 0; t <= durationMs + 1e-9; t += frameMs) {
      const p = Math.round(t);
      if (!seen.has(p)) {
        seen.add(p);
        gridPoints.push(p);
      }
    }
    const last = Math.round(durationMs);
    if (!seen.has(last)) gridPoints.push(last);
  }

  const groups = groupTracks(resolvedTracks);

  for (const group of groups) {
    const name = `tmk-${++ruleIndex}`;

    // Sample grid: the shared fps grid + THIS group's structural boundaries
    // (track starts, iteration boundaries, iteration ends, track ends).
    const points: number[] = [...gridPoints];
    const seen = new Set<number>(points);
    const addPoint = (t: number): void => {
      if (t >= 0 && t <= durationMs + 1e-9) {
        const p = Math.round(t);
        if (!seen.has(p)) {
          seen.add(p);
          points.push(p);
        }
      }
    };
    for (const track of group.tracks) {
      const iteration = track.iterationMs + track.repeatDelayMs;
      const span = Number.isFinite(track.totalMs) ? track.totalMs : durationMs - track.delayMs;
      const reps = Math.min(
        Number.isFinite(track.repeat) ? track.repeat + 1 : Math.ceil(span / iteration),
        Math.ceil((durationMs - track.delayMs) / iteration) + 1
      );
      for (let i = 0; i <= reps; i++) {
        addPoint(track.delayMs + i * iteration); // iteration start
        addPoint(track.delayMs + i * iteration + track.iterationMs); // iteration end (pre-gap hold)
      }
      addPoint(track.delayMs + bakedSpan(track));
    }
    points.sort((a, b) => a - b);

    // Emit steps; a step is dropped only when it equals BOTH neighbors
    // (linear-through). Dropping mere consecutive duplicates would erase the
    // hold-end anchor and turn every hold into a slow linear ramp across the
    // gap (the engine interpolates between the two surviving keyframes).
    //
    // v1.0 — dedupe compares declarations STRUCTURALLY. The baseline
    // JSON.stringify'd every sample point just for comparison; the declaration
    // objects are tiny and stable-shaped, so a keyed compare is both faster
    // and allocation-light.
    // Sample ONCE per point into a flat array (the v1.0 draft lazily
    // re-sampled the next point for its compare — up to 2× the sampling cost;
    // the baseline JSON.stringify'd every point instead). Structural compare
    // on the cached objects keeps emit-side work allocation-free.
    const sampled: Declarations[] = points.map((t) => {
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
      return declarations;
    });

    const steps: Array<{ offset: string; style?: Declarations }> = [];
    let lastEmitted: Declarations | null = null;
    for (let i = 0; i < sampled.length; i++) {
      const cur = sampled[i];
      const isFinal = i === sampled.length - 1;
      // A step survives when it differs from the last EMITTED step (segment
      // start / hold-end anchor) or is the final anchor. Interior steps equal
      // on BOTH sides are redundant — compare against the neighbor samples.
      const sameAsPrev = lastEmitted !== null && declarationsEqual(cur, lastEmitted);
      const sameAsNext = !isFinal && declarationsEqual(cur, sampled[i + 1]);
      if (sameAsPrev && (sameAsNext || isFinal) && !isFinal) continue;
      lastEmitted = cur;
      steps.push({
        offset: durationMs > 0 ? `${roundToCss((points[i] / durationMs) * 100)}%` : "0%",
        style: cur,
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

/** Structural equality for tiny declaration objects (1 key in practice). */
function declarationsEqual(a: Declarations, b: Declarations): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if ((a as Record<string, string>)[k] !== (b as Record<string, string>)[k]) return false;
  }
  return true;
}
