// takumi-motion v0.2 example — the full README banner kit
// Renders all four built-in templates with v0.2 features (themes, motion
// personalities, Google Fonts), then emits one complete asset kit.
//
// Run: npm run example:banners   (outputs into ./examples/output)

import { renderBanner, formatReport, renderKit, formatKitReport } from "../src/index.js";
import { typewriterBanner, countUpBanner, gradientSweepBanner, cascadeBanner } from "../src/index.js";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outDir = fileURLToPath(new URL("./output/", import.meta.url));
mkdirSync(outDir, { recursive: true });

async function main() {
  // 1. typewriter — typing reveal, hold, terminal backspace, loop.
  //    v0.2: tokyo-night theme, Space Grotesk (Google Font, auto-fetched),
  //    windowed ambient → GIF holds collapse at render time.
  const typewriter = await typewriterBanner({
    text: "takumi-motion",
    tagline: "MOTION-STYLE ANIMATIONS · RENDERED BY RUST",
    theme: "tokyo-night",
    motion: "snappy",
    font: "Space Grotesk",
  });
  const report1 = await renderBanner({
    node: typewriter.element,
    timeline: typewriter.timeline,
    fonts: typewriter.fonts,
    preset: "readme",
    outDir,
    baseName: "banner-typewriter",
  });
  console.log("typewriter (tokyo-night · Space Grotesk):");
  console.log(formatReport(report1));

  // 2. countup — digit-layer counting columns.
  //    v0.2: github-dark theme, Inter, smooth personality (calmer holds).
  const countup = await countUpBanner({
    title: "BY THE NUMBERS",
    stats: [
      { label: "STARS", value: 12400, suffix: "+" },
      { label: "DOWNLOADS / MO", value: 890000 },
      { label: "CONTRIBUTORS", value: 87 },
    ],
    theme: "github-dark",
    motion: "smooth",
    font: { name: "Inter", weight: [400, 700, 800] },
  });
  const report2 = await renderBanner({
    node: countup.element,
    timeline: countup.timeline,
    fonts: countup.fonts,
    preset: "readme",
    outDir,
    baseName: "banner-countup",
  });
  console.log("\ncountup (github-dark · Inter · smooth):");
  console.log(formatReport(report2));

  // 3. sweep — statement banner with overshoot entrances.
  //    v0.2: dracula theme, playful personality (bouncy), Sora.
  const sweep = await gradientSweepBanner({
    title: "BUILD WITH SPRINGS",
    subtitle: "server-side · no browser · 60/60 golden tests",
    theme: "dracula",
    motion: "playful",
    font: "Sora",
  });
  const report3 = await renderBanner({
    node: sweep.element,
    timeline: sweep.timeline,
    fonts: sweep.fonts,
    preset: "readme",
    outDir,
    baseName: "banner-sweep",
  });
  console.log("\nsweep (dracula · Sora · playful):");
  console.log(formatReport(report3));

  // 4. cascade — per-GLYPH orchestration (impossible for single-string
  //    banner services): sunburst theme, mechanical personality.
  const cascade = await cascadeBanner({
    title: "MOTION FOR README",
    tagline: "PER-GLYPH KEYFRAMES BAKED IN RUST",
    theme: "sunburst",
    motion: "mechanical",
    font: "Manrope",
  });
  const report4 = await renderBanner({
    node: cascade.element,
    timeline: cascade.timeline,
    fonts: cascade.fonts,
    preset: "readme",
    outDir,
    baseName: "banner-cascade",
  });
  console.log("\ncascade (sunburst · Manrope · mechanical):");
  console.log(formatReport(report4));

  // 5. one kit — the cascade banner as a full asset set:
  //    readme GIF+WebP, retina WebP, lean GIF, poster + static twin.
  const kit = await renderKit(
    { element: cascade.element, timeline: cascade.timeline, fonts: cascade.fonts },
    { outDir, baseName: "kit-cascade" }
  );
  console.log("\nkit (cascade · full asset set):");
  console.log(formatKitReport(kit));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
