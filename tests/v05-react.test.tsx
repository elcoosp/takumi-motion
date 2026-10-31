// tests/v05-react.test.tsx — v0.5 react runtime: <Series>/<Series.Sequence>
// auto-stacking (scan flattening + planner parity), <Loop> frame rebasing,
// the kinetic text kit (splitText, stagger math, <SplitText>), and an
// end-to-end composition render.

import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DriverContext, type DriverRegistry } from "../src/react/context.js";
import { planBanner } from "../src/react/plan.js";
import {
  Banner,
  Scene,
  Layer,
  Sequence,
  Series,
  SeriesSequence,
  Loop,
  SplitText,
  defineBanner,
  isSeriesElement,
  isSeriesSequenceElement,
  useCurrentFrame,
  useAbsoluteFrame,
  useDuration,
  useStaggeredSpring,
  staggerDelay,
  staggeredSpringFor,
  springFor,
  splitText,
  captureReactBanner,
} from "../src/react/index.js";
import { renderReactBanner } from "../src/react-render.js";

// ---------------------------------------------------------------------------
// Harness — full driver flow (probe → plan → frame), like captureReactBanner
// ---------------------------------------------------------------------------

function renderAtFrame(element: ReactElement, frame: number, fps = 20): { html: string; registry: DriverRegistry } {
  const registry: DriverRegistry = { errors: [] };
  renderToStaticMarkup(
    createElement(
      DriverContext.Provider,
      { value: { phase: "probe" as const, absoluteFrame: 0, fps, registry } },
      element,
    ),
  );
  const meta = registry.banner!;
  const resolvedFps = meta.fps;
  const plan = planBanner(registry.sceneInputs as never, {
    fps: resolvedFps,
    defaultTransitionMs: meta.transitionMs,
  });
  registry.planned = plan;
  const html = renderToStaticMarkup(
    createElement(
      DriverContext.Provider,
      { value: { phase: "frame" as const, absoluteFrame: frame, fps: resolvedFps, registry } },
      element,
    ),
  );
  return { html, registry };
}

function FrameProbe({ tag }: { tag: string }): ReactElement {
  const frame = useCurrentFrame();
  const absolute = useAbsoluteFrame();
  const sceneFrames = useDuration();
  return createElement(
    "div",
    { "data-probe": `${tag}:${frame}:${absolute}:${sceneFrames}` },
  );
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

describe("<Series>", () => {
  it("sequence items stack back-to-back (planner parity with <Scene>)", () => {
    const { registry } = renderAtFrame(
      createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(
          Series,
          { key: "series" },
          createElement(SeriesSequence, { durationInFrames: 30, key: "a" }, createElement(FrameProbe, { tag: "a", key: "pa" })),
          createElement(SeriesSequence, { durationInFrames: 20, key: "b" }, createElement(FrameProbe, { tag: "b", key: "pb" })),
        ),
      ),
      0,
    );
    expect(registry.sceneInputs).toHaveLength(2);
    expect(registry.sceneInputs![0]).toMatchObject({ durationFrames: 30 });
    expect(registry.sceneInputs![1]).toMatchObject({ durationFrames: 20 });

    const plan = planBanner(registry.sceneInputs as never, { fps: 20, defaultTransitionMs: 250 });
    expect(plan.totalFrames).toBe(50); // pure cut stacking — no gaps, no overlaps
    expect(plan.scenes[0]).toMatchObject({ startFrame: 0, durationFrames: 30 });
    expect(plan.scenes[1]).toMatchObject({ startFrame: 30, durationFrames: 20 });
  });

  it("transitions carry through: enter overlap eats into the previous window", () => {
    const { registry } = renderAtFrame(
      createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(
          Series,
          { key: "series" },
          createElement(SeriesSequence, { durationInFrames: 30, key: "a" }),
          createElement(SeriesSequence, { durationInFrames: 30, enter: "crossfade", key: "b" }),
        ),
      ),
      0,
    );
    const plan = planBanner(registry.sceneInputs as never, { fps: 20, defaultTransitionMs: 250 });
    // 250ms @20fps = 5 overlap frames
    expect(plan.scenes[1]!.startFrame).toBe(25);
    expect(plan.totalFrames).toBe(55);
  });

  it("composes frames exactly like <Scene> (scene-local + absolute frames)", () => {
    const element = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(
        Series,
        { key: "series" },
        createElement(SeriesSequence, { durationInFrames: 30, key: "a" }, createElement(FrameProbe, { tag: "a", key: "pa" })),
        createElement(SeriesSequence, { durationInFrames: 30, key: "b" }, createElement(FrameProbe, { tag: "b", key: "pb" })),
      ),
    );

    const at12 = renderAtFrame(element, 12);
    expect(at12.html).toContain('data-probe="a:12:12:30"');

    const at45 = renderAtFrame(element, 45);
    expect(at45.html).toContain('data-probe="b:15:45:30"');
  });

  it("mixes with <Scene> and <Layer> (order preserved)", () => {
    const { registry } = renderAtFrame(
      createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(Layer, { bottom: true, key: "l" }, createElement(FrameProbe, { tag: "layer", key: "pl" })),
        createElement(Scene, { duration: 10, key: "s" }, createElement(FrameProbe, { tag: "scene", key: "ps" })),
        createElement(
          Series,
          { key: "series" },
          createElement(SeriesSequence, { durationInFrames: 15, key: "a" }),
          createElement(SeriesSequence, { durationInFrames: 15, key: "b" }),
        ),
      ),
      0,
    );
    expect(registry.sceneInputs).toHaveLength(3); // scene + 2 sequence items
    expect(registry.layerInputs).toHaveLength(1);
    const plan = planBanner(registry.sceneInputs as never, { fps: 20 });
    expect(plan.totalFrames).toBe(40);
  });

  it("markers are detectable", () => {
    const series = createElement(Series, { key: "s" });
    const seq = createElement(SeriesSequence, { durationInFrames: 5, key: "q" });
    expect(isSeriesElement(series)).toBe(true);
    expect(isSeriesSequenceElement(seq)).toBe(true);
    expect(isSeriesElement(seq)).toBe(false);
  });

  it("rejects non-sequence children inside <Series>", () => {
    expect(() =>
      renderAtFrame(
        createElement(
          Banner,
          { preset: "readme", fps: 20 },
          createElement(Series, { key: "s" }, createElement("div", { key: "d" })),
        ),
        0,
      ),
    ).toThrow(/<Series> children must be <Series\.Sequence/);
  });

  it("rejects <Series.Sequence> outside <Series>", () => {
    expect(() =>
      renderAtFrame(
        createElement(
          Banner,
          { preset: "readme", fps: 20 },
          createElement(SeriesSequence, { durationInFrames: 5, key: "q" }),
        ),
        0,
      ),
    ).toThrow(/must be a direct child of <Series>/);
  });

  it("rejects nested <Series>", () => {
    expect(() =>
      renderAtFrame(
        createElement(
          Banner,
          { preset: "readme", fps: 20 },
          createElement(
            Series,
            { key: "outer" },
            createElement(
              Series,
              { key: "inner" },
              createElement(SeriesSequence, { durationInFrames: 5, key: "q" }),
            ),
          ),
        ),
        0,
      ),
    ).toThrow(/cannot nest inside <Series>/);
  });
});

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

describe("<Loop>", () => {
  it("rebases frames modulo the iteration length", () => {
    const element = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(
        Scene,
        { duration: 60, key: "s" },
        createElement(
          Loop,
          { durationInFrames: 20, key: "l" },
          createElement(FrameProbe, { tag: "loop", key: "p" }),
        ),
      ),
    );
    const at0 = renderAtFrame(element, 0);
    expect(at0.html).toContain('data-probe="loop:0:0:20"');
    const at13 = renderAtFrame(element, 13);
    expect(at13.html).toContain('data-probe="loop:13:13:20"');
    const at27 = renderAtFrame(element, 27); // second iteration, local 7
    expect(at27.html).toContain('data-probe="loop:7:27:20"');
    const at59 = renderAtFrame(element, 59); // third iteration, local 19
    expect(at59.html).toContain('data-probe="loop:19:59:20"');
  });

  it("renders nothing after times × durationInFrames", () => {
    const element = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(
        Scene,
        { duration: 30, key: "s" },
        createElement(
          Loop,
          { durationInFrames: 10, times: 2, key: "l" },
          createElement(FrameProbe, { tag: "loop", key: "p" }),
        ),
      ),
    );
    expect(renderAtFrame(element, 19).html).toContain("data-probe");
    expect(renderAtFrame(element, 20).html).not.toContain("data-probe");
    expect(renderAtFrame(element, 29).html).not.toContain("data-probe");
  });

  it("default times runs until the scope ends; render prop sees the iteration", () => {
    const element = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(
        Scene,
        { duration: 25, key: "s" },
        createElement(
          Loop,
          { durationInFrames: 10, key: "l" },
          (iteration: number) =>
            createElement(
              "div",
              { key: `it${iteration}` },
              createElement(FrameProbe, { tag: `it${iteration}`, key: "p" }),
            ),
        ),
      ),
    );
    expect(renderAtFrame(element, 4).html).toContain('data-probe="it0:4:4:10"');
    expect(renderAtFrame(element, 12).html).toContain('data-probe="it1:2:12:10"');
    expect(renderAtFrame(element, 24).html).toContain('data-probe="it2:4:24:10"');
  });

  it("composes with <Sequence> (rebase on the rebased context)", () => {
    const element = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(
        Scene,
        { duration: 50, key: "s" },
        createElement(
          Sequence,
          { from: 10, durationInFrames: 40, key: "seq" },
          createElement(
            Loop,
            { durationInFrames: 10, key: "l" },
            createElement(FrameProbe, { tag: "seqloop", key: "p" }),
          ),
        ),
      ),
    );
    // global 12 → sequence-local 2 → loop-local 2 (absolute = true timeline pos)
    expect(renderAtFrame(element, 12).html).toContain('data-probe="seqloop:2:2:10"');
  });

  it("validates props", () => {
    const make = (props: Record<string, unknown>) =>
      createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(
          Scene,
          { duration: 20, key: "s" },
          createElement(Loop, { ...props, key: "l" }, createElement(FrameProbe, { tag: "x", key: "p" })),
        ),
      );
    expect(() => renderAtFrame(make({ durationInFrames: 0 }), 0)).toThrow(/durationInFrames must be a positive integer/);
    expect(() => renderAtFrame(make({ durationInFrames: 5, times: 0 }), 0)).toThrow(/times must be a positive integer/);
  });
});

// ---------------------------------------------------------------------------
// Kinetic text kit
// ---------------------------------------------------------------------------

describe("splitText", () => {
  it("chars: every glyph, surrogate pairs stay whole", () => {
    const units = splitText("a 𝕏b", "chars");
    expect(units.map((u) => u.text)).toEqual(["a", " ", "𝕏", "b"]);
    expect(units.map((u) => u.isSpace)).toEqual([false, true, false, false]);
    expect(units.every((u) => u.total === 4)).toBe(true);
    expect(units.map((u) => u.index)).toEqual([0, 1, 2, 3]);
  });

  it("words: whitespace is not part of the output", () => {
    const units = splitText("  ship   faster  ", "words");
    expect(units.map((u) => u.text)).toEqual(["ship", "faster"]);
    expect(units.map((u) => u.index)).toEqual([0, 1]);
    expect(units.every((u) => !u.isSpace)).toBe(true);
  });

  it("defaults to chars mode and validates input", () => {
    expect(splitText("hi")).toHaveLength(2);
    expect(() => splitText(42 as never)).toThrow(/text must be a string/);
  });
});

describe("stagger math", () => {
  it("staggerDelay: start + index × interval", () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(3)).toBe(6); // interval default 2
    expect(staggerDelay(3, { intervalFrames: 4, startFrames: 5 })).toBe(17);
    expect(() => staggerDelay(-1)).toThrow(/non-negative integer/);
  });

  it("staggeredSpringFor == springFor with the composed delay", () => {
    for (const index of [0, 1, 4, 9]) {
      for (const frame of [0, 3, 12, 40]) {
        const staggered = staggeredSpringFor(index, frame, 20, { intervalFrames: 3, stiffness: 210, damping: 24 });
        const equivalent = springFor(frame, 20, {
          stiffness: 210,
          damping: 24,
          delayFrames: staggerDelay(index, { intervalFrames: 3 }),
        });
        expect(staggered).toBeCloseTo(equivalent, 12);
      }
    }
  });

  it("useStaggeredSpring inside a scene reads the frame context", () => {
    function StaggerProbe(): ReactElement {
      const a = useStaggeredSpring(0);
      const b = useStaggeredSpring(5, { intervalFrames: 3 });
      return createElement("div", { "data-stagger": `${a.toFixed(6)}|${b.toFixed(6)}` });
    }
    const element = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(Scene, { duration: 40, key: "s" }, createElement(StaggerProbe, { key: "p" })),
    );
    const at10 = renderAtFrame(element, 10);
    const [a, b] = at10.html.match(/data-stagger="([^"]+)"/)![1].split("|").map(Number);
    expect(a).toBeCloseTo(springFor(10, 20), 6);
    expect(b).toBeCloseTo(springFor(10, 20, { delayFrames: 15 }), 6);
    expect(b).toBeLessThan(a); // unit 5 lags unit 0
  });
});

describe("<SplitText>", () => {
  it("default chars renderer emits inline-block spans", () => {
    const html = renderToStaticMarkup(createElement(SplitText, { text: "go!" } as never));
    expect(html).toContain('style="display:inline-block"');
    expect((html.match(/<span/g) ?? []).length).toBe(3);
  });

  it("default words renderer joins with single spaces", () => {
    const html = renderToStaticMarkup(createElement(SplitText, { text: "ship faster", by: "words" } as never));
    expect(html).toContain("ship");
    expect(html).toContain("faster");
    expect((html.match(/<span/g) ?? []).length).toBe(2);
    expect(html).toContain("> <"); // the joined space
  });

  it("renderUnit receives the unit + frame context", () => {
    const seen: Array<{ text: string; frame: number; fps: number; index: number }> = [];
    const element = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(
        Scene,
        { duration: 30, key: "s" },
        createElement(
          SplitText,
          {
            text: "abc",
            key: "st",
            renderUnit: (unit, ctx) => {
              seen.push({ text: unit.text, frame: ctx.frame, fps: ctx.fps, index: unit.index });
              return createElement("span", { key: unit.index }, unit.text);
            },
          },
        ),
      ),
    );
    renderAtFrame(element, 14);
    expect(seen.map((u) => u.text)).toEqual(["a", "b", "c"]);
    expect(seen.every((u) => u.frame === 14 && u.fps === 20)).toBe(true);
  });

  it("works outside the runtime (frame context falls back to 0)", () => {
    const seen: Array<{ frame: number }> = [];
    renderToStaticMarkup(
      createElement(SplitText, {
        text: "x",
        renderUnit: (unit, ctx) => {
          seen.push({ frame: ctx.frame });
          return createElement("span", { key: unit.index }, unit.text);
        },
      } as never),
    );
    expect(seen[0]!.frame).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: Series + Loop + SplitText through the full pipeline
// ---------------------------------------------------------------------------

describe("composition end-to-end", () => {
  it("renders a Series/Loop/SplitText banner with byte-deterministic output", async () => {
    function StaggeredTitle({ text }: { text: string }): ReactElement {
      const fps = 20;
      return createElement(
        "div",
        { style: { position: "absolute", left: "24px", top: "60px", fontSize: "36px", color: "#c0caf5", fontWeight: "700" } },
        createElement(SplitText, {
          text,
          by: "chars",
          renderUnit: (unit, ctx) =>
            unit.isSpace
              ? createElement("span", { key: unit.index, style: { display: "inline-block", width: "10px" } })
              : createElement(
                  "span",
                  {
                    key: unit.index,
                    style: {
                      display: "inline-block",
                      opacity: staggeredSpringFor(unit.index, ctx.frame, fps, { intervalFrames: 2 }),
                      transform: `translateY(${(1 - staggeredSpringFor(unit.index, ctx.frame, fps)) * 16}px)`,
                    },
                  },
                  unit.text,
                ),
        }),
      );
    }

    function Ticker({ items }: { items: string[] }): ReactElement {
      const frame = useCurrentFrame();
      const iteration = Math.floor(frame / 15) % items.length;
      return createElement(
        "div",
        { style: { position: "absolute", left: "24px", top: "130px", fontSize: "18px", color: "#7aa2f7" } },
        items[iteration]!,
      );
    }

    const banner = defineBanner(function CompositionBanner() {
      return createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(
          Series,
          { key: "series" },
          createElement(
            SeriesSequence,
            { durationInFrames: 45, enter: "crossfade", exit: "crossfade", key: "a" },
            createElement(StaggeredTitle, { text: "v0.5 ships", key: "t" }),
            createElement(
              Loop,
              { durationInFrames: 45, key: "tick" },
              createElement(Ticker, { items: ["composition", "stills", "parallel"], key: "ti" }),
            ),
          ),
          createElement(
            SeriesSequence,
            { durationInFrames: 30, enter: "crossfade", key: "b" },
            createElement(StaggeredTitle, { text: "stills & series", key: "t2" }),
          ),
        ),
        createElement(Layer, { bottom: true, key: "rail" },
          createElement("div", { style: { position: "absolute", left: 0, bottom: 0, width: "100%", height: "6px", backgroundColor: "#7aa2f7" } })),
      );
    });

    const outDir = mkdtempSync(join(tmpdir(), "tm-v05-e2e-"));
    const report = await renderReactBanner({ banner, outDir, baseName: "composition" });

    // Series windows: 45 + 30 − 5 overlap = 70 frames @20fps
    expect(report.frames).toBe(70);
    expect(report.scenes).toBe(2);
    expect(report.files.length).toBeGreaterThan(0);
    expect(report.extents.violations.filter((v) => !v.decorative)).toHaveLength(0);
    expect(report.timings.totalMs).toBeGreaterThan(0);

    const again = await renderReactBanner({ banner, outDir: join(outDir, "second"), baseName: "composition" });
    for (let i = 0; i < report.files.length; i++) {
      expect(again.files[i]!.buffer.equals(report.files[i]!.buffer)).toBe(true);
    }
  });

  it("capture sees the Series banner's full frame range", async () => {
    const banner = defineBanner(function SeriesCapture() {
      return createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(
          Series,
          { key: "series" },
          createElement(SeriesSequence, { durationInFrames: 12, key: "a" }),
          createElement(SeriesSequence, { durationInFrames: 12, key: "b" }),
        ),
      );
    });
    const capture = await captureReactBanner(banner);
    expect(capture.plan.totalFrames).toBe(24);
    expect(capture.htmlFrames).toHaveLength(24);
    expect(capture.chunks.length).toBeGreaterThanOrEqual(1);
  });
});
