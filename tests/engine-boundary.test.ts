// v1.0 — engine time boundary regressions: fractional frame grids
// (takumi 2.19's napi layer takes i64 ms; a float timeMs is InvalidArg).
import { describe, expect, it } from "vitest";
import { renderStill } from "../src/still.js";

const HTML = `<div style="width:600px;height:315px;background-color:#0b1220;display:flex;align-items:center;justify-content:center;"><span style="font-size:40px;color:#f8fafc">t</span></div>`;

describe("renderStill: fractional frame grids", () => {
  it("html path rounds 1000/30 frame times to whole ms (30fps, odd frames)", async () => {
    const still = await renderStill({ html: HTML, width: 600, height: 315, fps: 30, frame: 1 });
    expect(still.timeMs).toBe(33); // 33.333… → 33
  });

  it("html path rounds 1000/60 frame times (60fps, frame 7)", async () => {
    const still = await renderStill({ html: HTML, width: 600, height: 315, fps: 60, frame: 7 });
    expect(still.timeMs).toBe(117); // 116.66… → 117
  });
});
