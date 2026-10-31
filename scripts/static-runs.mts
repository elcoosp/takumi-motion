// v0.9.1 QA probe — dead-frame detector: longest run of byte-identical
// consecutive frames (the reel's own doctrine: nothing static for long).
import { readFileSync } from "node:fs";
import { captureReactBanner } from "../src/react/capture.js";

const banner = (await import("../examples/signals-reel.tsx")).SignalsReelBanner;
const capture = await captureReactBanner(banner, {
  data: JSON.parse(readFileSync(new URL("../examples/signals-data.json", import.meta.url), "utf8")),
});

const frames = capture.htmlFrames;
const fps = capture.plan.fps;
type Run = { start: number; len: number };
const runs: Run[] = [];
let start = 0;
for (let i = 1; i <= frames.length; i++) {
  if (i === frames.length || frames[i] !== frames[start]) {
    runs.push({ start, len: i - start });
    start = i;
  }
}
runs.sort((a, b) => b.len - a.len);
console.log(`total frames: ${frames.length} @${fps}fps`);
console.log("longest static runs (top 6):");
for (const r of runs.slice(0, 6)) {
  const seconds = (r.len / fps).toFixed(2);
  console.log(`  f${r.start}..f${r.start + r.len - 1}  ${r.len}f  ${seconds}s`);
}
const dynamic = runs.length;
console.log(`static runs: ${dynamic} (dynamic frames: ${frames.length})`);
