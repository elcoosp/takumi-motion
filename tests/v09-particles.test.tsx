// tests/v09-particles.test.tsx — v0.9 Bet D: deterministic particles.
// Sparkle = static positions + opacity twinkle (cheap tier); confetti =
// closed-form ballistic churn with burst-and-settle; TM_PARTICLE_CHURN lint;
// byte determinism across runs; TM_PARTICLE_BUDGET semantics.

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  Particles,
  CONFETTI_BUDGET,
  defineBanner,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner } from "../src/react-render.js";

const canvas = { width: 200, height: 100, fps: 20 };

function bannerOf(children: ReactNode) {
  return defineBanner(function V09ParticlesBanner() {
    return <Banner {...canvas}>{children}</Banner>;
  }) as never;
}

describe("<Particles sparkle>", () => {
  it("renders static positions whose opacity twinkles", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={40}>
          <Particles count={12} seed="hero" twinklePeriodFrames={16} />
        </Scene>,
      ),
    );
    const f0 = capture.htmlFrames[0];
    // A field of absolutely-positioned dots.
    expect(f0.match(/border-radius:999px/g)?.length).toBeGreaterThan(6);
    // Positions NEVER change (same left/top values across frames).
    const positionsOf = (html: string) =>
      [...html.matchAll(/left:([\d.]+)px;top:([\d.]+)px/g)].map((m) => `${m[1]},${m[2]}`).sort().join("|");
    expect(positionsOf(capture.htmlFrames[10])).toBe(positionsOf(capture.htmlFrames[30]));
    // Opacity DOES change (twinkle).
    const opacityOf = (html: string) => [...html.matchAll(/opacity:([\d.]+)/g)].map((m) => m[1]).join(",");
    expect(opacityOf(capture.htmlFrames[10])).not.toBe(opacityOf(capture.htmlFrames[12]));
  });

  it("is byte-deterministic across runs", async () => {
    const banner = bannerOf(
      <Scene duration={20}>
        <Particles count={10} seed="determinism" />
      </Scene>,
    );
    const a = await captureReactBanner(banner);
    const b = await captureReactBanner(banner);
    expect(a.htmlFrames.join("\u0000")).toBe(b.htmlFrames.join("\u0000"));
  });
});

describe("<Particles confetti>", () => {
  it("bursts and settles into a twinkle (positions frozen after burstFrames)", async () => {
    const capture = await captureReactBanner(
      bannerOf(
        <Scene duration={60}>
          <Particles count={16} mode="confetti" seed="launch" burstFrames={24} speed={3} />
        </Scene>,
      ),
    );
    // During flight, positions churn.
    const posOf = (html: string) =>
      [...html.matchAll(/left:([\d.]+)px;top:([\d.]+)px/g)].map((m) => `${m[1]},${m[2]}`).join("|");
    expect(posOf(capture.htmlFrames[6])).not.toBe(posOf(capture.htmlFrames[14]));
    // After the burst: frozen.
    expect(posOf(capture.htmlFrames[40])).toBe(posOf(capture.htmlFrames[50]));
    // Settled frames twinkle (opacity still varies).
    const opOf = (html: string) => [...html.matchAll(/opacity:([\d.]+)/g)].map((m) => m[1]).join(",");
    expect(opOf(capture.htmlFrames[40])).not.toBe(opOf(capture.htmlFrames[44]));
  });

  it("flags unbounded or over-budget confetti through capture lint", async () => {
    const unbounded = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Particles count={10} mode="confetti" seed="x" />
        </Scene>,
      ),
    );
    expect(unbounded.lint.some((l) => l.code === "TM_PARTICLE_CHURN" && l.message.includes("WHOLE scene"))).toBe(true);

    const overBudget = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Particles count={CONFETTI_BUDGET + 8} mode="confetti" seed="y" burstFrames={10} />
        </Scene>,
      ),
    );
    expect(overBudget.lint.some((l) => l.code === "TM_PARTICLE_CHURN")).toBe(true);

    const ok = await captureReactBanner(
      bannerOf(
        <Scene duration={20}>
          <Particles count={12} mode="confetti" seed="z" burstFrames={10} />
        </Scene>,
      ),
    );
    expect(ok.lint.filter((l) => l.code === "TM_PARTICLE_CHURN")).toEqual([]);
  });
});

describe("<Particles> end-to-end", () => {
  it("renders a sparkle field through the full pipeline without extent violations", async () => {
    const report = await renderReactBanner({
      banner: bannerOf(
        <Scene duration={24}>
          <Particles count={14} seed="pipeline" />
        </Scene>,
      ),
      width: 200,
      height: 100,
      dpr: 1,
      formats: ["gif"],
      posters: false,
    } as never);
    expect(report.files[0].buffer.subarray(0, 3).toString("latin1")).toBe("GIF");
    expect(report.extents.violations.filter((v) => !v.decorative)).toEqual([]);
  });
});
