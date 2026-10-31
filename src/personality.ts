// takumi-motion — personality.ts
// One-knob motion character. A Personality bundles the choices that are hard
// to get right one track at a time: entrance ease, overshoot budget, stagger
// rhythm, hold pacing, and how alive the ambient layer is. Templates consume
// these instead of hardcoding feel, so `motion: "snappy"` re-times the whole
// banner coherently.
//
// The ambient() helper also lives here: it emits the mirror-track pattern the
// v0.1 templates hand-rolled (period/N mirror durations + assertAmbientPeriod
// guard), generalized over effect kind and intensity.

import { assertAmbientPeriod } from "./loop.js";
import type { Easing } from "./types.js";
import type { Timeline } from "./timeline.js";
import type { TimelineTarget } from "./types.js";

export interface Personality {
  name: string;
  /** Entrance ease for fade/rise reveals. */
  entrance: Easing;
  /** Exit/reset ease — how content leaves before the loop tail. */
  exit: Easing;
  /** Overshoot easing for scale/underline accents (backOut-like). */
  overshoot: Easing;
  /** Base per-glyph stagger, ms. Templates scale it by content length. */
  staggerMs: number;
  /** Stagger distribution: even (mechanical) or decelerating (organic). */
  staggerCurve: "even" | "out";
  /** Multiplier applied to template hold durations (>1 = calmer). */
  holdBias: number;
  /** Ambient layer intensity multiplier 0..1. */
  ambient: number;
  /** Spring params for logo/badge pops (null = use easings, not springs). */
  spring?: { stiffness: number; damping: number };
  /** One-line character note (docs/CLI). */
  note: string;
}

export const personalities: Record<string, Personality> = {
  snappy: {
    name: "snappy",
    entrance: "backOut",
    exit: "easeIn",
    overshoot: "backOut",
    staggerMs: 28,
    staggerCurve: "out",
    holdBias: 0.85,
    ambient: 0.8,
    spring: { stiffness: 520, damping: 26 },
    note: "quick in, confident overshoot, short holds — demo-day energy",
  },
  smooth: {
    name: "smooth",
    entrance: "easeInOut",
    exit: "easeInOut",
    overshoot: "easeOut",
    staggerMs: 42,
    staggerCurve: "out",
    holdBias: 1.2,
    ambient: 0.6,
    note: "long glides, no overshoot, patient holds — keynote calm",
  },
  playful: {
    name: "playful",
    entrance: "backOut",
    exit: "circIn",
    overshoot: "backOut",
    staggerMs: 34,
    staggerCurve: "out",
    holdBias: 1.0,
    ambient: 1.0,
    spring: { stiffness: 300, damping: 17 },
    note: "bouncy springs, lively ambient, generous overshoot",
  },
  mechanical: {
    name: "mechanical",
    entrance: { steps: 8, direction: "end" },
    exit: { steps: 6, direction: "start" },
    overshoot: "linear",
    staggerMs: 22,
    staggerCurve: "even",
    holdBias: 1.0,
    ambient: 0.35,
    note: "stepped easings, even rhythm, minimal ambient — terminal honest",
  },
};

export type PersonalityName = keyof typeof personalities;

/** Resolve by name (unknown names throw with the list) or pass through. */
export function resolvePersonality(personality: string | Personality = "snappy"): Personality {
  if (typeof personality !== "string") return personality;
  const found = personalities[personality];
  if (!found) {
    throw new Error(
      `Unknown motion personality '${personality}'. Available: ${Object.keys(personalities).join(", ")}.`
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Ambient layer — period/N mirror tracks guarded against seam drift
// ---------------------------------------------------------------------------

export type AmbientKind =
  /** Horizontal glow drift (the v0.1 signature). */
  | "drift"
  /** Gentle scale breathing 1 → 1+2%·intensity → 1. */
  | "breathe"
  /** Soft opacity pulse 1 → 1−0.18·intensity → 1. */
  | "pulse"
  /** Slow vertical float ±3px·intensity. */
  | "float";

export interface AmbientOptions {
  /** Full loop period, ms — ambient mirror cycles divide it (period/N). */
  periodMs: number;
  /** Effect strength 0..1 (templates pass personality.ambient · author trim). */
  intensity?: number;
  /** Mirror divisor of the period (2 = one full cycle per half-loop). Default 2. */
  divisor?: number;
  /** Label used in seam-guard errors. Default target. */
  label?: string;
  /** Timeline grid fps — must match render fps. Default 20. */
  fps?: number;
}

/**
 * Add a seamless ambient track to the timeline. Emits ONE mirror track whose
 * mirror cycle (2 × duration) divides `periodMs` exactly, so the ping-pong
 * lands on the loop seam — the invariant v0.1 enforced by hand.
 *
 * Returns the options actually applied (durationMs, intensity) for reporting.
 */
export function ambient(
  tl: Timeline,
  target: TimelineTarget,
  kind: AmbientKind,
  options: AmbientOptions
): { durationMs: number; intensity: number; divisor: number } {
  const periodMs = options.periodMs;
  const divisor = Math.max(1, Math.round(options.divisor ?? 2));
  const intensity = clamp01(options.intensity ?? 0.8);
  const fps = options.fps ?? 20;
  const durationMs = periodMs / divisor;

  const frames = periodMs / (1000 / fps);
  if (Math.abs(frames - Math.round(frames)) > 1e-6) {
    throw new Error(
      `ambient: periodMs ${periodMs} is not frame-grid aligned (fps ${fps}). Use loopPeriod().`
    );
  }

  switch (kind) {
    case "drift":
      tl.add(target, { x: [-18 * intensity, 18 * intensity] }, mirror(durationMs));
      break;
    case "breathe":
      tl.add(target, { scale: [1, 1 + 0.025 * intensity] }, mirror(durationMs));
      break;
    case "pulse":
      tl.add(target, { opacity: [1, 1 - 0.22 * intensity] }, mirror(durationMs));
      break;
    case "float":
      tl.add(target, { y: [-3 * intensity, 3 * intensity] }, mirror(durationMs));
      break;
  }

  assertAmbientPeriod(durationMs, periodMs, options.label ?? String(typeof target === "string" ? target : "ambient target"));
  return { durationMs, intensity, divisor };
}

/** Track distance for drift/float: clamp px to a banner-safe ±24px. */
export function clampAmbientPx(px: number): number {
  return Math.min(Math.abs(px), 24) * Math.sign(px || 1);
}

// ---------------------------------------------------------------------------
// Windowed ambient — motion during active windows, still during holds
// ---------------------------------------------------------------------------

export interface AmbientWindowOptions {
  /** Full loop period, ms (tracks span it; strict seam by construction). */
  periodMs: number;
  /** [start, end] ms windows where the effect moves. Window length must be
   *  an even frame count so the mirror peak lands on the fps grid. */
  windows: Array<[number, number]>;
  /** Effect strength 0..1. */
  intensity?: number;
  /** Timeline grid fps — must match render fps. Default 20. */
  fps?: number;
  /** Label for error messages. */
  label?: string;
  /** Direct amplitude override (overrides kind defaults × intensity). */
  amplitude?: number;
  /** Cycle phase: "low-high-low" (default) or "high-low-high". The value held
   *  BETWEEN windows is the phase's first value — pick "high-low-high" when
   *  the element must rest at its base state (e.g. a solid cursor). */
  phase?: "low-high-low" | "high-low-high";
}

/**
 * Ambient motion that runs only inside `windows` and freezes elsewhere.
 * Between windows the value holds at its start — so long content holds
 * become byte-identical GIF frames that collapseGifHolds() merges (the
 * 5-10x size cut on hold-heavy banners). Each window hosts whole mirror
 * cycles (±peak → ∓peak → ±peak), so every track returns to its t=0 value:
 * strict seam intact, no assertAmbientPeriod needed.
 */
export function ambientWindow(
  tl: Timeline,
  target: TimelineTarget,
  kind: AmbientKind,
  options: AmbientWindowOptions
): void {
  const periodMs = options.periodMs;
  // Signed intensity: negative mirrors the direction (useful for paired glows).
  const intensity = Math.max(-1, Math.min(1, options.intensity ?? 0.8));
  const fps = options.fps ?? 20;
  const frameMs = 1000 / fps;

  if (options.windows.length === 0) return;

  const A =
    options.amplitude ??
    (kind === "drift" ? 18 * intensity :
    kind === "float" ? 3 * intensity :
    kind === "breathe" ? 0.025 * intensity :  // scale
    kind === "pulse" ? 0.22 * intensity : 0); // opacity
  const base = kind === "breathe" ? 1 : kind === "pulse" ? 1 : 0;
  const prop = kind === "drift" ? "x" : kind === "float" ? "y" : kind === "breathe" ? "scale" : "opacity";

  const values: number[] = [];
  const times: number[] = [];
  let lastEnd = -1;
  const high = base + A;
  const low = base - A;
  // "high-low-high" rests AT BASE (e.g. a solid cursor) and dips by A inside
  // windows; "low-high-low" hosts a full ±A mirror cycle per window.
  const triple = options.phase === "high-low-high" ? [base, low, base] : [low, high, low];

  for (const [ws, we] of options.windows) {
    const L = we - ws;
    if (L <= 0) throw new Error(`ambientWindow: invalid window [${ws}, ${we}] (${options.label ?? ""}).`);
    if (Math.abs(L / frameMs - Math.round(L / frameMs)) > 1e-6) {
      throw new Error(
        `ambientWindow: window [${ws}, ${we}] length ${L}ms is not frame-grid aligned (fps ${fps}).` +
          ` ${options.label ?? ""}`
      );
    }
    if (Math.abs(L / 2 / frameMs - Math.round(L / 2 / frameMs)) > 1e-6) {
      throw new Error(
        `ambientWindow: window [${ws}, ${we}] needs an EVEN frame count so the mirror peak lands ` +
          `on the grid (length ${L}ms at ${fps}fps). ${options.label ?? ""}`
      );
    }
    if (ws <= lastEnd) {
      throw new Error(`ambientWindow: windows must be ordered and non-overlapping. ${options.label ?? ""}`);
    }
    lastEnd = we;
    values.push(triple[0]!, triple[1]!, triple[2]!);
    times.push(ws / periodMs, (ws + L / 2) / periodMs, we / periodMs);
  }

  tl.add(target, { [prop]: values } as never, {
    at: 0,
    type: "tween",
    duration: periodMs,
    times,
    ease: "easeInOut",
  });
}

function mirror(durationMs: number) {
  return { at: 0, type: "tween" as const, duration: durationMs, repeat: Infinity as number, repeatType: "mirror" as const };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
