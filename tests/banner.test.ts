// Integration tests: presets, templates (structure + strict seam), and a real
// end-to-end render through the Takumi native engine at tiny sizes.
import { describe, expect, it } from "vitest";
import { bannerPresets, formatBytes, resolvePreset } from "../src/presets.js";
import { checkLoopSeam } from "../src/loop.js";
import {
  typewriterBanner,
  countUpBanner,
  gradientSweepBanner,
  bannerTemplates,
  buildTemplate,
} from "../src/templates/index.js";
import { fitFontSize } from "../src/templates/shared.js";
import { renderBanner, formatReport } from "../src/render.js";
import type { BannerPreset } from "../src/presets.js";

const tinyPreset: BannerPreset = {
  width: 240,
  height: 60,
  devicePixelRatio: 1,
  fps: 10,
  formats: ["gif"],
  webpQuality: 70,
  budgetBytes: 512 * 1024,
  description: "test fixture",
};

describe("presets", () => {
  it("are well-formed", () => {
    for (const [name, preset] of Object.entries(bannerPresets)) {
      expect(preset.width, name).toBeGreaterThan(0);
      expect(preset.height, name).toBeGreaterThan(0);
      expect(preset.devicePixelRatio, name).toBeGreaterThanOrEqual(1);
      expect(preset.fps, name).toBeGreaterThan(0);
      expect(preset.formats.length, name).toBeGreaterThan(0);
      expect(preset.budgetBytes, name).toBeGreaterThan(0);
    }
  });

  it("resolve by name and reject unknown names", () => {
    expect(resolvePreset("readme-lean").devicePixelRatio).toBe(1);
    expect(resolvePreset("readme-hd").devicePixelRatio).toBe(2);
    expect(() => resolvePreset("nope")).toThrow(/Unknown preset/);
  });

  it("formatBytes stays human", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 kB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.00 MB");
  });
});

describe("templates", () => {
  it("registry exposes the four built-ins", async () => {
    expect(Object.keys(bannerTemplates).sort()).toEqual(["cascade", "countup", "sweep", "typewriter"]);
    const built = await buildTemplate({ name: "sweep", props: { title: "x" } });
    expect(built.timeline.version).toBe(1);
  });

  it("typewriterBanner: chars are gated, loop is strictly seamless", async () => {
    const { element, timeline } = await typewriterBanner({ text: "hello", tagline: "world" });
    // No wrap marker: the type→hold→delete loop returns to its t=0 state.
    expect(timeline.wrap).toBeUndefined();
    const charTracks = timeline.tracks.filter((t) => t.target === ".tw-ch-0");
    expect(charTracks).toHaveLength(1);
    expect(charTracks[0]!.keyframes).toEqual([0, 1, 1, 0]);
    expect(element.props.className).toBe("tw-root");
    const seam = checkLoopSeam(timeline);
    expect(seam.mode).toBe("strict");
    expect(seam.seamless).toBe(true);
  });

  it("countUpBanner: digit layers + underlines, loop is strictly seamless", async () => {
    const { timeline } = await countUpBanner({
      title: "Stats",
      stats: [{ label: "stars", value: 12300, suffix: "+" }],
      steps: 6,
    });
    const layers = timeline.tracks.filter((t) => t.target.startsWith(".cu-num-0-"));
    expect(layers.length).toBe(7); // steps + 1
    // zero layer returns to visible at the reset
    const zero = layers.find((t) => t.target === ".cu-num-0-0")!;
    expect(zero.keyframes).toEqual([1, 0, 0, 1]);
    expect(timeline.tracks.some((t) => t.target === ".cu-fill-0" && t.property === "scaleX")).toBe(true);
    expect(timeline.tracks.some((t) => t.target === ".cu-label-0")).toBe(true);
    expect(checkLoopSeam(timeline).seamless).toBe(true);
  });

  it("gradientSweepBanner: glows drift, title tracks, loop is strictly seamless", async () => {
    const { timeline } = await gradientSweepBanner({ title: "Hi", subtitle: "there" });
    expect(timeline.wrap).toBeUndefined();
    expect(timeline.tracks.some((t) => t.target === ".gs-glow-a" && t.property === "x")).toBe(true);
    expect(timeline.tracks.some((t) => t.target === ".gs-title" && t.property === "y")).toBe(true);
    expect(timeline.tracks.some((t) => t.target === ".gs-title" && t.property === "letterSpacing")).toBe(true);
    const seam = checkLoopSeam(timeline);
    expect(seam.mode).toBe("strict");
    expect(seam.seamless).toBe(true);
  });

  it("countUpBanner rejects too many stats", async () => {
    await expect(
      countUpBanner({ stats: Array.from({ length: 5 }, (_, i) => ({ label: `s${i}`, value: i })) })
    ).rejects.toThrow(/at most 4/);
  });

  it("fitFontSize shrinks long text and caps short text", async () => {
    const short = await fitFontSize({ text: "hi", maxWidth: 400, fontWeight: 700, max: 50, min: 18 });
    expect(short).toBe(50);
    const long = await fitFontSize({ text: "a very long banner title indeed", maxWidth: 200, fontWeight: 700, max: 50, min: 18 });
    expect(long).toBeLessThan(50);
    expect(long).toBeGreaterThanOrEqual(18);
    const floored = await fitFontSize({ text: "an absurdly long title that cannot possibly fit at any legible size", maxWidth: 100, fontWeight: 700, max: 50, min: 30 });
    expect(floored).toBe(30);
  });
});

describe("renderBanner (native integration)", () => {
  it("renders a real GIF + poster from a template", async () => {
    const { element, timeline } = await typewriterBanner({
      text: "ship it",
      width: tinyPreset.width,
      height: tinyPreset.height,
      holdMs: 300,
      speed: 40,
      fps: tinyPreset.fps,
    });

    const report = await renderBanner({
      node: element,
      timeline,
      preset: tinyPreset,
      baseName: "test-banner",
    });

    expect(report.frames).toBeGreaterThan(4);
    expect(report.files).toHaveLength(1);
    const gif = report.files[0]!;
    expect(gif.format).toBe("gif");
    expect(gif.bytes).toBeGreaterThan(500);
    // GIF magic + Netscape looping extension
    const magic = gif.buffer.subarray(0, 6).toString("latin1");
    expect(magic.startsWith("GIF89a") || magic.startsWith("GIF87a")).toBe(true);
    expect(gif.buffer.toString("latin1")).toContain("NETSCAPE2.0");
    // GIF logical screen descriptor: little-endian width/height = preset size (dpr 1)
    expect(gif.buffer.readUInt16LE(6)).toBe(tinyPreset.width);
    expect(gif.buffer.readUInt16LE(8)).toBe(tinyPreset.height);
    expect(report.posters).toHaveLength(1);
    const poster = report.posters[0]!;
    expect(poster.bytes).toBeGreaterThan(60);
    expect(poster.buffer.subarray(0, 4).toString("latin1")).toBe("\x89PNG");
    expect(report.overBudget).toBe(false);
    expect(report.warnings).toHaveLength(0);
  });

  it("scales output by devicePixelRatio (device-px convention)", async () => {
    const hdPreset: BannerPreset = { ...tinyPreset, width: 200, height: 80, devicePixelRatio: 2 };
    const { element, timeline } = await gradientSweepBanner({
      title: "hd",
      width: hdPreset.width,
      height: hdPreset.height,
      holdMs: 300,
      fps: hdPreset.fps,
    });
    const report = await renderBanner({
      node: element,
      timeline,
      preset: hdPreset,
      formats: ["webp"],
      posters: [600],
    });
    // CSS design is 200×80; output must be 400×160 physical.
    expect(report.physicalWidth).toBe(400);
    expect(report.physicalHeight).toBe(160);
    const poster = report.posters[0]!;
    // PNG IHDR: width/height big-endian at bytes 16..24
    expect(poster.buffer.readUInt32BE(16)).toBe(400);
    expect(poster.buffer.readUInt32BE(20)).toBe(160);
    const webp = report.files[0]!;
    expect(webp.buffer.subarray(0, 4).toString("latin1")).toBe("RIFF");
    expect(webp.buffer.subarray(8, 12).toString("latin1")).toBe("WEBP");
    // VP8X canvas size (24-bit little-endian) when the extended format is used
    if (webp.buffer.subarray(12, 16).toString("latin1") === "VP8X") {
      const w = 1 + webp.buffer.readUIntLE(24, 3);
      const h = 1 + webp.buffer.readUIntLE(27, 3);
      expect(w).toBe(400);
      expect(h).toBe(160);
    }
  });

  it("honors fps override and keeps compile + render grids in sync", async () => {
    const { element, timeline } = await gradientSweepBanner({
      title: "x",
      width: tinyPreset.width,
      height: tinyPreset.height,
      holdMs: 200,
      fps: tinyPreset.fps,
    });
    const report = await renderBanner({
      node: element,
      timeline,
      preset: tinyPreset,
      fps: 8,
    });
    expect(report.fps).toBe(8);
    expect(report.durationMs % 125).toBe(0); // 8fps = 125ms frames
  });

  it("formatReport renders a readable block", async () => {
    const { element, timeline } = await typewriterBanner({
      text: "ok",
      width: tinyPreset.width,
      height: tinyPreset.height,
      holdMs: 200,
      speed: 40,
      fps: tinyPreset.fps,
    });
    const report = await renderBanner({ node: element, timeline, preset: tinyPreset });
    const text = formatReport(report);
    expect(text).toContain("gif");
    expect(text).toContain("poster");
  });
});
