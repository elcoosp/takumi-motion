// takumi-motion — size.ts
// Size engineering as a feature, not a doctrine.
//
// 1. GIF hold-collapse: takumi's Rust GIF encoder writes one frame per fps
//    tick — including the static holds that dominate typographic banners.
//    The WebP encoder merges runs of identical frames natively; the GIF
//    encoder does not. This module post-processes the GIF byte stream and
//    merges runs of byte-identical frames, accumulating their delays — a
//    large cut on typewriter-class banners at zero visual cost. The parser
//    is strict: anything unexpected passes the input through untouched.
//
// 2. gifStats: frame counts, delays, loop duration read from the byte
//    stream — powers reports and tests.
//
// 3. optimizeBanner: budget-driven variant ladder with an injected render
//    function; reports a vite-style table and picks the smallest result.

// ---------------------------------------------------------------------------
// GIF byte-stream parsing
// ---------------------------------------------------------------------------

export interface GifFrame {
  /** Offset of the frame's first block (GCE when present, else descriptor). */
  start: number;
  /** Offset just past the frame's last block. */
  end: number;
  /** Raw GCE block (8 bytes: 21 F9 04 packed d1 d2 ti 00), null when absent. */
  gce: Uint8Array | null;
  /** Delay in 1/100 s from the GCE (0 when absent). */
  delayCs: number;
  /** Bytes from the image descriptor to the frame end (descriptor + LCT + LZW sub-blocks). */
  imageData: Uint8Array;
}

export interface GifStructure {
  /** Header + LSD + GCT + any extensions before the first frame. */
  prefix: Uint8Array;
  frames: GifFrame[];
  /** Everything after the last frame (usually just the 0x3B trailer). */
  suffix: Uint8Array;
  /** Netscape loop count (0 = loop forever) when the extension is present. */
  loopCount?: number;
}

/**
 * Parse a GIF into prefix / frames / suffix. Returns null when the stream is
 * not a GIF or violates the block grammar — callers must then pass the
 * buffer through unmodified.
 */
export function parseGif(bytes: Uint8Array): GifStructure | null {
  if (bytes.length < 14) return null;
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null; // "GIF"
  if (bytes[3] !== 0x38 || (bytes[4] !== 0x37 && bytes[4] !== 0x39) || bytes[5] !== 0x61) return null; // "87a"/"89a"

  const packed = bytes[10]!;
  const gctSize = packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
  let pos = 13 + gctSize;
  if (pos > bytes.length) return null;

  const frames: GifFrame[] = [];
  let loopCount: number | undefined;
  let firstFrameStart = -1;
  let pendingGce: Uint8Array | null = null;
  let pendingGceStart = -1;
  let pendingDelayCs = 0;

  /** Consume sub-blocks from `p`; returns offset past the 0 terminator, or -1. */
  const readSubBlocks = (p: number): number => {
    while (p < bytes.length) {
      const len = bytes[p]!;
      if (len === 0) return p + 1;
      p += 1 + len;
    }
    return -1;
  };

  while (pos < bytes.length) {
    const block = bytes[pos]!;

    if (block === 0x21) {
      const label = bytes[pos + 1];
      if (label === undefined) return null;
      const bodyStart = pos + 2;
      const end = readSubBlocks(bodyStart);
      if (end < 0) return null;
      if (label === 0xf9) {
        // GCE: 21 F9 04 packed delay(2) transparentIdx 00
        if (bytes[bodyStart] !== 0x04 || bodyStart + 6 !== end) return null;
        pendingGce = bytes.subarray(pos, end);
        pendingGceStart = pos;
        pendingDelayCs = bytes[bodyStart + 2]! | (bytes[bodyStart + 3]! << 8);
      } else if (label === 0xff) {
        const idLen = bytes[bodyStart] ?? 0;
        if (bodyStart + 1 + idLen > bytes.length) return null;
        const id = bytes.slice(bodyStart + 1, bodyStart + 1 + idLen);
        if (id.length === 11 && String.fromCharCode(...id) === "NETSCAPE2.0") {
          const subLen = bytes[bodyStart + 1 + idLen] ?? 0;
          if (subLen >= 3 && bytes[bodyStart + 2 + idLen] === 0x01) {
            loopCount = bytes[bodyStart + 3 + idLen]! | (bytes[bodyStart + 4 + idLen]! << 8);
          }
        }
      }
      pos = end;
      continue;
    }

    if (block === 0x2c) {
      if (pos + 10 > bytes.length) return null;
      const imgPacked = bytes[pos + 9]!;
      const lctSize = imgPacked & 0x80 ? 3 * 2 ** ((imgPacked & 0x07) + 1) : 0;
      const dataStart = pos + 10 + lctSize;
      if (dataStart >= bytes.length) return null;
      const end = readSubBlocks(dataStart + 1);
      if (end < 0) return null;
      if (firstFrameStart < 0) firstFrameStart = pendingGce ? pendingGceStart : pos;
      frames.push({
        start: pendingGce ? pendingGceStart : pos,
        end,
        gce: pendingGce,
        delayCs: pendingDelayCs,
        imageData: bytes.subarray(pos, end),
      });
      pendingGce = null;
      pendingGceStart = -1;
      pendingDelayCs = 0;
      pos = end;
      continue;
    }

    if (block === 0x3b) {
      // Trailer — done.
      pos = bytes.length;
      break;
    }

    return null; // unknown block — pass the buffer through untouched
  }

  if (frames.length === 0) return null;
  if (pendingGce) return null; // dangling GCE — malformed

  return {
    prefix: bytes.subarray(0, firstFrameStart),
    frames,
    suffix: bytes.subarray(frames[frames.length - 1]!.end),
    ...(loopCount !== undefined ? { loopCount } : {}),
  };
}

export interface GifStats {
  frames: number;
  /** Total display duration, ms (delay units are 1/100 s). */
  durationMs: number;
  /** Distinct frame payloads — equals frames for a fully animated banner. */
  loopCount?: number;
}

/** Read frame count + duration from a GIF; null when not a parseable GIF. */
export function gifStats(input: Uint8Array): Omit<GifStats, "loopCount"> & { loopCount?: number } | null {
  const parsed = parseGif(input);
  if (!parsed) return null;
  const durationCs = parsed.frames.reduce((s, f) => s + f.delayCs, 0);
  return {
    frames: parsed.frames.length,
    durationMs: durationCs * 10,
    ...(parsed.loopCount !== undefined ? { loopCount: parsed.loopCount } : {}),
  };
}

// ---------------------------------------------------------------------------
// Hold collapsing
// ---------------------------------------------------------------------------

export interface CollapseResult {
  buffer: Buffer;
  framesBefore: number;
  framesAfter: number;
  /** Total display duration before/after — identical when valid. */
  durationMsBefore: number;
  durationMsAfter: number;
  collapsed: boolean;
}

function framesIdentical(a: GifFrame, b: GifFrame): boolean {
  // GCE bytes must match with the delay field (bytes 4–5) masked out.
  if ((a.gce === null) !== (b.gce === null)) return false;
  if (a.gce && b.gce) {
    for (let k = 0; k < 8; k++) {
      if (k === 4 || k === 5) continue;
      if (a.gce[k] !== b.gce[k]) return false;
    }
  }
  if (a.imageData.length !== b.imageData.length) return false;
  // v1.0 — native memcmp for real payloads (views are zero-copy since the
  // subarray switch); the JS loop wins below ~64 bytes (view setup cost).
  if (a.imageData.length === 0) return true;
  if (a.imageData.length >= 64) {
    const ab = Buffer.from(a.imageData.buffer, a.imageData.byteOffset, a.imageData.byteLength);
    const bb = Buffer.from(b.imageData.buffer, b.imageData.byteOffset, b.imageData.byteLength);
    return ab.equals(bb);
  }
  for (let k = 0; k < a.imageData.length; k++) {
    if (a.imageData[k] !== b.imageData[k]) return false;
  }
  return true;
}

/**
 * Merge runs of byte-identical GIF frames into single frames with
 * accumulated delays. Frames compare on the full image block (descriptor +
 * local palette + LZW data) and the GCE minus its delay field. Non-GIF or
 * malformed input passes through unchanged (collapsed: false).
 */
export function collapseGifHolds(input: Uint8Array): CollapseResult {
  const parsed = parseGif(input);
  if (!parsed) {
    return {
      buffer: Buffer.from(input),
      framesBefore: 0,
      framesAfter: 0,
      durationMsBefore: 0,
      durationMsAfter: 0,
      collapsed: false,
    };
  }

  const frames = parsed.frames;
  const durationMsBefore = frames.reduce((s, f) => s + f.delayCs, 0) * 10;

  const chunks: Uint8Array[] = [parsed.prefix];
  let i = 0;
  while (i < frames.length) {
    const frame = frames[i]!;
    let delayCs = frame.delayCs;
    let j = i + 1;
    while (j < frames.length && framesIdentical(frame, frames[j]!)) {
      delayCs = Math.min(delayCs + frames[j]!.delayCs, 0xffff);
      j++;
    }
    chunks.push(emitFrame(frame, delayCs));
    i = j;
  }
  if (parsed.suffix.length) chunks.push(parsed.suffix);

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = Buffer.allocUnsafe(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }

  // Round-trip sanity: the merged file must re-parse cleanly and preserve
  // the total duration. Any doubt → return the original untouched.
  const reparsed = parseGif(out);
  const durationMsAfter = reparsed ? reparsed.frames.reduce((s, f) => s + f.delayCs, 0) * 10 : -1;
  const framesAfter = reparsed ? reparsed.frames.length : -1;
  if (!reparsed || durationMsAfter !== durationMsBefore || framesAfter <= 0 || framesAfter > frames.length) {
    return {
      buffer: Buffer.from(input),
      framesBefore: frames.length,
      framesAfter: frames.length,
      durationMsBefore,
      durationMsAfter: durationMsBefore,
      collapsed: false,
    };
  }

  return {
    buffer: out,
    framesBefore: frames.length,
    framesAfter,
    durationMsBefore,
    durationMsAfter,
    collapsed: framesAfter < frames.length,
  };
}

/** Re-emit one frame: GCE (delay patched) + image block. */
function emitFrame(frame: GifFrame, delayCs: number): Uint8Array {
  const gce = frame.gce;
  const gceLen = gce ? gce.length : 0;
  const out = new Uint8Array(gceLen + frame.imageData.length);
  if (gce) {
    out.set(gce, 0);
    out[4] = delayCs & 0xff;
    out[5] = (delayCs >> 8) & 0xff;
  }
  out.set(frame.imageData, gceLen);
  return out;
}

// ---------------------------------------------------------------------------
// Budget optimizer
// ---------------------------------------------------------------------------

export interface OptimizerAttempt {
  /** Human label, e.g. "webp q82 @20fps". */
  label: string;
  format: "gif" | "webp" | "apng";
  fps: number;
  /** WebP quality (gif/apng ignore it). */
  quality?: number;
}

export interface OptimizerResult {
  /** The chosen attempt's render result. */
  chosen: { attempt: OptimizerAttempt; buffer: Buffer; bytes: number };
  attempts: Array<{ attempt: OptimizerAttempt; bytes: number; withinBudget: boolean; ms: number }>;
  /** true when some attempt fit the budget; false = smallest attempt returned anyway. */
  withinBudget: boolean;
}

/**
 * Render variants until one fits `budget`, cheapest-first. The ladder only
 * kicks in when the first attempt misses the budget — the happy path costs
 * one render. `render` receives the attempt and returns the encoded buffer;
 * the caller owns how fps/quality re-compile (compile grid must match the
 * render fps for frame-exact output).
 */
export async function optimizeBudget(
  budget: number,
  ladder: OptimizerAttempt[],
  render: (attempt: OptimizerAttempt) => Promise<Buffer>
): Promise<OptimizerResult> {
  if (ladder.length === 0) throw new Error("optimizeBudget: ladder is empty.");
  const attempts: OptimizerResult["attempts"] = [];
  const lastBuffers = new Map<string, Buffer>();

  for (const attempt of ladder) {
    const t0 = performance.now();
    const buffer = await render(attempt);
    const ms = performance.now() - t0;
    const bytes = buffer.length;
    attempts.push({ attempt, bytes, withinBudget: bytes <= budget, ms });
    if (bytes <= budget) {
      return {
        chosen: { attempt, buffer, bytes },
        attempts,
        withinBudget: true,
      };
    }
    lastBuffers.set(labelOf(attempt), buffer);
  }

  const smallest = attempts.reduce((a, b) => (a.bytes <= b.bytes ? a : b));
  const cached = lastBuffers.get(labelOf(smallest.attempt));
  return {
    chosen: {
      attempt: smallest.attempt,
      buffer: cached ?? (await render(smallest.attempt)),
      bytes: smallest.bytes,
    },
    attempts,
    withinBudget: false,
  };
}

function labelOf(attempt: OptimizerAttempt): string {
  return `${attempt.format}:${attempt.fps}:${attempt.quality ?? ""}`;
}
