// takumi-motion — png.ts (v1.0)
// Minimal, deterministic PNG encoder (RGBA, 8-bit) extracted from sprite.ts
// and upgraded to the standard per-row **minimum-sum-of-absolute-differences
// filter heuristic** (None / Sub / Up / Average / Paeth, PNG spec §6.6).
//
// Why: the v0.9.1 encoder wrote filter-0 rows. Filtered rows deflate far
// better on gradients/photographic cells — sprite sheets and PNG sequences
// shrink dramatically (measured in BENCHMARKS.md) at zero determinism cost:
// the heuristic is a pure function of the pixel rows, and node:zlib
// deflateSync runs with fixed parameters (no timestamps, no adaptivity).

import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// CRC + chunk framing
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** paeth(a, b, c) — PNG spec predictor. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function sumAbs8(rows: Uint8Array): number {
  // Interpret signed bytes as deltas: |x| where x ∈ [-255, 255] stored as
  // unsigned — compare via min(x, 256 - x) for x > 128.
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i];
    sum += v > 127 ? 256 - v : v;
  }
  return sum;
}

export interface PngEncodeOptions {
  /** zlib deflate level 0–9. Default 9 (deterministic; best ratio). */
  level?: number;
  /** "min-sad" (default, per-row heuristic) or "none" (v0.9.1 behavior). */
  filter?: "min-sad" | "none";
}

/**
 * Encode an RGBA pixel buffer as PNG (color type 6, 8-bit).
 * Deterministic: fixed deflate parameters + a pure per-row filter heuristic.
 */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array, options: PngEncodeOptions = {}): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`encodePngRgba: buffer is ${rgba.length} bytes, expected ${width * height * 4} (${width}×${height} RGBA).`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  const scratch = Buffer.alloc(stride);

  const pick = options.filter ?? "min-sad";
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    const out = filtered.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    filtered[y * (stride + 1)] = 0;

    if (pick === "none") {
      out.set(row);
      continue;
    }

    let bestScore = Infinity;
    let bestFilter = 0;
    // 0 None → 1 Sub → 2 Up → 3 Average → 4 Paeth
    for (let f = 0; f <= 4; f++) {
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? row[x - 4] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= 4 ? prev[x - 4] : 0;
        let v: number;
        switch (f) {
          case 0: v = row[x]; break;
          case 1: v = (row[x] - a) & 0xff; break;
          case 2: v = (row[x] - b) & 0xff; break;
          case 3: v = (row[x] - ((a + b) >> 1)) & 0xff; break;
          default: v = (row[x] - paeth(a, b, c)) & 0xff; break;
        }
        scratch[x] = v;
      }
      const score = sumAbs8(scratch);
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        out.set(scratch);
      }
    }
    filtered[y * (stride + 1)] = bestFilter;
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered, { level: options.level ?? 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
