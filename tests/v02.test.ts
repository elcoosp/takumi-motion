// takumi-motion — v0.2 feature tests
// fonts / themes / personality / orchestrate / audit / size / preview / kit.
// Network-dependent paths (googleFonts) are exercised in integration smoke
// scripts, not here — these tests pin the pure logic.

import { describe, expect, it } from "vitest";
import { createTimeline } from "../src/timeline.js";
import { checkLoopSeam } from "../src/loop.js";

import { fontStack, isCatalogFont, loadedFontFamilies, type FontSpec } from "../src/fonts.js";
import { resolveTheme, themes } from "../src/themes.js";
import {
  ambientWindow,
  personalities,
  resolvePersonality,
} from "../src/personality.js";
import {
  deceleratingStagger,
  revealRow,
  revealUnits,
  splitGlyphs,
  splitWords,
  visibleUnit,
  waveUnits,
} from "../src/orchestrate.js";
import {
  checkBanner,
  matrixFor,
  parseTransformOrigin,
  seamEnergy,
} from "../src/audit.js";
import {
  collapseGifHolds,
  gifStats,
  optimizeBudget,
  parseGif,
} from "../src/size.js";
import { cssEntriesToText, elementToHtml, renderPreviewHtml } from "../src/preview.js";
import { compileTimeline } from "../src/compile.js";
import { h } from "../src/jsx.js";

// ---------------------------------------------------------------------------
// fonts
// ---------------------------------------------------------------------------

describe("fonts", () => {
  it("fontStack joins family with fallbacks", () => {
    expect(fontStack("Inter", "sans-serif")).toBe("Inter, sans-serif");
    expect(fontStack("Space Grotesk")).toBe("Space Grotesk");
  });

  it("catalog membership check", () => {
    expect(isCatalogFont("Space Grotesk")).toBe(true);
    expect(isCatalogFont("Comic Sans MS")).toBe(false);
  });

  it("loadedFontFamilies reads the dedup registry", () => {
    // no renderer registered → empty
    const fake = {} as never;
    expect(loadedFontFamilies(fake)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// themes
// ---------------------------------------------------------------------------

describe("themes", () => {
  it("resolves built-ins and rejects unknown names helpfully", () => {
    const tokyo = resolveTheme("tokyo-night");
    expect(tokyo.accent).toBe("#7aa2f7");
    expect(() => resolveTheme("nope")).toThrow(/Available: /);
  });

  it("completes partial custom themes over midnight", () => {
    const custom = resolveTheme({ accent: "#ff0000" });
    expect(custom.accent).toBe("#ff0000");
    expect(custom.bg).toBe(themes.midnight.bg);
    expect(custom.text).toBe(themes.midnight.text);
  });

  it("every theme is GIF-safe on glow opacity (≤ 0.16)", () => {
    for (const theme of Object.values(themes)) {
      expect(theme.glow).toBeLessThanOrEqual(0.16);
      expect(theme.bg).toMatch(/^#/);
    }
  });
});

// ---------------------------------------------------------------------------
// personality + ambientWindow
// ---------------------------------------------------------------------------

describe("personality", () => {
  it("resolves by name, throws with the list", () => {
    expect(resolvePersonality("smooth").name).toBe("smooth");
    expect(() => resolvePersonality("wild")).toThrow(/Available: /);
  });

  it("personalities differ meaningfully", () => {
    expect(personalities.snappy.staggerMs).toBeLessThan(personalities.smooth.staggerMs);
    expect(personalities.playful.spring).toBeDefined();
    expect(personalities.mechanical.entrance).toHaveProperty("steps");
  });

  it("ambientWindow emits ordered, period-dividing mirror triples", () => {
    const tl = createTimeline({ fps: 20 });
    ambientWindow(tl, ".g", "drift", {
      periodMs: 2000,
      windows: [[0, 500], [1000, 1500]],
      intensity: 0.5,
      fps: 20,
    });
    const json = tl.toJSON();
    const track = json.tracks.find((t) => t.target === ".g")!;
    expect(track.keyframes).toEqual([-9, 9, -9, -9, 9, -9]);
    expect(track.times![0]).toBe(0);
    expect(track.times![2]).toBeCloseTo(0.25, 10);
    expect(track.times![3]).toBeCloseTo(0.5, 10);
    expect(checkLoopSeam(json).seamless).toBe(true);
  });

  it("ambientWindow rejects odd frame-count windows", () => {
    const tl = createTimeline({ fps: 20 });
    // 50ms at 20fps = 1 frame — odd, peak off-grid
    expect(() =>
      ambientWindow(tl, ".g", "drift", { periodMs: 2000, windows: [[0, 50]], fps: 20 })
    ).toThrow(/EVEN frame count/);
  });

  it("ambientWindow enforces ordered non-overlapping windows", () => {
    const tl = createTimeline({ fps: 20 });
    expect(() =>
      ambientWindow(tl, ".g", "drift", { periodMs: 2000, windows: [[500, 300]], fps: 20 })
    ).toThrow(/invalid window/);
  });

  it("high-low-high phase rests at base (solid cursor)", () => {
    const tl = createTimeline({ fps: 20 });
    ambientWindow(tl, ".c", "pulse", {
      periodMs: 2000, windows: [[0, 400]], amplitude: 0.85, phase: "high-low-high", fps: 20,
    });
    const track = tl.toJSON().tracks[0]!;
    expect(track.keyframes![0]).toBeCloseTo(1, 10);
    expect(track.keyframes![1]).toBeCloseTo(0.15, 10);
  });
});

// ---------------------------------------------------------------------------
// orchestrate
// ---------------------------------------------------------------------------

describe("orchestrate", () => {
  it("splits glyphs and words, maps spaces", () => {
    expect(splitGlyphs("ab c")).toEqual(["a", "b", " ", "c"]);
    expect(splitWords("hello  world")).toEqual(["hello", "world"]);
    expect(visibleUnit(" ")).toBe("\u00a0");
  });

  it("deceleratingStagger: first unit at 0, sum bounded by n·stagger", () => {
    const n = 6, stagger = 30;
    expect(deceleratingStagger(0, n, stagger)).toBe(0);
    const last = deceleratingStagger(n - 1, n, stagger);
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThanOrEqual(n * stagger);
  });

  it("revealRow: strict-seam safe (opacity 0→1→1→0, y returns)", () => {
    const tl = createTimeline({ fps: 20 });
    const row = revealRow(tl, {
      text: "hey",
      classNamePrefix: "rr",
      periodMs: 2400,
      at: 100,
      staggerMs: 40,
      inMs: 300,
      rise: 20,
      exitAt: 1800,
      exitMs: 220,
      fps: 20,
    });
    expect(row.selectors).toEqual([".rr-0", ".rr-1", ".rr-2"]);
    const json = tl.toJSON();
    expect(checkLoopSeam(json).seamless).toBe(true);
    const yTrack = json.tracks.find((t) => t.target === ".rr-0" && t.property === "y")!;
    // hold anchored on BOTH sides — no interpolation across the gap
    expect(yTrack.keyframes).toEqual([20, 0, 0, 20]);
  });

  it("waveUnits validates mirror cycle divides the period", () => {
    const tl = createTimeline({ fps: 20 });
    expect(() =>
      waveUnits(tl, { selectors: [".a", ".b"], periodMs: 2000, divisor: 3, fps: 20 })
    ).toThrow(/does not divide/);
    waveUnits(tl, { selectors: [".a", ".b"], periodMs: 2000, divisor: 2, fps: 20 });
    const track = tl.toJSON().tracks[0]!;
    expect(track.transition.repeat).toBe(Infinity);
    expect(track.transition.repeatType).toBe("mirror");
  });
});

// ---------------------------------------------------------------------------
// audit (pure parts)
// ---------------------------------------------------------------------------

describe("audit", () => {
  it("parseTransformOrigin handles center/keywords/percent/px", () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    expect(parseTransformOrigin(undefined, box)).toEqual({ x: 50, y: 25 });
    expect(parseTransformOrigin("left top", box)).toEqual({ x: 0, y: 0 });
    expect(parseTransformOrigin("50% 100%", box)).toEqual({ x: 50, y: 50 });
    expect(parseTransformOrigin("10px 20px", box)).toEqual({ x: 10, y: 20 });
  });

  it("matrixFor composes translate·scale·rotate in compiler order", () => {
    const m = matrixFor({ x: 10, y: 5, scale: 2 }, { x: 0, y: 0 });
    // p' = T·S·p: scale both axes, then translate
    const [px, py] = [m.a * 3 + m.c * 2 + m.e, m.b * 3 + m.d * 2 + m.f];
    expect(px).toBeCloseTo(2 * 3 + 10, 10);
    expect(py).toBeCloseTo(2 * 2 + 5, 10);
    const r = matrixFor({ rotate: 90 }, { x: 0, y: 0 });
    // 90° CW in screen coords (y down): (1,0) → (0,1)
    const [rx, ry] = [r.a * 1 + r.c * 0 + r.e, r.b * 1 + r.d * 0 + r.f];
    expect(rx).toBeCloseTo(0, 8);
    expect(ry).toBeCloseTo(1, 8);
  });

  it("seamEnergy: 0 for perfect loops, >0 for broken ones", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add(".a", { x: [0, 10, 0] }, { at: 0, type: "tween", duration: 1000, times: [0, 0.5, 1] });
    expect(seamEnergy(tl.toJSON()).energy).toBe(0);

    const bad = createTimeline({ fps: 20 });
    bad.add(".b", { x: [0, 10] }, { at: 0, type: "tween", duration: 1000 });
    const energy = seamEnergy(bad.toJSON());
    expect(energy.energy).toBeGreaterThan(0.5);
  });

  it("checkBanner fails an overflowing transform track (integration)", async () => {
    const tl = createTimeline({ fps: 20 });
    tl.add(".ov", { opacity: [1, 1] }, { at: 0, type: "tween", duration: 500 });
    tl.add(".ov", { y: [-200, 200, -200] }, { at: 0, type: "tween", duration: 2000, times: [0, 0.5, 1] });
    const el = h("div", {
      className: "root",
      style: { width: 850, height: 200, backgroundColor: "#000", display: "flex", alignItems: "center", justifyContent: "center" },
      children: h("div", { className: "ov", style: { fontSize: 30, color: "#fff" }, children: "escape" }),
    });
    const result = await checkBanner(el, tl.toJSON(), { width: 850, height: 200 });
    expect(result.ok).toBe(false);
    expect(result.extents.violations.length).toBeGreaterThan(0);
    expect(result.extents.violations[0]!.detail).toMatch(/reaches (top|bottom)/);
  });
});

// ---------------------------------------------------------------------------
// size — GIF byte-stream
// ---------------------------------------------------------------------------

/** Build a minimal valid N-frame GIF with local color tables (encoder-shaped). */
function makeTestGif(delays: number[], variantFor: (i: number) => number = () => 0): Buffer {
  const chunks: Buffer[] = [];
  // Header + LSD (no GCT)
  chunks.push(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])); // GIF89a
  chunks.push(Buffer.from([4, 0, 4, 0, 0x00, 0, 0])); // 4×4, no GCT
  // Netscape loop extension: len=3 payload [1, 0, 0] → loop forever
  chunks.push(Buffer.from([0x21, 0xff, 0x0b]));
  chunks.push(Buffer.from("NETSCAPE2.0"));
  chunks.push(Buffer.from([3, 1, 0, 0]));
  chunks.push(Buffer.from([0]));

  delays.forEach((delay, i) => {
    // GCE
    chunks.push(Buffer.from([0x21, 0xf9, 0x04, 0x00, delay & 0xff, (delay >> 8) & 0xff, 0, 0]));
    // Image descriptor + 2-color LCT (size field 0 → 2 entries × 3 bytes)
    // + LZW data (min code size 2, one 3-byte sub-block, terminator).
    // variantFor flips a data byte so tests can build distinct frames.
    chunks.push(Buffer.from([0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0x80]));
    chunks.push(Buffer.from([0xff, 0x00, 0x00, 0x00, 0x00, 0xff])); // LCT
    chunks.push(Buffer.from([2, 3, 0b10010110 ^ variantFor(i), 0b01101000, 0b00000010, 0]));
  });
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
}

describe("size", () => {
  it("gifStats reads frames, duration, loop count", () => {
    const gif = makeTestGif([5, 10, 5]);
    const stats = gifStats(gif)!;
    expect(stats.frames).toBe(3);
    expect(stats.durationMs).toBe(200);
    expect(stats.loopCount).toBe(0);
  });

  it("collapseGifHolds merges identical runs, preserves duration", () => {
    const allSame = makeTestGif([5, 5, 5]); // identical holds
    const merged = collapseGifHolds(allSame);
    expect(merged.framesBefore).toBe(3);
    expect(merged.framesAfter).toBe(1);
    expect(merged.durationMsBefore).toBe(merged.durationMsAfter);
    expect(parseGif(merged.buffer)!.frames[0]!.delayCs).toBe(15);

    // 3 identical holds + 1 genuinely distinct frame
    const gif = makeTestGif([5, 5, 5, 10], (i) => (i === 3 ? 0xff : 0));
    const result = collapseGifHolds(gif);
    expect(result.framesBefore).toBe(4);
    expect(result.framesAfter).toBe(2);
    expect(result.durationMsBefore).toBe(result.durationMsAfter);
    expect(result.collapsed).toBe(true);
    const parsed = parseGif(result.buffer)!;
    expect(parsed.frames[0]!.delayCs).toBe(15);
    expect(parsed.frames[1]!.delayCs).toBe(10);
  });

  it("collapseGifHolds passes through non-GIF and malformed buffers untouched", () => {
    const notGif = Buffer.from([1, 2, 3, 4]);
    expect(collapseGifHolds(notGif).collapsed).toBe(false);
    expect(collapseGifHolds(notGif).buffer.equals(notGif)).toBe(true);
    const truncated = makeTestGif([5]).subarray(0, 20);
    expect(collapseGifHolds(truncated).collapsed).toBe(false);
  });

  it("parseGif rejects unknown block bytes", () => {
    const gif = makeTestGif([5]);
    gif[13] = 0x99; // corrupt the first block id
    expect(parseGif(gif)).toBeNull();
  });

  it("optimizeBudget returns the first fitting attempt and caches renders", async () => {
    let calls = 0;
    const render = async (attempt: { fps: number }) => {
      calls++;
      return Buffer.alloc(attempt.fps * 100); // smaller at lower fps
    };
    const result = await optimizeBudget(1500, [
      { label: "hi", format: "gif", fps: 20 },   // 2000 — over
      { label: "mid", format: "gif", fps: 12 },  // 1200 — fits
      { label: "lo", format: "gif", fps: 6 },
    ], render);
    expect(result.withinBudget).toBe(true);
    expect(result.chosen.attempt.fps).toBe(12);
    expect(calls).toBe(2); // ladder stops at the first fit
  });

  it("optimizeBudget picks smallest when nothing fits", async () => {
    const render = async (attempt: { fps: number }) => Buffer.alloc(attempt.fps * 100);
    const result = await optimizeBudget(100, [
      { label: "hi", format: "gif", fps: 20 },
      { label: "lo", format: "gif", fps: 6 },
    ], render);
    expect(result.withinBudget).toBe(false);
    expect(result.chosen.attempt.fps).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// integration — real renders: determinism + hold collapse (native takumi)
// ---------------------------------------------------------------------------

describe("integration (native)", () => {
  it("renderBanner output is byte-deterministic across runs", async () => {
    const { renderBanner } = await import("../src/render.js");
    const { typewriterBanner } = await import("../src/templates/typewriter.js");
    const banner = await typewriterBanner({ text: "det", width: 400, height: 120, fps: 10 });
    const options = {
      node: banner.element,
      timeline: banner.timeline,
      preset: { width: 400, height: 120, devicePixelRatio: 1, fps: 10, formats: ["webp"] as never, webpQuality: 70, budgetBytes: 1e9, description: "t" },
    };
    const a = await renderBanner(options);
    const b = await renderBanner(options);
    expect(a.files[0]!.buffer.equals(b.files[0]!.buffer)).toBe(true);
  }, 60000);

  it("windowed ambient + collapseGifHolds shrinks a real GIF hold", async () => {
    const { renderBanner } = await import("../src/render.js");
    const { typewriterBanner } = await import("../src/templates/typewriter.js");
    const banner = await typewriterBanner({ text: "hold on", width: 500, height: 140, fps: 20 });
    const report = await renderBanner({
      node: banner.element,
      timeline: banner.timeline,
      preset: { width: 500, height: 140, devicePixelRatio: 1, fps: 20, formats: ["gif"] as never, webpQuality: 70, budgetBytes: 1e9, description: "t" },
    });
    expect(report.collapse).not.toBeNull();
    expect(report.collapse!.framesAfter).toBeLessThan(report.collapse!.framesBefore);
    // Duration is preserved through the collapse.
    expect(report.collapse!.framesAfter).toBeGreaterThan(0);
    const stats = gifStats(report.files[0]!.buffer)!;
    expect(stats.frames).toBe(report.collapse!.framesAfter);
  }, 60000);

  it("checkBanner passes a built template end-to-end (extents + seam)", async () => {
    const { cascadeBanner } = await import("../src/templates/cascade.js");
    const banner = await cascadeBanner({ title: "SHIP", tagline: "clean" });
    const result = await checkBanner(banner.element, banner.timeline, { width: 850, height: 200 });
    // The decorative glow may warn; content must be clean and seam exact.
    expect(result.extents.violations.every((v) => v.decorative)).toBe(true);
    expect(result.seam.energy).toBe(0);
    expect(result.seam.report.seamless).toBe(true);
  }, 60000);
});

// ---------------------------------------------------------------------------
// preview
// ---------------------------------------------------------------------------

describe("preview", () => {
  it("serializes elements and compiled CSS to valid HTML", () => {
    const el = h("div", {
      className: "root",
      style: { width: 100, fontSize: 20, color: "#fff" },
      children: [h("span", { style: { letterSpacing: 2 }, children: "hi" })],
    });
    const html = elementToHtml(el);
    expect(html).toContain('class="root"');
    expect(html).toContain("width: 100px");
    expect(html).toContain("font-size: 20px");
    expect(html).toContain(">hi</span>");
  });

  it("cssEntriesToText emits @keyframes and rules", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add(".a", { x: [0, 10] }, { at: 0, type: "tween", duration: 500 });
    const compiled = compileTimeline(tl.toJSON(), { fps: 20 });
    const text = cssEntriesToText(compiled.css);
    expect(text).toContain("@keyframes tmk-1");
    expect(text).toContain("transform:");
    expect(text).toContain(".a {");
  });

  it("renderPreviewHtml embeds the timeline CSS and scrubber", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add(".a", { x: [0, 10] }, { at: 0, type: "tween", duration: 1000 });
    const el = h("div", { className: "root", style: { width: 100, height: 50 }, children: h("div", { className: "a", style: {}, children: "x" }) });
    const html = renderPreviewHtml(el, tl.toJSON(), { width: 100, height: 50, fps: 20 });
    expect(html).toContain("@keyframes");
    expect(html).toContain('id="scrub"');
    expect(html).toContain("1000 ms");
  });
});
