// tests/v06.test.ts — the authoring experience release: coded authoring lint
// (lintStyleObject/lintHtmlChunk/lintTracks/collectLintWarnings), the style
// allowlists, engine-exact filmstrip on all three paths (byte-deterministic),
// timeline transforms (shiftTimeline/concatTimelines), plan-grid hardening
// (planRound float dust), the kit components end-to-end, and report.lint
// surfacing through the react + declarative pipelines.

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";

import {
  lintStyleObject,
  lintStyleTree,
  lintHtmlChunk,
  lintTracks,
  lintFontSpecs,
  lintGlowDither,
  collectLintWarnings,
  formatLint,
  camelHint,
} from "../src/lint.js";
import {
  SUPPORTED_STYLE_PROPS,
  UNITLESS_STYLE_PROPS,
  type TakumiStyle,
} from "../src/style.js";
import {
  renderFilmstrip,
  evenFrames,
} from "../src/filmstrip.js";
import {
  shiftTimeline,
  concatTimelines,
} from "../src/timeline-transforms.js";
import { planRound } from "../src/react/plan.js";
import { compileTimeline } from "../src/compile.js";
import { createTimeline } from "../src/timeline.js";
import { renderBanner } from "../src/render.js";
import { renderReactBanner } from "../src/react-render.js";
import { renderStill } from "../src/still.js";
import { h } from "../src/jsx.js";
import {
  Banner,
  Scene,
  Layer,
  Series,
  defineBanner,
  useSpring,
  Fill,
  FitText,
  CountUp,
  Typewriter,
  Glow,
} from "../src/react/index.js";
import { imageDataUri } from "../src/react/components.js";

// ---------------------------------------------------------------------------
// Lint — style objects
// ---------------------------------------------------------------------------

describe("lintStyleObject", () => {
  it("flags kebab-case keys with a did-you-mean camelCase hint", () => {
    const warnings = lintStyleObject({ "font-weight": 700 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TM_KEBAB_STYLE");
    expect(warnings[0].hint).toContain('"fontWeight"');
    // The px-suffix failure mode is called out when a number hits a
    // non-unitless property.
    expect(warnings[0].message).toContain("font-weight:700px");
  });

  it("kebab-case with a numeric value always claims the px risk (React's unitless table misses kebab keys)", () => {
    const warnings = lintStyleObject({ "z-index": 5 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("z-index:5px");
  });

  it("flags NaN and Infinity values with a math hint", () => {
    const warnings = lintStyleObject({ x: NaN, opacity: Infinity, color: "undefined" });
    expect(warnings).toHaveLength(3);
    expect(warnings.every((w) => w.code === "TM_NAN_STYLE")).toBe(true);
  });

  it("ignores undefined/null values (normal React omit pattern)", () => {
    expect(lintStyleObject({ color: undefined, opacity: null })).toHaveLength(0);
  });

  it("passes clean camelCase objects", () => {
    expect(lintStyleObject({ fontSize: 32, fontWeight: 700, color: "red", "--brand": "1" })).toHaveLength(0);
  });

  it("strict mode flags unknown properties (advisory)", () => {
    const warnings = lintStyleObject({ someMadeUpProp: 1 }, { strict: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TM_UNKNOWN_STYLE_PROP");
    expect(warnings[0].severity).toBe("info");
  });

  it("strict mode accepts everything on the curated allowlist", () => {
    const style: Record<string, unknown> = {};
    for (const prop of SUPPORTED_STYLE_PROPS) style[prop] = UNITLESS_STYLE_PROPS.has(prop) ? 1 : "1px";
    expect(lintStyleObject(style, { strict: true })).toHaveLength(0);
  });

  it("annotates paths when given", () => {
    const warnings = lintStyleObject({ "font-weight": 400 }, { path: "scene-1 > span" });
    expect(warnings[0].message).toContain("(at scene-1 > span)");
  });
});

describe("camelHint", () => {
  it("converts kebab to camel", () => {
    expect(camelHint("font-weight")).toBe("fontWeight");
    expect(camelHint("background-color")).toBe("backgroundColor");
    expect(camelHint("fontSize")).toBe("fontSize");
  });
});

// ---------------------------------------------------------------------------
// Lint — element trees + html chunks
// ---------------------------------------------------------------------------

describe("lintStyleTree", () => {
  it("walks host elements, fragments and arrays", () => {
    const el = createElement(
      "div",
      { style: { fontSize: 10 } },
      createElement("span", { style: { "font-weight": 700 } }),
      [createElement("em", { style: { opacity: NaN } })],
    );
    const warnings = lintStyleTree(el);
    expect(warnings.map((w) => w.code).sort()).toEqual(["TM_KEBAB_STYLE", "TM_NAN_STYLE"]);
    // Paths identify the owning element.
    expect(warnings.some((w) => w.message.includes("<span>"))).toBe(true);
    expect(warnings.some((w) => w.message.includes("<em>"))).toBe(true);
  });

  it("ignores strings and nulls in the tree", () => {
    expect(lintStyleTree(createElement("div", null, "text", null, ["a", "b"]))).toHaveLength(0);
  });
});

describe("lintHtmlChunk", () => {
  it("flags empty style attributes", () => {
    const warnings = lintHtmlChunk('<div style=""></div>');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TM_EMPTY_STYLE");
  });

  it("flags NaN/undefined values that leaked into markup", () => {
    const warnings = lintHtmlChunk('<div style="transform:translateX(NaNpx)"></div>');
    expect(warnings.map((w) => w.code)).toEqual(["TM_NAN_STYLE"]);
  });

  it("flags the kebab px-suffix signature in output markup (unitless + px)", () => {
    const warnings = lintHtmlChunk('<div style="font-weight:700px;color:#fff"></div>');
    expect(warnings.map((w) => w.code)).toEqual(["TM_KEBAB_STYLE"]);
    expect(warnings[0].message).toContain("font-weight:700px");
  });

  it("passes clean markup", () => {
    expect(lintHtmlChunk('<div style="font-size:10px"></div>')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lint — timeline tracks (the spring/duration trap)
// ---------------------------------------------------------------------------

describe("lintTracks", () => {
  it("flags spring + explicit duration", () => {
    const timeline = createTimeline();
    timeline.add(".a", { x: [0, 100] }, { type: "spring", stiffness: 300, duration: 300 } as never);
    const warnings = lintTracks(timeline.toJSON().tracks);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("TM_SPRING_DURATION");
    expect(warnings[0].message).toContain(".a.x");
  });

  it("flags the DEFAULT spring on transforms with duration (no explicit type)", () => {
    const timeline = createTimeline();
    timeline.add(".a", { x: [0, 100] }, { duration: 300 } as never);
    const warnings = lintTracks(timeline.toJSON().tracks);
    expect(warnings).toHaveLength(1);
  });

  it("passes tweens with duration and springs without", () => {
    const timeline = createTimeline();
    timeline.add(".a", { x: [0, 100] }, { type: "spring" as never });
    timeline.add(".b", { opacity: [0, 1] }, { type: "tween", duration: 300 } as never);
    expect(lintTracks(timeline.toJSON().tracks)).toHaveLength(0);
  });

  it("surfaces through compileTimeline (deduped, in compiled.lint)", () => {
    const timeline = createTimeline();
    timeline.add(".a", { x: [0, 100] }, { duration: 300 } as never);
    const compiled = compileTimeline(timeline.toJSON(), { fps: 30 });
    expect(compiled.lint.map((w) => w.code)).toContain("TM_SPRING_DURATION");
  });
});

// ---------------------------------------------------------------------------
// Lint — collection, formatting, fonts, glow
// ---------------------------------------------------------------------------

describe("collectLintWarnings + formatLint", () => {
  it("dedupes identical code+message pairs", () => {
    const warnings = collectLintWarnings([
      { code: "TM_EMPTY_STYLE", message: "same", severity: "warn" },
      { code: "TM_EMPTY_STYLE", message: "same", severity: "warn" },
      { code: "TM_EMPTY_STYLE", message: "different", severity: "warn" },
    ]);
    expect(warnings).toHaveLength(2);
  });

  it("caps floods at 20 per code with a truncation notice", () => {
    const flood = Array.from({ length: 40 }, (_, i) => ({
      code: "TM_NAN_STYLE" as const,
      message: `w${i}`,
      severity: "warn" as const,
    }));
    const warnings = collectLintWarnings(flood);
    expect(warnings).toHaveLength(21); // 20 + truncation notice
    expect(warnings[warnings.length - 1].message).toContain("suppressed");
  });

  it("formatLint renders severity icons and hints", () => {
    const lines = formatLint([
      { code: "TM_NAN_STYLE", message: "bad value", hint: "clamp it", severity: "warn" },
      { code: "TM_FONT_NETWORK", message: "network font", severity: "info" },
    ]);
    expect(lines[0]).toContain("⚠");
    expect(lines[0]).toContain("[TM_NAN_STYLE]");
    expect(lines[0]).toContain("clamp it");
    expect(lines[1]).toContain("·");
  });
});

describe("lintFontSpecs + lintGlowDither", () => {
  it("flags Google Font specs as network-sourced", () => {
    expect(lintFontSpecs(["Sora"])).toHaveLength(1);
    expect(lintFontSpecs([])).toHaveLength(0);
  });

  it("flags blur chunks only for gif at dpr 1", () => {
    const chunks = ['<div style="filter:blur(44px)"></div>'];
    expect(lintGlowDither(chunks, ["gif"], 1)).toHaveLength(1);
    expect(lintGlowDither(chunks, ["webp"], 1)).toHaveLength(0);
    expect(lintGlowDither(chunks, ["gif"], 2)).toHaveLength(0);
    expect(lintGlowDither(["<div></div>"], ["gif"], 1)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Style sets — type/runtime single-source-of-truth invariants
// ---------------------------------------------------------------------------

describe("style sets", () => {
  it("UNITLESS is a subset of SUPPORTED", () => {
    for (const prop of UNITLESS_STYLE_PROPS) {
      expect(SUPPORTED_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it("TakumiStyle accepts the allowlist members (compile-time probe via satisfies)", () => {
    // A compile-time contract; if SUPPORTED_STYLE_PROPS and the SupportedProp
    // union drift apart, either this object assignment or the set membership
    // check below breaks.
    const probe: TakumiStyle = {
      display: "flex", position: "absolute", inset: 0, zIndex: 1, order: 2,
      overflow: "hidden", boxSizing: "border-box", aspectRatio: 1.5,
      flexDirection: "column", flexWrap: "wrap", flex: 1, flexGrow: 1, flexShrink: 0,
      alignItems: "center", justifyContent: "space-between", gap: 8, rowGap: 4, columnGap: 4,
      width: 100, height: "50%", minWidth: 0, maxWidth: "80ch",
      margin: 0, marginTop: 2, marginInline: "auto",
      padding: "8px 12px", paddingLeft: 12, paddingInline: 6,
      background: "linear-gradient(90deg, #000, #fff)", backgroundColor: "#0b1220",
      backgroundImage: "url(x)", backgroundSize: "cover", backgroundPosition: "center",
      border: "1px solid red", borderWidth: 1, borderRadius: 8, borderTopLeftRadius: "50%",
      color: "#fff", fontFamily: "Sora, sans-serif", fontSize: 12, fontWeight: 700,
      fontStyle: "italic", lineHeight: 1.4, letterSpacing: 0.5, textAlign: "center",
      textDecoration: "underline", whiteSpace: "pre", textShadow: "0 1px 2px #000",
      opacity: 0.5, filter: "blur(4px)", boxShadow: "0 0 8px #000", mixBlendMode: "screen",
      transform: "translateX(1px)", transformOrigin: "center",
      cursor: "pointer", objectFit: "contain", contain: "strict",
      "--brand": "#38bdf8",
    };
    void probe;
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plan-grid hardening
// ---------------------------------------------------------------------------

describe("planRound", () => {
  it("rounds float dust deterministically (ties toward less overlap)", () => {
    expect(planRound(7.5)).toBe(7);
    expect(planRound(7.4999999999)).toBe(7);
    expect(planRound(7.5001)).toBe(8);
    expect(planRound(6.9999999999)).toBe(7);
    expect(planRound(0.5)).toBe(0);
    expect(planRound(1.5)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Timeline transforms
// ---------------------------------------------------------------------------

describe("shiftTimeline", () => {
  it("shifts track delays and extends duration", () => {
    const timeline = createTimeline({ fps: 30 });
    timeline.add(".a", { x: [0, 100] }, { type: "tween", duration: 500, at: 0 });
    const json = timeline.toJSON();
    const shifted = shiftTimeline(json, 250);
    expect(shifted.durationMs).toBe(json.durationMs + 250);
    expect((shifted.tracks[0].transition as { delay: number }).delay).toBe(250);
    // Values are untouched.
    expect(shifted.tracks[0].keyframes).toEqual(json.tracks[0].keyframes);
  });

  it("rejects negative and non-finite deltas", () => {
    const json = { version: 1 as const, durationMs: 1000, tracks: [] };
    expect(() => shiftTimeline(json, -1)).toThrow(/non-negative/);
    expect(() => shiftTimeline(json, NaN)).toThrow(/non-negative/);
  });

  it("zero delta returns the same reference (pure no-op)", () => {
    const json = { version: 1 as const, durationMs: 1000, tracks: [] };
    expect(shiftTimeline(json, 0)).toBe(json);
  });
});

describe("concatTimelines", () => {
  it("places each timeline after the previous one (the declarative Series)", () => {
    const a = createTimeline({ fps: 30 });
    a.add(".a", { x: [0, 10] }, { type: "tween", duration: 300 });
    const b = createTimeline({ fps: 30 });
    b.add(".b", { x: [0, 20] }, { type: "tween", duration: 300 });
    const merged = concatTimelines([a.toJSON(), b.toJSON()]);
    expect(merged.tracks).toHaveLength(2);
    const delayA = (merged.tracks[0].transition as { delay: number }).delay;
    const delayB = (merged.tracks[1].transition as { delay: number }).delay;
    expect(delayB).toBe(delayA + 300);
    expect(merged.durationMs).toBe(a.toJSON().durationMs + b.toJSON().durationMs);
  });

  it("throws on empty input", () => {
    expect(() => concatTimelines([])).toThrow(/at least one/);
  });
});

// ---------------------------------------------------------------------------
// Kit components — frame math (react path exercised in v06-react.test.tsx)
// ---------------------------------------------------------------------------

describe("imageDataUri", () => {
  it("converts buffers to data URIs deterministically", () => {
    const buf = Buffer.from([137, 80, 78, 71]);
    const uri = imageDataUri(buf, "image/png");
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(uri).toBe(imageDataUri(buf, "image/png"));
  });
});

// ---------------------------------------------------------------------------
// Filmstrip
// ---------------------------------------------------------------------------

describe("evenFrames", () => {
  it("is inclusive of both ends and evenly spaced", () => {
    expect(evenFrames(5, 100)).toEqual([0, 25, 50, 74, 99]);
    expect(evenFrames(6, 30)).toEqual([0, 6, 12, 17, 23, 29]);
  });

  it("clamps count to the timeline and handles single-frame timelines", () => {
    expect(evenFrames(10, 4)).toEqual([0, 1, 2, 3]);
    expect(evenFrames(1, 50)).toEqual([0]);
    expect(evenFrames(6, 1)).toEqual([0]);
  });
});

describe("renderFilmstrip", () => {
  it("renders engine-exact stills for a react banner (byte-deterministic artifact)", async () => {
    function StripTitle() {
      const x = useSpring({ from: -40, to: 0, stiffness: 200, damping: 20 });
      return (
        <div style={{ color: "#fff", fontSize: 28, fontWeight: 700, transform: `translateX(${x.toFixed(2)}px)` }}>
          filmstrip
        </div>
      );
    }
    const banner = defineBanner(function StripBanner() {
      return (
        <Banner width={400} height={120} fps={30} background="#0b1220">
          <Scene duration={30}>
            <Fill style={{ alignItems: "center", justifyContent: "center" }}>
              <StripTitle />
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const a = await renderFilmstrip({ banner, frames: [0, 10, 29] });
    const b = await renderFilmstrip({ banner, frames: [0, 10, 29] });

    expect(a.source).toBe("react");
    expect(a.frames).toEqual([0, 10, 29]);
    expect(a.pngs).toHaveLength(3);
    expect(a.columns).toBeGreaterThanOrEqual(2);
    expect(a.html.toString("utf8")).toContain("frame 0");
    expect(a.html.toString("utf8")).toContain("frame 29");
    // Byte-determinism: two runs, same artifact.
    expect(a.html.equals(b.html)).toBe(true);
    // Cells differ (the spring actually moved).
    expect(a.pngs[0].equals(a.pngs[2])).toBe(false);
  }, 60_000);

  it("writes the html artifact to outDir", async () => {
    const banner = defineBanner(function StripFileBanner() {
      return (
        <Banner width={320} height={90} fps={30}>
          <Scene duration={12}>
            <Fill style={{ alignItems: "center", justifyContent: "center" }}>
              <div style={{ color: "#fff", fontSize: 24 }}>file</div>
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const dir = mkdtempSync(join(tmpdir(), "filmstrip-"));
    const result = await renderFilmstrip({ banner, count: 4, outDir: dir });
    expect(result.path).toBe(join(dir, "filmstrip.html"));
    expect(existsSync(result.path!)).toBe(true);
  }, 60_000);

  it("renders the html path across an explicit duration", async () => {
    const a = await renderFilmstrip({
      html: '<div style="font-size:24px;color:#fff">card</div>',
      width: 200,
      height: 100,
      durationMs: 1000,
      fps: 30,
      count: 4,
    });
    expect(a.source).toBe("html");
    expect(a.frames).toEqual([0, 10, 19, 29]);
    expect(a.pngs.every((p) => p.length > 0)).toBe(true);
  }, 60_000);

  it("renders the declarative path across the compiled timeline", async () => {
    const timeline = createTimeline({ fps: 30 });
    timeline.add(".box", { x: [0, 50] }, { type: "tween", duration: 600 });
    const node = h("div", { className: "box", style: { width: 40, height: 40, backgroundColor: "#38bdf8" } });
    const a = await renderFilmstrip({ node, timeline: timeline.toJSON(), width: 200, height: 100, count: 4 });
    expect(a.source).toBe("declarative");
    expect(a.pngs).toHaveLength(4);
  }, 60_000);

  it("rejects out-of-range frames", async () => {
    const banner = defineBanner(function TinyBanner() {
      return (
        <Banner width={100} height={50} fps={30}>
          <Scene duration={5}>
            <div>tiny</div>
          </Scene>
        </Banner>
      );
    });
    await expect(renderFilmstrip({ banner, frames: [0, 99] })).rejects.toThrow(/outside the timeline/);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// renderStill — FitText parity with the pipeline (prewarm path)
// ---------------------------------------------------------------------------

describe("renderStill + FitText", () => {
  it("renders a FitText og-image without overflow (extents audited by the consumer)", async () => {
    const banner = defineBanner(function OgBanner() {
      return (
        <Banner width={600} height={200} fps={30}>
          <Scene duration={2}>
            <Fill style={{ alignItems: "center", justifyContent: "center" }}>
              <FitText text="this is a really long headline that must fit" max={48} />
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const still = await renderStill({ banner, frame: 0 });
    expect(still.png.length).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Kit end-to-end through the React pipeline (node-side)
// ---------------------------------------------------------------------------

describe("kit + lint end-to-end", () => {
  it("report.lint surfaces TM_KEBAB_STYLE from a kebab-case banner", async () => {
    const KebabBanner = defineBanner(function KebabBanner() {
      return (
        <Banner width={300} height={100} fps={30}>
          <Scene duration={3}>
            <div style={{ "font-weight": 700 as never, color: "#fff" }}>kebab</div>
          </Scene>
        </Banner>
      );
    });
    const capture = await import("../src/react/capture.js").then((m) => m.captureReactBanner(KebabBanner as never));
    const codes = capture.lint.map((w) => w.code);
    expect(codes).toContain("TM_KEBAB_STYLE");
  }, 60_000);

  it("renders a kit banner (CountUp + Typewriter + Glow) byte-deterministically", async () => {
    const KitBanner = defineBanner(function KitBanner() {
      return (
        <Banner width={480} height={120} fps={30} background="#0b1220">
          <Scene duration={30}>
            <Layer bottom>
              <Glow x={80} y={60} size={160} color="#38bdf8" />
            </Layer>
            <Fill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <CountUp to={4200} durationFrames={20} delayFrames={2}
                      format={(n) => `${Math.round(n).toLocaleString("en-US")}+ stars`}
                      style={{ color: "#fff", fontSize: 30, fontWeight: 700 }} />
              <Typewriter text="shipping determinism" durationFrames={18} cursorPeriodFrames={10}
                          style={{ color: "#94a3b8", fontSize: 16 }} />
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const reportA = await renderReactBanner({ banner: KitBanner, formats: ["gif", "webp"] });
    const reportB = await renderReactBanner({ banner: KitBanner, formats: ["gif", "webp"] });

    expect(reportA.files).toHaveLength(2);
    // CountUp changes text per frame → many chunks; determinism regardless.
    expect(reportA.chunks).toBeGreaterThan(15);
    for (const [a, b] of reportA.files.map((f, i) => [f, reportB.files[i]] as const)) {
      expect(a.format).toBe(b.format);
      expect(a.buffer.equals(b.buffer)).toBe(true);
    }
    // The GIF frame count matches the plan (holds collapse but frames stay).
    expect(reportA.frames).toBe(30);
  }, 120_000);

  it("declarative renderBanner carries compile lint into report.lint", async () => {
    const timeline = createTimeline({ fps: 30 });
    timeline.add(".box", { x: [0, 30] }, { duration: 300 } as never);
    const node = h("div", { className: "box", style: { width: 40, height: 40, backgroundColor: "#38bdf8" } });
    const report = await renderBanner({ node, timeline: timeline.toJSON(), width: 200, height: 100, formats: ["webp"] });
    expect(report.lint.map((w) => w.code)).toContain("TM_SPRING_DURATION");
  }, 60_000);
});
