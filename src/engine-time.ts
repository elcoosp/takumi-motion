// takumi-motion — engine-time.ts
// The engine time boundary. takumi's napi layer takes animation time in
// WHOLE milliseconds (i64); fractional frame times (frame × 1000/fps on
// frame grids like 30fps ⇒ 33.333ms) are rejected with InvalidArg.
//
// Every call site that forwards a `timeMs` into the engine funnels through
// this helper, so the value is rounded deterministically (nearest, ties
// toward +∞ — Math.round) and clamped to the timeline start. Rounding is
// idempotent, so nested/frame-sourced call sites can round again safely.

/**
 * Round a timeline time to the whole-millisecond grid the engine accepts.
 * Negative and non-finite inputs clamp to 0 (the first frame).
 */
export function toEngineMs(timeMs: number): number {
  if (!Number.isFinite(timeMs) || timeMs <= 0) return 0;
  return Math.round(timeMs);
}
