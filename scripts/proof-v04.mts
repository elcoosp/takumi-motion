// scripts/proof-v04.mts — the v0.4 "general engine" proof bar.
//
// Zero banner assumptions: three wildly different outputs through one engine —
//   1. a 1080×1080 transparent, memory-driven (useNoise) data-viz loop
//   2. a 64×64 sprite-sheet atlas for a game/UI spinner
//   3. a 1200×630 animated OG card authored as RAW HTML + CSS (no React)
// …plus byte-determinism on every path, and renderWithAudit as the embeddable
// programmatic interface.

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Banner,
  Scene,
  defineBanner,
  useCurrentFrame,
  useNoise,
  useSpring,
  renderWithAudit,
  renderHtmlAnimation,
  renderReactBanner,
} from "../src/index.js";
import { createElement } from "react";

const OUT = new URL("../examples-output/v04-proof/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------------------
// 1. Transparent square data-viz (React runtime, alpha canvas, memory-driven)
// ---------------------------------------------------------------------------

console.log("\n[1/3] 1080×1080 transparent data-viz (React + useNoise + useSpring)");

const DataViz = defineBanner(function DataViz() {
  return createElement(
    Banner,
    { width: 1080, height: 1080, dpr: 1, fps: 30, background: "transparent" },
    createElement(
      Scene,
      { duration: 45 },
      createElement(() => {
        const f = useCurrentFrame();
        const spring = useSpring({ from: 0, to: 1, stiffness: 120, damping: 14 });
        const bars = [0, 1, 2, 3, 4, 5].map((i) => {
          const jitter = useNoise(`bar-${i}`, { amplitude: 18, frequency: 0.15 });
          const h = 220 + i * 90 + jitter + spring * 120;
          return createElement("div", {
            key: i,
            style: {
              position: "absolute",
              left: `${140 + i * 140}px`,
              bottom: "120px",
              width: "84px",
              height: `${Math.round(h)}px`,
              backgroundColor: i % 2 ? "#7aa2f7" : "#bb9af7",
              borderRadius: "10px",
            },
          });
        });
        return createElement(
          "div",
          { style: { position: "absolute", inset: 0 } },
          bars,
          createElement("div", {
            style: {
              position: "absolute", left: "120px", top: "90px",
              color: "#c0caf5", fontSize: "44px", fontWeight: 700,
              fontFamily: "sans-serif",
            },
          }),
        );
      }),
    ),
  );
});

{
  const t0 = performance.now();
  const { report, audit, exitCode } = await renderWithAudit({
    banner: DataViz,
    formats: ["webp"],
    outDir: OUT,
    baseName: "dataviz",
    sequence: true,
  });
  const dt = performance.now() - t0;
  writeFileSync(join(OUT, "dataviz.webp"), report.files[0].buffer);
  check("transparent webp rendered", report.files[0].bytes > 0, `${(report.files[0].bytes / 1024).toFixed(0)}kB in ${dt.toFixed(0)}ms`);
  check("surface is user-given", report.surface.customized && report.surface.width === 1080 && report.surface.background === null);
  check("byte-deterministic (audit)", audit.determinism.deterministic === true, audit.determinism.detail);
  check("extents clean", (audit.extents?.hardFailures ?? 0) === 0, `${audit.extents?.violations.length ?? 0} findings`);
  check("sequence exported", report.sequence?.frameCount === 45, `${report.sequence?.frameCount} frames`);
  check("exit code 0", exitCode === 0);
}

// ---------------------------------------------------------------------------
// 2. Sprite sheet (game/UI spinner, tiny surface)
// ---------------------------------------------------------------------------

console.log("\n[2/3] 64×64 sprite-sheet spinner (engine output extension)");

{
  const Spinner = defineBanner(function Spinner() {
    return createElement(
      Banner,
      { width: 64, height: 64, dpr: 1, fps: 12, background: "transparent" },
      createElement(
        Scene,
        { duration: 12 },
        createElement(() => {
          const f = useCurrentFrame();
          return createElement("div", {
            style: {
              width: "40px", height: "40px", margin: "12px",
              border: "6px solid rgba(122,162,247,0.25)",
              borderTopColor: "#7aa2f7",
              borderRadius: "9999px",
              transform: `rotate(${f * 30}deg)`,
            },
          });
        }),
      ),
    );
  });

  const report = await renderReactBanner({
    banner: Spinner,
    formats: [],
    posters: false,
    outDir: OUT,
    spriteSheet: { columns: 4 },
    baseName: "spinner",
  });
  const s = report.spriteSheet!;
  check("atlas grid math", s.meta.columns === 4 && s.meta.rows === 3 && s.meta.frameCount === 12);
  check("atlas PNG written", s.paths.png !== null && s.bytes > 0, `${s.bytes}B`);
  const meta = JSON.parse(readFileSync(s.paths.json!, "utf8"));
  check("metadata JSON valid", meta.version === 1 && meta.frames.length === 12 && meta.css.includes("steps("));
  // determinism: render the atlas twice
  const second = await renderReactBanner({ banner: Spinner, formats: [], posters: false, spriteSheet: { columns: 4 }, baseName: "spinner" });
  check("atlas byte-deterministic", second.spriteSheet!.png.equals(s.png));
}

// ---------------------------------------------------------------------------
// 3. Raw HTML OG card (no React at all)
// ---------------------------------------------------------------------------

console.log("\n[3/3] 1200×630 OG card from raw HTML + CSS (no React)");

const ogHtml = `
<div style="width:1200px;height:630px;background-color:#0b0e14;display:flex;align-items:center;justify-content:center;">
  <div style="display:flex;flex-direction:column;align-items:center;">
    <div class="glow" style="width:180px;height:8px;background-color:#7aa2f7;"></div>
    <div style="color:#c0caf5;font-size:72px;font-weight:800;font-family:sans-serif;margin-top:36px;">takumi-motion</div>
    <div style="color:#7982a9;font-size:30px;font-family:sans-serif;margin-top:14px;">any component. any surface. one Rust engine.</div>
  </div>
</div>`;

const ogCss = `
@keyframes sweep { 0% { width: 60px; opacity: 0.2; } 50% { width: 420px; opacity: 1; } 100% { width: 60px; opacity: 0.2; } }
.glow { animation: sweep 1.5s ease-in-out infinite; }`;

{
  const t0 = performance.now();
  const report = await renderHtmlAnimation({
    html: ogHtml,
    css: ogCss,
    width: 1200, height: 630, fps: 20, frames: 30,
    formats: ["gif", "webp"],
    outDir: OUT,
    baseName: "og-card",
  });
  const dt = performance.now() - t0;
  const gif = report.files.find((f) => f.format === "gif")!;
  const webp = report.files.find((f) => f.format === "webp")!;
  check("gif rendered from raw html", gif.bytes > 0, `${(gif.bytes / 1024).toFixed(0)}kB`);
  check("webp rendered from raw html", webp.bytes > 0, `${(webp.bytes / 1024).toFixed(0)}kB`);
  check("render time sane", dt < 30000, `${dt.toFixed(0)}ms`);
  // byte determinism
  const rerun = await renderHtmlAnimation({ html: ogHtml, css: ogCss, width: 1200, height: 630, fps: 20, frames: 30, formats: ["webp"] });
  check("html path byte-deterministic", rerun.files[0].buffer.equals(webp.buffer));
}

// ---------------------------------------------------------------------------

console.log(failures === 0 ? "\nPROOF BAR: ALL PASS" : `\nPROOF BAR: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
