// tests/v05.test.ts — the composition & stills release: bounded-parallel
// pipeline (mapWithConcurrency, resolveConcurrency), renderStill on all three
// source paths, concurrency-invariant outputs (byte-identical at 1 vs N),
// sequence/sprite parallel determinism.

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";

import { mapWithConcurrency, resolveConcurrency } from "../src/concurrency.js";
import { renderStill } from "../src/still.js";
import { renderReactBanner } from "../src/react-render.js";
import { exportFrameSequence } from "../src/sequence-export.js";
import { renderSpriteSheet } from "../src/sprite.js";
import { renderWithAudit } from "../src/with-audit.js";
import {
  defineBanner,
  Banner,
  Scene,
  Layer,
  useCurrentFrame,
  useAbsoluteFrame,
  useSpring,
  useNoise,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { h, createTimeline } from "../src/index.js";
import { getSharedRenderer } from "../src/templates/shared.js";
import { fromHtml } from "@takumi-rs/helpers/html";
import { fromJsx } from "@takumi-rs/helpers/jsx";

// ---------------------------------------------------------------------------
// Shared probe components (deterministic frame math — pure (frame) output)
// ---------------------------------------------------------------------------

function SpringBox(): ReactElement {
  const frame = useCurrentFrame();
  const value = useSpring({ stiffness: 180, damping: 22 });
  return createElement(
    "div",
    {
      style: {
        position: "absolute",
        left: `${8 + value * 40 + frame * 0.2}px`,
        top: "20px",
        width: "60px",
        height: "24px",
        backgroundColor: "#7aa2f7",
        opacity: 0.4 + value * 0.6,
      },
    },
    `f${frame}`,
  );
}

function Drift(): ReactElement {
  const frame = useAbsoluteFrame();
  const n = useNoise("drift", { amplitude: 3 });
  return createElement("div", {
    style: {
      position: "absolute",
      left: `${100 + n}px`,
      top: `${10 + n}px`,
      width: "20px",
      height: "20px",
      borderRadius: "10px",
      backgroundColor: "#bb9af7",
    },
  });
}

function FrameText(): ReactElement {
  const frame = useCurrentFrame();
  return createElement(
    "div",
    { style: { position: "absolute", left: "10px", top: "10px", width: "200px", height: "40px", fontSize: "20px", color: "#a9b1d6" } },
    `frame ${frame}`,
  );
}

// ---------------------------------------------------------------------------
// Concurrency primitives
// ---------------------------------------------------------------------------

describe("resolveConcurrency", () => {
  it("explicit limits win and are validated", () => {
    expect(resolveConcurrency(1)).toBe(1);
    expect(resolveConcurrency(16)).toBe(16);
    expect(() => resolveConcurrency(0)).toThrow(/positive integer/);
    expect(() => resolveConcurrency(2.5)).toThrow(/positive integer/);
  });

  it("undefined falls back to cores capped at 8, and never below 1", () => {
    const n = resolveConcurrency(undefined);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(8);
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const results = await mapWithConcurrency(
      [30, 5, 20, 1, 10],
      4,
      async (delay) => {
        await new Promise((r) => setTimeout(r, delay));
        return delay;
      },
    );
    expect(results).toEqual([30, 5, 20, 1, 10]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 24 }, (_, i) => i), 3, async (i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return i;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("works with non-promise mappers (napi helpers return plain values)", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, (n) => n * 10);
    expect(results).toEqual([10, 20, 30]);
  });

  it("a rejection fails the map", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

// ---------------------------------------------------------------------------
// renderStill — html path
// ---------------------------------------------------------------------------

const STILL_HTML =
  '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background-color:#0b0e14;">' +
  '<div class="dot" style="width:80px;height:80px;border-radius:40px;background-color:#7aa2f7;"></div></div>';
const STILL_CSS =
  "@keyframes stillSweep { from { transform: translateX(-200px); } to { transform: translateX(200px); } }\n" +
  ".dot { animation: stillSweep 1s linear infinite; }";

describe("renderStill (html)", () => {
  it("renders a single PNG at frame → timeMs", async () => {
    const still = await renderStill({
      html: STILL_HTML,
      css: STILL_CSS,
      width: 600,
      height: 315,
      fps: 30,
      frame: 15,
    });
    expect(still.source).toBe("html");
    expect(still.png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(still.physicalWidth).toBe(600);
    expect(still.physicalHeight).toBe(315);
    expect(still.timeMs).toBe(500);
    expect(still.bytes).toBeGreaterThan(500);
  });

  it("animated frames differ; outDir writes the file", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "tm-still-html-"));
    const f0 = await renderStill({ html: STILL_HTML, css: STILL_CSS, width: 400, height: 200, fps: 20, frame: 0 });
    const f5 = await renderStill({ html: STILL_HTML, css: STILL_CSS, width: 400, height: 200, fps: 20, frame: 5 });
    expect(f0.png.equals(f5.png)).toBe(false);

    const written = await renderStill({
      html: STILL_HTML, css: STILL_CSS, width: 400, height: 200, fps: 20, frame: 3,
      outDir, baseName: "card",
    });
    expect(written.path).toBe(join(outDir, "card.png"));
    expect(existsSync(written.path!)).toBe(true);
    expect(readFileSync(written.path!).equals(written.png)).toBe(true);
  });

  it("background flows to the report; the markup owns the canvas (html doctrine)", async () => {
    const content = '<div style="width:50px;height:50px;background-color:#ff0000;"></div>';
    const transparent = await renderStill({ html: content, width: 100, height: 100, background: "transparent" });
    expect(transparent.background).toBeNull();
    const colored = await renderStill({ html: content, width: 100, height: 100, background: "#ffffff" });
    expect(colored.background).toBe("#ffffff");

    // Different content → different still (the html itself paints).
    const red = await renderStill({ html: '<div style="width:100%;height:100%;background-color:#ff0000;"></div>', width: 100, height: 100 });
    const blue = await renderStill({ html: '<div style="width:100%;height:100%;background-color:#0000ff;"></div>', width: 100, height: 100 });
    expect(red.png.equals(blue.png)).toBe(false);
  });

  it("rejects missing width/height (surface contract)", async () => {
    await expect(renderStill({ html: STILL_HTML })).rejects.toThrow(/width and height are required/);
  });
});

// ---------------------------------------------------------------------------
// renderStill — declarative path
// ---------------------------------------------------------------------------

describe("renderStill (declarative)", () => {
  it("samples the timeline at frame × frameMs", async () => {
    const node = h(
      "div",
      { style: { width: "100%", height: "100%", backgroundColor: "#101014", display: "flex", "align-items": "center", "justify-content": "center" } },
      h("div", { className: "box", style: { width: "120px", height: "24px", backgroundColor: "#f7768e" } }),
    );
    const tl = createTimeline();
    tl.add(".box", { x: [0, 160] }, { duration: 1000, at: 0, type: "tween", ease: "linear" });
    const still = await renderStill({ node, timeline: tl.toJSON(), width: 400, height: 200, fps: 20, frame: 10 });
    expect(still.source).toBe("declarative");
    expect(still.timeMs).toBe(500);
    expect(still.png.subarray(1, 4)).toEqual(Buffer.from("PNG", "ascii"));
    expect(still.bytes).toBeGreaterThan(100); // solid-color 400×200 PNG compresses hard
  });

  it("rejects frames outside the timeline", async () => {
    const node = h("div", { style: { width: "100px", height: "100px", backgroundColor: "#123456" } });
    const tl = createTimeline();
    tl.add("div", { opacity: [0, 1] }, { duration: 200, at: 0, type: "tween", ease: "linear" });
    await expect(renderStill({ node, timeline: tl.toJSON(), width: 200, height: 200, fps: 20, frame: 99 })).rejects.toThrow(/outside the timeline/);
  });
});

// ---------------------------------------------------------------------------
// renderStill — react path (byte-parity with the pipeline poster)
// ---------------------------------------------------------------------------

describe("renderStill (react)", () => {
  it("is byte-identical to the pipeline poster for the same frame", async () => {
    const renderer = await getSharedRenderer();
    const banner = defineBanner(function StillBanner() {
      return createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(Scene, { duration: 40, key: "s1" }, createElement(SpringBox, { key: "b" })),
        createElement(Scene, { duration: 30, key: "s2" }, createElement(FrameText, { key: "t" })),
      );
    });

    const report = await renderReactBanner({ banner, posters: [12], formats: [], renderer });
    const poster = report.posters[0]!;
    const still = await renderStill({ banner, frame: 12, formats: [], renderer });

    expect(still.source).toBe("react");
    expect(still.frame).toBe(12);
    expect(still.png.equals(poster.buffer)).toBe(true);
  });

  it("default frame is the settled 60% frame; out of range throws", async () => {
    const banner = defineBanner(function StillBanner2() {
      return createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(Scene, { duration: 20, key: "s" }, createElement(FrameText, { key: "t" })),
      );
    });
    const still = await renderStill({ banner, formats: [] });
    expect(still.frame).toBe(12); // round(20 * 0.6)

    await expect(renderStill({ banner, formats: [], frame: 20 })).rejects.toThrow(/outside the banner timeline/);
  });
});

// ---------------------------------------------------------------------------
// Concurrency invariance — byte-identical output at 1 vs N
// ---------------------------------------------------------------------------

describe("bounded-parallel determinism", () => {
  it("renderReactBanner: concurrency 1 vs 6 → byte-identical files + posters", async () => {
    const banner = defineBanner(function DetBanner() {
      return createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(Layer, { bottom: true, key: "l" }, createElement(Drift, { key: "d" })),
        createElement(Scene, { duration: 24, key: "s1", enter: "crossfade" }, createElement(SpringBox, { key: "a" })),
        createElement(Scene, { duration: 24, key: "s2", enter: "slide" }, createElement(SpringBox, { key: "b" })),
      );
    });

    const one = await renderReactBanner({ banner, formats: ["gif", "webp"], concurrency: 1, posters: [5, 20] });
    const many = await renderReactBanner({ banner, formats: ["gif", "webp"], concurrency: 6, posters: [5, 20] });

    expect(one.files.length).toBe(2);
    for (let i = 0; i < one.files.length; i++) {
      expect(many.files[i]!.format).toBe(one.files[i]!.format);
      expect(many.files[i]!.buffer.equals(one.files[i]!.buffer)).toBe(true);
    }
    expect(many.posters[0]!.buffer.equals(one.posters[0]!.buffer)).toBe(true);
    expect(many.posters[1]!.buffer.equals(one.posters[1]!.buffer)).toBe(true);
    // timings block present (v0.5 observability)
    expect(one.timings.totalMs).toBeGreaterThan(0);
    expect(one.timings.captureMs).toBeGreaterThan(0);
  });

  it("sequence export: concurrency 1 vs 5 → identical frame bytes", async () => {
    const banner = defineBanner(function SeqBanner() {
      return createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(Scene, { duration: 16, key: "s" }, createElement(SpringBox, { key: "a" })),
      );
    });
    const renderer = await getSharedRenderer();
    const capture = await captureReactBanner(banner);
    const nodes: never[] = [];
    const cssSet = new Map<string, string>();
    for (const chunk of capture.chunks) {
      const parsed = await fromHtml(chunk.html);
      nodes.push(parsed.node as never);
      for (const entry of parsed.css) if (!cssSet.has(entry)) cssSet.set(entry, entry);
    }
    const css = [...cssSet.values()];

    const source = {
      renderAt: (frame: number) => {
        let ci = 0;
        for (let i = capture.chunks.length - 1; i >= 0; i--) {
          if (frame >= capture.chunks[i].startFrame) { ci = i; break; }
        }
        return { node: nodes[ci], timeMs: (frame - capture.chunks[ci].startFrame) * capture.plan.frameMs };
      },
      css,
      frames: capture.plan.totalFrames,
      frameMs: capture.plan.frameMs,
      fps: 20,
      width: 850,
      height: 200,
      devicePixelRatio: 1,
      chunkIndexForFrame: (frame: number) => {
        for (let i = capture.chunks.length - 1; i >= 0; i--) if (frame >= capture.chunks[i].startFrame) return i;
        return 0;
      },
      chunkKey: (ci: number) => `chunk-${ci}`,
      holdsStatic: css.every((entry) => !/@keyframes|animation(-name|-duration)?\s*:/i.test(entry)),
    };

    const dir1 = mkdtempSync(join(tmpdir(), "tm-seq-1-"));
    const dirN = mkdtempSync(join(tmpdir(), "tm-seq-n-"));
    const one = await exportFrameSequence(renderer, source, { outDir: dir1, concurrency: 1 });
    const many = await exportFrameSequence(renderer, source, { outDir: dirN, concurrency: 5 });

    expect(one.frameCount).toBe(many.frameCount);
    expect(one.files.map((f) => f.file)).toEqual(many.files.map((f) => f.file));
    for (let i = 0; i < one.files.length; i++) {
      const a = readFileSync(join(dir1, "sequence", one.files[i]!.file));
      const b = readFileSync(join(dirN, "sequence", many.files[i]!.file));
      expect(b.equals(a)).toBe(true);
    }
  });

  it("sprite sheet: concurrency 1 vs 4 → identical atlas bytes", async () => {
    const renderer = await getSharedRenderer();
    const element = h("div", { style: { width: "100%", height: "100%", backgroundColor: "#0f0f14", display: "flex", "align-items": "center", "justify-content": "center" } },
      h("div", { style: { width: "30px", height: "30px", borderRadius: "15px", backgroundColor: "#9ece6a" } }));
    const node = (await fromJsx(element as never)).node;
    const source = {
      renderAt: (frame: number) => ({ node, timeMs: frame * 50 }),
      css: [] as string[],
      frames: 8,
      frameMs: 50,
      fps: 20,
      width: 64,
      height: 64,
      devicePixelRatio: 1,
    };
    const one = await renderSpriteSheet(renderer, source, { columns: 4, concurrency: 1 });
    const many = await renderSpriteSheet(renderer, source, { columns: 4, concurrency: 4 });
    expect(one.png.equals(many.png)).toBe(true);
    expect(many.meta.frames.map((f) => f.frame)).toEqual(one.meta.frames.map((f) => f.frame));
  });
});

// ---------------------------------------------------------------------------
// renderWithAudit picks up the timings-era react report unchanged
// ---------------------------------------------------------------------------

describe("renderWithAudit (v0.5 compat)", () => {
  it("still audits a react banner end-to-end", async () => {
    const banner = defineBanner(function AuditBanner() {
      return createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(Scene, { duration: 20, key: "s" }, createElement(FrameText, { key: "t" })),
      );
    });
    const result = await renderWithAudit({ banner, skipDeterminismProbe: true });
    expect(result.exitCode).toBe(0);
    expect(result.audit.source).toBe("react");
  });
});
