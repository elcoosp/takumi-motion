// v0.9 Bet A probe — Donut transform-paint geometry through the REAL renderer.
//
// Asserts (raw RGBA pixels):
//   1. clip-path on the SAME element as transform rotates WITH the element
//      (the two-half mask sweep depends on it);
//   2. end state value=0.25 → progress [0°,90°): top-right = fill, rest = track;
//   3. start state (before draw) → full track;
//   4. settled state value=1 → full ring fill.
//
// Run: cd upload/v08-extracted && npx tsx scripts/probe-donut.mts
import { createElement } from "react";
import { captureReactBanner } from "../src/react/capture.js";
import { Banner, Scene, Fill, Donut, defineBanner } from "../src/react/index.js";
import { fromHtml } from "@takumi-rs/helpers/html";

const FILL = [0, 255, 0]; // #00ff00 progress
const TRACK = [255, 0, 0]; // #ff0000 track
const HOLE = [0, 0, 255]; // #0000ff hole

const banner = defineBanner(function DonutProbeBanner() {
  return createElement(
    Banner,
    { width: 200, height: 200, fps: 20, background: "#101010" },
    createElement(Scene, { duration: 60 },
      createElement(Fill, { style: { justifyContent: "center", alignItems: "center" } },
        createElement(Donut, {
          value: 0.25, size: 120, thickness: 18,
          color: "#00ff00", trackColor: "#ff0000", holeColor: "#0000ff",
          drawDurationFrames: 36, drawDelayFrames: 4,
        }),
      ),
    ),
  );
});

/** Point on the ring at `deg` (0° = 12 o'clock, clockwise), mid-thickness. */
function ringPoint(deg: number, size: number): [number, number] {
  const cx = size / 2;
  const mid = size / 2 - 18 / 2; // ring mid-radius from center
  const rad = (deg * Math.PI) / 180;
  return [cx + mid * Math.sin(rad), cx - mid * Math.cos(rad)];
}

function pixelAt(raw: Buffer, x: number, y: number): [number, number, number] {
  const data = raw;
  // Banner canvas is 200×200 logical; donut is centered by Fill (flex center).
  const px = Math.round((200 - 120) / 2 + x);
  const py = Math.round((200 - 120) / 2 + y);
  const idx = (py * 200 + px) * 4;
  return [data[idx], data[idx + 1], data[idx + 2]];
}

const near = (a: [number, number, number], b: [number, number, number], tol = 40): boolean =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

const capture = await captureReactBanner(banner as never);

async function framePixels(frame: number): Promise<Buffer> {
  const chunkIndex = capture.chunks.findIndex(
    (c, i) => frame >= c.startFrame && (i === capture.chunks.length - 1 || frame < capture.chunks[i + 1].startFrame),
  );
  const { node } = await fromHtml(capture.chunks[chunkIndex].html);
  const { Renderer } = await import("takumi-js/node");
  const renderer = new Renderer();
  return renderer.render(node as never, { width: 200, height: 200, format: "raw" } as never) as never as Buffer;
}

let failures = 0;
function check(label: string, got: [number, number, number], want: [number, number, number]) {
  const ok = near(got, want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got rgb(${got.join(",")}) want rgb(${want.join(",")})`);
}

// Frame 40: delay 4 + 36 frames → settled at value×360 = 90°.
const settled = await framePixels(40);
console.log(`--- settled (angle=90°): progress [0°,90°) ---`);
check("ring @45°  = fill", pixelAt(settled, ...ringPoint(45, 120)), FILL);
check("ring @135° = track", pixelAt(settled, ...ringPoint(135, 120)), TRACK);
check("ring @270° = track", pixelAt(settled, ...ringPoint(270, 120)), TRACK);
check("center   = hole", pixelAt(settled, 60, 60), HOLE);

// Frame 0 (before draw): masks fully cover → all track.
const start = await framePixels(0);
console.log(`--- start (angle=0): full track ---`);
check("ring @45°  = track", pixelAt(start, ...ringPoint(45, 120)), TRACK);
check("ring @135° = track", pixelAt(start, ...ringPoint(135, 120)), TRACK);

// Full-circle case: value=1 settled → all fill.
const bannerFull = defineBanner(function DonutFullBanner() {
  return createElement(
    Banner,
    { width: 200, height: 200, fps: 20, background: "#101010" },
    createElement(Scene, { duration: 60 },
      createElement(Fill, { style: { justifyContent: "center", alignItems: "center" } },
        createElement(Donut, {
          value: 1, size: 120, thickness: 18,
          color: "#00ff00", trackColor: "#ff0000", holeColor: "#0000ff",
          drawDurationFrames: 36, drawDelayFrames: 4,
        }),
      ),
    ),
  );
});
const captureFull = await captureReactBanner(bannerFull as never);
const chunkIndexFull = captureFull.chunks.length - 1;
const { node: nodeFull } = await fromHtml(captureFull.chunks[chunkIndexFull].html);
const { Renderer } = await import("takumi-js/node");
const renderer2 = new Renderer();
const full = await renderer2.render(nodeFull as never, { width: 200, height: 200, format: "raw" } as never) as never as Buffer;
console.log(`--- full (value=1, angle=360): all fill ---`);
check("ring @45°  = fill", pixelAt(full, ...ringPoint(45, 120)), FILL);
check("ring @135° = fill", pixelAt(full, ...ringPoint(135, 120)), FILL);
check("ring @270° = fill", pixelAt(full, ...ringPoint(270, 120)), FILL);

console.log(failures === 0 ? "\nDONUT GEOMETRY: ALL PASS" : `\nDONUT GEOMETRY: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
