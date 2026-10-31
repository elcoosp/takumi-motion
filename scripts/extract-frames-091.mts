// v0.9.1 QA probe — extract specific timeline frames from the rendered reel
// WebP (1:1 with the timeline) as PNGs for visual inspection.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// PIL via a tiny python interop is overkill — use sharp? Not installed.
// Simplest: render frames straight from the capture pipeline instead.

const { captureReactBanner } = await import("../src/react/capture.js");
const { getSharedRenderer } = await import("../src/measure.js");
const { fromHtml } = await import("@takumi-rs/helpers/html");

const mod = await import("../examples/signals-reel.tsx");
const banner = mod.SignalsReelBanner;

// Frames of interest:
//  60  scene 1 settled (chart)
//  86  push transition mid (scene1→2)
//  89  push transition last
//  92  scene 2 single (list settled)
//  100 list hold
//  107 morph flight start (switch at 84+22=106 → first flight frame 106)
//  112 flight early-mid
//  118 flight mid (content flip zone)
//  126 flight late
//  134 settled grid
//  160 grid hold
//  190 material scene
//  260 finale
//  313 wrap tail start
//  316 final frame (seam)
const FRAMES = [60, 86, 89, 92, 100, 106, 107, 112, 118, 126, 134, 160, 190, 260, 313, 316];

const capture = await captureReactBanner(banner, {
  data: JSON.parse(readFileSync(new URL("../examples/signals-data.json", import.meta.url), "utf8")),
});
console.log(`plan: ${capture.plan.totalFrames} frames, scene starts:`, capture.plan.scenes.map((s) => s.startFrame));

const renderer = await getSharedRenderer();
import { mkdirSync } from "node:fs";
mkdirSync(new URL("../examples/out/qa-091/", import.meta.url).pathname, { recursive: true });

for (const f of FRAMES) {
  if (f >= capture.htmlFrames.length) continue;
  const { node } = await fromHtml(capture.htmlFrames[f]);
  const png = await (renderer as any).render(node, {
    width: 850,
    height: 200,
  });
  const path = new URL(`../examples/out/qa-091/f${String(f).padStart(3, "0")}.png`, import.meta.url).pathname;
  readFileSync; // noop
  (await import("node:fs")).writeFileSync(path, Buffer.from(png));
  console.log(`f${f} → ${path}`);
}
