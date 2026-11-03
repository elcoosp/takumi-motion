// v1.0 — micro-optimization parity: chunk index, GIF hold collapse, PNG encoder
import { describe, expect, it } from "vitest";
import { chunkIndexForFrame } from "../src/chunk-index.js";
import { collapseGifHolds, parseGif, gifStats } from "../src/size.js";
import {
  collapseGifHolds as baseCollapse,
  parseGif as baseParse,
} from "../bench/baseline/src/size.js";
import { encodePngRgba } from "../src/png.js";

/**
 * Build a minimal two-frame GIF: 2×2, GCT of 2 entries, each frame a GCE +
 * descriptor + LZW min-code-size 2 + one 2-byte sub-block + terminator.
 * `identical` makes frame 2's payload byte-identical to frame 1's.
 */
function twoFrameGif(delayCs1: number, delayCs2: number, identical: boolean): Buffer {
  const header = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x02, 0x00, // width 2
    0x02, 0x00, // height 2
    0x80, 0x00, 0x00, // packed: GCT present, size bits 0 → 3×2^1 = 6 bytes
  ]);
  const gct = Buffer.from([0xff, 0x00, 0x00, 0x00, 0x00, 0xff]);
  const gce = (delayCs: number) =>
    Buffer.from([0x21, 0xf9, 0x04, 0x04, delayCs & 0xff, (delayCs >> 8) & 0xff, 0x00, 0x00]);
  const descriptor = Buffer.from([0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00]); // 10 bytes: 2c + left/top/w/h + packed
  const dataA = Buffer.from([0x02, 0x02, 0x4c, 0x01, 0x00]);
  const dataB = Buffer.from([0x02, 0x02, 0x4c, 0x02, 0x00]);
  const f1 = Buffer.concat([gce(delayCs1), descriptor, dataA]);
  const f2 = Buffer.concat([gce(delayCs2), descriptor, identical ? dataA : dataB]);
  return Buffer.concat([header, gct, f1, f2, Buffer.from([0x3b])]);
}

describe("chunkIndexForFrame (binary search) parity with the linear scan", () => {
  const chunks = [
    { html: "a", frames: 3, startFrame: 0 },
    { html: "b", frames: 2, startFrame: 3 },
    { html: "c", frames: 5, startFrame: 5 },
  ];
  it("maps every frame to the chunk the linear scan picks", () => {
    for (let f = 0; f < 10; f++) {
      let linear = 0;
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (f >= chunks[i].startFrame) {
          linear = i;
          break;
        }
      }
      expect(chunkIndexForFrame(chunks, f)).toBe(linear);
    }
  });
  it("frames before the first chunk clamp to chunk 0", () => {
    expect(chunkIndexForFrame(chunks, -5)).toBe(0);
  });
  it("single-chunk and empty inputs are safe", () => {
    expect(chunkIndexForFrame([{ html: "x", frames: 4, startFrame: 0 }], 3)).toBe(0);
    expect(chunkIndexForFrame([], 1)).toBe(0);
  });
});

describe("GIF hold collapse parity with v0.9.1", () => {
  it("identical hold frames merge with accumulated delays — same bytes as the baseline", () => {
    const gif = twoFrameGif(5, 5, true);
    const next = collapseGifHolds(gif);
    const base = baseCollapse(gif);
    expect(next.collapsed).toBe(base.collapsed);
    expect(next.framesBefore).toBe(base.framesBefore);
    expect(next.framesAfter).toBe(base.framesAfter);
    expect(Buffer.from(next.buffer).equals(Buffer.from(base.buffer))).toBe(true);
    expect(gifStats(next.buffer)?.frames).toBe(1);
    expect(gifStats(next.buffer)?.durationMs).toBe(100); // 5cs + 5cs
  });

  it("distinct frames pass through structurally unchanged", () => {
    const gif = twoFrameGif(5, 7, false);
    const next = collapseGifHolds(gif);
    expect(next.collapsed).toBe(false);
    expect(gifStats(gif)?.frames).toBe(2);
    expect(gifStats(gif)?.durationMs).toBe(120);
  });

  it("non-GIF input passes through untouched", () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    const r = collapseGifHolds(bytes);
    expect(r.collapsed).toBe(false);
    expect(r.buffer.equals(bytes)).toBe(true);
  });

  it("parser structure matches the baseline on a two-frame stream", () => {
    const gif = twoFrameGif(5, 7, false);
    const next = parseGif(gif);
    const base = baseParse(gif);
    expect(next).not.toBeNull();
    expect(base).not.toBeNull();
    if (!next || !base) return;
    expect(next.frames.length).toBe(base.frames.length);
    expect(next.frames.map((f) => f.delayCs)).toEqual(base.frames.map((f) => f.delayCs));
    expect(Buffer.from(next.prefix).equals(Buffer.from(base.prefix))).toBe(true);
    expect(Buffer.from(next.suffix).equals(Buffer.from(base.suffix))).toBe(true);
    for (let i = 0; i < next.frames.length; i++) {
      expect(Buffer.from(next.frames[i].imageData).equals(Buffer.from(base.frames[i].imageData))).toBe(true);
      expect(Buffer.from(next.frames[i].gce!).equals(Buffer.from(base.frames[i].gce!))).toBe(true);
    }
  });
});

describe("encodePngRgba (v1.0 min-SAD filter)", () => {
  it("produces a valid PNG whose rows reconstruct the exact pixels", () => {
    const w = 4;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = i * 4;
      rgba[i * 4 + 1] = 128;
      rgba[i * 4 + 2] = 255 - i;
      rgba[i * 4 + 3] = 255;
    }
    const png = encodePngRgba(w, h, rgba);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const { inflateSync } = require("node:zlib") as typeof import("node:zlib");
    let off = 8;
    let idat: Buffer | null = null;
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      const type = png.subarray(off + 4, off + 8).toString("ascii");
      if (type === "IDAT") idat = png.subarray(off + 8, off + 8 + len);
      off += 12 + len;
    }
    expect(idat).not.toBeNull();
    const raw = inflateSync(idat!);
    expect(raw.length).toBe((w * 4 + 1) * h);
    const stride = w * 4;
    const recon = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
      const filter = raw[y * (stride + 1)];
      const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
      const prev = y > 0 ? recon.subarray((y - 1) * stride, y * stride) : null;
      for (let x = 0; x < stride; x++) {
        const a = x >= 4 ? recon[y * stride + x - 4] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= 4 ? prev[x - 4] : 0;
        let v = line[x];
        if (filter === 1) v = (v + a) & 0xff;
        else if (filter === 2) v = (v + b) & 0xff;
        else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        recon[y * stride + x] = v;
      }
    }
    for (let i = 0; i < w * h * 4; i++) expect(recon[i]).toBe(rgba[i]);
  });

  it("deterministic: same pixels → same bytes", () => {
    const w = 8;
    const h = 8;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i % 7) * 30);
    expect(encodePngRgba(w, h, rgba).equals(encodePngRgba(w, h, rgba))).toBe(true);
  });

  it("rejects malformed buffers", () => {
    expect(() => encodePngRgba(2, 2, new Uint8Array(3))).toThrow(/expected 16/);
  });
});
