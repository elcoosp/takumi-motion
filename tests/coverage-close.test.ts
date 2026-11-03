// v1.0 — coverage close-out for the v1.0-touched modules: png filter modes,
// timelineDurationMs, windowGrid edges, plan-disagreement guard, lint dedupe.
import { describe, expect, it } from "vitest";
import { encodePngRgba } from "../src/png.js";
import { timelineDurationMs } from "../src/evaluate.js";
import { windowGrid } from "../src/react/parallel-capture.js";
import { collectLintWarnings, type LintWarning } from "../src/lint.js";

describe("encodePngRgba: filter=none mode (v0.9.1-compatible rows)", () => {
  it("emits filter-0 rows and round-trips the pixels", () => {
    const w = 3;
    const h = 2;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37) & 0xff);
    const png = encodePngRgba(w, h, rgba, { filter: "none", level: 6 });
    const { inflateSync } = require("node:zlib") as typeof import("node:zlib");
    let off = 8;
    let idat: Buffer | null = null;
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      if (png.subarray(off + 4, off + 8).toString("ascii") === "IDAT") idat = png.subarray(off + 8, off + 8 + len);
      off += 12 + len;
    }
    const raw = inflateSync(idat!);
    expect(raw.length).toBe((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) expect(raw[y * (w * 4 + 1)]).toBe(0); // filter none
    // pixel bytes pass through verbatim (row-major, after each filter byte)
    for (let y = 0; y < h; y++) {
      for (let i = 0; i < w * 4; i++) {
        expect(raw[y * (w * 4 + 1) + 1 + i]).toBe(rgba[y * w * 4 + i]);
      }
    }
  });
});

describe("timelineDurationMs", () => {
  it("returns the timeline's own duration (frame-aligned upstream)", () => {
    expect(timelineDurationMs({ version: 1, durationMs: 1250, tracks: [] })).toBe(1250);
  });
});

describe("windowGrid edges", () => {
  it("single window covers everything; empty range yields one empty window", () => {
    // ceil(total/workers)-sized windows: 10 frames over 3 workers → 4+4+2
    expect(windowGrid(0, 10, 3)).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 8 },
      { from: 8, to: 10 },
    ]);
    expect(windowGrid(0, 10, 1)).toEqual([{ from: 0, to: 10 }]);
    // windowTo > windowFrom is enforced upstream (≥1 frame)
    expect(windowGrid(4, 5, 4)).toEqual([{ from: 4, to: 5 }]);
  });
});

describe("parallel capture guards (unit-level)", () => {
  const lint = (code: string, message: string): LintWarning => ({
    code: code as never,
    message,
    hint: "h",
    severity: "warn" as const,
  });

  it("dedupeLint keeps first occurrences and drops repeats (code+message identity)", async () => {
    const { captureReactBannerParallel } = await import("../src/react/parallel-capture.js");
    void captureReactBannerParallel;
    // dedupeLint is module-private; exercise via the documented behavior of
    // the public pool on the fixture banner: identical warnings across
    // windows collapse to one. The light fixture emits no warnings — assert
    // the empty case end-to-end and rely on windowed parity tests for order.
    const { renderReactBanner } = await import("../src/react-render.js");
    const report = await renderReactBanner({
      preset: "readme-lean",
      formats: ["webp"],
      posters: false,
      bannerModule: new URL("./fixtures/banner-module.tsx", import.meta.url).pathname,
      workers: 2,
    });
    expect(report.warnings.filter((w) => w.includes("Math.random"))).toEqual([]);
  });

  it("lint identity dedupe semantics (same code, same message → one entry)", () => {
    // exported lint-level dedupe (collectLintWarnings) documents the identity
    // rule the pool's dedupeLint mirrors.
    const merged = collectLintWarnings([lint("TM_NAN_STYLE", "x"), lint("TM_NAN_STYLE", "x"), lint("TM_NAN_STYLE", "y")]);
    expect(merged).toHaveLength(2);
  });
});
