// Behavior tests for the authoring API, compiler, and evaluator.
import { describe, expect, it } from "vitest";
import { createTimeline } from "../src/timeline.js";
import { compileTimeline } from "../src/compile.js";
import { evaluateAt } from "../src/evaluate.js";
import type { AnimationRule, StyleRule } from "@takumi-rs/helpers";

describe("createTimeline authoring", () => {
  it("builds tracks with sequence `at` positions", () => {
    const tl = createTimeline();
    tl.add("#card", { x: [-24, 0], opacity: [0, 1] }, { at: 0 });
    tl.add("#badge", { scale: [0.6, 1] }, { at: "<+150" });
    const json = tl.toJSON();
    expect(json.version).toBe(1);
    expect(json.tracks).toHaveLength(3);
    const badgeTrack = json.tracks.find((t) => t.target === "#badge")!;
    expect(badgeTrack.transition.delay).toBe(150);
  });

  it("applies Motion default transitions (scale → critically damped 550/30)", () => {
    const tl = createTimeline();
    tl.add("#b", { scale: [0, 1] }, { at: 0 });
    const track = tl.toJSON().tracks[0]!;
    expect(track.transition.type).toBe("spring");
    expect(track.transition.stiffness).toBe(550);
    expect(track.transition.damping).toBe(30);
  });

  it("applies Motion default transitions (x → spring 500/25)", () => {
    const tl = createTimeline();
    tl.add("#b", { x: [0, 100] }, { at: 0 });
    const track = tl.toJSON().tracks[0]!;
    expect(track.transition.type).toBe("spring");
    expect(track.transition.stiffness).toBe(500);
    expect(track.transition.damping).toBe(25);
  });

  it("classes React element targets and returns the clone", () => {
    const tl = createTimeline();
    const el = { type: "div", props: { className: "card" }, $$typeof: Symbol.for("react.element") };
    const replaced = tl.add(el as any, { opacity: [0, 1] }, { at: 0 }) as any;
    expect(replaced.props.className).toBe("card tm-1");
    expect(tl.toJSON().tracks[0]!.target).toBe(".tm-1");
  });

  it("labels work for at references", () => {
    const tl = createTimeline();
    tl.add("#a", { opacity: [0, 1] }, { at: 0 });
    tl.label("afterCard");
    tl.add("#b", { opacity: [0, 1] }, { at: "afterCard" as any });
    expect(tl.toJSON().tracks[1]!.transition.delay).toBe(0);
  });
});

describe("compileTimeline", () => {
  it("emits AnimationRule + StyleRule with comma-joined longhands", () => {
    const tl = createTimeline();
    tl.add("#card", { x: [-24, 0], opacity: [0, 1] }, { at: 0, type: "tween", duration: 500 });
    const { css, durationMs } = compileTimeline(tl.toJSON(), { fps: 30 });

    const rules = css.filter((c) => "keyframes" in (c as object)) as AnimationRule[];
    const styleRules = css.filter((c) => "selector" in (c as object)) as StyleRule[];

    expect(rules).toHaveLength(2); // x + opacity
    expect(styleRules).toHaveLength(1);
    const sr = styleRules[0]!;
    expect(sr.selector).toBe("#card");
    expect((sr.style!.animationName as string).split(", ")).toHaveLength(2);
    expect(sr.style!.animationFillMode).toBe("both, both");
    expect(durationMs).toBeGreaterThan(0);

    for (const rule of rules) {
      expect(rule.steps[0]!.offset).toMatch(/%$/);
      expect(rule.steps[rule.steps.length - 1]!.offset).toBe("100%");
    }
  });

  it("merges transform props into one transform track with aligned functions", () => {
    const tl = createTimeline();
    tl.add("#card", { x: [0, 100], rotate: [0, 8] }, { at: 0, type: "tween", duration: 600 });
    const { css } = compileTimeline(tl.toJSON(), { fps: 30 });
    const rules = css.filter((c) => "keyframes" in (c as object)) as AnimationRule[];
    expect(rules).toHaveLength(1);
    const step = rules[0]!.steps[Math.floor(rules[0]!.steps.length / 2)]!;
    expect(step.style!.transform).toContain("translateX(");
    expect(step.style!.transform).toContain("rotate(");
  });

  it("bakes springs on the fps grid and lands exactly on target", () => {
    const tl = createTimeline();
    tl.add("#a", { x: [0, 100] }, { at: 0, type: "spring", stiffness: 170, damping: 20 });
    const { css, durationMs } = compileTimeline(tl.toJSON(), { fps: 30 });
    const rule = css.filter((c) => "keyframes" in (c as object))[0] as AnimationRule;
    const last = rule.steps[rule.steps.length - 1]!;
    expect(last.style!.transform).toContain("translateX(100px)");
    // settle of a 170/20 spring quantizes to the 50ms scan; duration grid-aligned
    expect(durationMs).toBeGreaterThanOrEqual(600);
  });

  it("bakes infinite repeats across the whole timeline (finite formats)", () => {
    const tl = createTimeline();
    tl.add("#a", { y: [0, -8] }, { at: 0, type: "tween", duration: 500, repeat: Infinity, repeatType: "reverse" });
    const json = tl.toJSON();
    // one infinite iteration defines the scene duration (grid-aligned)
    expect(json.durationMs).toBeGreaterThan(0);
    const { css } = compileTimeline(json, { fps: 30 });
    const styleRule = css.filter((c) => "selector" in (c as object))[0] as StyleRule;
    expect(styleRule.style!.animationIterationCount).toBe("1");
    // the fold sampler oscillates: value at t=250 is mid-rise, at t=750 mid-fall
    const at250 = evaluateAt(json, 250, { rawTransforms: true })["#a"]!.y as number;
    const at750 = evaluateAt(json, 750, { rawTransforms: true })["#a"]!.y as number;
    expect(at250).toBeLessThan(-2);
    expect(at750).toBeLessThan(-2);
  });
});

describe("evaluateAt reference evaluator", () => {
  it("undershoots before delay and overshoots mid-spring", () => {
    const tl = createTimeline();
    tl.add("#a", { x: [0, 100] }, { at: 0, type: "spring", stiffness: 100, damping: 10 });
    const json = tl.toJSON();

    // At t=0 x=0 is the default → Motion's buildTransform collapses it to "none"
    const before = evaluateAt(json, 0);
    expect(before["#a"]!.transform).toBe("none");

    // default spring overshoots mid-flight
    const mid = evaluateAt(json, 600);
    const m = (mid["#a"]!.transform as string).match(/translateX\(([\d.]+)px\)/)!;
    expect(parseFloat(m[1]!)).toBeGreaterThan(100); // overshoot

    const end = evaluateAt(json, 3000);
    expect(end["#a"]!.transform).toBe("translateX(100px)");
  });

  it("colors interpolate through the squared-channel blend", () => {
    const tl = createTimeline();
    tl.add("#a", { backgroundColor: ["#000000", "#ffffff"] }, { at: 0, type: "tween", duration: 1000, ease: "linear" });
    const json = tl.toJSON();
    const half = evaluateAt(json, 500)["#a"]!.backgroundColor as string;
    // Motion's mixLinearColor: sqrt(0.5·255²) = 180 → #b4b4b4 (not the naive sRGB lerp #808080)
    expect(half).toBe("#b4b4b4");
  });

  it("respects repeat folding for reverse", () => {
    const tl = createTimeline();
    tl.add("#a", { x: [0, 100] }, { at: 0, type: "tween", duration: 500, repeat: Infinity, repeatType: "reverse" });
    const json = tl.toJSON();
    // iteration 0: 0→100; iteration 1 (500-1000ms): back 100→0
    const at750 = evaluateAt(json, 750, { rawTransforms: true });
    expect(at750["#a"]!.x).toBeCloseTo(50, 1);
  });
});
