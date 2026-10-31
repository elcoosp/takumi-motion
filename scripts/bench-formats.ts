// Benchmark: GIF/WebP size vs dpr/fps for the three templates (fixed compiler)
import { typewriterBanner } from "../src/templates/typewriter.js";
import { countUpBanner } from "../src/templates/countup.js";
import { gradientSweepBanner } from "../src/templates/sweep.js";
import { compileTimeline } from "../src/compile.js";
import { renderBanner } from "../src/render.js";
import { formatBytes } from "../src/presets.js";
import type { BannerPreset } from "../src/presets.js";

const renderer = undefined; // renderBanner creates its own per call — warm enough per variant

async function bench(name: string, build: () => Promise<{ element: never; timeline: never }>, preset: BannerPreset, fps?: number) {
  const { element, timeline } = await build();
  const report = await renderBanner({
    node: element,
    timeline,
    preset,
    ...(fps ? { fps } : {}),
    posters: false,
  });
  const sizes = report.files.map((f) => `${f.format} ${formatBytes(f.bytes)}`).join("  ");
  console.log(`${name.padEnd(34)} ${String(report.frames).padStart(3)}f  ${sizes}`);
}

const readme1x: BannerPreset = { width: 850, height: 200, devicePixelRatio: 1, fps: 24, formats: ["gif", "webp"], webpQuality: 82, budgetBytes: 2e6, description: "bench" };
const readme2x: BannerPreset = { ...readme1x, devicePixelRatio: 2, formats: ["gif", "webp"] };
const leanFps: BannerPreset = { ...readme1x, fps: 16 };

const tw = () => typewriterBanner({ text: "takumi-motion", tagline: "MOTION-STYLE ANIMATIONS · RENDERED BY RUST" });
const cu = () => countUpBanner({ title: "OPEN SOURCE, MEASURED", stats: [
  { label: "GITHUB STARS", value: 12400, suffix: "+" },
  { label: "WEEKLY DOWNLOADS", value: 188000 },
  { label: "MS PER FRAME", value: 0.8, decimals: 1 },
] });
const sw = () => gradientSweepBanner({ title: "Ship animated banners", subtitle: "AUTHOR IN TYPESCRIPT · EVALUATED IN RUST · NO BROWSER" });

console.log("— @1x 24fps —");
await bench("typewriter 1x", tw, readme1x);
await bench("countup 1x", cu, readme1x);
await bench("sweep 1x", sw, readme1x);
console.log("— @2x 24fps —");
await bench("typewriter 2x (webp)", tw, readme2x);
await bench("countup 2x (webp)", cu, readme2x);
await bench("sweep 2x (webp)", sw, readme2x);
console.log("— @1x 16fps —");
await bench("typewriter 1x 16fps", tw, leanFps);
await bench("countup 1x 16fps", cu, leanFps);
await bench("sweep 1x 16fps", sw, leanFps);
