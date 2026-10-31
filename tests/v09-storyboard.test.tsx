// tests/v09-storyboard.test.tsx — v0.9 Bet F: the contact sheet.
// sampleFrames determinism, renderStoryboard through the real renderer
// (PNG bytes, grid geometry, metadata), byte determinism, and the
// wrap-seam visibility a choreographer needs.

import { describe, expect, it } from "vitest";
import { createElement, type ReactNode } from "react";

import {
  Banner,
  Scene,
  defineBanner,
} from "../src/react/index.js";
import { renderStoryboard, sampleFrames } from "../src/storyboard.js";

const canvas = { width: 200, height: 100, fps: 20 };

function bannerOf(children: ReactNode) {
  return defineBanner(function V09StoryboardBanner() {
    return <Banner {...canvas}>{children}</Banner>;
  }) as never;
}

describe("sampleFrames", () => {
  it("samples evenly and stays in bounds", () => {
    expect(sampleFrames(60, 6)).toEqual([0, 12, 24, 35, 47, 59]);
    expect(sampleFrames(10, 20)).toHaveLength(10);
    expect(sampleFrames(1, 8)).toEqual([0]);
  });
});

describe("renderStoryboard", () => {
  it("renders a labeled grid through the real renderer", async () => {
    const sheet = await renderStoryboard({
      banner: bannerOf(
        <>
          <Scene duration={20}>
            <div style={{ fontSize: 30, color: "#f8fafc" }}>alpha</div>
          </Scene>
          <Scene duration={20} enter="crossfade">
            <div style={{ fontSize: 30, color: "#f8fafc" }}>beta</div>
          </Scene>
        </>,
      ),
      frames: 6,
      columns: 3,
    });
    // PNG magic.
    expect(sheet.png.subarray(1, 4).toString("latin1")).toBe("PNG");
    // Grid geometry: 6 cells in 3 columns → 2 rows.
    expect(sheet.cells).toHaveLength(6);
    expect(sheet.columns).toBe(3);
    expect(sheet.rows).toBe(2);
    expect(sheet.cellWidth).toBe(100);
    expect(sheet.cellHeight).toBe(50);
    // Cells span both scenes (scene labels resolved from the plan).
    const scenes = new Set(sheet.cells.map((c) => c.scene));
    expect(scenes.size).toBe(2);
    // Substantially non-trivial bytes (real rasters + labels, not a blank sheet).
    expect(sheet.png.length).toBeGreaterThan(1500);
  });

  it("is byte-deterministic across runs", async () => {
    const banner = bannerOf(
      <Scene duration={20}>
        <div style={{ fontSize: 24, color: "#f8fafc" }}>stable</div>
      </Scene>,
    );
    const a = await renderStoryboard({ banner, frames: 4, columns: 2 });
    const b = await renderStoryboard({ banner, frames: 4, columns: 2 });
    expect(a.png.equals(b.png)).toBe(true);
    expect(a.cells).toEqual(b.cells);
  });

  it("writes PNG + JSON sidecars when outDir is given", async () => {
    const { mkdtempSync, existsSync, readFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "tm-storyboard-"));
    const sheet = await renderStoryboard({
      banner: bannerOf(
        <Scene duration={16}>
          <div>cells</div>
        </Scene>,
      ),
      frames: 4,
      columns: 4,
      outDir: dir,
      baseName: "sheet",
    });
    expect(existsSync(join(dir, "sheet.png"))).toBe(true);
    expect(existsSync(join(dir, "sheet.json"))).toBe(true);
    const meta = JSON.parse(readFileSync(join(dir, "sheet.json"), "utf8"));
    expect(meta.cells).toHaveLength(4);
    expect(meta.columns).toBe(4);
    // The on-disk PNG matches the returned buffer.
    expect(readFileSync(join(dir, "sheet.png")).equals(sheet.png)).toBe(true);
  });
});
