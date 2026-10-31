// tests/v09-material.test.tsx — v0.9 Bet C: the material pack.
// <Reveal> directional mask wipes (+ feather), <Mask> presets, <VariableText>
// weight tracks, <GradientText> background-clip fill — all through capture,
// plus a through-the-renderer pixel probe for the feathered wipe.

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  Fill,
  Reveal,
  Mask,
  VariableText,
  GradientText,
  revealGradient,
  defineBanner,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";

const canvas = { width: 200, height: 100, fps: 20 };

function bannerOf(children: ReactNode, bannerProps: Record<string, unknown> = {}) {
  return defineBanner(function V09MaterialBanner() {
    return <Banner {...canvas} {...bannerProps}>{children}</Banner>;
  }) as never;
}

// ---------------------------------------------------------------------------
// revealGradient (pure math)
// ---------------------------------------------------------------------------

describe("revealGradient", () => {
  it("starts fully transparent, ends fully black", () => {
    expect(revealGradient("right", 0, 0, 200, 100)).toBe(
      "linear-gradient(90deg, transparent 0px, transparent 200px)",
    );
    const full = revealGradient("right", 1, 0, 200, 100);
    expect(full).toContain("black 200px");
    expect(full).toContain("transparent 200px"); // hard cut at the box edge
  });

  it("sweeps the edge along the travel direction", () => {
    expect(revealGradient("right", 0.5, 0, 200, 100)).toContain("black 100px");
    expect(revealGradient("left", 0.5, 0, 200, 100)).toContain("270deg");
    expect(revealGradient("up", 0.5, 0, 200, 100)).toContain("0deg");
    expect(revealGradient("down", 0.5, 0, 200, 100)).toContain("180deg");
    // Vertical wipes travel across the height, not the width.
    expect(revealGradient("up", 0.5, 0, 200, 100)).toContain("black 50px");
  });

  it("adds a feather band ahead of the edge", () => {
    const g = revealGradient("right", 0.5, 24, 200, 100);
    expect(g).toContain("black 100px");
    expect(g).toContain("transparent 124px");
  });

  it("circle wipes grow radially from the center", () => {
    const g = revealGradient("circle", 0.5, 0, 200, 100);
    expect(g).toContain("radial-gradient(circle at 50% 50%");
    // half-diagonal of 200×100 ≈ 111.803399; at progress 0.5 → 55.901699
    expect(g).toContain("black 55.901699px");
  });
});

// ---------------------------------------------------------------------------
// <Reveal>
// ---------------------------------------------------------------------------

describe("<Reveal>", () => {
  it("emits a mask while animating and none when settled", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={50}>
          <Reveal wipe="up" feather={24} drawDurationFrames={30} drawDelayFrames={4} style={{ width: 180, height: 80 }}>
            <div style={{ fontSize: 22, color: "#f8fafc" }}>quote card</div>
          </Reveal>
        </Scene>,
      ),
    );
    // Before the draw: fully transparent mask.
    expect(capture.htmlFrames[0]).toContain("mask-image:linear-gradient(0deg, transparent 0px");
    // Mid-draw: black edge rising with a 24px feather band.
    const mid = capture.htmlFrames[20];
    expect(mid).toContain("mask-image:linear-gradient(0deg, black 0px, black ");
    expect(mid).toMatch(/transparent \d+(\.\d+)?px/);
    // Settled: no mask at all (style-stable → chunk-merges).
    expect(capture.htmlFrames[45]).not.toContain("mask-image");
  });

  it("renders feathered wipes with real alpha ramp through the renderer", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <Fill style={{ backgroundColor: "#38bdf8" }}>
            <Reveal wipe="right" drawDurationFrames={24} drawDelayFrames={4} style={{ width: 200, height: 100 }} />
          </Fill>
        </Scene>,
      ),
      { background: "#101010" },
    );
    const { fromHtml } = await import("@takumi-rs/helpers/html");
    const { Renderer } = await import("takumi-js/node");
    const renderer = new Renderer();
    const chunk = capture.chunks[Math.min(6, capture.chunks.length - 1)];
    const { node } = await fromHtml(chunk.html);
    const raw = (await renderer.render(node as never, { width: 200, height: 100, format: "raw" } as never)) as Buffer;
    // Left edge revealed (opaque sky blue), right edge still covered (bg).
    const idxL = (50 * 200 + 10) * 4;
    const idxR = (50 * 200 + 190) * 4;
    expect(raw[idxL + 2]).toBeGreaterThan(150); // blue channel high
    expect(raw[idxR]).toBeLessThan(60); // bg red channel low
  });
});

// ---------------------------------------------------------------------------
// <Mask>
// ---------------------------------------------------------------------------

describe("<Mask>", () => {
  it("applies fade presets as mask gradients", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={10}>
          <Mask fade="bottom" fadeLength={32}>
            <div style={{ fontSize: 20 }}>fading</div>
          </Mask>
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[0]).toContain("mask-image:linear-gradient(180deg, black 32px, transparent 64px)");
  });

  it("accepts a raw mask image and mask mode", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={10}>
          <Mask image="radial-gradient(circle, black 40%, transparent 70%)" mode="luminance">
            <div>vignette</div>
          </Mask>
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[0]).toContain("mask-image:radial-gradient(circle, black 40%, transparent 70%)");
    expect(capture.htmlFrames[0]).toContain("mask-mode:luminance");
  });

  it("throws when neither image nor fade is given", async () => {
    await expect(
      captureReactBanner(bannerOf(<Scene duration={10}><Mask><div>x</div></Mask></Scene>)),
    ).rejects.toThrow(/provide `image`/);
  });
});

// ---------------------------------------------------------------------------
// <VariableText>
// ---------------------------------------------------------------------------

describe("<VariableText>", () => {
  it("sweeps fontVariationSettings from weight to weight", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <VariableText text="Signal" from={300} to={800} durationFrames={30} drawDelayFrames={2} fontSize={40} />
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[0]).toContain("font-variation-settings:&#x27;wght&#x27; 300");
    // Settled exactly at `to` (quotes are HTML-escaped in static markup).
    expect(capture.htmlFrames[38]).toContain("font-variation-settings:&#x27;wght&#x27; 800");
    // Mid-swell: some intermediate integer weight.
    const mid = capture.htmlFrames[15].match(/font-variation-settings:&#x27;wght&#x27; (\d+)/);
    expect(mid).not.toBeNull();
    const weight = Number(mid![1]);
    expect(weight).toBeGreaterThan(300);
    expect(weight).toBeLessThan(800);
  });
});

// ---------------------------------------------------------------------------
// <GradientText>
// ---------------------------------------------------------------------------

describe("<GradientText>", () => {
  it("clips a gradient into the text", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={10}>
          <GradientText text="takumi" fontSize={48} fontWeight={800} />
        </Scene>,
      ),
    );
    const frame = capture.htmlFrames[0];
    expect(frame).toContain("-webkit-background-clip:text");
    expect(frame).toContain("background-clip:text");
    expect(frame).toContain("color:transparent");
    expect(frame).toContain("linear-gradient(90deg, #38bdf8, #a78bfa)");
  });

  it("honors a custom gradient", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={10}>
          <GradientText text="hot" gradient="linear-gradient(90deg, #f00, #00f)" />
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[0]).toContain("linear-gradient(90deg, #f00, #00f)");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("material pack determinism", () => {
  it("two captures are byte-identical", async () => {
    const banner = bannerOf(
      <Scene duration={30}>
        <Fill style={{ flexDirection: "column", gap: 8 }}>
          <Reveal wipe="up" feather={12} drawDurationFrames={20} style={{ width: 160, height: 40 }}>
            <div>one</div>
          </Reveal>
          <VariableText text="two" durationFrames={20} />
          <GradientText text="three" />
        </Fill>
      </Scene>,
    );
    const a = await captureReactBanner(banner);
    const b = await captureReactBanner(banner);
    expect(a.htmlFrames.join("\u0000")).toBe(b.htmlFrames.join("\u0000"));
  });
});
