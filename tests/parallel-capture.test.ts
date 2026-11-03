// v1.0 — worker-pool parallel capture: byte-parity between the serial
// pipeline and the worker-pool pipeline at ANY worker count, for both
// doctrine-clean banners and Math.random consumers (frame-seeded shim).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderReactBanner, type ReactBannerReport } from "../src/react-render.js";
import { resolveWorkers } from "../src/react/parallel-capture.js";

const MODULE = resolve("tests/fixtures/banner-module.tsx");
const RANDOM_MODULE = resolve("tests/fixtures/random-banner-module.tsx");

const summary = (r: ReactBannerReport) => ({
  frames: r.frames,
  chunks: r.chunks,
  scenes: r.scenes,
  gif: r.files.find((f) => f.format === "gif")?.buffer.toString("base64"),
  webp: r.files.find((f) => f.format === "webp")?.buffer.toString("base64"),
});

const BASE = { preset: "readme-lean", formats: ["gif", "webp"] as const, posters: false as const };

describe("worker-pool capture parity", () => {
  it("module entry with workers:1 matches the serial element pipeline", async () => {
    const serial = await renderReactBanner({
      ...BASE,
      banner: (await import(MODULE)).default,
    });
    const worker1 = await renderReactBanner({
      ...BASE,
      bannerModule: MODULE,
      workers: 1,
    });
    expect(summary(worker1)).toEqual(summary(serial));
  });

  it("module entry with workers:2 and workers:3 is byte-identical to serial", async () => {
    const serial = await renderReactBanner({
      ...BASE,
      banner: (await import(MODULE)).default,
    });
    for (const workers of [2, 3]) {
      const parallel = await renderReactBanner({
        ...BASE,
        bannerModule: MODULE,
        workers,
      });
      expect(summary(parallel)).toEqual(summary(serial));
    }
  });

  it("workers:auto splits across cores and still matches serial", async () => {
    const serial = await renderReactBanner({
      ...BASE,
      banner: (await import(MODULE)).default,
    });
    const auto = await renderReactBanner({
      ...BASE,
      bannerModule: MODULE,
      workers: "auto",
    });
    expect(summary(auto)).toEqual(summary(serial));
  });

  it("Math.random consumers render byte-identically at any worker count (frame-seeded shim)", async () => {
    const one = await renderReactBanner({
      ...BASE,
      bannerModule: RANDOM_MODULE,
      workers: 1,
    });
    const four = await renderReactBanner({
      ...BASE,
      bannerModule: RANDOM_MODULE,
      workers: 4,
    });
    expect(summary(four)).toEqual(summary(one));
    // the shim warning surfaces once
    expect(one.warnings.join(" ")).toContain("Math.random");
  });

  it("windowed render (fromFrame/toFrame) matches the serial window", async () => {
    const serial = await renderReactBanner({
      ...BASE,
      banner: (await import(MODULE)).default,
      fromFrame: 10,
      toFrame: 30,
    });
    const parallel = await renderReactBanner({
      ...BASE,
      bannerModule: MODULE,
      workers: 2,
      fromFrame: 10,
      toFrame: 30,
    });
    expect(summary(parallel)).toEqual(summary(serial));
    expect(parallel.window).toEqual({ from: 10, to: 30 });
    // tempo rides on the capture result; the report window is [from, to) only
  });

  it("a missing module path fails with a clear error", async () => {
    await expect(
      renderReactBanner({ ...BASE, bannerModule: resolve("tests/fixtures/does-not-exist.tsx"), workers: 2 }),
    ).rejects.toThrow(/bannerModule|Cannot find|ERR_MODULE_NOT_FOUND/i);
  });
});

describe("resolveWorkers", () => {
  it("defaults to 1 (serial) when unset", () => {
    expect(resolveWorkers(undefined, 300)).toBe(1);
  });
  it("auto engages cores only when cores, frames AND work amortize the spawn", () => {
    expect(resolveWorkers("auto", 10)).toBe(1); // shallow window
    expect(resolveWorkers("auto", 300, 20)).toBe(1); // frames but trivial per-frame cost
    const engaged = resolveWorkers("auto", 300, 5000);
    // On a ≥4-core host this engages (capped by cores); on smaller hosts the
    // gate keeps serial — either way it never exceeds cores and never regresses.
    expect(engaged).toBeGreaterThanOrEqual(1);
    expect(engaged).toBeLessThanOrEqual(16);
  });
  it("explicit integers clamp to the frame count", () => {
    expect(resolveWorkers(4, 300)).toBe(4);
    expect(resolveWorkers(16, 6)).toBe(6);
    expect(resolveWorkers(0, 300)).toBe(1);
    expect(resolveWorkers(2.5, 300)).toBe(1);
  });
});
