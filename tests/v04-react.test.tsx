// tests/v04-react.test.tsx — v0.4 react runtime: Sequence/Freeze time
// vocabulary, useNoise, <Banner> surface overrides (width/height/dpr/background),
// alpha canvases, sequence + sprite exports, renderWithAudit on the react path.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DriverContext, type DriverRegistry } from "../src/react/context.js";
import { planBanner } from "../src/react/plan.js";
import {
  Banner,
  Scene,
  Layer,
  defineBanner,
  Sequence,
  Freeze,
  useCurrentFrame,
  useDuration,
  useNoise,
  isSequenceElement,
  isFreezeElement,
  captureReactBanner,
} from "../src/react/index.js";
import { renderReactBanner } from "../src/react-render.js";
import { renderWithAudit } from "../src/with-audit.js";
import type { ReactElement } from "react";

// ---------------------------------------------------------------------------
// Harness — full driver flow (probe → plan → frame), like captureReactBanner
// ---------------------------------------------------------------------------

function renderAtFrame(element: ReactElement, frame: number, fps = 20): { html: string; registry: DriverRegistry } {
  const registry: DriverRegistry = { errors: [] };
  // 1. probe — <Banner> registers meta + scene inputs
  renderToStaticMarkup(
    createElement(
      DriverContext.Provider,
      { value: { phase: "probe" as const, absoluteFrame: 0, fps, registry } },
      element,
    ),
  );
  const meta = registry.banner!;
  const resolvedFps = meta.fps;
  // 2. plan
  const plan = planBanner(registry.sceneInputs as never, {
    fps: resolvedFps,
    defaultTransitionMs: meta.transitionMs,
  });
  registry.planned = plan;
  // 3. frame
  const html = renderToStaticMarkup(
    createElement(
      DriverContext.Provider,
      { value: { phase: "frame" as const, absoluteFrame: frame, fps: resolvedFps, registry } },
      element,
    ),
  );
  return { html, registry };
}

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

function FrameProbe({ tag }: { tag: string }) {
  const frame = useCurrentFrame();
  const duration = useDuration();
  return createElement("div", { "data-probe": `${tag}:${frame}/${duration}` });
}

describe("<Sequence>", () => {
  const scene = (child: React.ReactNode) =>
    createElement(Banner, { preset: "readme", fps: 20 }, createElement(Scene, { duration: 60 }, child));

  it("renders nothing before `from` and after the window", () => {
    const el = scene(createElement(Sequence, { from: 10, durationInFrames: 20 }, createElement(FrameProbe, { tag: "s" })));

    const before = renderAtFrame(el, 5);
    expect(before.html).not.toContain("data-probe");

    const after = renderAtFrame(el, 35);
    expect(after.html).not.toContain("data-probe");
  });

  it("rebases the frame inside the window (child sees local 0 at from)", () => {
    const el = scene(createElement(Sequence, { from: 10, durationInFrames: 20 }, createElement(FrameProbe, { tag: "s" })));

    expect(renderAtFrame(el, 10).html).toContain("s:0/20");
    expect(renderAtFrame(el, 15).html).toContain("s:5/20");
    expect(renderAtFrame(el, 29).html).toContain("s:19/20");
  });

  it("durationInFrames defaults to the rest of the scope", () => {
    const el = scene(createElement(Sequence, { from: 10 }, createElement(FrameProbe, { tag: "s" })));
    // scope 60 − from 10 = 50
    expect(renderAtFrame(el, 10).html).toContain("s:0/50");
    expect(renderAtFrame(el, 59).html).toContain("s:49/50");
  });

  it("speed remaps time (2× advances two frames per timeline frame)", () => {
    const el = scene(createElement(Sequence, { from: 0, durationInFrames: 20, speed: 2 }, createElement(FrameProbe, { tag: "s" })));
    expect(renderAtFrame(el, 0).html).toContain("s:0/20");
    expect(renderAtFrame(el, 5).html).toContain("s:10/20");
    // clamped to the window end
    expect(renderAtFrame(el, 19).html).toContain("s:19/20");
  });

  it("reverse plays the window backwards", () => {
    const el = scene(createElement(Sequence, { from: 0, durationInFrames: 10, reverse: true }, createElement(FrameProbe, { tag: "s" })));
    expect(renderAtFrame(el, 0).html).toContain("s:9/10");
    expect(renderAtFrame(el, 9).html).toContain("s:0/10");
  });

  it("composes speed + reverse", () => {
    const el = scene(
      createElement(Sequence, { from: 0, durationInFrames: 10, speed: 2, reverse: true }, createElement(FrameProbe, { tag: "s" })),
    );
    // child = (10-1) - round(local*2)
    expect(renderAtFrame(el, 0).html).toContain("s:9/10");
    expect(renderAtFrame(el, 2).html).toContain("s:5/10");
  });

  it("nests: inner Sequence rebases against the outer window", () => {
    const inner = createElement(Sequence, { from: 5, durationInFrames: 10 }, createElement(FrameProbe, { tag: "in" }));
    const outer = createElement(Sequence, { from: 20, durationInFrames: 30 }, inner);
    const el = scene(outer);

    // outer local 0 at absolute 20; inner appears at outer-local 5 → absolute 25
    expect(renderAtFrame(el, 24).html).not.toContain("data-probe");
    expect(renderAtFrame(el, 25).html).toContain("in:0/10");
    expect(renderAtFrame(el, 30).html).toContain("in:5/10");
  });

  it("validates its props", () => {
    const el = scene(createElement(Sequence, { from: -1 } as never, createElement(FrameProbe, { tag: "s" })));
    expect(() => renderAtFrame(el, 0)).toThrow(/from/);

    const el2 = scene(createElement(Sequence, { speed: 0 } as never, createElement(FrameProbe, { tag: "s" })));
    expect(() => renderAtFrame(el2, 0)).toThrow(/speed/);
  });

  it("is detectable", () => {
    const el = createElement(Sequence, { from: 0 }, null);
    expect(isSequenceElement(el)).toBe(true);
    expect(isSequenceElement(createElement("div"))).toBe(false);
    expect(isFreezeElement(createElement(Freeze, { at: 0 }, null))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Freeze
// ---------------------------------------------------------------------------

describe("<Freeze>", () => {
  it("pins the subtree frame — every timeline frame renders the same output", () => {
    const el = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(Scene, { duration: 20 }, createElement(Freeze, { at: 7 }, createElement(FrameProbe, { tag: "f" }))),
    );
    expect(renderAtFrame(el, 0).html).toContain("f:7/20");
    expect(renderAtFrame(el, 13).html).toContain("f:7/20");
    const a = renderAtFrame(el, 0).html;
    const b = renderAtFrame(el, 13).html;
    expect(a).toBe(b);
  });

  it("works inside a Sequence (window-relative pin)", () => {
    const el = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(
        Scene,
        { duration: 40 },
        createElement(Sequence, { from: 10, durationInFrames: 20 }, createElement(Freeze, { at: 3 }, createElement(FrameProbe, { tag: "f" }))),
      ),
    );
    expect(renderAtFrame(el, 12).html).toContain("f:3/20");
    expect(renderAtFrame(el, 25).html).toContain("f:3/20");
  });

  it("validates `at`", () => {
    const el = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(Scene, { duration: 5 }, createElement(Freeze, { at: -2 } as never, null)),
    );
    expect(() => renderAtFrame(el, 0)).toThrow(/at/);
  });
});

// ---------------------------------------------------------------------------
// useNoise
// ---------------------------------------------------------------------------

describe("useNoise", () => {
  function NoiseProbe({ seed, amplitude, frequency }: { seed: number; amplitude?: number; frequency?: number }) {
    const v = useNoise(seed, { amplitude, frequency });
    return createElement("div", { "data-noise": v.toFixed(6) });
  }

  it("is deterministic per frame and smooth by default", () => {
    const el = (frame: number) =>
      createElement(
        Banner,
        { preset: "readme", fps: 20 },
        createElement(Scene, { duration: 20 }, createElement(NoiseProbe, { seed: 11 })),
      );
    const at = (f: number) => renderAtFrame(el(f), f).html.match(/data-noise="(-?[0-9.]+)"/)![1];

    const v3 = at(3);
    expect(v3).toBe(at(3)); // deterministic within a frame
    const a = Number(at(0)), b = Number(at(1)), c = Number(at(10));
    // consecutive frames stay close (smooth), distant frames drift
    expect(Math.abs(b - a)).toBeLessThan(0.35);
    expect([a, b, c]).not.toContain("0");
  });

  it("honors amplitude scaling", () => {
    const el = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(Scene, { duration: 10 }, createElement(NoiseProbe, { seed: 5, amplitude: 0.5 })),
    );
    const v = Number(renderAtFrame(el, 4).html.match(/data-noise="(-?[0-9.]+)"/)![1]);
    expect(Math.abs(v)).toBeLessThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// <Banner> surface overrides (Bet 1 authoring side)
// ---------------------------------------------------------------------------

describe("<Banner> surface overrides", () => {
  it("width/height/dpr overrides replace the preset dims everywhere", async () => {
    const el = createElement(
      Banner,
      { preset: "readme", width: 640, height: 360, dpr: 3, fps: 20 },
      createElement(Scene, { duration: 10 }, createElement(FrameProbe, { tag: "s" })),
    );
    const capture = await captureReactBanner(el);
    expect(capture.meta.preset).toMatchObject({ width: 640, height: 360, devicePixelRatio: 3 });
    // scene wrapper divs sized to the override
    expect(capture.htmlFrames[0]).toContain('width:640px');
    expect(capture.htmlFrames[0]).toContain('height:360px');
  });

  it('background="transparent" drops the canvas backgroundColor', async () => {
    const el = createElement(
      Banner,
      { preset: "readme", background: "transparent", fps: 20 },
      createElement(Scene, { duration: 4 }, null),
    );
    const capture = await captureReactBanner(el);
    expect(capture.meta.background).toBeNull();
    expect(capture.htmlFrames[0]).not.toContain("background-color");

    const themed = createElement(
      Banner,
      { preset: "readme", fps: 20 },
      createElement(Scene, { duration: 4 }, null),
    );
    const themedCapture = await captureReactBanner(themed);
    expect(themedCapture.meta.background).not.toBeNull();
  });

  it("background color override paints the root", async () => {
    const el = createElement(
      Banner,
      { preset: "readme", background: "#0b0e14", fps: 20 },
      createElement(Scene, { duration: 4 }, null),
    );
    const capture = await captureReactBanner(el);
    expect(capture.meta.background).toBe("#0b0e14");
    expect(capture.htmlFrames[0]).toContain("background-color:#0b0e14");
  });
});

// ---------------------------------------------------------------------------
// Native renders through the react pipeline (v0.4 outputs)
// ---------------------------------------------------------------------------

const spinBanner = defineBanner(function Spin() {
  return createElement(
    Banner,
    { width: 96, height: 96, dpr: 1, fps: 20, background: "transparent" },
    createElement(
      Scene,
      { duration: 8 },
      createElement(() => {
        const f = useCurrentFrame();
        return createElement("div", {
          style: {
            width: "48px", height: "48px", marginTop: "24px", marginLeft: "24px",
            backgroundColor: "#7aa2f7", transform: `rotate(${f * 45}deg)`,
          },
        });
      }),
    ),
  );
});

describe("renderReactBanner v0.4 outputs", () => {
  it("sequence export: one PNG per frame + manifest", async () => {
    const out = mkdtempSync(join(tmpdir(), "tm-rseq-"));
    const report = await renderReactBanner({
      banner: spinBanner,
      formats: [],
      posters: false,
      outDir: out,
      sequence: true,
    });
    expect(report.sequence).toBeDefined();
    expect(report.sequence!.frameCount).toBe(8);
    const manifest = JSON.parse(readFileSync(join(report.sequence!.dir, "frames.json"), "utf8"));
    expect(manifest.frameCount).toBe(8);
    expect(manifest.files[0].file).toBe("frame_00000.png");
    expect(readFileSync(join(report.sequence!.dir, "frame_00007.png")).subarray(1, 4).toString("latin1")).toBe("PNG");
  }, 30000);

  it("sprite sheet export: atlas + metadata with grid math", async () => {
    const out = mkdtempSync(join(tmpdir(), "tm-rspr-"));
    const report = await renderReactBanner({
      banner: spinBanner,
      formats: [],
      posters: false,
      outDir: out,
      spriteSheet: { columns: 4 },
    });
    const s = report.spriteSheet!;
    expect(s.meta).toMatchObject({ columns: 4, rows: 2, frameWidth: 96, frameHeight: 96, frameCount: 8 });
    const png = readFileSync(s.paths.png!);
    expect(png.readUInt32BE(16)).toBe(4 * 96);
    expect(png.readUInt32BE(20)).toBe(2 * 96);
    const json = JSON.parse(readFileSync(s.paths.json!, "utf8"));
    expect(json.frames).toHaveLength(8);
    expect(json.frames[3]).toMatchObject({ x: 288, y: 0 });
  }, 30000);

  it("transparent react banner: webp renders (alpha canvas)", async () => {
    const report = await renderReactBanner({
      banner: spinBanner,
      formats: ["webp"],
      posters: false,
    });
    expect(report.files[0].format).toBe("webp");
    expect(report.files[0].bytes).toBeGreaterThan(0);
    expect(report.surface.background).toBeNull();
  }, 30000);

  it("user-given render options override the banner (CLI > component)", async () => {
    const report = await renderReactBanner({
      banner: spinBanner,
      width: 200, height: 100, dpr: 1,
      formats: [], posters: [0],
    });
    expect(report.surface).toMatchObject({ width: 200, height: 100, customized: true });
    expect(report.posters[0].buffer.readUInt32BE(16)).toBe(200);
  }, 30000);
});

// ---------------------------------------------------------------------------
// renderWithAudit — react path
// ---------------------------------------------------------------------------

describe("renderWithAudit (react)", () => {
  it("audit carries extents + seam + determinism verdict", async () => {
    const result = await renderWithAudit({
      banner: spinBanner,
      formats: ["webp"],
    });
    expect(result.audit.source).toBe("react");
    expect(result.audit.extents).not.toBeNull();
    expect(result.audit.extents!.checked).toBeGreaterThan(0);
    expect(result.audit.seam).not.toBeNull();
    expect(result.audit.determinism.deterministic).toBe(true);
    expect(result.audit.surface).toMatchObject({ width: 96, height: 96, background: null, customized: true });
    expect(result.exitCode).toBe(0);
  }, 60000);

  it("over budget → exitCode 2", async () => {
    const result = await renderWithAudit({
      banner: spinBanner,
      formats: ["webp"],
      budgetBytes: 10,
    });
    expect(result.exitCode).toBe(2);
  }, 60000);
});
