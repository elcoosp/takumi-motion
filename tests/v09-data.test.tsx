// tests/v09-data.test.tsx — v0.9 Bet A, the data spine:
// CountUp v2 format patterns, the DataContext channel (--data /
// renderReactBanner({ data })), and the chart kit — <LineChart> clip reveal,
// <BarChart> staggered springs, <Donut> two-half sweep + conic alternative.

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  Fill,
  CountUp,
  LineChart,
  BarChart,
  Donut,
  useChartData,
  niceMax,
  chartMaxOf,
  compactNumber,
  parseNumberPattern,
  groupDigits,
  formatNumberPattern,
  defineBanner,
  type ChartData,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner } from "../src/react-render.js";

const canvas = { width: 240, height: 120, fps: 20 };

const revenue: ChartData = {
  labels: ["Jan", "Feb", "Mar", "Apr"],
  series: [{ name: "Revenue", color: "#38bdf8", points: [120, 240, 180, 420] }],
};

function bannerOf(children: ReactNode, bannerProps: Record<string, unknown> = {}) {
  return defineBanner(function V09Banner() {
    return <Banner {...canvas} {...bannerProps}>{children}</Banner>;
  }) as never;
}

// ---------------------------------------------------------------------------
// CountUp v2 — format patterns
// ---------------------------------------------------------------------------

describe("CountUp v2 format patterns", () => {
  it("parses prefix / grouping / decimals / suffix deterministically", () => {
    expect(parseNumberPattern("$,.0f")).toEqual({ prefix: "$", grouping: true, decimals: 0, suffix: "" });
    expect(parseNumberPattern(",.1f")).toEqual({ prefix: "", grouping: true, decimals: 1, suffix: "" });
    expect(parseNumberPattern("+,.0f%")).toEqual({ prefix: "+", grouping: true, decimals: 0, suffix: "%" });
    expect(parseNumberPattern("ms")).toEqual({ prefix: "", grouping: false, decimals: null, suffix: "ms" });
    expect(parseNumberPattern("")).toEqual({ prefix: "", grouping: false, decimals: null, suffix: "" });
  });

  it("groups thousands without Intl", () => {
    expect(groupDigits("128400")).toBe("128,400");
    expect(groupDigits("-1234567.89")).toBe("-1,234,567.89");
    expect(groupDigits("42")).toBe("42");
  });

  it("formats values through patterns", () => {
    expect(formatNumberPattern(128400, "$,.0f")).toBe("$128,400");
    expect(formatNumberPattern(99.98, ",.1f")).toBe("100.0");
    expect(formatNumberPattern(0.42, "+,.0f%")).toBe("+0%");
    expect(formatNumberPattern(42, "ms")).toBe("42ms");
  });

  it("renders pattern-formatted frames through capture", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <CountUp to={128400} format="$,.0f" durationFrames={20} />
        </Scene>,
      ),
    );
    // Frame 0 → $0; settled → $128,400 grouped.
    expect(capture.htmlFrames[0]).toContain(">$0<");
    expect(capture.htmlFrames[39]).toContain("$128,400");
    // tabular-nums stays forced on the v2 path.
    expect(capture.htmlFrames[39]).toContain("tabular-nums");
  });
});

// ---------------------------------------------------------------------------
// Data channel
// ---------------------------------------------------------------------------

describe("data channel (DataContext)", () => {
  it("useChartData throws with a pointed message when nothing is provided", async () => {
    function Reader() {
      useChartData("metrics");
      return null;
    }
    await expect(
      captureReactBanner(bannerOf(<Scene duration={10}><Reader /></Scene>)),
    ).rejects.toThrow(/no data was provided.*--data file\.json/s);
  });

  it("captureReactBanner provides data through the channel", async () => {
    let seen: unknown;
    function Reader() {
      seen = useChartData<{ tier: string }>("probe");
      return null;
    }
    await captureReactBanner(bannerOf(<Scene duration={10}><Reader /></Scene>), {
      data: { tier: "pro" },
    });
    expect(seen).toEqual({ tier: "pro" });
  });

  it("renderReactBanner({ data }) feeds a chart that declares NO data prop", async () => {
    const report = await renderReactBanner({
      banner: bannerOf(
        <Scene duration={24}>
          <LineChart draw="none" width={180} height={80} />
        </Scene>,
      ),
      data: revenue,
      width: 240,
      height: 120,
      dpr: 1,
      formats: ["gif"],
      posters: false,
    } as never);
    expect(report.files[0].buffer.subarray(0, 3).toString("latin1")).toBe("GIF");
    expect(report.extents.violations.filter((v) => !v.decorative)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Chart math
// ---------------------------------------------------------------------------

describe("chart math", () => {
  it("niceMax rounds up to human ticks", () => {
    expect(niceMax(420)).toBe(500);
    expect(niceMax(1000)).toBe(1000);
    expect(niceMax(1234)).toBe(2000);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(0.3)).toBe(0.5);
    expect(niceMax(0)).toBe(1);
  });

  it("chartMaxOf prefers explicit max, else niceMax of the peak", () => {
    expect(chartMaxOf({ series: [{ name: "a", color: "#fff", points: [1, 2, 3] }], max: 10 })).toBe(10);
    expect(chartMaxOf({ series: [{ name: "a", color: "#fff", points: [120, 240, 420] }] })).toBe(500);
  });

  it("chartMaxOf rejects invalid explicit maxima", () => {
    expect(() =>
      chartMaxOf({ series: [{ name: "a", color: "#fff", points: [1] }], max: -1 }),
    ).toThrow(/data\.max/);
  });

  it("compactNumber abbreviates", () => {
    expect(compactNumber(1234)).toBe("1.23k");
    expect(compactNumber(4_500_000)).toBe("4.5M");
    expect(compactNumber(42)).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// <LineChart>
// ---------------------------------------------------------------------------

describe("<LineChart>", () => {
  it("draw=reveal clips fully at frame 0 and settles clip-free", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={60}>
          <LineChart data={revenue} draw="reveal" drawDurationFrames={30} drawDelayFrames={6} width={180} height={80} />
        </Scene>,
      ),
    );
    // Frame 0: fully clipped (nothing visible yet).
    expect(capture.htmlFrames[0]).toContain("clip-path:inset(0px 180px 0px 0px)");
    // Mid-draw: the inset shrinks (sweeping right).
    const mid = capture.htmlFrames[20];
    const midClip = /clip-path:inset\(0px ([\d.]+)px 0px 0px\)/.exec(mid);
    expect(midClip).not.toBeNull();
    expect(Number(midClip![1])).toBeGreaterThan(0);
    expect(Number(midClip![1])).toBeLessThan(180);
    // Settled: no clip attribute at all (style-stable → chunk-merges).
    const settled = capture.htmlFrames[55];
    expect(settled).not.toContain("clip-path");
    // One SVG data URI carries the whole chart.
    expect(settled).toContain("data:image/svg+xml;base64,");
  });

  it("draw=none renders settled immediately (no clip ever)", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <LineChart data={revenue} draw="none" width={180} height={80} />
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[0]).not.toContain("clip-path");
    expect(capture.htmlFrames[0]).toContain("data:image/svg+xml;base64,");
  });

  it("scales the SVG to the requested plot box", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <LineChart data={revenue} draw="none" width={180} height={80} />
        </Scene>,
      ),
    );
    // The <img> carries the exact plot dimensions (grid-aligned SVG viewport).
    expect(capture.htmlFrames[0]).toContain("width:180px;height:80px");
    expect(capture.htmlFrames[0]).toContain("width=\u0022180\u0022");
  });

  it("throws on ragged series", async () => {
    const ragged: ChartData = {
      series: [
        { name: "a", color: "#fff", points: [1, 2, 3] },
        { name: "b", color: "#fff", points: [1, 2] },
      ],
    };
    await expect(
      captureReactBanner(bannerOf(<Scene duration={10}><LineChart data={ragged} draw="none" /></Scene>)),
    ).rejects.toThrow(/same point count/);
  });
});

// ---------------------------------------------------------------------------
// <BarChart>
// ---------------------------------------------------------------------------

describe("<BarChart>", () => {
  it("bars grow from zero with stagger and settle at value/max", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={50}>
          <BarChart data={revenue} width={180} height={80} stagger={{ intervalFrames: 2 }} spring={{ duration: 300, bounce: 0 }} />
        </Scene>,
      ),
    );
    // Frame 0: nothing grown yet (spring at from=0 → height 0).
    const h0 = /height:(\d+(?:\.\d+)?)px/.exec(capture.htmlFrames[0].match(/flex:1;height:[^\"]*/)[0] ?? "");
    expect(h0 === null || Number(h0[1]) === 0).toBe(true);
    // Settled: tallest bar (420/500) ≈ 0.84 × 80 = 67.2px (scan bar divs only).
    const settled = capture.htmlFrames[45];
    const heights = [...settled.matchAll(/flex:1;height:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeCloseTo(67.2, 0);
  });

  it("orientation=right animates width instead of height", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={30}>
          <BarChart data={revenue} orientation="right" width={180} height={80} spring={{ duration: 200, bounce: 0 }} />
        </Scene>,
      ),
    );
    const settled = capture.htmlFrames[28];
    const widths = [...settled.matchAll(/width:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(Math.max(...widths)).toBeGreaterThan(100); // 0.84 × 180 ≈ 151
  });

  it("renders value labels when showValues (default)", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={30}>
          <BarChart data={revenue} width={180} height={80} spring={{ duration: 200, bounce: 0 }} />
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[28]).toContain("420");
  });
});

// ---------------------------------------------------------------------------
// <Donut>
// ---------------------------------------------------------------------------

describe("<Donut>", () => {
  it("transform paint sweeps the mask pair and settles static", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={50}>
          <Donut value={0.25} size={80} thickness={12} drawDurationFrames={30} drawDelayFrames={4} />
        </Scene>,
      ),
    );
    // Start: masks at 0 — track-colored pair, no progress visible.
    expect(capture.htmlFrames[0]).toContain("rotate(0deg)");
    // Settled: angle = 0.25 × 360 = 90°.
    const settled = capture.htmlFrames[45];
    expect(settled).toContain("rotate(90deg)");
    // After the 180° crossing the second mask swaps to progress color; at 90°
    // it must still be track (pre-crossing branch).
    expect(settled).toContain("#38bdf8"); // default chart color on the progress disc
  });

  it("value > 1 throws with the ratio hint", async () => {
    await expect(
      captureReactBanner(bannerOf(<Scene duration={10}><Donut value={1.5} /></Scene>)),
    ).rejects.toThrow(/\[0, 1\]/);
  });

  it("conic paint emits a per-frame conic-gradient", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={50}>
          <Donut value={0.5} paint="conic" size={80} thickness={12} drawDurationFrames={30} drawDelayFrames={4} />
        </Scene>,
      ),
    );
    const settled = capture.htmlFrames[45];
    expect(settled).toContain("conic-gradient(#38bdf8 0deg, #38bdf8 180deg");
    expect(settled).not.toContain("clip-path");
  });

  it("renders center content inside the hole", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <Donut value={0.73} size={80} thickness={12} center={<CountUp to={73} format="+,.0f%" durationFrames={20} />} />
        </Scene>,
      ),
    );
    expect(capture.htmlFrames[38]).toContain("+73%");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("chart kit determinism", () => {
  it("two captures of a data-driven banner are byte-identical", async () => {
    const banner = bannerOf(
      <Scene duration={40}>
        <Fill style={{ flexDirection: "column", gap: 8 }}>
          <LineChart data={revenue} width={180} height={60} />
          <BarChart data={revenue} width={180} height={40} spring={{ duration: 200, bounce: 0 }} />
        </Fill>
      </Scene>,
    );
    const a = await captureReactBanner(banner);
    const b = await captureReactBanner(banner);
    expect(a.htmlFrames.join("\u0000")).toBe(b.htmlFrames.join("\u0000"));
  });
});
