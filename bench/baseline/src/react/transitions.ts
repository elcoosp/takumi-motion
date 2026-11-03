// takumi-motion — react/transitions.ts
// Enter/exit style synthesis for scene transitions.
//
// During an overlap frame the planner hands us `progress` (0 → 1 across the
// overlap). The ARRIVING scene applies its enter style at `progress`; the
// LEAVING scene applies its exit style at `1 - progress` (its visibility).
// Values are rounded to 6 decimals so byte-identical frames chunk-merge.

import type { TransitionKind } from "./plan.js";

export interface TransitionStyles {
  opacity?: number;
  transform?: string;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const TRANSITION_DISTANCE_PX = 48;

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * Styles for one side of a transition at arrival `progress` (0 → 1).
 *
 * - `side: "enter"`: scene is arriving (opacity ramps up, offset collapses).
 * - `side: "exit"`: scene is leaving (opacity ramps down, offset grows).
 *
 * `cut` produces no styles (the scene simply isn't composited during
 * non-overlap frames).
 */
export function transitionStyle(
  kind: TransitionKind,
  side: "enter" | "exit",
  progress: number,
  distancePx: number = TRANSITION_DISTANCE_PX,
): TransitionStyles {
  const p = Math.min(1, Math.max(0, progress));
  // Fully arrived (enter at 1) / not yet leaving (exit at 0): no overrides —
  // keeps the scene wrapper clean and lets identical frames chunk-merge.
  if ((side === "enter" && p >= 1) || (side === "exit" && p <= 0)) return {};
  switch (kind) {
    case "cut":
      return {};
    case "wrap":
      // The wrap tail composites through its own director branch (scene 1's
      // frozen frame-0 layer underneath) — no synthesized styles here.
      return {};
    case "crossfade": {
      return side === "enter"
        ? { opacity: r6(easeOutCubic(p)) }
        : { opacity: r6(1 - easeInCubic(p)) };
    }
    case "slide": {
      // Arrives from the right, leaves toward the left (reading-direction push).
      return side === "enter"
        ? { opacity: r6(easeOutCubic(p)), transform: `translateX(${r6((1 - easeOutCubic(p)) * distancePx)}px)` }
        : { opacity: r6(1 - easeInCubic(p)), transform: `translateX(${r6(-easeInCubic(p) * distancePx)}px)` };
    }
    case "rise": {
      // Arrives from below, leaves upward.
      return side === "enter"
        ? { opacity: r6(easeOutCubic(p)), transform: `translateY(${r6((1 - easeOutCubic(p)) * distancePx)}px)` }
        : { opacity: r6(1 - easeInCubic(p)), transform: `translateY(${r6(-easeInCubic(p) * distancePx)}px)` };
    }
    case "push": {
      // v0.9.1 — the no-double-exposure transition. Both scenes stay at FULL
      // opacity and slide in lockstep: the arriving scene comes from exactly
      // one canvas-width to the right, the leaving exits toward exactly one
      // canvas-width to the left. Because both offsets share one eased q and
      // the distance is the full width, the scenes remain exactly ADJACENT
      // for every q — the leaving scene's right edge always touches the
      // arriving scene's left edge — so nothing ever superimposes. Pass the
      // BANNER width as distancePx (the director does).
      const q = easeInOutCubic(p);
      return side === "enter"
        ? { transform: `translateX(${r6((1 - q) * distancePx)}px)` }
        : { transform: `translateX(${r6(-q * distancePx)}px)` };
    }
  }
}
