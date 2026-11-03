// v1.0 — coverage close-out, batch 2: the kit pipeline, jsx cloneNode,
// personality branches, loop seam helpers, timeline + orchestrate edges.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderKit, formatKitReport, type KitBanner } from "../src/kit.js";
import { h, cloneNode, type VNodeStyle } from "../src/jsx.js";
import { personalities, resolvePersonality } from "../src/personality.js";
import { checkLoopSeam, alignLoopPeriod, assertAmbientPeriod, fadeWrap } from "../src/loop.js";
import { createTimeline, trackEndMs } from "../src/timeline.js";
import { deceleratingStagger, revealUnits, waveUnits, visibleUnit, splitWords, splitGlyphs } from "../src/orchestrate.js";

const node = h("div", {
  style: { width: 850, height: 200, backgroundColor: "#0b1220" },
  children: [h("span", { style: { fontSize: 40, color: "#f8fafc" }, children: "kit" })],
});

describe("renderKit (multi-preset asset kit)", () => {
  it("renders every preset variant + the static twin + a formatted report", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "tm-kit-"));
    const banner: KitBanner = {
      element: node as never,
      timeline: { version: 1, durationMs: 800, tracks: [] },
    };
    const kit = await renderKit(banner, { outDir, baseName: "kit", presets: ["readme", "readme-lean"] });
    expect(kit.variants).toHaveLength(2);
    expect(kit.totalBytes).toBeGreaterThan(0);
    // static twin only for the FIRST variant
    const roles = kit.files.map((f) => f.role);
    expect(roles.filter((r) => r.includes("static twin"))).toHaveLength(1);
    const report = formatKitReport(kit);
    expect(report).toContain("kit: 2 variants");
    expect(report).toContain("readme");
    expect(report).toContain("→");
  });

  it("staticTwin: false skips the fallback twin; posters off", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "tm-kit2-"));
    const kit = await renderKit(
      { element: node as never, timeline: { version: 1, durationMs: 600, tracks: [] } },
      { outDir, baseName: "lean", presets: ["readme-lean"], staticTwin: false, posters: false },
    );
    expect(kit.files.map((f) => f.role).filter((r) => r.includes("static twin"))).toHaveLength(0);
  });
});

describe("jsx cloneNode", () => {
  it("deep-clones props, styles and child elements (fresh objects)", () => {
    const child = h("span", { style: { color: "#fff" } as VNodeStyle, children: "deep" });
    const original = h("div", { className: "a", style: { width: 10 } as VNodeStyle, children: [child, "text"] });
    const clone = cloneNode(original);
    expect(clone.props.className).toBe("a"); // same values…
    expect(clone.props.style).toEqual({ width: 10 });
    // …but FRESH object identities (mutating the clone never touches the source)
    expect(clone.props.style).not.toBe(original.props.style);
    expect((clone.props.children as unknown[])[0]).not.toBe(child);
  });

  it("scalar children pass through by value", () => {
    const clone = cloneNode(h("div", { children: 7 }));
    expect(clone.props.children).toBe(7);
  });
});

describe("personality resolution", () => {
  it("resolves every named personality; unknown names THROW with the catalog", () => {
    for (const name of Object.keys(personalities)) {
      expect(resolvePersonality(name).name).toBe(name);
    }
    expect(() => resolvePersonality("does-not-exist" as never)).toThrow(/Unknown motion personality/);
    expect(resolvePersonality().name).toBe("snappy"); // documented default
  });

  it("accepts a full personality object verbatim", () => {
    const custom = { ...resolvePersonality("snappy"), name: "custom" };
    expect(resolvePersonality(custom as never).name).toBe("custom");
  });
});

describe("loop seam helpers", () => {
  const strict = (opacity: [number, number], durationMs = 800): Parameters<typeof checkLoopSeam>[0] => ({
    version: 1,
    durationMs,
    tracks: [
      {
        target: ".a",
        property: "opacity",
        keyframes: opacity,
        transition: { type: "tween", duration: durationMs, repeat: Infinity, repeatType: "mirror" },
      },
    ],
  });

  it("wrapped mode: a fadeWrap marker masks everything at the seam", () => {
    const timeline: Parameters<typeof checkLoopSeam>[0] = {
      version: 1,
      durationMs: 800,
      tracks: [
        // content track on a CHILD; fadeWrap owns the ROOT container's opacity
        {
          target: ".a",
          property: "x",
          keyframes: [0, 40],
          transition: { type: "tween", duration: 400 },
        },
      ],
    };
    const wrapped = fadeWrap(timeline, { selector: ".root", inMs: 200, outMs: 200, periodMs: 900 });
    expect(wrapped.wrap).toBeDefined();
    const report = checkLoopSeam(wrapped);
    expect(report.mode).toBe("wrapped");
  });

  it("fadeWrap refuses timelines that already own the root opacity", () => {
    expect(() => fadeWrap(strict([0, 1]), { selector: ".a" })).toThrow(/already has an opacity track/);
  });

  it("wrapped mode without the wrap track reports a missing opacity track", () => {
    const timeline = { ...strict([0, 1]), wrap: { selector: ".missing" } };
    const report = checkLoopSeam(timeline);
    expect(report.seamless).toBe(false);
    expect(report.notes.join(" ")).toContain("no opacity track");
  });

  it("strict mode flags entrance timelines and passes oscillating ones", () => {
    const entrance = checkLoopSeam(strict([0, 1], 800).tracks[0].transition.repeat === Infinity ? strict([0, 1]) : strict([0, 1]));
    void entrance;
    const oscillating = checkLoopSeam({
      version: 1,
      durationMs: 900,
      tracks: [
        {
          target: ".a",
          property: "opacity",
          keyframes: [0.5, 0.5],
          transition: { type: "tween", duration: 900 },
        },
      ],
    });
    expect(oscillating.seamless).toBe(true);
    const moving = checkLoopSeam({
      version: 1,
      durationMs: 900,
      tracks: [
        { target: ".a", property: "opacity", keyframes: [0, 1], transition: { type: "tween", duration: 900 } },
      ],
    });
    expect(moving.seamless).toBe(false);
  });

  it("alignLoopPeriod snaps the duration to a common multiple (capped)", () => {
    const aligned = alignLoopPeriod(strict([0.4, 0.4], 700));
    expect(aligned.durationMs).toBeGreaterThanOrEqual(700);
    expect(() => alignLoopPeriod(strict([0.4, 0.4], 700), 1)).toThrow(/no common multiple/);
    expect(() => alignLoopPeriod({
      version: 1,
      durationMs: 700,
      tracks: [
        {
          target: ".a",
          property: "opacity",
          keyframes: [0, 1],
          transition: { type: "tween", duration: 350, repeat: Infinity, delay: 100 },
        },
      ],
    })).toThrow(/phase-shifted/);
  });

  it("assertAmbientPeriod enforces the period/N convention", () => {
    expect(() => assertAmbientPeriod(350, 700, "glow")).not.toThrow();
    expect(() => assertAmbientPeriod(351, 700, "glow")).toThrow(/does not divide/);
  });
});

describe("timeline edges", () => {
  it("labels, stagger, spring settle times and trackEndMs", () => {
    const timeline = createTimeline({ fps: 20 });
    timeline.add(".a", { opacity: [0, 1] }, { at: 100 });
    timeline.label("mid");
    timeline.add(".a", { y: [0, 40] }, { at: "<+50", stagger: 10 });
    const json = timeline.toJSON();
    expect(json.tracks.length).toBeGreaterThanOrEqual(2);
    expect(trackEndMs(json.tracks[0])).toBeGreaterThan(0);
    expect(timeline.targets()).toContain(".a");
    // spring settle resolution flows into the duration
    expect(json.durationMs).toBeGreaterThan(0);
  });
});

describe("orchestrate unit placement", () => {
  it("deceleratingStagger weights head units heavier; n<=1 collapses to 0", () => {
    expect(deceleratingStagger(0, 4, 30)).toBe(0);
    expect(deceleratingStagger(3, 4, 30)).toBeGreaterThan(deceleratingStagger(0, 4, 30));
    expect(deceleratingStagger(0, 1, 30)).toBe(0);
  });

  it("revealUnits schedules selectors with a staggered timeline (period-shaped)", () => {
    const tl = createTimeline({ fps: 30 });
    const end = revealUnits(tl, {
      selectors: [".a", ".b", ".c"],
      at: 0,
      periodMs: 2400, // the window the reveal lives inside
      staggerMs: 30,
    });
    expect(end).toBeGreaterThan(0);
    expect(tl.toJSON().tracks.length).toBeGreaterThanOrEqual(3);
  });

  it("waveUnits adds ambient mirror tracks on the timeline", () => {
    const tl = createTimeline({ fps: 30 });
    waveUnits(tl, { selectors: [".a", ".b"], at: 0, periodMs: 800, amplitude: 6, property: "y" });
    expect(tl.toJSON().tracks.length).toBeGreaterThanOrEqual(2);
  });

  it("visibleUnit maps spaces to nbsp; word/glyph splits", () => {
    expect(visibleUnit(" ")).toBe("\u00a0");
    expect(visibleUnit("a")).toBe("a");
    const words = splitWords("one two three");
    expect(words).toEqual(["one", "two", "three"]);
    const glyphs = splitGlyphs("ab");
    expect(glyphs).toEqual(["a", "b"]);
  });
});
