// takumi-motion — orchestrate.ts
// Kinetic-typography primitives: split text into glyphs/words and orchestrate
// their reveals on the timeline. Every primitive is SEAM-SAFE BY SHAPE:
//
//   opacity: [0, 1, 1, 0]   appears → holds → leaves
//   y:       [rise, 0, 0, rise]   returns to its t=0 value while invisible
//
// so strict-mode checkLoopSeam passes without a global fade pulse. This is
// the layer capsule-render / typing-svg cannot reach — per-glyph CSS
// keyframes baked by the compiler and sampled in Rust.

import { h, type VNodeStyle } from "./jsx.js";
import type { ReactElementLike } from "./types.js";
import type { Timeline } from "./timeline.js";
import type { Easing } from "./types.js";

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/** Split into grapheme-ish units ([...text] — covers emoji + CJK correctly). */
export function splitGlyphs(text: string): string[] {
  return [...text];
}

/** Split into whitespace-separated words. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Render a unit safely in HTML/text layout: spaces become no-break spaces. */
export function visibleUnit(unit: string): string {
  return unit === " " ? "\u00a0" : unit;
}

// ---------------------------------------------------------------------------
// Reveal orchestration
// ---------------------------------------------------------------------------

export interface RevealUnitsOptions {
  /** Selectors of the units, in reveal order. */
  selectors: string[];
  /** Loop period, ms — tracks span the full period (strict seam). */
  periodMs: number;
  /** Reveal start, ms. */
  at: number;
  /** Stagger between units, ms. */
  staggerMs?: number;
  /** Stagger distribution: "out" decelerates the rhythm across the run. */
  staggerCurve?: "even" | "out";
  /** Per-unit entrance span, ms. Default 320. */
  inMs?: number;
  /** Vertical rise, px (0 = fade only). Default 22. */
  rise?: number;
  /** Entrance ease. Default "easeOut". */
  ease?: Easing;
  /** When the run starts exiting, ms (per-unit exit is staggered the same way). Default periodMs - tailMs - runSpan. */
  exitAt?: number;
  /** Per-unit exit span, ms. Default 240. */
  exitMs?: number;
  /** Invisible tail before the loop restarts, ms. Default 260. */
  tailMs?: number;
  /** Exit ease. Default "easeIn". */
  exitEase?: Easing;
  /** Exit motion: return rise ("drop" back down) or none. Default "return". */
  exitMotion?: "return" | "none";
}

/**
 * Orchestrate opacity (+ optional y-rise) reveals across unit selectors.
 * Each unit ends hidden with transforms back at their t=0 values — strict
 * seam intact. Returns the last unit's end time (useful for labels).
 */
export function revealUnits(tl: Timeline, opts: RevealUnitsOptions): number {
  const n = opts.selectors.length;
  if (n === 0) return opts.at;
  const stagger = opts.staggerMs ?? 30;
  const curve = opts.staggerCurve ?? "out";
  const inMs = opts.inMs ?? 320;
  const rise = opts.rise ?? 22;
  const ease = opts.ease ?? "easeOut";
  const exitMs = opts.exitMs ?? 240;
  const exitEase = opts.exitEase ?? "easeIn";
  const tailMs = opts.tailMs ?? 260;
  const exitMotion = opts.exitMotion ?? "return";

  const delayFor = (i: number): number =>
    curve === "even" ? i * stagger : deceleratingStagger(i, n, stagger);

  const runSpan = delayFor(n - 1) + inMs;
  const exitAt = opts.exitAt ?? opts.periodMs - tailMs - delayFor(n - 1) - exitMs;

  for (let i = 0; i < n; i++) {
    const selector = opts.selectors[i]!;
    const d = delayFor(i);
    const tIn = opts.at + d;
    const tOut = exitAt + d;

    const opacityTimes = [tIn / opts.periodMs, (tIn + inMs) / opts.periodMs, tOut / opts.periodMs, (tOut + exitMs) / opts.periodMs];
    tl.add(selector, { opacity: [0, 1, 1, 0] }, {
      at: 0, type: "tween", duration: opts.periodMs,
      times: opacityTimes, ease: [ease, "linear", exitEase],
    });

    if (rise !== 0) {
      // y holds at 0 through the visible hold (BOTH ends anchored — a 2-keyframe
      // gap interpolates across it, the v0.1 hold-degradation bug class), then
      // returns to its t=0 value while the unit fades out — seam-safe.
      const returnY = exitMotion === "return";
      const yKf = returnY ? [rise, 0, 0, rise] : [rise, 0, 0];
      const yTimes = returnY
        ? [tIn / opts.periodMs, (tIn + inMs) / opts.periodMs, tOut / opts.periodMs, (tOut + exitMs * 0.8) / opts.periodMs]
        : [tIn / opts.periodMs, (tIn + inMs) / opts.periodMs, Math.min(tOut / opts.periodMs, 1)];
      tl.add(selector, { y: yKf }, {
        at: 0, type: "tween", duration: opts.periodMs,
        times: yTimes, ease: [ease, "linear", exitEase],
      });
    }
  }

  return Math.max(opts.at + runSpan, exitAt + delayFor(n - 1) + exitMs);
}

/**
 * Stagger that decelerates across the run: first unit lands quickly, later
 * units breathe — organic rhythm without changing the total window.
 * Sums to n * stagger (same total time as "even").
 */
export function deceleratingStagger(i: number, n: number, staggerMs: number): number {
  if (n <= 1) return 0;
  // weights w_i = (2(n-i))/(n(n+1)) — sums to 1; scaled to the even budget.
  const total = n * staggerMs;
  let acc = 0;
  for (let k = 0; k < i; k++) acc += (2 * (n - k)) / (n * (n + 1));
  return Math.round(acc * total * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Wave — phase-shifted ambient per unit (seam-safe: mirror cycle | period)
// ---------------------------------------------------------------------------

export interface WaveUnitsOptions {
  selectors: string[];
  /** Loop period, ms. */
  periodMs: number;
  /** Mirror duration = periodMs / divisor (cycle = 2× that). Default divisor 2. */
  divisor?: number;
  /** Phase shift between units, ms. Default period/24. */
  phaseMs?: number;
  /** Peak offset, px. Default 6. */
  amplitude?: number;
  /** Wave axis. Default "y". */
  axis?: "x" | "y";
  /** Timeline grid fps (phase alignment sanity). Default 20. */
  fps?: number;
}

/**
 * Phase-shifted sine-feel wave across units: each unit gets an infinite
 * mirror track of duration period/divisor, delayed by i·phaseMs. Mirror
 * tracks are phase-seam-safe when their full cycle divides the period — the
 * ping-pong position repeats exactly across the seam.
 */
export function waveUnits(tl: Timeline, opts: WaveUnitsOptions): void {
  const divisor = Math.max(1, Math.round(opts.divisor ?? 2));
  const durationMs = opts.periodMs / divisor;
  const amplitude = opts.amplitude ?? 6;
  const axis = opts.axis ?? "y";
  const phaseMs = opts.phaseMs ?? opts.periodMs / 24;
  const fps = opts.fps ?? 20;

  const cycle = durationMs * 2;
  if (Math.abs((opts.periodMs / cycle) - Math.round(opts.periodMs / cycle)) > 1e-6) {
    throw new Error(
      `waveUnits: mirror cycle ${cycle}ms does not divide the period ${opts.periodMs}ms. ` +
        `Use periodMs/divisor durations.`
    );
  }
  const frameMs = 1000 / fps;
  if (Math.abs((durationMs / frameMs) - Math.round(durationMs / frameMs)) > 1e-6) {
    throw new Error(`waveUnits: mirror duration ${durationMs}ms is not frame-grid aligned (fps ${fps}).`);
  }

  for (let i = 0; i < opts.selectors.length; i++) {
    tl.add(opts.selectors[i]!, { [axis]: [-amplitude, amplitude] } as never, {
      at: i * phaseMs,
      type: "tween",
      duration: durationMs,
      repeat: Infinity as number,
      repeatType: "mirror",
    });
  }
}

// ---------------------------------------------------------------------------
// Composite: build a reveal row (elements + tracks in one call)
// ---------------------------------------------------------------------------

export interface RevealRowOptions extends Omit<RevealUnitsOptions, "selectors"> {
  text: string;
  /** "glyph" reveals per character; "word" per word. Default "glyph". */
  mode?: "glyph" | "word";
  classNamePrefix: string;
  /** Base text style shared by every unit. */
  style?: VNodeStyle;
  /** Wrap each unit in this much horizontal padding to un-clip italic overhang. Default 0. */
  unitPaddingX?: number;
}

export interface RevealRow {
  /** Row container (flex) holding the unit spans. */
  element: ReactElementLike;
  /** Unit selectors in reveal order. */
  selectors: string[];
  /** Last unit end time, ms. */
  endsAtMs: number;
}

/**
 * Build a flex row of glyph/word spans AND their reveal tracks in one call.
 * Compose with your own container/typography; the tracks land on `tl`.
 */
export function revealRow(tl: Timeline, opts: RevealRowOptions): RevealRow {
  const mode = opts.mode ?? "glyph";
  const units = mode === "word" ? splitWords(opts.text) : splitGlyphs(opts.text);
  if (units.length === 0) throw new Error("revealRow: text is empty.");

  const selectors = units.map((_, i) => `.${opts.classNamePrefix}-${i}`);
  const endsAtMs = revealUnits(tl, { ...opts, selectors });

  const element = h(
    "div",
    {
      style: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        ...opts.style,
      },
      children: units.map((unit, i) =>
        h("div", {
          className: `${opts.classNamePrefix}-${i}`,
          style: {
            whiteSpace: "pre",
            ...(opts.unitPaddingX ? { padding: `0 ${opts.unitPaddingX}px` } : {}),
          },
          children: visibleUnit(unit),
        })
      ),
    }
  );

  return { element, selectors, endsAtMs };
}
