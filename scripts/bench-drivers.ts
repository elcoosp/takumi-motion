// Benchmark 2: what actually drives GIF size?
import { typewriterBanner } from "../src/templates/typewriter.js";
import { gradientSweepBanner } from "../src/templates/sweep.ts";
import { renderBanner } from "../src/render.js";
import { formatBytes } from "../src/presets.js";
import type { BannerPreset } from "../src/presets.js";

const p: BannerPreset = { width: 850, height: 200, devicePixelRatio: 1, fps: 20, formats: ["gif"], webpQuality: 82, budgetBytes: 2e6, description: "bench" };

async function bench(name: string, build: () => Promise<{ element: never; timeline: never }>, preset: BannerPreset = p) {
  const { element, timeline } = await build();
  const r = await renderBanner({ node: element, timeline, preset, posters: false });
  console.log(`${name.padEnd(44)} ${String(r.frames).padStart(3)}f  gif ${formatBytes(r.files[0]!.bytes)}`);
}

const swFlat = () => gradientSweepBanner({
  title: "Ship animated banners",
  subtitle: "AUTHOR IN TYPESCRIPT · EVALUATED IN RUST · NO BROWSER",
  background: "#0a1122", // flat, no gradient
});
const swNoGlowColors = () => gradientSweepBanner({
  title: "Ship animated banners",
  subtitle: "AUTHOR IN TYPESCRIPT · EVALUATED IN RUST · NO BROWSER",
  colors: ["#0a1122", "#0a1122"], // glows same color as bg → invisible but still rendered
});
const swFlatNoGlow = () => gradientSweepBanner({
  title: "Ship animated banners",
  subtitle: "AUTHOR IN TYPESCRIPT · EVALUATED IN RUST · NO BROWSER",
  background: "#0a1122",
  colors: ["#0a1122", "#0a1122"],
});
const twFlat = () => typewriterBanner({
  text: "takumi-motion",
  tagline: "MOTION-STYLE ANIMATIONS · RENDERED BY RUST",
  background: "#0c1326",
});

await bench("sweep gradient+glow (current)", () => gradientSweepBanner({
  title: "Ship animated banners",
  subtitle: "AUTHOR IN TYPESCRIPT · EVALUATED IN RUST · NO BROWSER",
}));
await bench("sweep flat bg + glows", swFlat);
await bench("sweep gradient bg + invisible glows", swNoGlowColors);
await bench("sweep flat bg + invisible glows", swFlatNoGlow);
await bench("typewriter gradient+glow (current)", () => typewriterBanner({
  text: "takumi-motion",
  tagline: "MOTION-STYLE ANIMATIONS · RENDERED BY RUST",
}));
await bench("typewriter flat bg + glow", twFlat);
