// tests/v07-react.test.tsx — the motion language release, React side:
// <Animated> entering/exiting through the frame runtime, <Keyframes> stops
// with fill-forward + per-stop easing, the TM_TRANSITION_UNSETTLED lint
// flowing through capture, and byte-determinism with the new vocabulary.

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  Layer,
  Animated,
  Keyframes,
  FadeIn,
  FadeInDown,
  FadeOutLeft,
  ZoomIn,
  BounceIn,
  staggered,
  defineBanner,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { parseKeyframes } from "../src/react/animated.js";
import { renderReactBanner } from "../src/react-render.js";

const canvas = { width: 200, height: 100, fps: 30 };

// ---------------------------------------------------------------------------
// <Animated> — entering
// ---------------------------------------------------------------------------

describe("<Animated> entering", () => {
  it("renders the start state at frame 0 and NO overrides once settled", async () => {
    const capture = await captureReactBanner(
      defineBanner(function EnterBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={30}>
              <Animated entering={FadeInDown.duration(20)}>
                <div style={{ fontSize: 20 }}>hello</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );

    // Frame 0: fully hidden start state (opacity 0, offset -24px).
    expect(capture.chunks[0].html).toContain("opacity:0");
    expect(capture.chunks[0].html).toContain("translateY(-24px)");

    // Frame 25 (> duration 20): the wrapper must carry NO transition overrides —
    // its style is exactly what the user passed (none), so no opacity/transform
    // from the descriptor appears on the wrapper div.
    const settledHtml = capture.htmlFrames[25];
    expect(settledHtml).not.toContain("translateY(-24px)");
    expect(settledHtml).not.toContain("opacity:0.");
  });

  it("mid-flight frames carry eased overrides (per-frame React path)", async () => {
    const capture = await captureReactBanner(
      defineBanner(function EnterMidBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={30}>
              <Animated entering={FadeIn.duration(20)}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    // easeOut is ahead of linear: at frame 5 (25% in) opacity is already ≈0.42.
    const mid = capture.htmlFrames[5];
    expect(mid).toMatch(/opacity:0\.[1-5]\d*/);
  });

  it("useEntering/useExiting apply to your own elements", async () => {
    const { useEntering } = await import("../src/react/index.js");
    const capture = await captureReactBanner(
      defineBanner(function HookBanner() {
        function Hero(): ReactNode {
          const overrides = useEntering(FadeIn.duration(10));
          return createElement("div", { style: { opacity: overrides?.opacity } }, "hero");
        }
        return (
          <Banner {...canvas}>
            <Scene duration={30}>
              <Hero />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    expect(capture.htmlFrames[0]).toContain("opacity:0");
    // Frame 5: eased partial (easeOut(0.5) ≈ 0.73).
    expect(capture.htmlFrames[5]).toMatch(/opacity:0\.\d+/);
    // Settled: null overrides → the hook hands back nothing → no opacity at all.
    expect(capture.htmlFrames[15]).not.toMatch(/opacity:/);
  });

  it("entering with delay stays hidden through the delay window", async () => {
    const capture = await captureReactBanner(
      defineBanner(function EnterDelayBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={40}>
              <Animated entering={FadeIn.delay(10).duration(10)}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    for (const f of [0, 5, 9]) {
      expect(capture.htmlFrames[f], `frame ${f}`).toContain("opacity:0");
    }
    // Frame 19: easeOut(0.9) ≈ 0.98 — nearly, but not exactly, arrived.
    expect(capture.htmlFrames[19]).toMatch(/opacity:0\.9\d*/);
  });
});

// ---------------------------------------------------------------------------
// <Animated> — exiting (anchored to the scene end)
// ---------------------------------------------------------------------------

describe("<Animated> exiting", () => {
  it("is invisible-motion early, then fades so it ENDS as the scene closes", async () => {
    const capture = await captureReactBanner(
      defineBanner(function ExitBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={30}>
              <Animated exiting={FadeOutLeft.duration(20)}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    // Frame 5 (well before exit start = 30-20 = 10): no overrides.
    expect(capture.htmlFrames[5]).not.toContain("opacity:0.");
    // Frame 20: mid-exit — partial opacity, moving left.
    const mid = capture.htmlFrames[20];
    expect(mid).toMatch(/opacity:0\.\d+/);
    expect(mid).toContain("translateX(-");
    // Frame 29 (the last): effectively hidden.
    const last = capture.htmlFrames[29];
    expect(last).toMatch(/opacity:0\.0\d|opacity:0;/);
  });

  it("both entering and exiting on one wrapper: exit wins while both run", async () => {
    // Scene 40f, enter 30f + exit 20f → overlap window 30..40.
    const capture = await captureReactBanner(
      defineBanner(function BothBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={40}>
              <Animated entering={FadeIn.duration(30)} exiting={FadeOutLeft.duration(20)}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    // At frame 35 the enter is done but the exit is halfway → partial opacity.
    const mid = capture.htmlFrames[35];
    expect(mid).toMatch(/opacity:0\.\d+/);
  });

  it("works inside <Layer> too (anchors to the banner end)", async () => {
    const capture = await captureReactBanner(
      defineBanner(function LayerExitBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={20}>
              <div>scene</div>
            </Scene>
            <Layer top>
              <Animated exiting={FadeOutLeft.duration(10)}>
                <div>chip</div>
              </Animated>
            </Layer>
          </Banner>
        );
      }) as never,
    );
    const last = capture.htmlFrames[capture.htmlFrames.length - 1];
    expect(last).toMatch(/opacity:0\.1\d*|opacity:0\.0\d*|opacity:0/);
  });
});

// ---------------------------------------------------------------------------
// TM_TRANSITION_UNSETTLED lint
// ---------------------------------------------------------------------------

describe("TM_TRANSITION_UNSETTLED", () => {
  it("an entering longer than the scene is reported as data", async () => {
    const capture = await captureReactBanner(
      defineBanner(function UnsettledBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={15}>
              <Animated entering={FadeInDown.duration(20)}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const warning = capture.lint.find((w) => w.code === "TM_TRANSITION_UNSETTLED");
    expect(warning).toBeDefined();
    expect(warning!.message).toContain("FadeInDown");
    expect(warning!.message).toMatch(/still moving at the scene's last frame/);
    expect(warning!.hint).toMatch(/scene more frames|shorten/i);
  });

  it("a springified enter that cannot settle is reported with its settle estimate", async () => {
    const capture = await captureReactBanner(
      defineBanner(function UnsettledSpringBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={8}>
              <Animated entering={BounceIn}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const warning = capture.lint.find((w) => w.code === "TM_TRANSITION_UNSETTLED");
    expect(warning).toBeDefined();
    expect(warning!.message).toMatch(/spring/);
  });

  it("an exit starting before the scene opens is reported", async () => {
    const capture = await captureReactBanner(
      defineBanner(function EarlyExitBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={10}>
              <Animated exiting={FadeOutLeft.duration(30)}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const warning = capture.lint.find((w) => w.code === "TM_TRANSITION_UNSETTLED");
    expect(warning).toBeDefined();
    expect(warning!.message).toMatch(/before the scene begins/);
  });

  it("fitting transitions produce NO unsettle warning", async () => {
    const capture = await captureReactBanner(
      defineBanner(function CleanBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={30}>
              <Animated entering={FadeInDown.duration(15)} exiting={FadeOutLeft.duration(10)}>
                <div>x</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    expect(capture.lint.find((w) => w.code === "TM_TRANSITION_UNSETTLED")).toBeUndefined();
  });

  it("does not duplicate the same descriptor warning across scenes", async () => {
    const capture = await captureReactBanner(
      defineBanner(function DupBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={15}>
              <Animated entering={FadeInDown.duration(20)}>
                <div>x</div>
              </Animated>
            </Scene>
            <Scene duration={15}>
              <Animated entering={FadeInDown.duration(20)}>
                <div>y</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const warnings = capture.lint.filter((w) => w.code === "TM_TRANSITION_UNSETTLED");
    expect(warnings.length).toBe(1); // collectLintWarnings dedupes identical messages
  });
});

// ---------------------------------------------------------------------------
// <Keyframes>
// ---------------------------------------------------------------------------

describe("<Keyframes>", () => {
  it("resolves numeric + transform stops with fill-forward holds", async () => {
    const stops = {
      0: { opacity: 0, y: -24, easing: "easeOut" as const },
      20: { opacity: 1, y: 0 },
      40: { opacity: 1 }, // hold
      49: { opacity: 0, y: 24, easing: "easeIn" as const },
    };
    const capture = await captureReactBanner(
      defineBanner(function KfBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={50}>
              <Keyframes frames={stops}>
                <div>x</div>
              </Keyframes>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    expect(capture.htmlFrames[0]).toContain("opacity:0;");
    expect(capture.htmlFrames[0]).toContain("translateY(-24px)");
    // Frame 30: settled section → opacity exactly 1, no y (holds at stop-20 state).
    expect(capture.htmlFrames[30]).toContain("opacity:1;");
    expect(capture.htmlFrames[30]).not.toContain("translateY(-");
    // Frame 49: exactly the last stop → static end state.
    expect(capture.htmlFrames[49]).toContain("opacity:0");
    expect(capture.htmlFrames[49]).toContain("translateY(24px)");
  });

  it("interpolates colors in OKLCH and holds verbatim strings", async () => {
    const stops = {
      0: { color: "#ff0000" },
      10: { color: "#ffff00" },
      20: { backgroundColor: "#000000" },
    };
    const capture = await captureReactBanner(
      defineBanner(function KfColorBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={25}>
              <Keyframes frames={stops}>
                <div>x</div>
              </Keyframes>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    // Frame 5: mid red→yellow mix in OKLCH.
    expect(capture.htmlFrames[5]).toMatch(/color:rgb\(\d+ \d+ \d+\)/);
    // Frame 15: color fill-forward holds at yellow (its last declared stop).
    expect(capture.htmlFrames[15]).toContain("color:rgb(255 255 0)");
    // backgroundColor is declared ONLY at stop 20 — the wrapper's style proves
    // absence (exact-match the whole style attr; the root's theme bg is separate).
    expect(capture.htmlFrames[15]).toMatch(/style="color:rgb\(255 255 0\)"/);
    // From stop 20 on, backgroundColor fill-forwards as normalized rgb.
    expect(capture.htmlFrames[21]).toContain("background-color:rgb(0 0 0)");
  });

  it("transform channels interpolate part-wise (x + scale together)", async () => {
    const stops = {
      0: { x: -60, scale: 0.5 },
      20: { x: 0, scale: 1, easing: "easeOut" as const },
    };
    const capture = await captureReactBanner(
      defineBanner(function KfTransformBanner() {
        return (
          <Banner {...canvas}>
            <Scene duration={20}>
              <Keyframes frames={stops}>
                <div>x</div>
              </Keyframes>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const frame10 = capture.htmlFrames[10];
    expect(frame10).toMatch(/transform:translateX\(-[\d.]+px\) scale\(0\.\d+\)/);
    // Frame 19: eased to within a hair of the final state.
    expect(capture.htmlFrames[19]).toMatch(/translateX\(-?0\.\d+px\) scale\(0\.9\d+\)/);
  });

  it("throws a helpful error with no integer-keyed stops", () => {
    expect(() => parseKeyframes({ zero: { opacity: 1 } } as never)).toThrow(/integer-keyed stop/);
  });
});

// ---------------------------------------------------------------------------
// Integration — the full motion vocabulary through a real render
// ---------------------------------------------------------------------------

describe("v0.7 integration", () => {
  const stops = {
    0: { opacity: 0, scale: 0.8 },
    15: { opacity: 1, scale: 1, easing: "backOut" as const },
    40: { opacity: 1 },
    50: { opacity: 0, easing: "easeIn" as const },
  };

  const banner = defineBanner(function MotionBanner() {
    return (
      <Banner width={320} height={120} fps={30}>
        <Scene duration={50}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120 }}>
            <Animated entering={staggered(FadeInDown, 0, { intervalFrames: 2 })} exiting={FadeOutLeft.duration(8)}>
              <Keyframes frames={stops}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#f8fafc" }}>
                  motion language
                </div>
              </Keyframes>
            </Animated>
          </div>
        </Scene>
        <Scene duration={40}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120 }}>
            <Animated entering={ZoomIn.springify("snappy")} exiting={FadeOutLeft.duration(10)}>
              <div style={{ fontSize: 22, color: "#f8fafc" }}>v0.7</div>
            </Animated>
          </div>
        </Scene>
      </Banner>
    );
  }) as never;

  it("capture is clean (no lint findings) and chunk-merges hard", async () => {
    const capture = await captureReactBanner(banner);
    expect(capture.lint).toEqual([]);
    // 90 raw frames must chunk-merge to fewer (r6 + settled nulls doing work).
    expect(capture.chunks.length).toBeLessThan(capture.htmlFrames.length);
    expect(capture.chunks.length).toBeGreaterThan(5);
  });

  it("renders byte-deterministically through the full pipeline", async () => {
    const a = await renderReactBanner({ banner, formats: ["gif", "webp"] });
    const b = await renderReactBanner({ banner, formats: ["gif", "webp"] });
    expect(a.lint).toEqual([]);
    expect(a.files.map((f) => f.bytes)).toEqual(b.files.map((f) => f.bytes));
    for (const [x, y] of a.files.map((f, i) => [f, b.files[i]] as const)) {
      expect(x.buffer.equals(y.buffer)).toBe(true);
    }
    // The motion actually happened: two scenes → 90 planned frames.
    const { plan } = await captureReactBanner(banner);
    expect(plan.totalFrames).toBe(90);
  }, 120_000);
});
