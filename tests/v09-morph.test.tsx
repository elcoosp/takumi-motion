// tests/v09-morph.test.tsx — v0.9 Bet B: layout truth.
// <Morph> measured FLIP through the real capture prewarm (rects cached, FLIP
// transforms match the measured deltas, settled frames transform-free), and
// the TM_LAYOUT_SHIFT lint (pushed-sibling detection on synthetic trees, plus
// an end-to-end renderReactBanner case).

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  Fill,
  Morph,
  clearMorphCache,
  morphRectOf,
  morphContainerRectOf,
  defineBanner,
} from "../src/react/index.js";
import { detectLayoutShifts, layoutShiftWarnings } from "../src/layout-shift.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner } from "../src/react-render.js";
import type { MeasuredNode } from "takumi-js/node";

const canvas = { width: 240, height: 140, fps: 20 };

function bannerOf(children: ReactNode) {
  return defineBanner(function V09MorphBanner() {
    return <Banner {...canvas}>{children}</Banner>;
  }) as never;
}

// ---------------------------------------------------------------------------
// detectLayoutShifts (synthetic measured trees)
// ---------------------------------------------------------------------------

function node(w: number, h: number, x: number, y: number, text = "", children: MeasuredNode[] = []): MeasuredNode {
  return {
    width: w,
    height: h,
    transform: [1, 0, 0, 1, x, y],
    children,
    runs: text ? [{ text, x: 0, y: 0, width: w }] : [],
  } as never;
}

describe("detectLayoutShifts", () => {
  const sceneAt = () => 0;

  it("flags a leaf pushed by a growing sibling, naming the culprit", () => {
    // Frame A: [title 40w][label at x=48]. Frame B: title grew 40→60, label pushed +20.
    const a = node(200, 100, 0, 0, "", [
      node(40, 24, 8, 8, "title"),
      node(100, 24, 48, 8, "the label"),
    ]);
    const b = node(200, 100, 0, 0, "", [
      node(60, 24, 8, 8, "title"),
      node(100, 24, 68, 8, "the label"),
    ]);
    const findings = detectLayoutShifts([a, b], [0, 5], sceneAt);
    expect(findings).toHaveLength(1);
    expect(findings[0].axis).toBe("x");
    expect(findings[0].deltaPx).toBe(20);
    expect(findings[0].text).toBe("the label");
    expect(findings[0].pushedBy).toEqual({ path: "/0", axis: "width", deltaPx: 20 });
  });

  it("skips cross-scene pairs and transform-sized movers", () => {
    const a = node(200, 100, 0, 0, "", [node(100, 24, 8, 8, "leaf")]);
    const bSame = node(200, 100, 0, 0, "", [node(100, 24, 58, 8, "leaf")]);
    const bResized = node(200, 100, 0, 0, "", [node(150, 24, 8, 8, "leaf")]);
    // Cross-scene (scene 0 → scene 1 across the pair): skipped entirely.
    expect(detectLayoutShifts([a, bSame], [0, 5], (frame) => (frame < 3 ? 0 : 1))).toHaveLength(0);
    // Same scene but the mover RESIZED (authored growth, not a shift).
    expect(detectLayoutShifts([a, bResized], [0, 5], sceneAt)).toHaveLength(0);
  });

  it("dedupes repeated findings across pairs", () => {
    const a = node(200, 100, 0, 0, "", [node(40, 24, 8, 8, "t"), node(100, 24, 48, 8, "l")]);
    const b = node(200, 100, 0, 0, "", [node(60, 24, 8, 8, "t"), node(100, 24, 68, 8, "l")]);
    const findings = detectLayoutShifts([a, b, b], [0, 5, 10], sceneAt);
    expect(findings).toHaveLength(1);
  });

  it("layoutShiftWarnings carry the doctrine hint", () => {
    const a = node(200, 100, 0, 0, "", [node(40, 24, 8, 8, "t"), node(100, 24, 48, 8, "l")]);
    const b = node(200, 100, 0, 0, "", [node(60, 24, 8, 8, "t"), node(100, 24, 68, 8, "l")]);
    const warnings = layoutShiftWarnings(detectLayoutShifts([a, b], [0, 5], sceneAt));
    expect(warnings[0].code).toBe("TM_LAYOUT_SHIFT");
    expect(warnings[0].hint).toContain("tabular-nums");
  });
});

// ---------------------------------------------------------------------------
// <Morph> through capture (measured rect flight, v0.9.1)
// ---------------------------------------------------------------------------

const itemIds = ["a", "b"];
const morphLayout = {
  containerStyle: {
    list: { display: "flex", flexDirection: "column" as const, gap: 8, padding: 12 },
    grid: { display: "flex", flexWrap: "wrap" as const, gap: 8, padding: 12 },
  },
  itemStyle: {
    list: { a: { width: 200, height: 40 }, b: { width: 200, height: 40 } },
    grid: { a: { width: 100, height: 80 }, b: { width: 100, height: 80 } },
  },
};

function morphChildren() {
  return (
    <Morph
      from="list"
      to="grid"
      switchFrame={16}
      durationFrames={10}
      itemIds={itemIds}
      renderItem={(id, state) => (
        <div style={{ fontSize: 14, color: "#f8fafc" }}>{`${id}:${state}`}</div>
      )}
      {...morphLayout}
    />
  );
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

describe("<Morph>", () => {
  it("measures both states in prewarm and flies items through the switch", async () => {
    clearMorphCache();
    const capture = await captureReactBanner(
      bannerOf(<Scene duration={40}>{morphChildren()}</Scene>),
    );

    // Before the switch: state A content, plain flow (no flight items).
    expect(capture.htmlFrames[5]).toContain("a:list");
    expect(capture.htmlFrames[5]).not.toMatch(/position:absolute;width:/);

    // Settled: state B content, plain flow again (flight overrides dropped).
    expect(capture.htmlFrames[35]).toContain("a:grid");
    expect(capture.htmlFrames[35]).not.toMatch(/position:absolute;width:/);

    // Early flight: the box glides but content hasn't flipped yet (q < 0.5).
    const early = capture.htmlFrames[18]; // u = 0.2 → q ≈ 0.032
    expect(early).toContain("a:list");
    expect(early).toMatch(/position:absolute;width:/);

    // Late flight: content has flipped to the target rendering (q > 0.5).
    const late = capture.htmlFrames[22]; // u = 0.6 → q ≈ 0.648
    expect(late).toContain("a:grid");

    // NO scale anywhere in the flight — glyphs never stretch (v0.9.1).
    for (let f = 16; f < 26; f++) {
      expect(capture.htmlFrames[f]).not.toMatch(/scale\(/);
    }
    // No unmeasured warnings — the prewarm did its job.
    expect(capture.lint.filter((l) => l.code === "TM_MORPH_UNMEASURED")).toEqual([]);
  });

  it("flight boxes interpolate between the measured container-local rects", async () => {
    clearMorphCache();
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <Morph
            from="list"
            to="grid"
            switchFrame={16}
            durationFrames={10}
            itemIds={itemIds}
            renderItem={(id, state) => <div style={{ fontSize: 14 }}>{`${id}:${state}`}</div>}
            morphKey="deltas"
            {...morphLayout}
          />
        </Scene>,
      ),
    );
    const from = morphRectOf("deltas", "b", "list");
    const to = morphRectOf("deltas", "b", "grid");
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();

    // First flight frame: the box sits EXACTLY at the measured from-rect.
    const first = capture.htmlFrames[16];
    expect(first).toContain(`left:${from!.x}px`);
    expect(first).toContain(`top:${from!.y}px`);
    expect(first).toContain(`width:${from!.w}px`);

    // Mid-flight: left/top are the measured-rect lerp at the eased progress.
    const mid = capture.htmlFrames[16 + 5]; // u = 0.5 → q = 0.5
    const expectedLeft = Math.round(lerp(from!.x, to!.x, 0.5) * 1e6) / 1e6;
    const expectedTop = Math.round(lerp(from!.y, to!.y, 0.5) * 1e6) / 1e6;
    expect(mid).toContain(`left:${expectedLeft}px`);
    expect(mid).toContain(`top:${expectedTop}px`);

    // The container's own box interpolates too (max-content of each state).
    const containerFrom = morphContainerRectOf("deltas", "list");
    const containerTo = morphContainerRectOf("deltas", "grid");
    expect(containerFrom).not.toBeNull();
    expect(containerTo).not.toBeNull();
    const expectedWidth = Math.round(lerp(containerFrom!.w, containerTo!.w, 0.5) * 1e6) / 1e6;
    expect(mid).toContain(`width:${expectedWidth}px`);
  });

  it("stagger delays each item's flight without moving the others", async () => {
    clearMorphCache();
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={44}>
          <Morph
            from="list"
            to="grid"
            switchFrame={16}
            durationFrames={10}
            staggerFrames={2}
            itemIds={itemIds}
            renderItem={(id, state) => <div style={{ fontSize: 14 }}>{`${id}:${state}`}</div>}
            morphKey="stagger"
            {...morphLayout}
          />
        </Scene>,
      ),
    );
    // Frame 17 (item 0 at u=0.1, item 1 not started yet — clamped to u=0).
    const html = capture.htmlFrames[17];
    const itemAWidth = Math.round(lerp(200, 100, easeInOutCubic(clamp01(1 / 10))) * 1e6) / 1e6;
    expect(html).toContain(`width:${itemAWidth}px`); // a is flying
    const fromB = morphRectOf("stagger", "b", "list");
    expect(fromB).not.toBeNull();
    expect(html).toContain(`left:${fromB!.x}px`); // b still exactly at its from-rect
    expect(html).toContain(`top:${fromB!.y}px`);
    expect(html).toContain(`width:${fromB!.w}px`);
    // The morphActive window covers the staggered tail (16..16+10+2).
    expect(capture.morphActiveFrames.includes(27)).toBe(true);
    expect(capture.morphActiveFrames.includes(28)).toBe(false);
  });

  it("renders byte-deterministically across runs", async () => {
    clearMorphCache();
    const banner = bannerOf(<Scene duration={30}>{morphChildren()}</Scene>);
    const a = await captureReactBanner(banner);
    const b = await captureReactBanner(banner);
    expect(a.htmlFrames.join("\u0000")).toBe(b.htmlFrames.join("\u0000"));
  });
});

// ---------------------------------------------------------------------------
// TM_LAYOUT_SHIFT end-to-end
// ---------------------------------------------------------------------------

describe("TM_LAYOUT_SHIFT (end-to-end)", () => {
  it("flags a text leaf pushed by an animated sibling's growth", async () => {
    const { useCurrentFrame } = await import("../src/react/index.js");
    function GrowingBar() {
      const frame = useCurrentFrame();
      const height = 8 + Math.min(24, frame * 2);
      return createElement("div", { style: { width: 120, height, backgroundColor: "#38bdf8" } });
    }
    const report = await renderReactBanner({
      banner: bannerOf(
        <Scene duration={24}>
          <Fill style={{ flexDirection: "column", gap: 4, padding: 10 }}>
            {/* The bar grows (layout channel) — the caption below is the victim. */}
            <GrowingBar />
            <div style={{ fontSize: 12, color: "#f8fafc" }}>caption below</div>
          </Fill>
        </Scene>,
      ),
      width: 240,
      height: 140,
      dpr: 1,
      formats: [],
      posters: false,
    } as never);
    const shifts = report.lint.filter((l) => l.code === "TM_LAYOUT_SHIFT");
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts[0].message).toContain("caption below");
  });

  it("stays silent for a fully static scene", async () => {
    const report = await renderReactBanner({
      banner: bannerOf(
        <Scene duration={20}>
          <Fill style={{ flexDirection: "column", gap: 4, padding: 10 }}>
            <div style={{ width: 120, height: 20, backgroundColor: "#1e293b" }} />
            <div style={{ fontSize: 12, color: "#f8fafc" }}>stable</div>
          </Fill>
        </Scene>,
      ),
      width: 240,
      height: 140,
      dpr: 1,
      formats: [],
      posters: false,
    } as never);
    expect(report.lint.filter((l) => l.code === "TM_LAYOUT_SHIFT")).toEqual([]);
  });
});
