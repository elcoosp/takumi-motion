// tests/v08-react.test.tsx — the Choreography Release, React side:
// chains through <Animated>, <Camera>, <Wiggle> + the TM_NOISE_ALIASED lint,
// <FollowPath>, cascade exits, scene labels + useCue, composition tempo, and
// windowed capture (--from/--to).

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  Animated,
  Camera,
  Wiggle,
  FollowPath,
  chain,
  hold,
  cascadeExit,
  FadeInDown,
  FadeOutRight,
  ZoomIn,
  useCue,
  useAbsoluteFrame,
  defineBanner,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";

const canvas = { width: 200, height: 100, fps: 20 };

function bannerOf(children: ReactNode) {
  return defineBanner(function V08Banner() {
    return <Banner {...canvas}>{children}</Banner>;
  }) as never;
}

// ---------------------------------------------------------------------------
// Bet A — chains through <Animated>
// ---------------------------------------------------------------------------

describe("chain() through <Animated>", () => {
  it("plays segments back-to-back and settles style-stable", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <Animated entering={chain(FadeInDown.duration(10), hold(6), ZoomIn.duration(10))}>
            <div style={{ fontSize: 18 }}>chained</div>
          </Animated>
        </Scene>,
      ),
    );

    // Frame 0: first segment's start state.
    expect(capture.htmlFrames[0]).toContain("opacity:0");
    expect(capture.htmlFrames[0]).toContain("translateY(-24px)");

    // Frame 12 (inside the hold): the hold state — visible, no offset.
    const holdHtml = capture.htmlFrames[12];
    expect(holdHtml).toContain("opacity:1");

    // Frame 16 (ZoomIn window start): scale begins from ZoomIn's own start —
    // and OPACITY CONTINUITY keeps it visible (no blink at the handoff).
    const at16 = capture.htmlFrames[16];
    expect(at16).toContain("scale(0.6)");
    expect(at16).toContain("opacity:1");

    // Frame 27+ (chain span 26): settled — no overrides from the wrapper.
    const settled = capture.htmlFrames[27];
    expect(settled).not.toContain("translateY(-24px)");
    expect(settled).not.toContain("scale(0.6");

    // The scene-final frame rendered clean (no chain diagnostics — it fits).
    expect(capture.lint.filter((l) => l.code === "TM_TRANSITION_UNSETTLED")).toEqual([]);
  });

  it("an overflowing chain reports TM_TRANSITION_UNSETTLED through capture", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Animated entering={chain(FadeInDown.duration(14), hold(10), ZoomIn.duration(14))}>
            <div>too long</div>
          </Animated>
        </Scene>,
      ),
    );
    const unsettled = capture.lint.filter((l) => l.code === "TM_TRANSITION_UNSETTLED");
    expect(unsettled.length).toBeGreaterThan(0);
    expect(unsettled[0].message).toMatch(/chain\(/);
  });

  it("velocity continuity flows end-to-end (carry kicks the spring ahead)", async () => {
    const PHYS = { stiffness: 170, damping: 11 };
    const carryCapture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <Animated entering={chain(FadeInDown.duration(12), ZoomIn.springify(PHYS).carryVelocity())}>
            <div>v</div>
          </Animated>
        </Scene>,
      ),
    );
    const restCapture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <Animated entering={chain(FadeInDown.duration(12), ZoomIn.springify(PHYS))}>
            <div>v</div>
          </Animated>
        </Scene>,
      ),
    );
    // No dropped-carry lint when the carry lands.
    expect(carryCapture.lint.filter((l) => l.code === "TM_VELOCITY_DROPPED")).toEqual([]);
    // And the frames genuinely differ after the handoff.
    const f = 15;
    expect(carryCapture.htmlFrames[f]).not.toBe(restCapture.htmlFrames[f]);
  });
});

// ---------------------------------------------------------------------------
// Bet B — <FollowPath>
// ---------------------------------------------------------------------------

describe("<FollowPath>", () => {
  it("travels the path across frames and settles at the end point", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={30}>
          <FollowPath d="M -40 50 L 160 50" durationFrames={20} style={{ fontSize: 16 }}>
            <div>orb</div>
          </FollowPath>
        </Scene>,
      ),
    );
    // Frame 0: at the path start.
    expect(capture.htmlFrames[0]).toContain("translateX(-40px)");
    // Frame 10 (mid): roughly halfway.
    const mid = capture.htmlFrames[10];
    expect(mid).toMatch(/translateX\(-?[\d.]+px\)/);
    expect(mid).not.toContain("translateX(-40px)");
    // Settled: constant end transform (style-stable, chunk-mergeable).
    const end = capture.htmlFrames[25];
    expect(end).toContain("translateX(160px)");
    expect(capture.htmlFrames[26]).toBe(end);
  });

  it("rotate:'auto' emits the tangent rotation", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={10}>
          <FollowPath d="M 0 0 L 0 100" durationFrames={10} rotate="auto">
            <div>↕</div>
          </FollowPath>
        </Scene>,
      ),
    );
    // Vertical path → tangent ≈ 90°.
    expect(capture.htmlFrames[5]).toMatch(/rotate\(9?0(\.\d+)?deg\)/);
  });
});

// ---------------------------------------------------------------------------
// Bets C + D — <Wiggle> and <Camera>
// ---------------------------------------------------------------------------

describe("<Wiggle>", () => {
  it("is deterministic and moves the subtree per frame", async () => {
    const props = { amplitude: 6, frequency: 0.15, seed: "test" } as const;
    const a = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Wiggle {...props}>
            <div>w</div>
          </Wiggle>
        </Scene>,
      ),
    );
    const b = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Wiggle {...props}>
            <div>w</div>
          </Wiggle>
        </Scene>,
      ),
    );
    expect(a.htmlFrames[5]).toBe(b.htmlFrames[5]);
    expect(a.htmlFrames[5]).toMatch(/translateX\(-?[\d.]+px\)/);
    expect(a.htmlFrames[5]).not.toBe(a.htmlFrames[9]);
  });

  it("aliases above the Nyquist limit are reported as TM_NOISE_ALIASED", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={12}>
          <Wiggle frequency={0.9} amplitude={5}>
            <div>shaky</div>
          </Wiggle>
        </Scene>,
      ),
    );
    const aliased = capture.lint.filter((l) => l.code === "TM_NOISE_ALIASED");
    expect(aliased.length).toBeGreaterThan(0);
    expect(aliased[0].message).toMatch(/0\.9/);
  });
});

describe("<Camera>", () => {
  it("pushes in and pans per frame (root transform choreography)", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={30}>
          <Camera pushIn={{ from: 1, to: 1.2 }} pan={{ x: [-10, 10] }}>
            <div style={{ fontSize: 20 }}>stage</div>
          </Camera>
        </Scene>,
      ),
    );
    // Frame 0: at the start of both tracks.
    expect(capture.htmlFrames[0]).toContain("translateX(-10px)");
    expect(capture.htmlFrames[0]).toContain("scale(1)");
    // Frame 25: pushed and panned.
    const late = capture.htmlFrames[25];
    expect(late).toMatch(/translateX\([\d.]+px\)/);
    expect(late).toMatch(/scale\(1\.1[\d]*\)/);
  });

  it("shake adds noise offsets and reports aliasing above Nyquist", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={12}>
          <Camera shake={{ amplitude: 4, frequency: 0.8, seed: 3 }}>
            <div>s</div>
          </Camera>
        </Scene>,
      ),
    );
    expect(capture.lint.some((l) => l.code === "TM_NOISE_ALIASED" && /Camera shake/.test(l.message))).toBe(true);
  });

  it("transformOrigin reaches the camera node (left-anchored push-ins)", async () => {
    // Regression (v0.8.1 demo reel): a center-origin push-in shoved the
    // left-parked headline off the canvas edge — the camera needs an origin.
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Camera pushIn={{ from: 1, to: 1.15 }} transformOrigin="left center">
            <div style={{ fontSize: 18 }}>left-anchored</div>
          </Camera>
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[0]).toContain("transform-origin:left center");
    // The pushed frame keeps the same origin (it rides the same node).
    expect(capture.htmlFrames[15]).toContain("transform-origin:left center");
  });

  it("finite shake decays to an exact rest (frames merge after it settles)", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={24}>
          <Camera shake={{ amplitude: 4, frequency: 0.2, seed: 5, durationFrames: 10 }}>
            <div style={{ fontSize: 18 }}>tremor</div>
          </Camera>
        </Scene>,
      ),
    );
    // Mid-shake: the tremor is live.
    expect(capture.htmlFrames[4]).toMatch(/translateX\([+-]?[\d.]+px\)/);
    // At/past the envelope end: amplitude 0 → no transform at all, so the
    // tail frames are style-stable (chunk-merge stays effective).
    expect(capture.htmlFrames[10]).not.toContain("translateX(");
    expect(capture.htmlFrames[10]).toBe(capture.htmlFrames[23]);
  });
});

// ---------------------------------------------------------------------------
// Bet E — cascade exits
// ---------------------------------------------------------------------------

describe("cascade exits", () => {
  it("units leave in order, all landing hidden at the scene close", async () => {
    const lines = ["one", "two", "three"];
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={30}>
          {lines.map((line, i) => (
            <Animated key={i} exiting={cascadeExit(FadeOutRight, i, lines.length, { intervalFrames: 3 })}>
              <div>{line}</div>
            </Animated>
          ))}
        </Scene>,
      ),
    );
    // Exits have duration 18, anchored at scene close; delays 4/2/0 → starts 8/10/12.
    // At frame 9: unit 0 is already exiting (opacity < 1), unit 2 has not started.
    const f9 = capture.htmlFrames[9];
    expect(f9).toMatch(/opacity:0\.\d+/);
    // At the final frame: everything hidden.
    const last = capture.htmlFrames[29];
    expect(last).toMatch(/opacity:0/);
  });
});

// ---------------------------------------------------------------------------
// Bet A — labels + cues
// ---------------------------------------------------------------------------

describe("scene labels + useCue", () => {
  it("resolves cue expressions to absolute frames inside the runtime", async () => {
    // A gate that opens exactly 3 frames after the "demo" scene starts.
    function Gated(props: { children: ReactNode }) {
      const demo = useCue("demo + 3f");
      const frame = useAbsoluteFrame();
      return createElement("div", { style: { opacity: frame >= demo ? 1 : 0.25 } }, props.children);
    }

    const capture = await captureReactBanner(
      bannerOf(
        <>
          <Scene duration={20} label="intro">
            <div>intro</div>
          </Scene>
          <Scene duration={40} label="demo">
            <Gated>
              <div>gated</div>
            </Gated>
          </Scene>
        </>,
      ),
    );

    const introScene = capture.plan.labels.intro;
    const demoScene = capture.plan.labels.demo;
    expect(introScene).toBe(0);
    expect(demoScene).toBe(20);

    // demo+3 lands at global frame 23 — the gate is closed at 22, open at 23.
    expect(capture.htmlFrames[22]).toContain("opacity:0.25");
    expect(capture.htmlFrames[23]).toContain("opacity:1");
  });
});

// ---------------------------------------------------------------------------
// Bet E/F — tempo + windowed capture
// ---------------------------------------------------------------------------

describe("composition tempo", () => {
  it("tempo 2 halves the output frames and maps them onto authored time", async () => {
    const make = () =>
      bannerOf(
        <Scene duration={20}>
          <Animated entering={FadeInDown.duration(10)}>
            <div>t</div>
          </Animated>
        </Scene>,
      );

    const normal = await captureReactBanner(make());
    const fast = await captureReactBanner(make(), { fromFrame: undefined });

    const fastCapture = await captureReactBanner(
      defineBanner(function TempoBanner() {
        return (
          <Banner {...canvas} tempo={2}>
            <Scene duration={20}>
              <Animated entering={FadeInDown.duration(10)}>
                <div>t</div>
              </Animated>
            </Scene>
          </Banner>
        );
      }) as never,
    );

    expect(normal.plan.totalFrames).toBe(20);
    expect(fastCapture.outputFrames).toBe(10);
    // Output frame 5 sees authored frame 10 — the entrance is already halfway.
    expect(fastCapture.htmlFrames[5]).toBe(normal.htmlFrames[10]);
    // The last output frame maps to the authored close.
    expect(fastCapture.htmlFrames[9]).toBe(normal.htmlFrames[19]);
    void fast;
  });
});

describe("windowed capture (--from/--to)", () => {
  it("renders only the requested subrange with rebased chunks", async () => {
    const make = () =>
      bannerOf(
        <>
          <Scene duration={10}>
            <div style={{ fontSize: 18 }}>a</div>
          </Scene>
          <Scene duration={10}>
            <div style={{ fontSize: 18 }}>b</div>
          </Scene>
        </>,
      );

    const full = await captureReactBanner(make());
    const windowed = await captureReactBanner(make(), { fromFrame: 8, toFrame: 14 });

    expect(full.outputFrames).toBe(20);
    expect(windowed.outputFrames).toBe(6);
    expect(windowed.window).toEqual({ from: 8, to: 14, tempo: 1 });
    // Frame 0 of the window == frame 8 of the full capture.
    expect(windowed.htmlFrames[0]).toBe(full.htmlFrames[8]);
    expect(windowed.htmlFrames[5]).toBe(full.htmlFrames[13]);
    // Chunks are rebased into the window (first chunk starts at 8).
    expect(windowed.chunks[0].startFrame).toBe(8);
  });
});
