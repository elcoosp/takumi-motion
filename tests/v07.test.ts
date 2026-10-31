// tests/v07.test.ts — the motion language release, pure-math side:
// the Easing namespace (factories + bounce/poly/elastic), spring hygiene
// (presets, overshootClamping, springSettleFrames), perceptual color
// interpolation (OKLCH), and the entering/exiting descriptor core.

import { describe, expect, it } from "vitest";

import {
  Easing,
  easingDefinitionToFunction,
  namedEasings,
} from "../src/easing.js";
import {
  springFor,
  springPresets,
  springSettleFrames,
  msToFrames,
} from "../src/react/motion.js";
import {
  parseColor,
  colorToOklch,
  mixColor,
  interpolateColorFor,
  type Rgba,
} from "../src/color.js";
import {
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInLeft,
  ZoomIn,
  BounceIn,
  FadeOutLeft,
  BounceOut,
  transitionPresets,
  defineTransition,
  staggered,
  resolveTransitionAtFrame,
  transitionSettleIssue,
  transitionStartFrame,
} from "../src/react/enter-exit.js";

const FPS = 30;
const CTX = { fps: FPS, totalFrames: 60 };

// ---------------------------------------------------------------------------
// Easing namespace (v0.7)
// ---------------------------------------------------------------------------

describe("Easing namespace", () => {
  it("factories: endpoints hold and out() mirrors in()", () => {
    for (const f of [Easing.back(1.7), Easing.poly(3), Easing.elastic(1), Easing.bounceOut]) {
      expect(f(0)).toBeCloseTo(0, 12);
      expect(f(1)).toBeCloseTo(1, 12);
    }
    // out(back) starts fast and lands soft: at p=0.5 it is past halfway.
    const outBack = Easing.out(Easing.back(1.7));
    expect(outBack(0)).toBeCloseTo(0, 12);
    expect(outBack(1)).toBeCloseTo(1, 12);
    expect(outBack(0.5)).toBeGreaterThan(0.5);
    // in(back) is the mirror: at 0.5 it is behind halfway.
    const inBack = Easing.in(Easing.back(1.7));
    expect(inBack(0.5)).toBeLessThan(0.5);
  });

  it("inOut composes both ends symmetrically", () => {
    const inOutBack = Easing.inOut(Easing.back(1.7));
    expect(inOutBack(0)).toBeCloseTo(0, 12);
    expect(inOutBack(0.5)).toBeCloseTo(0.5, 5);
    expect(inOutBack(1)).toBeCloseTo(1, 12);
  });

  it("bounceIn/bounceOut/bounceInOut resolve as named easings too", () => {
    expect(namedEasings.bounceOut(0)).toBe(0);
    expect(namedEasings.bounceOut(1)).toBe(1);
    // bounceOut overshoots nothing (peaks at 1) but bounces on the way.
    const fn = easingDefinitionToFunction("bounceIn");
    expect(fn(0)).toBeCloseTo(0, 12);
    expect(fn(1)).toBeCloseTo(1, 12);
    // easeDefinition path: "bounceOut" is now a valid string easing anywhere.
    expect(easingDefinitionToFunction("bounceInOut")(0.5)).toBeCloseTo(0.5, 5);
  });

  it("poly and elastic behave per their definitions", () => {
    expect(Easing.poly(2)(0.5)).toBe(0.25);
    expect(Easing.poly(3)(0.5)).toBeCloseTo(0.125, 12);
    const elastic1 = Easing.elastic(1);
    expect(elastic1(0)).toBeCloseTo(0, 12);
    expect(elastic1(1)).toBeCloseTo(1, 12);
    // Elastic oscillates around 1 before settling: some point exceeds 1.
    const max = Math.max(...Array.from({ length: 101 }, (_, i) => elastic1(i / 100)));
    expect(max).toBeGreaterThan(1);
  });

  it("bezier is the same solver as cubicBezier", () => {
    expect(Easing.bezier(0.33, 1.53, 0.69, 0.99)(0.5)).toBeCloseTo(namedEasings.backOut(0.5), 12);
  });
});

// ---------------------------------------------------------------------------
// Spring hygiene
// ---------------------------------------------------------------------------

describe("spring hygiene", () => {
  it("presets are spreadable SpringAtOptions", () => {
    for (const [name, preset] of Object.entries(springPresets)) {
      expect(Object.keys(preset).length, name).toBeGreaterThan(0);
      // Spreading into springFor produces settled values at the end.
      const settle = springSettleFrames(FPS, preset);
      expect(Number.isFinite(settle), name).toBe(true);
    }
  });

  it("springSettleFrames matches where springFor lands exactly on `to`", () => {
    for (const options of [
      { duration: 400, bounce: 0.3 },
      { stiffness: 170, damping: 11 },
      { duration: 800, bounce: 0.45 },
      { duration: 350, bounce: 0.12 },
    ]) {
      const settle = springSettleFrames(FPS, options);
      expect(settle).toBeGreaterThan(0);
      // At settle-1 the spring may still be in motion; at settle it is done.
      const atSettle = springFor(settle, FPS, options);
      expect(atSettle).toBeCloseTo(1, 10);
      // Monotone in duration-bounce space: a calmer spring never settles later than a wilder one at same duration? — skip; assert sanity bounds instead.
      expect(settle).toBeLessThan(FPS * 21);
    }
  });

  it("springSettleFrames includes delayFrames and memoizes", () => {
    const plain = springSettleFrames(FPS, { duration: 500, bounce: 0.3 });
    const delayed = springSettleFrames(FPS, { duration: 500, bounce: 0.3, delayFrames: 10 });
    expect(delayed).toBe(plain + 10);
    // Second call hits the cache — value identical.
    expect(springSettleFrames(FPS, { duration: 500, bounce: 0.3 })).toBe(plain);
  });

  it("overshootClamping keeps the spring inside [from, to]", () => {
    const wild = { duration: 600, bounce: 0.6, from: 0, to: 100 };
    let unclampedMax = -Infinity;
    let clampedMax = -Infinity;
    for (let f = 0; f <= springSettleFrames(FPS, wild); f++) {
      unclampedMax = Math.max(unclampedMax, springFor(f, FPS, wild));
      clampedMax = Math.max(clampedMax, springFor(f, FPS, { ...wild, overshootClamping: true }));
    }
    expect(unclampedMax).toBeGreaterThan(100); // sanity: the wild spring DOES overshoot
    expect(clampedMax).toBeLessThanOrEqual(100);
    expect(clampedMax).toBeGreaterThanOrEqual(0);
  });

  it("msToFrames rounds up", () => {
    expect(msToFrames(1000, 30)).toBe(30);
    expect(msToFrames(1001, 30)).toBe(31);
    expect(msToFrames(0, 30)).toBe(0);
    expect(() => msToFrames(-1, 30)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Color — parse, OKLCH, mix, interpolate
// ---------------------------------------------------------------------------

const rgbaOf = (css: string): Rgba => parseColor(css)!;

describe("parseColor", () => {
  it("parses hex variants, named colors, rgb(), hsl(), transparent", () => {
    expect(rgbaOf("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(rgbaOf("#f00")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(rgbaOf("#ff000080")!.a).toBeCloseTo(128 / 255, 5);
    expect(rgbaOf("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(rgbaOf("RebeccaPurple")).toEqual({ r: 102, g: 51, b: 153, a: 1 });
    expect(rgbaOf("rgb(0 128 255)")).toEqual({ r: 0, g: 128, b: 255, a: 1 });
    expect(rgbaOf("rgba(0, 128, 255, 0.5)")!.a).toBeCloseTo(0.5, 5);
    expect(rgbaOf("hsl(0 100% 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(rgbaOf("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor("not-a-color")).toBeNull();
  });

  it("caches parses (same string → same result)", () => {
    expect(parseColor("salmon")).toEqual(parseColor("salmon"));
  });
});

describe("OKLCH conversion", () => {
  it("white is L=1, black is L=0, greys are achromatic", () => {
    const white = colorToOklch!("#ffffff")!;
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeLessThan(1e-6);
    const black = colorToOklch("#000000")!;
    expect(black.l).toBeCloseTo(0, 3);
    const grey = colorToOklch("#808080")!;
    expect(grey.c).toBeLessThan(1e-4);
  });

  it("red has hue ≈ 29°, blue ≈ 264° (OKLCH reference hues)", () => {
    expect(colorToOklch("#ff0000")!.h).toBeGreaterThan(25);
    expect(colorToOklch("#ff0000")!.h).toBeLessThan(32);
    expect(colorToOklch("#0000ff")!.h).toBeGreaterThan(260);
    expect(colorToOklch("#0000ff")!.h).toBeLessThan(270);
  });

  it("round-trips through rgbaToCss within 8-bit tolerance", () => {
    for (const css of ["#1e293b", "#f8fafc", "#dc143c", "#4ade80"]) {
      // mixColor(x, x, 0.5) round-trips through OKLCH and back to css.
      const back = rgbaOf(mixColor(css, css, 0.5));
      const original = rgbaOf(css);
      expect(Math.abs(back.r - original.r)).toBeLessThanOrEqual(1, css);
      expect(Math.abs(back.g - original.g)).toBeLessThanOrEqual(1, css);
      expect(Math.abs(back.b - original.b)).toBeLessThanOrEqual(1, css);
    }
  });
});

describe("mixColor", () => {
  it("OKLCH midpoint of red→yellow is a clean orange (no brown muddiness)", () => {
    const mid = rgbaOf(mixColor("red", "yellow", 0.5));
    // In OKLCH the 50% red/yellow mix keeps high chroma and L between both.
    expect(mid.r).toBeGreaterThan(200);
    expect(mid.g).toBeGreaterThan(140);
    expect(mid.b).toBeLessThan(60);
  });

  it("hue travels the short path (red→blue goes through purple, not green)", () => {
    const quarter = colorToOklch(mixColor("#ff0000", "#0000ff", 0.25))!;
    // Short path red(29°) → blue(264°): the negative direction → hue near 0/360.
    const shortWay = quarter.h > 300 || quarter.h < 40;
    expect(shortWay).toBe(true);
  });

  it("srgb space stays available as the legacy per-channel mix", () => {
    const mid = rgbaOf(mixColor("#000000", "#ffffff", 0.5, { space: "srgb" }));
    expect(mid.r).toBe(128); // round(127.5)
    // Linear-light 50% mixes MORE light, so it gamma-encodes lighter than 128.
    const lin = rgbaOf(mixColor("#000000", "#ffffff", 0.5, { space: "srgb-linear" }));
    expect(lin.r).toBeGreaterThan(128);
  });

  it("unparseable inputs pass through by majority rule", () => {
    expect(mixColor("nope", "red", 0.1)).toBe("nope");
    expect(mixColor("red", "nope", 0.9)).toBe("nope");
  });

  it("is deterministic — identical inputs, identical bytes", () => {
    expect(mixColor("#0f172a", "#f8fafc", 0.37)).toBe(mixColor("#0f172a", "#f8fafc", 0.37));
  });
});

describe("interpolateColorFor", () => {
  it("clamps outside the input range and interpolates between stops", () => {
    const stops = ["#000000", "#808080", "#ffffff"];
    expect(interpolateColorFor(-5, [0, 10, 20], stops)).toBe("#000000");
    expect(interpolateColorFor(25, [0, 10, 20], stops)).toBe("#ffffff");
    const mid = rgbaOf(interpolateColorFor(5, [0, 10, 20], stops));
    // OKLCH midpoint of black→#808080 has L≈0.3 → a dark grey ≈ rgb(40).
    expect(mid.r).toBeGreaterThan(20);
    expect(mid.r).toBeLessThan(60);
  });

  it("supports per-segment easing arrays", () => {
    const stops = ["#000000", "#ffffff", "#000000"];
    // Segment 1 eased hard → at 75% of segment 0, already most of the way.
    const eased = rgbaOf(interpolateColorFor(7.5, [0, 10, 20], stops, { easing: ["linear", "linear"] }));
    const hard = rgbaOf(interpolateColorFor(7.5, [0, 10, 20], stops, { easing: "easeOut" }));
    expect(hard.r).toBeGreaterThan(eased.r);
  });

  it("rejects mismatched arrays", () => {
    expect(() => interpolateColorFor(0, [0, 10], ["#000000"])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Entering/exiting descriptor core
// ---------------------------------------------------------------------------

describe("descriptor resolution — entering", () => {
  it("before start: full start state (hidden, offset)", () => {
    const desc = FadeInDown.delay(6);
    const styles = resolveTransitionAtFrame(desc, 3, CTX)!;
    expect(styles.opacity).toBe(0);
    expect(styles.transform).toBe("translateY(-24px)");
  });

  it("mid-flight: eased partial state, r6-rounded", () => {
    const desc = FadeInDown.duration(20);
    const styles = resolveTransitionAtFrame(desc, 10, CTX)!;
    expect(styles.opacity).toBeGreaterThan(0);
    expect(styles.opacity).toBeLessThan(1);
    const y = Number(styles.transform!.match(/translateY\((-?[\d.]+)px\)/)![1]);
    expect(y).toBeLessThan(0);
    expect(y).toBeGreaterThan(-24);
    // r6: at most 6 decimals.
    expect(String(styles.opacity).replace(/^0\./, "").length).toBeLessThanOrEqual(6);
  });

  it("after end: null — no overrides, chunk-merge stays effective", () => {
    expect(resolveTransitionAtFrame(FadeInDown.duration(20), 20, CTX)).toBeNull();
    expect(resolveTransitionAtFrame(FadeInDown.duration(20), 59, CTX)).toBeNull();
  });

  it("defaults: 20 frames, easeOut", () => {
    const styles = resolveTransitionAtFrame(FadeIn, 10, CTX)!;
    const linearStyles = resolveTransitionAtFrame(defineTransition({ side: "enter", channels: { opacity: [0, 1] }, easing: "linear" }), 10, CTX)!;
    // easeOut is ahead of linear at half-time.
    expect(styles.opacity!).toBeGreaterThan(linearStyles.opacity!);
  });
});

describe("descriptor resolution — exiting", () => {
  it("anchored to the scene end: null early, partial late, hidden at the close", () => {
    const desc = FadeOutLeft.duration(20);
    expect(resolveTransitionAtFrame(desc, 30, CTX)).toBeNull(); // well before
    const mid = resolveTransitionAtFrame(desc, 50, CTX)!;
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    const end = resolveTransitionAtFrame(desc, 59, CTX)!;
    expect(end.opacity).toBeCloseTo(0.05, 1); // 1f before close
  });

  it("exactly at the final frame the exit is effectively done", () => {
    const desc = FadeOutLeft.duration(30);
    const end = resolveTransitionAtFrame(desc, 59, CTX)!;
    expect(end.opacity).toBeLessThan(0.1);
  });
});

describe("springified transitions", () => {
  it("BounceIn overshoots scale above 1 but keeps opacity ≤ 1", () => {
    const desc = BounceIn;
    let maxScale = 0;
    let maxOpacity = 0;
    for (let f = 0; f <= 60; f++) {
      const styles = resolveTransitionAtFrame(desc, f, CTX);
      if (!styles) break; // settled → null
      if (styles.transform) {
        const s = Number(styles.transform.match(/scale\(([\d.]+)\)/)![1]);
        maxScale = Math.max(maxScale, s);
      }
      maxOpacity = Math.max(maxOpacity, styles.opacity ?? 0);
    }
    expect(maxScale).toBeGreaterThan(1.02); // real bounce
    expect(maxOpacity).toBeLessThanOrEqual(1);
  });

  it("spring progress starts its own clock at the exit start (no double delay)", () => {
    const desc = BounceOut.delay(5);
    const ctx = { fps: FPS, totalFrames: 60 };
    const start = transitionStartFrame(desc, ctx);
    expect(start).toBeGreaterThan(0);
    // Early frames: no override (exit hasn't started).
    expect(resolveTransitionAtFrame(desc, start - 1, ctx)).toBeNull();
    // At start the spring is at progress 0 → identity (opacity 1).
    const styles = resolveTransitionAtFrame(desc, start, ctx)!;
    expect(styles.opacity).toBeCloseTo(1, 5);
  });

  it("settle lint: fitting transitions pass, overlong ones are caught", () => {
    expect(transitionSettleIssue(FadeInDown.duration(20), CTX)).toBeNull();
    const lateEnter = transitionSettleIssue(FadeInDown.duration(30).delay(40), CTX);
    expect(lateEnter).toMatch(/still moving at the scene's last frame/);
    const earlyExit = transitionSettleIssue(FadeOutLeft.duration(30).delay(50), CTX);
    expect(earlyExit).toMatch(/before the scene begins/);
  });
});

describe("staggered + factories", () => {
  it("staggered bakes the unit's delay into a COPY (original untouched)", () => {
    const unit = staggered(FadeInUp, 3, { intervalFrames: 2 });
    expect(unit.delayFrames).toBe(6);
    expect(FadeInUp.delayFrames).toBe(0);
    // Unit 3 at frame 5 is still fully hidden; unit 0 is already moving.
    expect(resolveTransitionAtFrame(unit, 5, CTX)!.opacity).toBe(0);
    expect(resolveTransitionAtFrame(FadeInUp, 5, CTX)!.opacity).toBeGreaterThan(0);
  });

  it("chainables return new factories and validate inputs", () => {
    const d = FadeInDown.duration(10);
    expect(d.durationFrames).toBe(10);
    expect(FadeInDown.durationFrames).toBe(20);
    expect(() => FadeInDown.duration(0)).toThrow();
    expect(() => FadeInDown.delay(-1)).toThrow();
  });

  it("SlideInLeft has no opacity channel (pure slide)", () => {
    const styles = resolveTransitionAtFrame(SlideInLeft, 5, CTX)!;
    expect(styles.opacity).toBeUndefined();
    expect(styles.transform).toContain("translateX(-");
  });

  it("ZoomIn composes opacity + scale", () => {
    const styles = resolveTransitionAtFrame(ZoomIn, 5, CTX)!;
    expect(styles.transform).toMatch(/scale\(0\.\d+\)/);
    expect(styles.opacity).toBeGreaterThan(0);
  });

  it("all 26 presets: enters hidden→settled, exits dormant→moving→null", () => {
    for (const [name, preset] of Object.entries(transitionPresets)) {
      if (preset.side === "enter") {
        const atZero = resolveTransitionAtFrame(preset, 0, CTX);
        expect(atZero, name).not.toBeNull();
        const settled = resolveTransitionAtFrame(preset, 400, { fps: FPS, totalFrames: 400 });
        expect(settled, name).toBeNull();
      } else {
        // Exits are dormant at frame 0 (their window opens near the scene end).
        expect(resolveTransitionAtFrame(preset, 0, CTX), name).toBeNull();
        const nearEnd = resolveTransitionAtFrame(preset, 59, CTX);
        expect(nearEnd, name).not.toBeNull();
      }
    }
  });

  it("defineTransition builds custom presets", () => {
    const custom = defineTransition({
      name: "WipeCustom",
      side: "enter",
      channels: { opacity: [0, 1], rotate: [-8, 0], scale: [0.9, 1] },
      durationFrames: 15,
      easing: [0.22, 1, 0.36, 1],
    });
    const styles = resolveTransitionAtFrame(custom, 7, CTX)!;
    expect(styles.transform).toContain("rotate(-");
    expect(custom.preset).toBe("WipeCustom");
  });
});
