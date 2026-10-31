// takumi-motion — react/particles.tsx (v0.9 Bet D)
// Deterministic particle emitters — celebration dust for banners.
//
//   mode="sparkle"   opacity twinkle at STATIC positions. GIF delta-encoding
//                    carries a twinkle as a few changed pixels — the nearly
//                    free tier. Default.
//   mode="confetti"  real position churn (closed-form ballistic path). Every
//                    frame moves pixels — the budget tier. Pass burstFrames
//                    so the burst SETTLES into a twinkle (finite churn);
//                    unbounded churn is flagged by TM_PARTICLE_CHURN.
//
// Doctrine baked in: every particle's state is a CLOSED FORM of the frame
// index (no accumulators, no simulation step) — O(1) per particle per frame,
// and any frame replays byte-identically. Randomness flows through
// randomFor/hashString (mulberry32 doctrine) — never Math.random.

import { createElement, type ReactNode } from "react";
import { useCurrentFrame, useDriver, type DriverInfo } from "./context.js";
import { hashString, randomFor } from "./motion.js";
import type { LintWarning } from "../lint.js";
import type { TakumiStyle } from "../style.js";

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParticleArea {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ParticlesProps {
  /** Particle count. Default 24. */
  count?: number;
  /** "sparkle" — static positions + opacity twinkle (cheap);
   *  "confetti" — ballistic position churn (budget). Default "sparkle". */
  mode?: "sparkle" | "confetti";
  /** Seed (number or string) — same seed, same particles, forever. */
  seed?: number | string;
  /** Particle colors, cycled by index. Default: cool spark whites. */
  colors?: string[];
  /** Particle size in px, or a [min, max] range. Default 3. */
  size?: number | [number, number];
  /** Emission area (canvas-absolute px). Default: the full canvas. */
  area?: ParticleArea;
  /** Confetti: fly for N frames from the scene start, then freeze and settle
   *  into a twinkle. Omit → churn for the whole scene (flagged). */
  burstFrames?: number;
  /** Confetti gravity, px/frame². Default 0.35. */
  gravity?: number;
  /** Confetti launch speed, px/frame. Default 2.4. */
  speed?: number;
  /** Twinkle period in frames (even numbers stay loop-friendly). Default 16. */
  twinklePeriodFrames?: number;
  /** Peak opacity. Default 0.9. */
  opacity?: number;
  style?: TakumiStyle;
}

// ---------------------------------------------------------------------------
// Lint (TM_PARTICLE_CHURN) — pushed through the driver registry
// ---------------------------------------------------------------------------

/** Confetti count above this (without burstFrames) trips the churn lint. */
export const CONFETTI_BUDGET = 24;

function particleLint(props: ParticlesProps): LintWarning[] {
  const warnings: LintWarning[] = [];
  const count = props.count ?? 24;
  if (props.mode === "confetti" && (props.burstFrames === undefined || count > CONFETTI_BUDGET)) {
    warnings.push({
      code: "TM_PARTICLE_CHURN" as const,
      message:
        `confetti churns ${count} particles${props.burstFrames === undefined ? " for the WHOLE scene (no burstFrames)" : ""} — ` +
        `position churn is the expensive tier (large GIF deltas per frame).`,
      hint:
        props.burstFrames === undefined
          ? `Pass burstFrames (e.g. 30) so the burst settles into a twinkle, or drop to mode="sparkle" for ambient dust.`
          : `Confetti above ${CONFETTI_BUDGET} particles is rare worth it — split across scenes or lower the count.`,
      severity: "warn",
    });
  }
  return warnings;
}

function pushLint(driver: DriverInfo | null, warnings: LintWarning[]): void {
  if (!driver) return;
  const store = driver.registry as { lints?: LintWarning[] };
  if (warnings.length === 0) return;
  store.lints ??= [];
  store.lints.push(...warnings);
}

// ---------------------------------------------------------------------------
// <Particles>
// ---------------------------------------------------------------------------

/**
 * Celebration dust. Sparkles twinkle in place; confetti flies a closed-form
 * ballistic arc and (with burstFrames) settles into a twinkle.
 *
 * ```tsx
 * <Scene duration={60}>
 *   <Particles count={18} mode="sparkle" seed="hero" />
 *   <Particles count={32} mode="confetti" seed="launch" burstFrames={28}
 *              colors={["#38bdf8", "#a78bfa", "#f472b6"]} />
 * </Scene>
 * ```
 */
export function Particles(props: ParticlesProps): ReactNode {
  const driver = useDriver();
  const frame = useCurrentFrame();

  pushLint(driver, particleLint(props));

  const count = Math.max(0, Math.min(256, Math.round(props.count ?? 24)));
  const mode = props.mode ?? "sparkle";
  const seedNum = typeof props.seed === "string" ? hashString(props.seed) : (props.seed ?? 1) >>> 0;
  const canvasW = driver.registry.banner?.width ?? 320;
  const canvasH = driver.registry.banner?.height ?? 180;
  const area = {
    x: props.area?.x ?? 0,
    y: props.area?.y ?? 0,
    width: props.area?.width ?? canvasW,
    height: props.area?.height ?? canvasH,
  };
  const colors = props.colors ?? ["#e2e8f0", "#bae6fd", "#c4b5fd"];
  const [sizeMin, sizeMax] = typeof props.size === "number" ? [props.size, props.size] : (props.size ?? [2, 4]);
  const period = Math.max(4, props.twinklePeriodFrames ?? 16);
  const peakOpacity = props.opacity ?? 0.9;

  const dots: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    // Per-particle static attributes — deterministic, computed fresh per
    // frame (pure function, no memo needed at banner scale).
    const rx = randomFor(seedNum, i, 1);
    const ry = randomFor(seedNum, i, 2);
    const rs = randomFor(seedNum, i, 3);
    const rc = randomFor(seedNum, i, 4);
    const size = r6(sizeMin + (sizeMax - sizeMin) * rs);
    const color = colors[Math.floor(rc * colors.length) % colors.length];

    let left: number;
    let top: number;
    let opacity: number;

    if (mode === "sparkle") {
      // Static position + sine twinkle with a per-particle phase offset.
      left = area.x + rx * area.width;
      top = area.y + ry * area.height;
      const phase = ((frame + Math.floor(randomFor(seedNum, i, 5) * period)) % period) / period;
      opacity = r6(peakOpacity * Math.sin(Math.PI * phase));
    } else {
      // Confetti: closed-form ballistic flight, frozen at the burst end,
      // then a soft twinkle at the resting spot.
      const angle = randomFor(seedNum, i, 6) * Math.PI * 2;
      const speed = (props.speed ?? 2.4) * (0.5 + randomFor(seedNum, i, 7));
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed * 0.6 - (props.speed ?? 2.4) * 0.7; // upward bias
      const gravity = props.gravity ?? 0.35;
      const burst = props.burstFrames;
      const t = burst === undefined ? frame : Math.min(frame, burst);
      left = area.x + rx * area.width + vx * t;
      top = area.y + ry * area.height + vy * t + gravity * t * t;
      const settledPhase = burst === undefined ? 0 : ((frame - burst) % period) / period;
      opacity = burst !== undefined && frame > burst
        ? r6(peakOpacity * Math.max(0.15, Math.sin(Math.PI * settledPhase)))
        : r6(Math.min(1, peakOpacity + 0.1));
    }

    // Clamp — never SKIP invisible particles: a stable structure (same divs
    // every frame) keeps the explain report honest and lets alpha-0 dots
    // ride GIF delta frames for free.
    opacity = Math.max(0, Math.min(1, opacity));
    dots.push(createElement("div", {
      key: `p-${i}`,
      style: {
        position: "absolute",
        left: r6(left),
        top: r6(top),
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: color,
        opacity,
        pointerEvents: "none",
      },
    }));
  }

  return createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      width: canvasW,
      height: canvasH,
      pointerEvents: "none",
      ...(props.style ?? {}),
    },
  }, dots);
}
