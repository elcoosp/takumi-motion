// takumi-motion — chunk-index.ts (v1.0)
// Shared chunk lookup for every frame→chunk mapping in the engine (posters,
// sequences, sprite sheets, filmstrips, storyboards). Three modules used to
// carry private linear scans; this is the single O(log n) binary search —
// chunks are produced sorted by startFrame, and the result is identical to
// the scans (last chunk whose startFrame ≤ frame, clamped to chunk 0).

export interface ChunkLike {
  startFrame: number;
}

/**
 * Index of the chunk that owns `frame` — the LAST chunk whose startFrame is
 * ≤ frame. Frames before the first chunk (shouldn't exist; clamped in the
 * v0.5 bounded pipeline) map to chunk 0, matching the v0.9.1 linear scans.
 */
export function chunkIndexForFrame<T extends ChunkLike>(chunks: readonly T[], frame: number): number {
  let lo = 0;
  let hi = chunks.length - 1;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (chunks[mid].startFrame <= frame) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
