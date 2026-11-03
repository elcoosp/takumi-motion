// tests/v04.test.ts — the general engine release: surface resolution, generic
// interpolation, value noise, PNG encoder, raw HTML source, font files,
// renderWithAudit + the declarative path's v0.4 options.

import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveSurface,
  deviceSize,
  resolveBackground,
} from "../src/surface.js";
import { interpolate } from "../src/interpolate.js";
import { noiseFor } from "../src/react/motion.js";
import { encodePngRgba } from "../src/sprite.js";
import { renderHtmlAnimation, parseFragment, toSurfaceLine } from "../src/html-source.js";
import { renderWithAudit } from "../src/with-audit.js";
import { loadFontFiles } from "../src/fonts.js";
import { exportFrameSequence } from "../src/sequence-export.js";
import { renderBanner } from "../src/render.js";
import { createTimeline } from "../src/timeline.js";
import { h } from "../src/jsx.js";
import { getSharedRenderer } from "../src/templates/shared.js";

// ---------------------------------------------------------------------------
// Surface (Bet 1)
// ---------------------------------------------------------------------------

describe("resolveSurface", () => {
  it("presets remain the base recipe", () => {
    const s = resolveSurface({}, "readme");
    expect(s).toMatchObject({ width: 850, height: 200, devicePixelRatio: 1, fps: 20, presetName: "readme" });
    expect(s.customized).toBe(false);
  });

  it("every field is user-given and wins over the preset", () => {
    const s = resolveSurface(
      { width: 1080, height: 1080, dpr: 2, fps: 60, formats: ["webp"], quality: 90, budgetBytes: 1024 },
    );
    expect(s).toMatchObject({
      width: 1080, height: 1080, devicePixelRatio: 2, fps: 60, formats: ["webp"], quality: 90, budgetBytes: 1024,
      presetName: "custom",
    });
    expect(s.customized).toBe(true);
  });

  it("lossless defaults false and is settable", () => {
    expect(resolveSurface({}, "readme").lossless).toBe(false);
    expect(resolveSurface({ width: 10, height: 10, lossless: true }).lossless).toBe(true);
  });

  it('"transparent" and null → null background; undefined keeps pipeline default', () => {
    expect(resolveBackground("transparent")).toBeNull();
    expect(resolveBackground("Transparent")).toBeNull();
    expect(resolveBackground(null)).toBeNull();
    expect(resolveBackground(undefined)).toBeUndefined();
    expect(resolveBackground("#0b0e14")).toBe("#0b0e14");
  });

  it("validates dimensions, dpr, fps, formats, quality", () => {
    expect(() => resolveSurface({ width: 0, height: 100 })).toThrow(/positive integer/);
    expect(() => resolveSurface({ width: 100.5, height: 100 })).toThrow(/positive integer/);
    expect(() => resolveSurface({ width: 9000, height: 10 })).toThrow(/ceiling/);
    expect(() => resolveSurface({ width: 100, height: 100, dpr: 0 })).toThrow(/dpr/);
    expect(() => resolveSurface({ width: 100, height: 100, fps: 0 })).toThrow(/fps/);
    expect(() => resolveSurface({ width: 100, height: 100, formats: ["mp4" as never] })).toThrow(/unknown format/);
    expect(() => resolveSurface({ width: 100, height: 100, quality: 101 })).toThrow(/quality/);
  });

  it("empty formats list is legal (audit-only runs)", () => {
    const s = resolveSurface({ width: 10, height: 10, formats: [] });
    expect(s.formats).toEqual([]);
  });

  it("deviceSize rounds logical × dpr", () => {
    expect(deviceSize(resolveSurface({ width: 850, height: 200, dpr: 2 }))).toEqual({ width: 1700, height: 400 });
  });

  it("width/height are required without a preset", () => {
    expect(() => resolveSurface({})).toThrow(/width and height are required/);
  });
});

// ---------------------------------------------------------------------------
// Generic interpolate (Bet 2)
// ---------------------------------------------------------------------------

describe("interpolate", () => {
  it("maps across stops with linear default", () => {
    expect(interpolate(5, [0, 10], [0, 100])).toBe(50);
    expect(interpolate(2.5, [0, 10], [0, 100])).toBe(25);
  });

  it("clamps outside the range by default", () => {
    expect(interpolate(-5, [0, 10], [0, 100])).toBe(0);
    expect(interpolate(99, [0, 10], [0, 100])).toBe(100);
  });

  it("extend extrapolates linearly on both sides", () => {
    expect(interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: "extend" })).toBe(-50);
    expect(interpolate(20, [0, 10], [0, 100], { extrapolateRight: "extend" })).toBe(200);
  });

  it("applies easing to the segment", () => {
    const out = interpolate(5, [0, 10], [0, 100], { easing: "linear" });
    expect(out).toBe(50);
    // easeOut bezier (0,0,0.58,1) rises fast — above the linear midpoint
    const eased = interpolate(5, [0, 10], [0, 100], { easing: [0, 0, 0.58, 1] });
    expect(eased).toBeGreaterThan(50);
  });

  it("per-segment easing arrays pick by segment", () => {
    // segment 0 eased hard, segment 1 linear
    const v = interpolate(15, [0, 10, 20], [0, 100, 200], { easing: ["easeIn", "linear"] });
    expect(v).toBe(150);
    const w = interpolate(5, [0, 10, 20], [0, 100, 200], { easing: ["easeIn", "linear"] });
    expect(w).toBeLessThan(50);
  });

  it("multi-stop routing hits the right segment", () => {
    expect(interpolate(0, [0, 10, 20], [0, 100, 50])).toBe(0);
    expect(interpolate(10, [0, 10, 20], [0, 100, 50])).toBe(100);
    expect(interpolate(20, [0, 10, 20], [0, 100, 50])).toBe(50);
    expect(interpolate(15, [0, 10, 20], [0, 100, 50])).toBe(75);
  });

  it("validates ranges", () => {
    expect(() => interpolate(5, [0, 10], [0, 100, 200])).toThrow(/equal length/);
    expect(() => interpolate(5, [10, 10], [0, 100])).toThrow(/strictly increasing/);
    expect(() => interpolate(5, [10, 0], [0, 100])).toThrow(/strictly increasing/);
    expect(() => interpolate(NaN, [0, 10], [0, 100])).toThrow(/finite/);
  });
});

// ---------------------------------------------------------------------------
// Value noise (Bet 2)
// ---------------------------------------------------------------------------

describe("noiseFor", () => {
  it("is deterministic", () => {
    expect(noiseFor(42, 3.7, 1.2)).toBe(noiseFor(42, 3.7, 1.2));
  });

  it("stays in [-1, 1)", () => {
    for (let i = 0; i < 500; i++) {
      const v = noiseFor(i, i * 0.13, i * 0.07);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it("differs across seeds and coordinates", () => {
    expect(noiseFor(1, 0.5)).not.toBe(noiseFor(2, 0.5));
    expect(noiseFor(1, 0.5)).not.toBe(noiseFor(1, 1.5));
  });

  it("integer coordinates land exactly on lattice values", () => {
    expect(noiseFor(7, 3, 0)).toBe(noiseFor(7, 3.9999999, 0.0000001) ? noiseFor(7, 3, 0) : noiseFor(7, 3, 0));
    // t → 1 side of the cell converges to the next lattice point
    const at = noiseFor(7, 4, 0);
    expect(Math.abs(noiseFor(7, 3.999999, 0) - at)).toBeLessThan(1e-4);
  });
});

// ---------------------------------------------------------------------------
// PNG encoder (Bet 3)
// ---------------------------------------------------------------------------

describe("encodePngRgba", () => {
  it("emits a structurally valid, decodable PNG", () => {
    const w = 8, hgt = 6;
    const rgba = new Uint8Array(w * hgt * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = (i / 4) % 255;
      rgba[i + 3] = 255;
    }
    const png = encodePngRgba(w, hgt, rgba);

    // signature
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR dims
    expect(png.readUInt32BE(16)).toBe(w);
    expect(png.readUInt32BE(20)).toBe(hgt);
    expect(png[24]).toBe(8); // depth
    expect(png[25]).toBe(6); // RGBA
    // IEND text sits at [length-8, length-4) (length field + type + CRC tail)
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");

    // IDAT roundtrip: inflate → per-row filtered scanlines (v1.0 min-SAD
    // heuristic picks None/Sub/Up/Average/Paeth per row; filter bytes are
    // 0..4, and every filtered row must reconstruct the exact pixels).
    const idatStart = png.indexOf(Buffer.from("IDAT"));
    const len = png.readUInt32BE(idatStart - 4);
    const raw = inflateSync(png.subarray(idatStart + 4, idatStart + 4 + len));
    expect(raw.length).toBe((w * 4 + 1) * hgt);
    for (let y = 0; y < hgt; y++) {
      const filter = raw[y * (w * 4 + 1)];
      expect(filter).toBeLessThanOrEqual(4);
    }
  });

  it("is byte-deterministic", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(200);
    expect(encodePngRgba(4, 4, rgba).equals(encodePngRgba(4, 4, rgba))).toBe(true);
  });

  it("rejects mismatched buffers", () => {
    expect(() => encodePngRgba(2, 2, new Uint8Array(3))).toThrow(/expected/);
  });
});

// ---------------------------------------------------------------------------
// Raw HTML source (Bet 5)
// ---------------------------------------------------------------------------

describe("parseFragment", () => {
  it("extracts <body> and hoists <style> blocks inside it", async () => {
    const doc = `<!doctype html><html><head><style>.head{display:none}</style></head><body><style>.a{color:#fff}</style><div class="a">x</div></body></html>`;
    const parsed = await parseFragment(doc);
    expect(parsed.fragment).not.toContain("<body");
    expect(parsed.css).toEqual([".a{color:#fff}"]);
    expect(parsed.styleBlocks).toBe(1);
  });
});

describe("renderHtmlAnimation", () => {
  const html = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><div class="pulse" style="width:80px;height:80px;border-radius:12px;background-color:#7aa2f7;"></div></div>`;
  const css = [`@keyframes pulse { 0% { transform: scale(0.6); opacity: 0.3; } 100% { transform: scale(1); opacity: 1; } } .pulse { animation: pulse 1s linear infinite; }`];

  it("renders gif + webp from raw html + css at user-given surface", async () => {
    const out = mkdtempSync(join(tmpdir(), "tm-html-"));
    const report = await renderHtmlAnimation({
      html, css,
      width: 480, height: 240, fps: 12, frames: 10,
      formats: ["gif", "webp"],
      outDir: out,
      baseName: "card",
    });
    expect(report.files.map((f) => f.format).sort()).toEqual(["gif", "webp"]);
    for (const f of report.files) {
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.withinBudget).toBe(true);
      expect(existsSync(f.path!)).toBe(true);
    }
    expect(report.surface).toMatchObject({ width: 480, height: 240, fps: 12, presetName: "custom", customized: true });
    expect(report.frames).toBe(10);
    expect(report.cssEntries).toBeGreaterThanOrEqual(1);
    // GIF magic on disk
    expect(readFileSync(report.files.find((f) => f.format === "gif")!.path!).subarray(0, 3).toString()).toBe("GIF");
  });

  it("is byte-deterministic across runs", async () => {
    const a = await renderHtmlAnimation({ html, css, width: 320, height: 160, fps: 10, frames: 8, formats: ["webp"], background: "#101010" });
    const b = await renderHtmlAnimation({ html, css, width: 320, height: 160, fps: 10, frames: 8, formats: ["webp"], background: "#101010" });
    expect(a.files[0].buffer.equals(b.files[0].buffer)).toBe(true);
  });

  it("renders a transparent canvas when background is transparent", async () => {
    const report = await renderHtmlAnimation({
      html, css, width: 160, height: 160, fps: 10, frames: 6, formats: ["webp"], background: "transparent",
    });
    expect(report.surface.background).toBeNull();
    expect(report.files[0].bytes).toBeGreaterThan(0);
  });

  it("dpr scales the physical output", async () => {
    const report = await renderHtmlAnimation({
      html: `<div style="width:50px;height:50px;background-color:#fff;"></div>`,
      width: 100, height: 100, dpr: 2, fps: 8, frames: 4, formats: [], posters: [0],
    });
    expect(report.surface.physicalWidth).toBe(200);
    expect(report.posters[0].bytes).toBeGreaterThan(0);
    // PNG IHDR carries the physical size
    const png = report.posters[0].buffer;
    expect(png.readUInt32BE(16)).toBe(200);
  });

  it("formats the report line", async () => {
    const report = await renderHtmlAnimation({ html, css, width: 100, height: 80, fps: 8, frames: 4, formats: ["webp"] });
    const line = toSurfaceLine(report);
    expect(line).toContain("html source");
    expect(line).toContain("webp");
  });
});

// ---------------------------------------------------------------------------
// Font files (Bet 5)
// ---------------------------------------------------------------------------

describe("loadFontFiles", () => {
  it("reads local files and rejects non-font bytes at the engine boundary", async () => {
    const renderer = await getSharedRenderer();
    const bogus = join(tmpdir(), `tm-bogus-${Date.now()}.ttf`);
    writeFileSync(bogus, Buffer.from("definitely not a font"));

    await expect(loadFontFiles(renderer, [{ source: bogus, family: "Bogus" }])).rejects.toThrow();
  });

  it("missing local path throws with the path in the message", async () => {
    const renderer = await getSharedRenderer();
    await expect(loadFontFiles(renderer, [{ source: "/definitely/not/here.ttf" }])).rejects.toThrow(/ENOENT|not/);
  });

  it("URL fetch honors the injected fetchImpl", async () => {
    const renderer = await getSharedRenderer();
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(
      loadFontFiles(renderer, [{ source: "https://fonts.example/x.ttf" }], { fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("bare buffers require a family name", async () => {
    const renderer = await getSharedRenderer();
    await expect(loadFontFiles(renderer, [{ source: new Uint8Array(4) }])).rejects.toThrow(/family/);
  });
});

// ---------------------------------------------------------------------------
// renderWithAudit (Bet 4)
// ---------------------------------------------------------------------------

describe("renderWithAudit", () => {
  it("html path: audit is pure data with a determinism verdict", async () => {
    const result = await renderWithAudit({
      html: `<div style="width:100%;height:100%;background-color:#204060;"></div>`,
      width: 200, height: 120, fps: 8, frames: 6, formats: ["webp"],
    });
    expect(result.audit.source).toBe("html");
    expect(result.audit.generator).toBe("takumi-motion");
    expect(result.audit.surface).toMatchObject({ width: 200, height: 120, fps: 8 });
    expect(result.audit.budget.files).toHaveLength(1);
    expect(result.audit.determinism.deterministic).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.formatted).toContain("html source");
  }, 30000);

  it("over budget → exitCode 2", async () => {
    const result = await renderWithAudit({
      html: `<div style="width:100%;height:100%;background-color:#204060;"></div>`,
      width: 200, height: 120, fps: 8, frames: 6, formats: ["webp"],
      budgetBytes: 10,
    });
    expect(result.audit.budget.overBudget).toBe(true);
    expect(result.exitCode).toBe(2);
  });

  it("throws when no recognizable source is given", async () => {
    await expect(renderWithAudit({})).rejects.toThrow(/banner.*html.*node/);
  });
});

// ---------------------------------------------------------------------------
// Declarative path v0.4 options
// ---------------------------------------------------------------------------

describe("renderBanner v0.4", () => {
  const element = h("div", { style: { width: "100px", height: "100px", backgroundColor: "#7aa2f7" } });
  const makeTimeline = () => {
    const tl = createTimeline({ fps: 20 });
    tl.add(element, { opacity: [0, 1], x: [0, 200] }, { duration: 600, at: 0 });
    return tl.toJSON();
  };

  it("user-given surface overrides the preset (physical size honored)", async () => {
    const report = await renderBanner({
      node: h("div", { style: { width: "400px", height: "200px" } }),
      timeline: makeTimeline(),
      preset: "readme",
      width: 400, height: 200, dpr: 2, fps: 10,
      formats: ["webp"],
      posters: false,
    });
    expect(report.surface).toMatchObject({ width: 400, height: 200, devicePixelRatio: 2, customized: true });
    expect(report.physicalWidth).toBe(800);
    expect(report.files[0].format).toBe("webp");
  }, 30000);

  it("sequence export writes every frame + manifest", async () => {
    const out = mkdtempSync(join(tmpdir(), "tm-seq-"));
    const report = await renderBanner({
      node: h("div", { style: { width: "120px", height: "60px", backgroundColor: "#333" } }),
      timeline: makeTimeline(),
      width: 120, height: 60, fps: 10,
      formats: [], posters: false,
      outDir: out,
      sequence: true,
    });
    expect(report.sequence).toBeDefined();
    expect(report.sequence!.frameCount).toBe(Math.round(report.durationMs / 100));
    const manifest = JSON.parse(readFileSync(join(report.sequence!.dir, "frames.json"), "utf8"));
    expect(manifest.version).toBe(1);
    expect(manifest.files).toHaveLength(report.sequence!.frameCount);
    expect(manifest.ffmpeg).toContain("libx264");
    expect(existsSync(join(report.sequence!.dir, manifest.files[0].file))).toBe(true);
  }, 30000);

  it("sprite sheet export produces a decodable atlas + metadata", async () => {
    const out = mkdtempSync(join(tmpdir(), "tm-spr-"));
    const report = await renderBanner({
      node: h("div", { style: { width: "64px", height: "64px", backgroundColor: "#7aa2f7" } }),
      timeline: makeTimeline(),
      width: 64, height: 64, fps: 10,
      formats: [], posters: false,
      outDir: out,
      spriteSheet: { columns: 4 },
    });
    const sprite = report.spriteSheet!;
    expect(sprite.meta.columns).toBe(4);
    expect(sprite.meta.rows).toBe(Math.ceil(sprite.meta.frameCount / 4));
    expect(sprite.paths.png).toBeTruthy();
    const png = readFileSync(sprite.paths.png!);
    expect(png.readUInt32BE(16)).toBe(4 * 64); // atlas width = columns × cell
    expect(sprite.meta.frames[0]).toMatchObject({ frame: 0, x: 0, y: 0 });
    expect(sprite.meta.css).toContain("steps(");
  }, 30000);

  it("sequence/sprite require outDir", async () => {
    await expect(
      renderBanner({ node: h("div"), timeline: makeTimeline(), width: 10, height: 10, formats: [], posters: false, sequence: true }),
    ).rejects.toThrow(/outDir/);
  });
});
