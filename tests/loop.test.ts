// Tests for seamless-loop primitives: fadeWrap, checkLoopSeam, alignLoopPeriod.
import { describe, expect, it } from "vitest";
import { createTimeline } from "../src/timeline.js";
import { fadeWrap, checkLoopSeam, alignLoopPeriod } from "../src/loop.js";
import type { TimelineJSON } from "../src/types.js";

describe("fadeWrap", () => {
  it("adds a single opacity track on the wrap selector and stamps the marker", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#child", { opacity: [0, 1] }, { at: 100, type: "tween", duration: 400 });
    const json = tl.toJSON();
    const wrapped = fadeWrap(json, { selector: "#root", inMs: 200, outMs: 200 });

    expect(wrapped.wrap).toEqual({ selector: "#root" });
    const wrapTracks = wrapped.tracks.filter((t) => t.target === "#root" && t.property === "opacity");
    expect(wrapTracks).toHaveLength(1);
    const track = wrapTracks[0]!;
    expect(track.keyframes).toEqual([0, 1, 1, 0]);
    // durationMs: track end 500ms → 20fps grid keeps 500ms
    const d = wrapped.durationMs;
    expect(track.times).toEqual([0, Math.round((200 / d) * 1000) / 1000, Math.round(((d - 200) / d) * 1000) / 1000, 1]);
  });

  it("extends durationMs when periodMs is larger", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#child", { x: [0, 10] }, { at: 0, type: "tween", duration: 300 });
    const wrapped = fadeWrap(tl.toJSON(), { selector: "#root", inMs: 200, outMs: 200, periodMs: 2000, fps: 20 });
    expect(wrapped.durationMs).toBeGreaterThanOrEqual(2000);
    expect(wrapped.durationMs % 50).toBe(0); // 20fps grid = 50ms frames
  });

  it("rejects conflicting opacity tracks on the wrap target", () => {
    const tl = createTimeline();
    tl.add("#card", { opacity: [0, 1] }, { at: 0 });
    const json = tl.toJSON();
    // wrapping a DIFFERENT selector is fine; wrapping the same one must throw
    expect(() => fadeWrap(json, { selector: "#card", inMs: 100, outMs: 100 })).toThrow(/already has an opacity track/);
    expect(() => fadeWrap(json, { selector: "#other", inMs: 100, outMs: 100 })).not.toThrow();
  });

  it("rejects durations that cannot fit the fades", () => {
    const json: TimelineJSON = { version: 1, durationMs: 400, tracks: [] };
    expect(() => fadeWrap(json, { selector: "#a", inMs: 300, outMs: 300 })).toThrow(/must exceed/);
  });
});

describe("checkLoopSeam — strict mode", () => {
  it("passes for a phase-aligned oscillating timeline", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#pulse", { scale: [1, 1.5] }, {
      at: 0, type: "tween", duration: 500, repeat: Infinity, repeatType: "reverse",
    });
    const aligned = alignLoopPeriod(tl.toJSON());
    // a reverse ping-pong returns to its start value after forward + backward = 1000ms
    expect(aligned.durationMs).toBe(1000);
    const report = checkLoopSeam(aligned);
    expect(report.mode).toBe("strict");
    expect(report.seamless).toBe(true);
  });

  it("fails when an oscillation is cut mid-swing", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#pulse", { scale: [1, 1.5] }, {
      at: 0, type: "tween", duration: 500, repeat: Infinity, repeatType: "reverse",
    });
    const json = tl.toJSON();
    const misaligned: TimelineJSON = { ...json, durationMs: 1175 };
    const report = checkLoopSeam(misaligned);
    expect(report.seamless).toBe(false);
    expect(report.diffs[0]).toMatchObject({ target: "#pulse", property: "scale" });
  });

  it("fails for entrance animations (they need fadeWrap)", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#card", { opacity: [0, 1] }, { at: 0, type: "tween", duration: 300 });
    const report = checkLoopSeam(tl.toJSON());
    expect(report.seamless).toBe(false);
    expect(report.notes[0]).toMatch(/fadeWrap/);
  });
});

describe("checkLoopSeam — wrapped mode", () => {
  it("passes when the wrap opacity is ~0 at both seam ends", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#inner", { opacity: [0, 1] }, { at: 0, type: "tween", duration: 300 });
    const wrapped = fadeWrap(tl.toJSON(), { selector: "#root", inMs: 100, outMs: 100 });
    const report = checkLoopSeam(wrapped);
    expect(report.mode).toBe("wrapped");
    expect(report.seamless).toBe(true);
  });

  it("fails when the wrap track is missing", () => {
    const wrapped = fadeWrap(
      { version: 1, durationMs: 1000, tracks: [] },
      { selector: "#ghost" }
    );
    const broken: TimelineJSON = { ...wrapped, tracks: [] }; // strip the wrap track
    const report = checkLoopSeam(broken);
    expect(report.seamless).toBe(false);
    expect(report.notes[0]).toMatch(/no opacity track/);
  });
});

describe("alignLoopPeriod", () => {
  it("snaps duration to the LCM of all infinite ping-pong cycles", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#a", { scale: [1, 2] }, { at: 0, type: "tween", duration: 400, repeat: Infinity, repeatType: "reverse" });
    tl.add("#b", { opacity: [1, 0.3] }, { at: 0, type: "tween", duration: 600, repeat: Infinity, repeatType: "reverse" });
    const json = tl.toJSON();
    const aligned = alignLoopPeriod(json);
    // cycles are 2× iteration for reverse repeats: 800 and 1200 → LCM 2400
    expect(aligned.durationMs % 800).toBe(0);
    expect(aligned.durationMs % 1200).toBe(0);
    expect(aligned.durationMs).toBeGreaterThanOrEqual(json.durationMs);
    expect(aligned.durationMs).toBe(2400);
  });

  it("rejects phase-shifted infinite tracks", () => {
    const tl = createTimeline({ fps: 20 });
    tl.add("#a", { scale: [1, 2] }, { at: 250, type: "tween", duration: 400, repeat: Infinity });
    expect(() => alignLoopPeriod(tl.toJSON())).toThrow(/phase-shifted/);
  });

  it("returns finite-only timelines unchanged", () => {
    const tl = createTimeline();
    tl.add("#a", { opacity: [0, 1] }, { at: 0 });
    expect(alignLoopPeriod(tl.toJSON())).toEqual(tl.toJSON());
  });
});
