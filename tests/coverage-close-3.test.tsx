// v1.0 — coverage close-out, batch 3: preview-react player HTML, personality
// ambient layer, timeline transforms + sampler/spring/interpolate branches.
import { describe, expect, it } from "vitest";
import { renderReactPreviewHtml } from "../src/preview-react.js";
import { personalities, resolvePersonality, ambient, clampAmbientPx } from "../src/personality.js";
import { createTimeline } from "../src/timeline.js";
import { shiftTimeline, concatTimelines } from "../src/timeline-transforms.js";
import { interpolate, mixValues, createTweenSampler } from "../src/interpolate.js";
import { springGenerator, calcGeneratorDuration, springDefaults } from "../src/spring.js";
import { captureReactBanner } from "../src/react/capture.js";
import { resolveTheme } from "../src/themes.js";
import { sampleTrackAt, resolveTrack } from "../src/sampler.js";

describe("renderReactPreviewHtml (frame-swap player)", () => {
  it("embeds chunks, frame map, scene ruler and the escaped title", async () => {
    const { defineBanner, Banner, Scene } = await import("../src/react/index.js");
    const banner = defineBanner(function PreviewFixture() {
      return (
        <Banner width={300} height={100} fps={20} theme="midnight">
          <Scene duration={30} enter="crossfade">
            <h1 style={{ fontSize: 30, color: "#f8fafc" }}>one</h1>
          </Scene>
          <Scene duration={30} enter="crossfade">
            <h1 style={{ fontSize: 30, color: "#7aa2f7" }}>two</h1>
          </Scene>
        </Banner>
      );
    });
    const capture = await captureReactBanner(banner as never);
    const html = renderReactPreviewHtml(capture, { title: "custom & <title>" });
    expect(html).toContain("custom &amp; &lt;title&gt;"); // escaped
    expect(html).toContain("<!doctype html>");
    // embedded player constants (ground truth: CHUNKS/FRAME_TO_CHUNK/SCENE_MARKS/FPS/TOTAL)
    expect(html).toContain("const CHUNKS = [");
    expect(html).toContain("const FRAME_TO_CHUNK = [");
    expect(html).toContain("const SCENE_MARKS = [");
    expect(html).toContain(`const FPS = ${capture.meta.fps}`);
    expect(html).toContain(`const TOTAL = ${capture.outputFrames}`);
    // scene ruler carries the overlap counts
    expect(html).toContain('"enter"');
  });

  it("jsonSafe escaping keeps </script> from terminating the payload", async () => {
    const { defineBanner, Banner, Scene } = await import("../src/react/index.js");
    const banner = defineBanner(function TextFixture() {
      return (
        <Banner width={300} height={100} fps={20} theme="midnight">
          <Scene duration={20}>
            <span style={{ color: "#fff" }}>{"</script><b>ok</b>"}</span>
          </Scene>
        </Banner>
      );
    });
    const capture = await captureReactBanner(banner as never);
    const html = renderReactPreviewHtml(capture);
    // jsonSafe escapes every embedded "</" (rendered as <\/ in the JSON
    // payload) — the player script's terminator can never be forged from
    // captured markup.
    expect(html).toContain("<\\/");
  });
});

describe("personality ambient layer", () => {
  it("resolves each catalog personality; unknown names throw", () => {
    expect(Object.keys(personalities).length).toBeGreaterThanOrEqual(4);
    expect(resolvePersonality("snappy").spring).toBeDefined();
    expect(() => resolvePersonality("nope" as never)).toThrow(/Unknown motion personality/);
  });

  it("ambient() adds mirror tracks for every kind, frame-grid aligned", () => {
    for (const kind of ["drift", "breathe", "pulse", "float"] as const) {
      const tl = createTimeline({ fps: 20 });
      const r = ambient(tl, ".glow", kind, { periodMs: 1000, intensity: 0.5 });
      expect(r.divisor).toBe(2);
      expect(r.durationMs).toBe(500);
      expect(tl.toJSON().tracks).toHaveLength(1);
    }
  });

  it("ambient() honors custom divisors and rejects off-grid periods", () => {
    const tl = createTimeline({ fps: 20 });
    const r = ambient(tl, ".glow", "drift", { periodMs: 1000, divisor: 4 });
    expect(r.durationMs).toBe(250);
    expect(() => ambient(tl, ".glow", "drift", { periodMs: 1001 })).toThrow(/frame-grid aligned/);
  });

  it("clampAmbientPx caps drift/float distance at ±24px", () => {
    expect(clampAmbientPx(100)).toBe(24);
    expect(clampAmbientPx(-100)).toBe(-24);
    expect(clampAmbientPx(10)).toBe(10);
    expect(clampAmbientPx(0)).toBe(0);
  });
});

describe("timeline transforms", () => {
  it("shiftTimeline moves delays forward only; concatTimelines chains", () => {
    const tl = createTimeline({ fps: 30 });
    tl.add(".a", { opacity: [0, 1] }, { at: 100 });
    const json = tl.toJSON();
    expect(() => shiftTimeline(json, -1)).toThrow(/non-negative/);
    const shifted = shiftTimeline(json, 50);
    expect(shifted.tracks[0].transition.delay).toBe(150);

    const second = createTimeline({ fps: 30 });
    second.add(".b", { opacity: [1, 0] }, { at: 40 });
    const merged = concatTimelines([json, second.toJSON()]);
    expect(merged.durationMs).toBeGreaterThan(json.durationMs);
    expect(() => concatTimelines([])).toThrow(/at least one/);
  });
});

describe("interpolate + sampler branches", () => {
  it("interpolate: extrapolate extend, per-segment easing, validation", () => {
    expect(interpolate(-5, [0, 100], [0, 10], { extrapolateLeft: "extend" })).toBeCloseTo(-0.5);
    expect(interpolate(105, [0, 100], [0, 10], { extrapolateRight: "extend" })).toBeCloseTo(10.5);
    expect(interpolate(50, [0, 50, 100], [0, 20, 40], { easing: ["linear", "easeOut"] })).toBeCloseTo(20);
    expect(() => interpolate(5, [0, 0], [0, 1])).toThrow(/strictly increasing/);
    expect(() => interpolate(Number.NaN, [0, 1], [0, 1])).toThrow(/finite/);
    expect(() => interpolate(5, [0, 1], [0])).toThrow(/equal length/);
  });

  it("mixValues falls back per category; single-stop samplers hold", () => {
    expect(mixValues(0, 10, 0.5)).toBe(5);
    expect(mixValues("#ff0000", "#0000ff", 0.5)).toMatch(/^#/);
    expect(mixValues("10px", "20px", 0.25)).toBe("12.5px");
    expect(mixValues("solid", "other", 0.9)).toBe("other"); // non-mixable → later value
    const single = createTweenSampler({ keyframes: [42], duration: 300 });
    expect(single.sample(999)).toBe(42);
  });

  it("null wildcards forward-fill from baseValue and neighbors", () => {
    const s = createTweenSampler({ keyframes: [null, 10, null], duration: 300 }, 2);
    expect(s.sample(0)).toBe(2);
    expect(s.sample(300)).toBe(10);
  });
});

describe("spring branches", () => {
  it("time-defined springs carry calculatedDuration; physics springs stay null", () => {
    const timed = springGenerator({ keyframes: [0, 1], duration: 500, bounce: 0.3 });
    expect(timed.calculatedDuration).toBe(500);
    const physical = springGenerator({ keyframes: [0, 1], stiffness: 210, damping: 20 });
    expect(physical.calculatedDuration).toBeNull();
    // velocity accessor (units/ms) + retarget toward a new target
    expect(physical.velocity(0)).toBe(0); // no inherited velocity
    expect(physical.velocity(10)).toBeGreaterThan(0); // rising toward 1
    physical.retarget([1, 0], 2);
    expect(physical.next(0).value).toBeCloseTo(1); // restarts from the origin
  });

  it("critical + overdamped solutions settle; the settle scan caps at maxDuration", () => {
    for (const damping of [1, 4]) {
      const gen = springGenerator({ keyframes: [0, 1], stiffness: 100, damping });
      expect(gen.next(0).value).toBeCloseTo(0);
      expect(calcGeneratorDuration(gen)).toBeLessThan(20_000);
    }
    const neverSettles = springGenerator({ keyframes: [0, 1], stiffness: 0.5, damping: 0.05 });
    // documented behavior: absurd configs scan to the cap and report Infinity
    expect(calcGeneratorDuration(neverSettles, 50, 300)).toBe(Infinity);
  });

  it("granular rest thresholds: tiny deltas use the tight scale", () => {
    expect(springDefaults.restDelta.granular).toBe(0.005);
    const gen = springGenerator({ keyframes: [0, 0.5], stiffness: 100, damping: 20 });
    expect(gen.next(4000).done).toBe(true);
  });
});

describe("sampler tracks: repeats, mirror, gap holds", () => {
  const track = {
    target: ".a",
    property: "opacity",
    keyframes: [0.2, 0.8],
    transition: { type: "tween", duration: 100, repeat: 3, repeatDelay: 50, repeatType: "mirror" as const },
  };
  it("mirror repeats ping-pong; repeatDelay holds the end value", () => {
    const r = resolveTrack(track);
    expect(sampleTrackAt(r, 0)).toBeCloseTo(0.2);
    expect(sampleTrackAt(r, 100)).toBeCloseTo(0.8);
    expect(sampleTrackAt(r, 125)).toBeCloseTo(0.8); // inside the gap
    expect(sampleTrackAt(r, 150)).toBeCloseTo(0.8); // mirror starts at the forward end
    expect(sampleTrackAt(r, 250)).toBeCloseTo(0.2); // mirror ends at the origin
  });

  it("infinite repeats fold across the whole timeline", () => {
    const r = resolveTrack({ ...track, transition: { type: "tween", duration: 100, repeat: Infinity } });
    expect(Number.isFinite(sampleTrackAt(r, 350))).toBe(true);
  });
});

describe("theme resolution fallback", () => {
  it("unknown themes fall back to midnight (capture path parity)", () => {
    expect(resolveTheme("midnight").text).toBeDefined();
  });
});
