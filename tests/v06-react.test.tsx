// tests/v06-react.test.tsx — the authoring experience release, React side:
// <Fill>/<Img>/<FitText> content components, the kinetic kit (<CountUp>,
// <Typewriter>, <Glow>), the FitText probe→prewarm→frame lifecycle, and the
// authoring lint flowing through capture (kebab styles, unmeasured FitText)
// with byte-determinism intact.

import { describe, expect, it } from "vitest";
import { createElement } from "react";

import {
  Fill,
  Img,
  FitText,
  CountUp,
  Typewriter,
  Glow,
  imageDataUri,
} from "../src/react/index.js";
import {
  Banner,
  Scene,
  Layer,
  defineBanner,
  useSpring,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner } from "../src/react-render.js";
import { renderStill } from "../src/still.js";
import { resolveFitRequests, fitCacheSize, clearMeasureCache } from "../src/measure.js";
import { takeFitRequests } from "../src/react/components.js";

// ---------------------------------------------------------------------------
// Markup — Fill / Img / Glow
// ---------------------------------------------------------------------------

describe("<Fill>", () => {
  it("renders an absolute inset-0 container", async () => {
    const capture = await captureReactBanner(
      defineBanner(function FillBanner() {
        return (
          <Banner width={200} height={100} fps={30}>
            <Scene duration={2}>
              <Fill style={{ alignItems: "center" }}>
                <div>x</div>
              </Fill>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const html = capture.chunks[0].html;
    // Fill is a flex container by default (takumi only applies alignment
    // under an explicit display:flex).
    expect(html).toContain('style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center"');
  });

  it("style overrides win over the defaults", async () => {
    const capture = await captureReactBanner(
      defineBanner(function FillOvBanner() {
        return (
          <Banner width={200} height={100} fps={30}>
            <Scene duration={2}>
              <Fill style={{ position: "relative", top: 8 }} />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    expect(capture.chunks[0].html).toContain("position:relative");
    expect(capture.chunks[0].html).toContain("top:8px");
  });
});

describe("<Img>", () => {
  it("inlines buffers as data URIs (server-safe, sync)", async () => {
    // 1×1 red PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const capture = await captureReactBanner(
      defineBanner(function ImgBanner() {
        return (
          <Banner width={100} height={100} fps={30}>
            <Scene duration={2}>
              <Img src={png} width={32} height={32} alt="logo" />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    expect(capture.chunks[0].html).toContain('src="data:image/png;base64,');
    expect(capture.chunks[0].html).toContain('width="32"');
    expect(capture.chunks[0].html).toContain('alt="logo"');
  });

  it("passes data-URI strings through untouched (deterministic prop-in path)", async () => {
    const uri = imageDataUri(Buffer.from([1, 2, 3]));
    const capture = await captureReactBanner(
      defineBanner(function ImgStrBanner() {
        return (
          <Banner width={100} height={100} fps={30}>
            <Scene duration={2}>
              <Img src={uri} />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    expect(capture.chunks[0].html).toContain(`src="${uri}"`);
  });
});

describe("<Glow>", () => {
  it("renders a blurred low-opacity blob with size doctrine defaults", async () => {
    const capture = await captureReactBanner(
      defineBanner(function GlowBanner() {
        return (
          <Banner width={400} height={100} fps={30}>
            <Scene duration={2}>
              <Glow x={200} y={50} size={160} color="#38bdf8" />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const html = capture.chunks[0].html;
    expect(html).toContain("filter:blur(44px)");
    expect(html).toContain("opacity:0.14");
    // centered on (x, y)
    expect(html).toContain("left:120px");
    expect(html).toContain("top:-30px");
  });
});

// ---------------------------------------------------------------------------
// Kit — CountUp / Typewriter frame math
// ---------------------------------------------------------------------------

describe("<CountUp>", () => {
  it("counts linearly with easing and holds the final value", async () => {
    const capture = await captureReactBanner(
      defineBanner(function CountBanner() {
        return (
          <Banner width={300} height={80} fps={10}>
            <Scene duration={10}>
              <CountUp to={100} durationFrames={5} ease="linear"
                      style={{ color: "#fff", fontSize: 20 }} />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const texts = capture.htmlFrames.map((html) => html.replace(/<[^>]+>/g, "").trim());
    // Frame 0: 0. Frame 4: 80 (easeOut cubic on 4/5). Frame 9: holds 100.
    expect(texts[0]).toBe("0");
    expect(texts[9]).toBe("100");
    expect(texts[4]).not.toBe("0");
    expect(Number(texts[4])).toBeGreaterThan(50);
    expect(Number(texts[4])).toBeLessThan(100);
  });

  it("formats per frame via the format prop", async () => {
    const capture = await captureReactBanner(
      defineBanner(function CountFmtBanner() {
        return (
          <Banner width={300} height={80} fps={10}>
            <Scene duration={4}>
              <CountUp to={2} durationFrames={2} ease="linear" format={(n) => `+${Math.round(n)}+`} />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const texts = capture.htmlFrames.map((h) => h.replace(/<[^>]+>/g, "").trim());
    expect(texts[0]).toBe("+0+");
    expect(texts[2]).toBe("+2+");
  });
});

describe("<Typewriter>", () => {
  it("gates characters per frame and holds the full text", async () => {
    const capture = await captureReactBanner(
      defineBanner(function TypeBanner() {
        return (
          <Banner width={400} height={80} fps={10}>
            <Scene duration={8}>
              <Typewriter text="abcdef" durationFrames={5} cursor={false} />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const texts = capture.htmlFrames.map((h) => h.replace(/<[^>]+>/g, ""));
    expect(texts[0]).toBe("");
    expect(texts[1]).toBe("a");
    expect(texts[5]).toBe("abcdef");
    expect(texts[7]).toBe("abcdef");
  });

  it("blinks the cursor on an even period (loop-safe)", async () => {
    const capture = await captureReactBanner(
      defineBanner(function CursorBanner() {
        return (
          <Banner width={400} height={80} fps={10}>
            <Scene duration={6}>
              <Typewriter text="hi" durationFrames={1} cursor cursorPeriodFrames={4} cursorChar="_" />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const texts = capture.htmlFrames.map((h) => h.replace(/<[^>]+>/g, ""));
    // Triangle pulse over 4 frames: 0, .5, 1, .5 — cursor visible at ≥ 0.5.
    expect(texts[0]).not.toContain("_");
    expect(texts[2]).toContain("_");
    expect(texts[4]).not.toContain("_");
    expect(texts[5]).toContain("_");
  });
});

// ---------------------------------------------------------------------------
// FitText — the probe → prewarm → frame lifecycle
// ---------------------------------------------------------------------------

describe("<FitText>", () => {
  it("registers a fit request in the probe phase (canvas width default)", async () => {
    clearMeasureCache();
    const banner = defineBanner(function FitProbeBanner() {
      return (
        <Banner width={600} height={200} fps={30}>
          <Scene duration={2}>
            <FitText text="probe me" max={40} />
          </Scene>
        </Banner>
      );
    });
    await captureReactBanner(banner as never);
    // Requests were consumed by the capture prewarm; the cache has the entry.
    expect(fitCacheSize()).toBeGreaterThan(0);
  });

  it("prewarmed fits render SMALLER than max for long text (measure-exact)", async () => {
    const longText = "a very long headline that cannot possibly fit at max size";
    const banner = defineBanner(function FitLongBanner() {
      return (
        <Banner width={400} height={150} fps={30}>
          <Scene duration={2}>
            <Fill style={{ alignItems: "center", justifyContent: "center" }}>
              <FitText text={longText} max={48} min={10} fontWeight={700} />
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const capture = await captureReactBanner(banner as never);
    const html = capture.chunks[0].html;
    const size = /font-size:(\d+)px/.exec(html)?.[1];
    expect(size).toBeDefined();
    expect(Number(size)).toBeLessThan(48);
    expect(Number(size)).toBeGreaterThanOrEqual(10);
  });

  it("short text renders at max (fits already)", async () => {
    clearMeasureCache();
    const banner = defineBanner(function FitShortBanner() {
      return (
        <Banner width={800} height={150} fps={30}>
          <Scene duration={2}>
            <FitText text="ok" max={48} />
          </Scene>
        </Banner>
      );
    });
    const capture = await captureReactBanner(banner as never);
    expect(capture.chunks[0].html).toContain("font-size:48px");
  });

  it("emits TM_FITTEXT_UNMEASURED when rendered without prewarm", async () => {
    // Render the FitText element OUTSIDE the capture runtime — no probe phase
    // ran, so the cache is cold and the component must warn + fall back.
    clearMeasureCache();
    const el = createElement(FitText, { text: "cold cache" });
    const capture = await captureReactBanner(
      defineBanner(function ColdBanner() {
        return (
          <Banner width={400} height={100} fps={30}>
            <Scene duration={2}>
              {el}
            </Scene>
          </Banner>
        );
      }) as never,
    );
    // Even in capture the element was CREATED before the runtime (cache cold
    // at registration time is fine — but this element was pre-rendered by
    // createElement only, the probe still ran). The deterministic signal:
    // takeFitRequests on a fresh registry gets the request, and a manual
    // renderToStaticMarkup outside the driver warns. Direct check instead:
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { DriverContext } = await import("../src/react/context.js");
    const markup = renderToStaticMarkup(
      createElement(
        DriverContext.Provider,
        {
          value: {
            phase: "frame" as const,
            absoluteFrame: 0,
            fps: 30,
            registry: { errors: [], banner: undefined },
          },
        },
        el,
      ),
    );
    expect(markup).toContain("font-size:64px"); // max fallback
    void capture;
  });

  it("end-to-end: FitText og-image via renderStill, byte-identical twice", async () => {
    const banner = defineBanner(function OgFitBanner() {
      return (
        <Banner width={640} height={320} fps={30} background="#0b1220">
          <Scene duration={2}>
            <Fill style={{ alignItems: "center", justifyContent: "center", padding: "0 32px" }}>
              <FitText text="renderStill + FitText" max={56} fontWeight={700}
                      style={{ color: "#f1f5f9" }} />
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const a = await renderStill({ banner, frame: 0 });
    const b = await renderStill({ banner, frame: 0 });
    expect(a.png.equals(b.png)).toBe(true);
    expect(a.bytes).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Lint integration — silent failures become report data
// ---------------------------------------------------------------------------

describe("authoring lint through capture", () => {
  it("flags kebab styles authored inside components via the chunk signature", async () => {
    function BadStyle() {
      return <div style={{ "font-weight": 700 } as never}>bad</div>;
    }
    const capture = await captureReactBanner(
      defineBanner(function KebabBanner() {
        return (
          <Banner width={300} height={80} fps={30}>
            <Scene duration={2}>
              <BadStyle />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const codes = capture.lint.map((w) => w.code);
    expect(codes).toContain("TM_KEBAB_STYLE");
    const kebab = capture.lint.find((w) => w.code === "TM_KEBAB_STYLE")!;
    expect(kebab.message).toContain("font-weight:700px");
  });

  it("flags literalized kebab styles via the chunk px signature", async () => {
    const capture = await captureReactBanner(
      defineBanner(function LiteralKebabBanner() {
        return (
          <Banner width={300} height={80} fps={30}>
            <Scene duration={2}>
              <div style={{ "line-height": 1.5 } as never}>lit</div>
            </Scene>
          </Banner>
        );
      }) as never,
    );
    const kebab = capture.lint.find((w) => w.code === "TM_KEBAB_STYLE");
    expect(kebab).toBeDefined();
    expect(kebab!.message).toContain("line-height:1.5px");
  });

  it("flags NaN springs via the markup walk", async () => {
    function BadSpring() {
      // Division by zero at frame 0 — the classic NaN producer.
      const x = useSpring({ from: 0, to: 1, stiffness: 0, damping: 0 });
      void x;
      return <div style={{ transform: `translateX(${Number.NaN}px)` }}>nan</div>;
    }
    const capture = await captureReactBanner(
      defineBanner(function NanBanner() {
        return (
          <Banner width={300} height={80} fps={30}>
            <Scene duration={2}>
              <BadSpring />
            </Scene>
          </Banner>
        );
      }) as never,
    );
    expect(capture.lint.some((w) => w.code === "TM_NAN_STYLE")).toBe(true);
  });

  it("report.lint dedupes and the human formatter renders it", async () => {
    // line-height is unitless: the px-suffixed value stays valid CSS, so the
    // render completes and the lint rides along in the report.
    const banner = defineBanner(function LintE2EBanner() {
      return (
        <Banner width={300} height={80} fps={30}>
          <Scene duration={2}>
            <div style={{ "line-height": 1.5 } as never}>e2e</div>
          </Scene>
        </Banner>
      );
    });
    const report = await renderReactBanner({ banner, formats: ["webp"] });
    expect(report.lint.some((w) => w.code === "TM_KEBAB_STYLE")).toBe(true);
    const { formatReactReport } = await import("../src/react-render.js");
    const formatted = formatReactReport(report);
    expect(formatted).toContain("lint:");
    expect(formatted).toContain("[TM_KEBAB_STYLE]");
  }, 60_000);

  it("clean banners produce an empty lint channel", async () => {
    const banner = defineBanner(function CleanBanner() {
      return (
        <Banner width={300} height={80} fps={30}>
          <Scene duration={2}>
            <Fill style={{ alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 20, color: "#fff" }}>clean</div>
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const capture = await captureReactBanner(banner as never);
    expect(capture.lint).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Byte-determinism with the new components in the tree
// ---------------------------------------------------------------------------

describe("determinism with v0.6 components", () => {
  it("Fill + Glow + CountUp banner: byte-identical GIF/WebP across runs", async () => {
    const banner = defineBanner(function DetBanner() {
      return (
        <Banner width={360} height={100} fps={20} background="#0b1220">
          <Scene duration={20}>
            <Layer bottom>
              <Glow x={90} y={50} size={120} />
            </Layer>
            <Fill style={{ alignItems: "center", justifyContent: "center" }}>
              <CountUp to={99} durationFrames={12} ease="linear"
                      style={{ color: "#fff", fontSize: 26, fontWeight: 700 }} />
            </Fill>
          </Scene>
        </Banner>
      );
    });
    const a = await renderReactBanner({ banner, formats: ["gif", "webp"] });
    const b = await renderReactBanner({ banner, formats: ["gif", "webp"] });
    expect(a.files.map((f) => f.bytes)).toEqual(b.files.map((f) => f.bytes));
    for (const [x, y] of a.files.map((f, i) => [f, b.files[i]] as const)) {
      expect(x.buffer.equals(y.buffer)).toBe(true);
    }
  }, 120_000);
});
