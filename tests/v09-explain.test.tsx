// tests/v09-explain.test.tsx — v0.9 Bet F: the X-ray.
// explainCapture attributes every frame to channels; the summary separates
// cheap churn (opacity/clip) from expensive churn (layout/text/structure);
// formatExplain renders the human table; renderReactBanner({ explain }) and
// the CLI flag surface it as report.explain.

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  explainCapture,
  formatExplain,
  rangesOf,
} from "../src/index.js";
import {
  Banner,
  Scene,
  CountUp,
  Animated,
  FadeIn,
  defineBanner,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner } from "../src/react-render.js";

const canvas = { width: 200, height: 100, fps: 20 };

function bannerOf(children: ReactNode) {
  return defineBanner(function V09ExplainBanner() {
    return <Banner {...canvas}>{children}</Banner>;
  }) as never;
}

describe("rangesOf", () => {
  it("compresses sorted frame indexes into inclusive ranges", () => {
    expect(rangesOf([1, 2, 3, 7, 9, 10])).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 7 },
      { from: 9, to: 10 },
    ]);
    expect(rangesOf([])).toEqual([]);
  });
});

describe("explainCapture", () => {
  it("classifies a static banner as all holds", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={12}>
          <div style={{ fontSize: 20, color: "#fff" }}>static</div>
        </Scene>,
      ),
    );
    const explain = explainCapture(capture);
    expect(explain.summary.totalFrames).toBe(12);
    expect(explain.summary.uniqueFrames).toBe(1);
    expect(explain.summary.holds).toBe(11);
    expect(explain.summary.churnFrames).toBe(0);
    // Frame 0 is the "start".
    expect(explain.frames[0].kind).toBe("start");
  });

  it("attributes opacity animation to the opacity channel (cheap churn)", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Animated entering={FadeIn.duration(12)}>
            <div style={{ fontSize: 20 }}>fade</div>
          </Animated>
        </Scene>,
      ),
    );
    const explain = explainCapture(capture);
    // 12 opacity frames + the structure change at frame 1 (Animated wrapper
    // appears with its start state — actually present from frame 0 here).
    const opacityFrames = explain.frames.filter((f) =>
      f.changes.some((c) => c.channel === "opacity"),
    );
    expect(opacityFrames.length).toBeGreaterThan(6);
    // NO layout/text churn for a pure fade.
    expect(explain.summary.churnFrames).toBe(0);
    // cheapFrames counts unique frames whose changes are opacity/clip only.
    expect(explain.summary.cheapFrames).toBeGreaterThan(6);
  });

  it("attributes CountUp deltas to the text channel (expensive churn)", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={24}>
          <CountUp to={1200} durationFrames={20} format="$,.0f" />
        </Scene>,
      ),
    );
    const explain = explainCapture(capture);
    expect(explain.summary.churnFrames).toBeGreaterThan(10);
    const textChannel = explain.summary.channels.find((c) => c.channel === "text");
    expect(textChannel).toBeDefined();
    expect(textChannel!.frames).toBeGreaterThan(10);
    // A text change carries the before → after strings.
    const textChange = explain.frames
      .flatMap((f) => f.changes)
      .find((c) => c.channel === "text" && c.from !== undefined && c.to !== undefined);
    expect(textChange).toBeDefined();
    expect(textChange!.from).toMatch(/^\$/);
    expect(textChange!.to).toMatch(/^\$/);
  });

  it("labels the active scene per frame", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <>
          <Scene duration={10}>
            <div style={{ opacity: 0.5 }}>a</div>
          </Scene>
          <Scene duration={10} enter="crossfade">
            <div style={{ opacity: 0.5 }}>b</div>
          </Scene>
        </>,
      ),
    );
    const explain = explainCapture(capture);
    expect(explain.frames[0].scene).toBe(0);
    expect(explain.frames[explain.frames.length - 1].scene).toBe(1);
  });

  it("detects structure changes when the tree shape changes", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <>
          <Scene duration={8}>
            <div>one</div>
          </Scene>
          <Scene duration={8}>
            <div style={{ fontSize: 40 }}>two</div>
            <div>extra</div>
          </Scene>
        </>,
      ),
    );
    const explain = explainCapture(capture);
    const structureFrames = explain.frames.filter((f) =>
      f.changes.some((c) => c.channel === "structure"),
    );
    expect(structureFrames.length).toBeGreaterThan(0);
  });
});

describe("formatExplain", () => {
  it("renders a compact human table", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={16}>
          <CountUp to={900} durationFrames={10} />
        </Scene>,
      ),
    );
    const table = formatExplain(explainCapture(capture));
    expect(table).toContain("explain:");
    expect(table).toContain("churn frames:");
    expect(table).toMatch(/unique \/ 16 frames/);
  });
});

describe("renderReactBanner({ explain })", () => {
  it("attaches report.explain and stays absent by default", async () => {
    const banner = bannerOf(
      <Scene duration={10}>
        <CountUp to={50} durationFrames={6} />
      </Scene>,
    );
    const withExplain = await renderReactBanner({
      banner,
      width: 200,
      height: 100,
      dpr: 1,
      formats: [],
      posters: false,
      explain: true,
    } as never);
    expect(withExplain.explain).toBeDefined();
    expect(withExplain.explain!.summary.totalFrames).toBe(10);

    const without = await renderReactBanner({
      banner,
      width: 200,
      height: 100,
      dpr: 1,
      formats: [],
      posters: false,
    } as never);
    expect(without.explain).toBeUndefined();
  });
});
