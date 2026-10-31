// takumi-motion — loop.ts
// Seamless-loop primitives for banner rendering. GIF/APNG are finite formats:
// the PLAYER loops them, so "seamless" is a TIMELINE property — the state at
// t=durationMs must connect to the state at t=0 (or the seam must be masked
// by a global fade).

import type { TimelineJSON, TrackJSON } from "./types.js";
import { resolveTrack, sampleTrackAt, type ResolvedTrack } from "./sampler.js";

export interface WrapOptions {
  /** Selector of the root content container whose opacity the wrap owns. */
  selector: string;
  /** Fade-in duration at the loop start, ms. Default 350. */
  inMs?: number;
  /** Fade-out duration at the loop end, ms. Default 350. */
  outMs?: number;
  /** If given, extend the timeline duration to at least this many ms (fps-grid aligned). */
  periodMs?: number;
  /** Grid for period alignment. Default 30. */
  fps?: number;
}

export interface SeamCheck {
  target: string;
  property: string;
  atStart: number | string;
  atEnd: number | string;
  delta: number | "text";
}

export interface SeamReport {
  seamless: boolean;
  /** "wrapped" = seam masked by a fadeWrap; "strict" = every track matches across the seam. */
  mode: "wrapped" | "strict";
  /** Violations found (empty when seamless). */
  diffs: SeamCheck[];
  notes: string[];
}

/**
 * Wrap a timeline so it loops seamlessly: the content fades out over the last
 * `outMs` and back in over the first `inMs`, dipping to the background at the
 * loop seam. Entrance-style banners (animate in → hold → wrap) become seamless
 * by construction, and any ambient loops may stay phase-free because they are
 * invisible at the seam.
 *
 * fadeWrap OWNS the opacity of `selector`: the timeline must not already
 * carry an opacity track on that target.
 *
 * The wrap marker is stored on `timeline.wrap` (authoring metadata; compile
 * and evaluators ignore it) so `checkLoopSeam` can switch to masked mode.
 */
export function fadeWrap(timeline: TimelineJSON, options: WrapOptions): TimelineJSON {
  const selector = options.selector;
  const inMs = options.inMs ?? 350;
  const outMs = options.outMs ?? 350;
  const fps = options.fps ?? 30;

  const conflict = timeline.tracks.find((t) => t.target === selector && t.property === "opacity");
  if (conflict) {
    throw new Error(
      `fadeWrap: target '${selector}' already has an opacity track. ` +
        `fadeWrap owns the root opacity — animate a child container instead.`
    );
  }
  if (inMs <= 0 || outMs <= 0) {
    throw new Error(`fadeWrap: inMs/outMs must be positive (got ${inMs}/${outMs}).`);
  }

  let durationMs = timeline.durationMs;
  if (options.periodMs !== undefined) {
    const frameMs = 1000 / fps;
    const target = Math.max(options.periodMs, durationMs);
    // round to µs — ceil×frameMs on non-representable frame sizes carries 1 ulp of noise
    durationMs = Math.round(Math.ceil(target / frameMs) * frameMs * 1000) / 1000;
  }
  if (durationMs <= inMs + outMs) {
    throw new Error(
      `fadeWrap: timeline duration (${Math.round(durationMs)}ms) must exceed inMs+outMs (${inMs + outMs}ms).`
    );
  }

  const wrapTrack: TrackJSON = {
    target: selector,
    property: "opacity",
    keyframes: [0, 1, 1, 0],
    times: [0, round3(inMs / durationMs), round3((durationMs - outMs) / durationMs), 1],
    transition: {
      type: "tween",
      duration: durationMs,
      ease: ["easeOut", "linear", "easeIn"],
    },
  };

  return {
    ...timeline,
    durationMs,
    tracks: [...timeline.tracks, wrapTrack],
    wrap: { selector },
  };
}

/**
 * Check whether a timeline loops seamlessly.
 *
 * - **wrapped** mode (timeline has a fadeWrap marker): the wrap opacity must
 *   be ≤ `tolerance` at both seam ends — everything else is masked by the fade.
 * - **strict** mode (no marker): every track's value at t=0 must equal its
 *   value at t=durationMs. Use this for pure oscillating timelines (pulse,
 *   float, shimmer); entrance animations correctly FAIL here — wrap them.
 */
export function checkLoopSeam(timeline: TimelineJSON, opts: { tolerance?: number } = {}): SeamReport {
  const notes: string[] = [];
  const diffs: SeamCheck[] = [];

  if (timeline.wrap) {
    const wrapTrack = timeline.tracks.find(
      (t) => t.target === timeline.wrap!.selector && t.property === "opacity"
    );
    if (!wrapTrack) {
      return {
        seamless: false,
        mode: "wrapped",
        diffs: [],
        notes: [`wrap marker present for '${timeline.wrap.selector}' but no opacity track found on it.`],
      };
    }
    const resolved = resolveTrack(wrapTrack);
    const tolerance = opts.tolerance ?? 0.02;
    const atStart = sampleTrackAt(resolved, 0) as number;
    const atEnd = sampleTrackAt(resolved, timeline.durationMs) as number;
    const seamless = atStart <= tolerance && atEnd <= tolerance;
    if (!seamless) {
      diffs.push({
        target: wrapTrack.target,
        property: "opacity",
        atStart,
        atEnd,
        delta: Math.max(atStart, atEnd),
      });
      notes.push(
        `Wrap opacity must be ~0 at both seam ends (got ${round3(atStart)} / ${round3(atEnd)}). ` +
          `Shorten content or raise inMs/outMs.`
      );
    }
    return { seamless, mode: "wrapped", diffs, notes };
  }

  const tolerance = opts.tolerance ?? 1e-6;
  for (const track of timeline.tracks) {
    const resolved: ResolvedTrack = resolveTrack(track);
    const atStart = sampleTrackAt(resolved, 0);
    const atEnd = sampleTrackAt(resolved, timeline.durationMs - resolved.delayMs);
    if (typeof atStart === "number" && typeof atEnd === "number") {
      if (Math.abs(atStart - atEnd) > tolerance) {
        diffs.push({ target: track.target, property: track.property, atStart, atEnd, delta: atEnd - atStart });
      }
    } else if (String(atStart) !== String(atEnd)) {
      diffs.push({ target: track.target, property: track.property, atStart, atEnd, delta: "text" });
    }
  }
  if (diffs.length > 0) {
    notes.push(
      "Strict mode: tracks must return to their t=0 value by the end of the timeline. " +
        "For entrance → hold → restart banners, apply fadeWrap() to the root content selector."
    );
  }
  return { seamless: diffs.length === 0, mode: "strict", diffs, notes };
}

/**
 * Snap durationMs up to the smallest value where every infinite (oscillating)
 * track completes whole iterations — makes strict-mode loops land exactly on
 * their t=0 state. The duration must be a common multiple of every period
 * (the LCM, capped to keep timelines sane); all infinite tracks must start
 * at delay 0.
 */
export function alignLoopPeriod(timeline: TimelineJSON, capMs = 30000): TimelineJSON {
  const periods = new Set<number>();
  for (const track of timeline.tracks) {
    const transition = track.transition as { repeat?: number; delay?: number };
    if (transition.repeat !== Infinity) continue;
    if ((transition.delay ?? 0) !== 0) {
      throw new Error(
        `alignLoopPeriod: infinite track '${track.property}' on '${track.target}' starts at ` +
          `delay ${transition.delay}ms — phase-shifted loops cannot be aligned by extending the duration. ` +
          `Start ambient tracks at t=0.`
      );
    }
    const resolved = resolveTrack(track);
    // "reverse"/"mirror" infinite tracks only return to their start value after a
    // full ping-pong cycle (forward + backward iteration); "loop" repeats need one
    // iteration per cycle (and only loop cleanly if first/last keyframes match).
    const cycleMultiplier = resolved.repeatType === "loop" ? 1 : 2;
    const period = Math.round((resolved.iterationMs + resolved.repeatDelayMs) * cycleMultiplier);
    if (period <= 0) throw new Error(`alignLoopPeriod: track '${track.property}' has a non-positive period.`);
    periods.add(period);
  }
  if (periods.size === 0) return timeline;
  const lcm = [...periods].reduce((a, b) => lcmOf(a, b));
  const aligned = Math.ceil(timeline.durationMs / lcm) * lcm;
  if (aligned > capMs) {
    throw new Error(
      `alignLoopPeriod: the periods {${[...periods].join(", ")}}ms have no common multiple within ` +
        `${capMs}ms (LCM ${lcm}ms). Shorten or retime the ambient tracks so their periods share a ` +
        `reasonable loop length.`
    );
  }
  return { ...timeline, durationMs: aligned };
}

function lcmOf(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Ambient tracks (glow drift, cursor blink) must complete whole mirror cycles
 * within the loop period to keep strict seams honest: mirror full cycle =
 * 2 × duration, so author them with `duration = period / N` (N = 1, 2, 3…).
 * Asserts the convention at construction time.
 */
export function assertAmbientPeriod(durationMs: number, periodMs: number, label: string): void {
  const cycle = durationMs * 2;
  const k = Math.round(periodMs / cycle);
  if (k < 1 || Math.abs(cycle * k - periodMs) > 1e-6) {
    throw new Error(
      `${label}: ambient mirror duration ${durationMs}ms has cycle ${cycle}ms which does not divide ` +
        `the loop period ${periodMs}ms. Use period/N durations (N = 1, 2, 3…).`
    );
  }
}
