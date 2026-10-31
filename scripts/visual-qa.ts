// Visual QA: render key frames of each template as PNGs for inspection.
import { Renderer } from "takumi-js/node";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { compileTimeline } from "../src/compile.js";
import { typewriterBanner, countUpBanner, gradientSweepBanner } from "../src/index.js";
import { writeFileSync } from "node:fs";

const r = new Renderer();
const FPS = 20;

async function snap(name, banner, times, w, h) {
  const { node } = await fromJsx(banner.element);
  const compiled = compileTimeline(banner.timeline, { fps: FPS });
  for (const t of times) {
    const png = await r.render(node, {
      width: w, height: h, format: "png", timeMs: t, devicePixelRatio: 1,
      css: compiled.css,
    });
    writeFileSync(new URL(`../examples/output/qa-${name}-${t}ms.png`, import.meta.url), png);
  }
  console.log(name, "duration:", compiled.durationMs);
}

async function main() {
  await snap("typewriter", await typewriterBanner({ text: "takumi-motion", tagline: "MOTION-STYLE ANIMATIONS · RENDERED BY RUST", fps: FPS }), [800, 1600, 2400], 850, 200);
  await snap("countup", await countUpBanner({ title: "OPEN SOURCE, MEASURED", stats: [{ label: "STARS", value: 12400, suffix: "+" }, { label: "DOWNLOADS", value: 188000 }], fps: FPS }), [700, 1300, 2200], 850, 200);
  await snap("sweep", await gradientSweepBanner({ title: "Ship animated banners", subtitle: "AUTHOR IN TYPESCRIPT · EVALUATED IN RUST", fps: FPS }), [600, 1600, 2600], 850, 200);
  console.log("done");
}

main();
