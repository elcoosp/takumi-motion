// takumi-motion example — animated OG card
// Author with a Motion-compatible API in React JSX, render an animated
// GIF + WebP + APNG + poster PNGs through Takumi's Rust engine.
//
// Run: npm run example   (outputs into ./examples/output)

import { fromJsx } from "@takumi-rs/helpers/jsx";
import { Renderer } from "takumi-js/node";
import { createTimeline, compileTimeline } from "../src/index.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const W = 600;
const H = 315; // 1.91:1 OG ratio at half scale
const FPS = 20;

const jsx = {
  $$typeof: Symbol.for("react.element"),
  type: "div",
  props: {
    style: {
      width: W,
      height: H,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: 36,
      backgroundImage: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 55%, #312e81 100%)",
      color: "#f8fafc",
      fontFamily: "sans-serif",
      overflow: "hidden",
      position: "relative",
    },
    children: [
      // top row: badge + logo mark
      {
        $$typeof: Symbol.for("react.element"),
        type: "div",
        props: {
          style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
          children: [
            {
              $$typeof: Symbol.for("react.element"),
              type: "div",
              props: {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: "rgba(99, 102, 241, 0.22)",
                  border: "1px solid rgba(129, 140, 248, 0.5)",
                  borderRadius: 999,
                  padding: "6px 14px",
                },
                children: [
                  {
                    $$typeof: Symbol.for("react.element"),
                    type: "div",
                    props: {
                      className: "badge-dot",
                      style: {
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: "#818cf8",
                      },
                    },
                  },
                  {
                    $$typeof: Symbol.for("react.element"),
                    type: "div",
                    props: {
                      className: "badge",
                      style: { fontSize: 14, fontWeight: 600, letterSpacing: 1, color: "#c7d2fe" },
                      children: "TAKUMI × MOTION",
                    },
                  },
                ],
              },
            },
            {
              $$typeof: Symbol.for("react.element"),
              type: "div",
              props: {
                className: "mark",
                style: {
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: "#6366f1",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#fff",
                  boxShadow: "0 8px 24px rgba(99, 102, 241, 0.45)",
                },
                children: "M",
              },
            },
          ],
        },
      },
      // middle: title + subtitle
      {
        $$typeof: Symbol.for("react.element"),
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "column", gap: 10 },
          children: [
            {
              $$typeof: Symbol.for("react.element"),
              type: "div",
              props: {
                className: "title",
                style: { fontSize: 42, fontWeight: 800, lineHeight: 1.1, color: "#ffffff" },
                children: "Server-side animated OG images",
              },
            },
            {
              $$typeof: Symbol.for("react.element"),
              type: "div",
              props: {
                className: "subtitle",
                style: { fontSize: 18, color: "#a5b4fc" },
                children: "Motion-authored springs, evaluated by a Rust-native clock",
              },
            },
          ],
        },
      },
      // bottom: staggered feature rows
      {
        $$typeof: Symbol.for("react.element"),
        type: "div",
        props: {
          style: { display: "flex", gap: 12 },
          children: ["GIF / WebP / APNG", "Springs in Rust", "No browser"].map((label, i) => ({
            $$typeof: Symbol.for("react.element"),
            type: "div",
            props: {
              className: `chip-${i}`,
              style: {
                backgroundColor: "rgba(148, 163, 184, 0.14)",
                border: "1px solid rgba(148, 163, 184, 0.3)",
                borderRadius: 10,
                padding: "8px 14px",
                fontSize: 14,
                color: "#e2e8f0",
              },
              children: label,
            },
          })),
        },
      },
    ],
  },
};

async function main() {
  const renderer = new Renderer();

  // ---- author: Motion-compatible timeline over the JSX tree ----
  const tl = createTimeline({ fps: FPS });

  tl.add(jsx as any, {}, { at: 0 }); // register root as-is (no-op track safety)
  const timeline = tl; // root element returned unchanged (no animated props)

  // badge dot: looping pulse (infinite alternate)
  tl.add(".badge-dot", { scale: [1, 1.5], opacity: [1, 0.55] }, {
    at: 0,
    type: "tween",
    duration: 600,
    repeat: Infinity,
    repeatType: "reverse",
  });

  // logo mark: spring pop-in with natural overshoot + endless float
  tl.add(".mark", { scale: [0, 1], rotate: [-14, 0] }, { at: 80, type: "spring", stiffness: 260, damping: 14 });
  tl.add(".mark", { y: [0, -5] }, { at: 900, type: "tween", duration: 900, repeat: Infinity, repeatType: "reverse" });

  // title: slide up + settle
  tl.add(".title", { y: [26, 0], opacity: [0, 1] }, { at: 150, type: "spring", stiffness: 210, damping: 22 });
  tl.add(".subtitle", { y: [18, 0], opacity: [0, 1] }, { at: "<+90", type: "spring", stiffness: 210, damping: 24 });

  // badge text: fade
  tl.add(".badge", { opacity: [0, 1] }, { at: "<+60", type: "tween", duration: 350 });

  // chips: staggered spring entrances
  tl.add([".chip-0", ".chip-1", ".chip-2"], { y: [16, 0], opacity: [0, 1] }, {
    at: "<+120",
    type: "spring",
    stiffness: 300,
    damping: 24,
    stagger: 110,
  });

  const json = timeline.toJSON();

  // ---- compile: timeline JSON → Takumi structured CSS (springs baked on the fps grid) ----
  const compiled = compileTimeline(json, { fps: FPS });
  console.log(`timeline: ${json.tracks.length} tracks, ${Math.round(json.durationMs)}ms`);
  console.log(`compiled: ${compiled.css.length} CSS entries, ${Math.round(compiled.durationMs)}ms @ ${FPS}fps`);

  // ---- render: single napi call, Rust evaluates every frame at time_ms ----
  const { node } = await fromJsx(jsx as any);

  const outDir = fileURLToPath(new URL("./output/", import.meta.url));
  mkdirSync(outDir, { recursive: true });

  const t0 = performance.now();
  const gif = await renderer.renderAnimation({
    scenes: [{ node, durationMs: compiled.durationMs }],
    width: W,
    height: H,
    fps: FPS,
    format: "gif",
    css: compiled.css as any,
  });
  const gifMs = (performance.now() - t0).toFixed(1);

  const t1 = performance.now();
  const webp = await renderer.renderAnimation({
    scenes: [{ node, durationMs: compiled.durationMs }],
    width: W,
    height: H,
    fps: FPS,
    format: "webp",
    quality: 90,
    css: compiled.css as any,
  });
  const webpMs = (performance.now() - t1).toFixed(1);

  const apng = await renderer.renderAnimation({
    scenes: [{ node, durationMs: compiled.durationMs }],
    width: W,
    height: H,
    fps: FPS,
    format: "apng",
    css: compiled.css as any,
  });

  // poster frames (static, time-sampled)
  const posterStart = await renderer.render(node, {
    width: W, height: H, format: "png", timeMs: 0, css: compiled.css as any,
  });
  const posterEnd = await renderer.render(node, {
    width: W, height: H, format: "png", timeMs: compiled.durationMs - 1, css: compiled.css as any,
  });

  const frameCount = Math.round((compiled.durationMs / 1000) * FPS);
  writeFileSync(new URL("./output/og-card.gif", import.meta.url), gif);
  writeFileSync(new URL("./output/og-card.webp", import.meta.url), webp);
  writeFileSync(new URL("./output/og-card.png", import.meta.url), apng);
  writeFileSync(new URL("./output/poster-frame-0.png", import.meta.url), posterStart);
  writeFileSync(new URL("./output/poster-final.png", import.meta.url), posterEnd);

  console.log(`rendered ${frameCount} frames:`);
  console.log(`  GIF  ${gif.length.toLocaleString()} bytes (${gifMs}ms)`);
  console.log(`  WebP ${webp.length.toLocaleString()} bytes (${webpMs}ms)`);
  console.log(`  APNG ${apng.length.toLocaleString()} bytes`);
  console.log(`  posters: ${posterStart.length + posterEnd.length} bytes`);
  console.log("outputs in examples/output/");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
