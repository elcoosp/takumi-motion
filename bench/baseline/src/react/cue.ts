// takumi-motion — react/cue.ts (v0.8, Bet A — the placement half of the
// sequence grammar). Scenes declare labels; anything inside the runtime
// resolves cue expressions against them:
//
//   <Scene duration={60} label="intro">…</Scene>
//   <Scene duration={90} label="demo">…</Scene>
//
//   const at = useCue("intro + 12f");   // absolute frame of the cue
//   <Sequence from={Math.max(0, at - useAbsoluteFrame())}>…</Sequence>
//
// Grammar (cached — parse once per distinct string):
//   "intro"        the labeled scene's start frame
//   "intro+12f"    … plus 12 frames
//   "intro - 8f"   whitespace tolerated around +/-; offset unit is `f`
//   "end"          the banner's last frame; "end-10f" etc. work too
//
// Labels resolve at plan time (compile-once doctrine); resolution is a Map
// lookup. Deterministic by construction — no clocks, no state.

import { createContext, useContext } from "react";

export interface LabelFrameContextValue {
  /** label → the scene's global start frame (its enter overlap included). */
  labels: Record<string, number>;
  /** Total frames of the whole banner. */
  totalFrames: number;
}

export const LabelContext = createContext<LabelFrameContextValue | null>(null);

// ---------------------------------------------------------------------------
// Expression parsing
// ---------------------------------------------------------------------------

export interface ParsedCue {
  label: string;
  offsetFrames: number;
}

// Lazy identifier + optional trailing offset — so "end-10f" parses as
// label "end" offset -10 (not as a hyphenated identifier), while
// "team-update" stays one label.
const CUE_RE = /^\s*([A-Za-z_][\w-]*?)\s*(?:([+-])\s*(\d+)f)?\s*$/;

const cueCache = new Map<string, ParsedCue>();
const CUE_CACHE_CAP = 256;

/**
 * Parse a cue expression: `"intro"`, `"intro + 12f"`, `"end-10f"`.
 * Throws with the expected grammar on anything else.
 */
export function parseCue(expr: string): ParsedCue {
  const hit = cueCache.get(expr);
  if (hit) return hit;

  const match = CUE_RE.exec(expr);
  if (!match) {
    throw new Error(
      `parseCue: "${expr}" is not a cue expression — expected "<label>", "<label>+12f" or "<label> - 8f" ` +
      `(labels are letter/underscore-starting identifiers; offsets are whole frames with the f suffix).`,
    );
  }
  const parsed: ParsedCue = {
    label: match[1],
    offsetFrames: match[2] ? (match[2] === "-" ? -1 : 1) * Number(match[3]) : 0,
  };
  if (cueCache.size >= CUE_CACHE_CAP) {
    const oldest = cueCache.keys().next().value;
    if (oldest !== undefined) cueCache.delete(oldest);
  }
  cueCache.set(expr, parsed);
  return parsed;
}

/**
 * Resolve a cue to an absolute frame: labeled scene start (or the banner's
 * last frame for "end") plus the offset. Throws on unknown labels, listing
 * the ones that exist — a typo should be loud, not a silent frame 0.
 */
export function resolveCue(expr: string, labels: Record<string, number>, totalFrames: number): number {
  const { label, offsetFrames } = parseCue(expr);
  let base: number;
  if (label === "end") {
    base = Math.max(0, totalFrames - 1);
  } else if (label in labels) {
    base = labels[label];
  } else {
    const known = Object.keys(labels);
    throw new Error(
      `resolveCue: unknown label "${label}" (${known.length > 0 ? `known labels: ${known.join(", ")}` : "no labels declared"}). ` +
      `Give a <Scene label="…"> or use "end".`,
    );
  }
  return base + offsetFrames;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Absolute frame of a cue expression, resolved against the banner's labels.
 * Must run inside <Banner> (the LabelContext provider).
 */
export function useCue(expr: string): number {
  const ctx = useContext(LabelContext);
  if (!ctx) {
    throw new Error(
      "useCue(): called outside <Banner>. Cue resolution needs the banner's label table — " +
      "run it inside a <Scene> subtree.",
    );
  }
  return resolveCue(expr, ctx.labels, ctx.totalFrames);
}
