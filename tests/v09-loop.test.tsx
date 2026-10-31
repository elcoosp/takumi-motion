// tests/v09-loop.test.tsx — v0.9 Bet E: the forever reel.
// enter="wrap" on the last scene appends a crossfade tail into scene 1's
// frozen frame-0 layer; the seam lands byte-exact; TM_LOOP_SEAM flags
// un-wrapped loop banners; looping posters default to frame 0.

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  planBanner,
  composeFrame,
  defineBanner,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner } from "../src/react-render.js";

const canvas = { width: 200, height: 100, fps: 20 };

function bannerOf(children: ReactNode, bannerProps: Record<string, unknown> = {}) {
  return defineBanner(function V09LoopBanner() {
    return <Banner {...canvas} {...bannerProps}>{children}</Banner>;
  }) as never;
}

// ---------------------------------------------------------------------------
// Plan level
// ---------------------------------------------------------------------------

describe("plan wrap", () => {
  it("appends wrap frames for the last scene only", () => {
    const plan = planBanner(
      [
        { durationFrames: 20 },
        { durationFrames: 20, enter: "crossfade", exit: "wrap" },
      ],
      { fps: 20 },
    );
    expect(plan.wrapFrames).toBeGreaterThan(0);
    expect(plan.totalFrames).toBe(
      plan.scenes[plan.scenes.length - 1].startFrame +
        plan.scenes[plan.scenes.length - 1].durationFrames +
        plan.wrapFrames,
    );
  });

  it("warns and ignores wrap on non-last scenes", () => {
    const plan = planBanner(
      [
        { durationFrames: 20, enter: "wrap" as const },
        { durationFrames: 20 },
      ],
      { fps: 20 },
    );
    expect(plan.wrapFrames).toBe(0);
    expect(plan.warnings.some((w) => w.includes("only honored on the LAST scene"))).toBe(true);
  });

  it("composeFrame returns wrap compositions past the last scene", () => {
    const plan = planBanner(
      [
        { durationFrames: 20 },
        { durationFrames: 20, exit: "wrap" },
      ],
      { fps: 20 },
    );
    const lastEnd = plan.scenes[1].startFrame + plan.scenes[1].durationFrames;
    const wrap = composeFrame(plan, lastEnd);
    expect(wrap.mode).toBe("wrap");
    if (wrap.mode === "wrap") {
      expect(wrap.arriving.index).toBe(0);
      expect(wrap.localFrame.arriving).toBe(0);
      expect(wrap.progress).toBeGreaterThan(0);
      expect(wrap.progress).toBeLessThanOrEqual(1);
    }
    // The FINAL wrap frame is at progress 1.
    const final = composeFrame(plan, plan.totalFrames - 1);
    expect(final.mode).toBe("wrap");
    if (final.mode === "wrap") expect(final.progress).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Capture level — the byte-exact seam
// ---------------------------------------------------------------------------

describe("wrap seam", () => {
  it("lands frame 0 == final frame byte-exactly", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <>
          <Scene duration={20}>
            <div style={{ fontSize: 22, color: "#f8fafc" }}>open</div>
          </Scene>
          <Scene duration={24} enter="crossfade" exit="wrap">
            <div style={{ fontSize: 22, color: "#f8fafc" }}>finale</div>
          </Scene>
        </>,
        { loop: true },
      ),
    );
    expect(capture.plan.wrapFrames).toBeGreaterThan(0);
    // THE Bet E promise: the seam is byte-exact by construction.
    expect(capture.htmlFrames[0]).toBe(capture.htmlFrames[capture.htmlFrames.length - 1]);
    // The wrap tail actually composites two layers mid-tail (both scenes'
    // content visible: the finale fading + scene 1's frozen layer beneath).
    const midTail = capture.htmlFrames[capture.htmlFrames.length - 2];
    expect(midTail).toContain("finale");
    expect(midTail).toContain("open");
    expect(midTail).toContain("opacity:");
  });

  it("deterministic across runs (wrapped loop)", async () => {
    const banner = bannerOf(
      <>
        <Scene duration={16}>
          <div>one</div>
        </Scene>
        <Scene duration={16} exit="wrap">
          <div>two</div>
        </Scene>
      </>,
      { loop: true },
    );
    const a = await captureReactBanner(banner);
    const b = await captureReactBanner(banner);
    expect(a.htmlFrames.join("\u0000")).toBe(b.htmlFrames.join("\u0000"));
  });
});

// ---------------------------------------------------------------------------
// TM_LOOP_SEAM + poster doctrine
// ---------------------------------------------------------------------------

describe("TM_LOOP_SEAM + looping poster", () => {
  it("flags a loop banner whose seam differs, silent when wrapped", async () => {
    const unwrapped = await renderReactBanner({
      banner: bannerOf(
        <>
          <Scene duration={12}>
            <div style={{ fontSize: 20 }}>a</div>
          </Scene>
          <Scene duration={12} enter="crossfade">
            <div style={{ fontSize: 20 }}>b</div>
          </Scene>
        </>,
        { loop: true },
      ),
      width: 200,
      height: 100,
      dpr: 1,
      formats: [],
      posters: false,
    } as never);
    expect(unwrapped.seam.mode).toBe("differs");
    expect(unwrapped.lint.some((l) => l.code === "TM_LOOP_SEAM")).toBe(true);
    expect(unwrapped.lint.find((l) => l.code === "TM_LOOP_SEAM")?.hint).toContain("wrap");

    const wrapped = await renderReactBanner({
      banner: bannerOf(
        <>
          <Scene duration={12}>
            <div style={{ fontSize: 20 }}>a</div>
          </Scene>
          <Scene duration={14} exit="wrap">
            <div style={{ fontSize: 20 }}>b</div>
          </Scene>
        </>,
        { loop: true },
      ),
      width: 200,
      height: 100,
      dpr: 1,
      formats: [],
    } as never);
    expect(wrapped.seam.mode).toBe("exact");
    expect(wrapped.lint.filter((l) => l.code === "TM_LOOP_SEAM")).toEqual([]);
    // Looping banners poster frame 0 by default.
    expect(wrapped.posters[0].frame).toBe(0);
  });
});
