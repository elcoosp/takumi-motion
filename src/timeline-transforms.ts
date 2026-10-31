// takumi-motion — timeline-transforms.ts (v0.6)
// Pure transforms over TimelineJSON — the declarative path's answer to the
// React runtime's composition primitives (<Sequence>/<Loop> shift or repeat
// whole subtrees; timeline authors need the same power as data).
//
// Semantics are documented against the React vocabulary: <Sequence> REBASES
// local frames but keeps absolute-frame hooks pointing at the true timeline —
// shiftTimeline is the same for tracks: delays move, values and easing
// curves do not.

import type { TimelineJSON } from "./types.js";

/**
 * Shift every track's delay by `deltaMs` (≥ 0 — moving tracks EARLIER would
 * clip their pre-zero span against the rendered scene start; build a new
 * timeline instead). The timeline's durationMs grows by the delta so nothing
 * is truncated.
 *
 * ```ts
 * // The intro slides in at 500ms; shift the whole body after it:
 * const body = shiftTimeline(buildBodyTimeline(), 500);
 * ```
 */
export function shiftTimeline(timeline: TimelineJSON, deltaMs: number): TimelineJSON {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new Error(`shiftTimeline: deltaMs must be a finite non-negative number, got ${deltaMs}.`);
  }
  if (deltaMs === 0) return timeline;
  return {
    ...timeline,
    durationMs: timeline.durationMs + deltaMs,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      transition: {
        ...track.transition,
        delay: Math.max(0, ((track.transition?.delay as number | undefined) ?? 0) + deltaMs),
      },
    })),
  };
}

/**
 * Concatenate timelines in order: each input is shifted to start where the
 * previous one ends (the declarative <Series>). Durations accumulate on the
 * fps grid of each input's own durationMs (no re-gridding — compile rounds
 * to the render fps).
 */
export function concatTimelines(timelines: ReadonlyArray<TimelineJSON>): TimelineJSON {
  if (timelines.length === 0) {
    throw new Error("concatTimelines: at least one timeline is required.");
  }
  const tracks = [];
  let offset = 0;
  for (const tl of timelines) {
    tracks.push(...shiftTimeline(tl, offset).tracks);
    offset += tl.durationMs;
  }
  return { version: timelines[0].version, durationMs: offset, tracks };
}

/**
 * v0.8 — composition-wide tempo for the DECLARATIVE path (the React path sets
 * `<Banner tempo>` and the capture driver maps frames). `tempo: 2` renders
 * twice as fast: the duration halves and every track's `delay`/`duration`
 * halves. Spring physics configs are NOT rescaled (physics is physics — a
 * faster clock would change the feel, not the speed) — rescale explicitly
 * when that's wanted. Values stay in ms space; compile rounds to the fps grid.
 *
 * ```ts
 * const faster = scaleTimeline(banner, 1.5);
 * ```
 */
export function scaleTimeline(timeline: TimelineJSON, tempo: number): TimelineJSON {
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new Error(`scaleTimeline: tempo must be a finite positive number, got ${tempo}.`);
  }
  if (tempo === 1) return timeline;
  return {
    ...timeline,
    durationMs: timeline.durationMs / tempo,
    tracks: timeline.tracks.map((track) => {
      const t = track.transition ?? {};
      return {
        ...track,
        transition: {
          ...t,
          delay: ((t.delay as number | undefined) ?? 0) / tempo,
          ...((t as { duration?: number }).duration !== undefined
            ? { duration: (t as { duration?: number }).duration! / tempo }
            : {}),
        },
      };
    }),
  };
}
