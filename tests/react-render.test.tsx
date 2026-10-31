// tests/react-render.test.tsx — the v0.3 render pipeline: chunk nodes →
// multi-scene renderAnimation, Safety Net, byte determinism, posters, fonts.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import {
  Banner,
  Scene,
  Layer,
  defineBanner,
  useCurrentFrame,
  useSpring,
  useFrameState,
  useInterpolate,
} from "../src/react/index.js";
import { renderReactBanner, formatReactReport, type ReactBannerReport } from "../src/react-render.js";
import type { BannerPreset } from "../src/presets.js";

const PRESET: BannerPreset = {
  width: 400,
  height: 100,
  devicePixelRatio: 1,
  fps: 20,
  formats: ["gif"],
  webpQuality: 80,
  budgetBytes: 4_000_000,
  description: "test preset",
};

function staticBanner() {
  return defineBanner(function StaticBanner() {
    return createElement(
      Banner,
      { preset: PRESET, theme: "tokyo-night" },
      createElement(Scene, { duration: 10 }, createElement("div", { style: { padding: 30, color: "#c0caf5", fontSize: 20 } }, "static")),
      createElement(Scene, { duration: 10 }, createElement("div", { style: { padding: 30, color: "#7aa2f7", fontSize: 20 } }, "second")),
    );
  });
}

function animatedBanner() {
  return defineBanner(function AnimatedBanner() {
    return createElement(
      Banner,
      { preset: PRESET, theme: "tokyo-night", loop: true },
      createElement(
        Scene,
        { duration: 20 },
        createElement(SpringyChild),
      ),
      createElement(
        Scene,
        { duration: 20, enter: "crossfade" as const },
        createElement(StatefulChild),
      ),
    );
  });
}

function SpringyChild() {
  const y = useSpring({ from: -16, to: 0, stiffness: 170, damping: 15 });
  return createElement(
    "div",
    { style: { height: 100, display: "flex", alignItems: "center", justifyContent: "center" } },
    createElement(
      "span",
      { style: { color: "#c0caf5", fontSize: 22, fontWeight: 700, transform: `translateY(${y.toFixed(2)}px)` } },
      "spring in",
    ),
  );
}

function StatefulChild() {
  const active = useFrameState(
    (state, action: { type: "next" }) => (action.type === "next" ? state + 1 : state),
    0,
    (f) => (f.frame > 0 && f.frame % 8 === 0 ? { type: "next" as const } : null),
  );
  const opacity = useInterpolate([0, 6], [0, 1], "easeOut");
  return createElement(
    "div",
    { style: { height: 100, display: "flex", alignItems: "center", justifyContent: "center" } },
    createElement(
      "span",
      { style: { color: "#7aa2f7", fontSize: 22, opacity: opacity.toFixed(3) } },
      `state ${active}`,
    ),
  );
}

describe("renderReactBanner (integration)", () => {
  it("renders a static two-scene banner through the multi-scene encoder", async () => {
    const report = await renderReactBanner({ banner: staticBanner(), baseName: "t-static" });

    expect(report.frames).toBe(20);
    expect(report.scenes).toBe(2);
    expect(report.chunks).toBe(2); // both scenes static → 2 unique chunks
    expect(report.mergedFrames).toBe(18);
    expect(report.files).toHaveLength(1); // gif only (preset formats)
    const gif = report.files[0];
    expect(gif.withinBudget).toBe(true);
    // Hold-collapse: each scene renders 10 identical frames → one 500ms GIF
    // frame each. Playback is identical at a fraction of the bytes.
    expect(gif.frames).toBe(2);
    expect(report.collapse).toMatchObject({ framesBefore: 20, framesAfter: 2 });
  });

  it("is byte-deterministic for the same input", async () => {
    const a = await renderReactBanner({ banner: staticBanner(), baseName: "t-det" });
    const b = await renderReactBanner({ banner: staticBanner(), baseName: "t-det" });
    expect(Buffer.compare(a.files[0].buffer, b.files[0].buffer)).toBe(0);
  });

  it("collapses GIF holds on the animated banner", async () => {
    const report = await renderReactBanner({ banner: animatedBanner(), baseName: "t-anim" });
    expect(report.frames).toBe(35); // 20 + 20 - 5 overlap frames (250ms @ 20fps)
    // spring settles + state holds → strictly fewer unique frames than 35
    expect(report.chunks).toBeLessThan(report.frames);
    if (report.collapse) {
      expect(report.collapse.framesAfter).toBeLessThan(report.collapse.framesBefore);
    }
    expect(report.files[0].withinBudget).toBe(true);
  });

  it("audits extents: static banners produce no hard failures", async () => {
    const report = await renderReactBanner({ banner: staticBanner(), baseName: "t-audit" });
    const hardFails = report.extents.violations.filter((v) => !v.decorative);
    expect(hardFails).toHaveLength(0);
    expect(report.extents.chunksChecked).toBe(report.chunks);
  });

  it("detects text pushed outside the canvas as a hard failure", async () => {
    const bad = defineBanner(function OverflowBanner() {
      return createElement(
        Banner,
        { preset: PRESET },
        createElement(
          Scene,
          { duration: 4 },
          createElement(
            "div",
            { style: { position: "absolute", left: 350, top: 10, width: 200 } },
            createElement("span", { style: { color: "#fff", fontSize: 18 } }, "this text runs far past the right edge"),
          ),
        ),
      );
    });
    const report = await renderReactBanner({ banner: bad, formats: [], posters: false, baseName: "t-over" });
    const hardFails = report.extents.violations.filter((v) => !v.decorative);
    expect(hardFails.length).toBeGreaterThan(0);
    expect(hardFails[0].detail).toMatch(/TEXT WILL CLIP/);
  });

  it("reports seam exact for loop banners whose first and last frames match", async () => {
    // Same static content in both scenes + cut transitions → frame 0 == last frame? No:
    // different text per scene. Use one scene whose content is frame-invariant.
    const looping = defineBanner(function LoopBanner() {
      return createElement(
        Banner,
        { preset: PRESET, loop: true },
        createElement(Scene, { duration: 8 }, createElement("div", { style: { padding: 30, color: "#fff", fontSize: 20 } }, "loop")),
      );
    });
    const report = await renderReactBanner({ banner: looping, baseName: "t-loop" });
    expect(report.seam.loop).toBe(true);
    expect(report.seam.mode).toBe("exact");
  });

  it("warns when loop is declared but the seam differs", async () => {
    const report = await renderReactBanner({ banner: animatedBanner(), baseName: "t-seam" });
    expect(report.seam.loop).toBe(true);
    expect(report.seam.mode).toBe("differs");
    expect(report.warnings.join(" ")).toMatch(/seam will visibly jump/);
  });

  it("renders posters from arbitrary frames", async () => {
    const report = await renderReactBanner({
      banner: animatedBanner(),
      baseName: "t-poster",
      posters: [0, 30],
    });
    expect(report.posters).toHaveLength(2);
    expect(report.posters[0].frame).toBe(0);
    expect(report.posters[1].frame).toBe(30);
    for (const p of report.posters) {
      expect(p.bytes).toBeGreaterThan(300); // non-blank PNG
    }
    // frame 30 is inside scene 2's exclusive window; its poster shows the state child
  });

  it("registers banner-declared fonts on the renderer", async () => {
    const withFont = defineBanner(function FontBanner() {
      return createElement(
        Banner,
        { preset: PRESET, fonts: [{ name: "Sora", weight: 600 }] },
        createElement(
          Scene,
          { duration: 4 },
          createElement("div", { style: { padding: 30, fontSize: 20, color: "#fff" } }, "fitted"),
        ),
      );
    });
    const report = await renderReactBanner({ banner: withFont, baseName: "t-font" });
    expect(report.fonts).not.toBeNull();
    const loaded = report.fonts?.families.map((f) => f.name) ?? [];
    expect(loaded).toContain("Sora");
  });

  it("formats a human-readable report", async () => {
    const report = await renderReactBanner({ banner: staticBanner(), baseName: "t-fmt" });
    const text = formatReactReport(report);
    expect(text).toContain("400×100 @ 20fps");
    expect(text).toContain("2 scenes → 2 chunks");
    expect(text).toContain("extents:");
    expect(text).toContain("seam:");
  });

  it("respects fps override from the CLI layer", async () => {
    const report = await renderReactBanner({ banner: staticBanner(), fps: 10, baseName: "t-fps" });
    expect(report.fps).toBe(10);
    expect(report.frames).toBe(20); // frames count is scene-declared, not fps-dependent
    expect(report.durationMs).toBe(2000);
  });
});

// Type-level guard: ReactBannerReport exposes what the CLI needs.
describe("report shape", () => {
  it("carries budget + warning fields", async () => {
    const report: ReactBannerReport = await renderReactBanner({
      banner: staticBanner(),
      baseName: "t-shape",
    });
    expect(typeof report.totalBytes).toBe("number");
    expect(typeof report.budgetBytes).toBe("number");
    expect(Array.isArray(report.warnings)).toBe(true);
    expect(report.overBudget).toBe(false);
  });
});
