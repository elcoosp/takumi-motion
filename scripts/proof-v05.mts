// scripts/proof-v05.mts — the v0.5 "composition & stills" proof bar.
//
//   1. a Series-composed kinetic-typography banner (SplitText + stagger
//      springs + Loop ticker) rendered at concurrency 1 AND 8 — outputs must
//      be byte-identical (the bounded-parallel determinism contract)
//   2. renderStill() og-images: 1200×630 from raw HTML (colored + transparent)
//      and from the React banner above — the single-frame first-class path
//   3. renderWithAudit over the composed banner (embeddability stays intact)
// …plus visual QA: every poster/still written into examples-output/v05-proof/.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Banner,
  Scene,
  Layer,
  Series,
  SeriesSequence,
  Loop,
  SplitText,
  defineBanner,
  useCurrentFrame,
  useSpring,
  staggeredSpringFor,
  renderReactBanner,
  renderStill,
  renderWithAudit,
} from "../src/index.js";
import { createElement } from "react";

const OUT = new URL("../examples-output/v05-proof/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------------------
// The composed banner — Series windows, staggered kinetic type, Loop ticker
// ---------------------------------------------------------------------------

const FPS = 30;

function StaggeredTitle({ text, top }: { text: string; top: number }): ReturnType<typeof createElement> {
  return createElement(
    "div",
    { style: { position: "absolute", left: "70px", top: `${top}px`, fontSize: "64px", fontWeight: 700, color: "#c0caf5" } },
    createElement(SplitText, {
      text,
      by: "chars",
      renderUnit: (unit, ctx) =>
        unit.isSpace
          ? createElement("span", { key: unit.index, style: { display: "inline-block", width: "18px" } })
          : createElement(
              "span",
              {
                key: unit.index,
                style: {
                  display: "inline-block",
                  opacity: staggeredSpringFor(unit.index, ctx.frame, FPS, { intervalFrames: 2, stiffness: 170, damping: 20 }),
                  transform: `translateY(${(1 - staggeredSpringFor(unit.index, ctx.frame, FPS, { intervalFrames: 2, stiffness: 170, damping: 20 })) * 22}px)`,
                },
              },
              unit.text,
            ),
    }),
  );
}

function Ticker(): ReturnType<typeof createElement> {
  const frame = useCurrentFrame();
  const words = ["compose", "still", "parallel", "deterministic"];
  const word = words[Math.floor(frame / 12) % words.length]!;
  const slide = useSpring({ from: 24, to: 0, stiffness: 260, damping: 24, delayFrames: 0 });
  return createElement(
    "div",
    { style: { position: "absolute", left: "70px", top: "168px", fontSize: "26px", color: "#7aa2f7", transform: `translateY(${slide}px)` } },
    createElement(
      Loop,
      { durationInFrames: 12, key: "tick" },
      () => createElement("span", { key: "w" }, word),
    ),
    `  — loop iteration ${Math.floor(frame / 12)}`,
  );
}

const CompositionBanner = defineBanner(function CompositionBanner() {
  return createElement(
    Banner,
    { width: 960, height: 240, dpr: 1, fps: FPS, background: "#1a1b26" },
    createElement(
      Layer,
      { bottom: true, key: "rail" },
      createElement("div", {
        key: "bar",
        style: { position: "absolute", left: 0, bottom: 0, width: "100%", height: "8px", backgroundColor: "#7aa2f7" },
      }),
    ),
    createElement(
      Series,
      { key: "series" },
      createElement(
        SeriesSequence,
        { durationInFrames: 75, enter: "crossfade", exit: "crossfade", key: "a" },
        createElement(StaggeredTitle, { text: "v0.5 ships", top: 60, key: "t1" }),
        createElement(Ticker, { key: "tick" }),
      ),
      createElement(
        SeriesSequence,
        { durationInFrames: 75, enter: "crossfade", exit: "crossfade", key: "b" },
        createElement(StaggeredTitle, { text: "compose & still", top: 60, key: "t2" }),
        createElement(
          () => {
            const frame = useCurrentFrame();
            return createElement("div", {
              key: "counter",
              style: { position: "absolute", left: "70px", top: "168px", fontSize: "26px", color: "#bb9af7" },
              // deterministic per-frame drift (chunker sees honest motion)
              opacity: 0.6 + 0.4 * Math.abs(Math.sin(frame / 7)),
            }, "stills are first-class now");
          },
          { key: "note" },
        ),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// 1. Bounded-parallel determinism at concurrency 1 vs 8
// ---------------------------------------------------------------------------

console.log("\n[1/3] Series/Loop/SplitText banner — concurrency 1 vs 8 (byte-identical)");

const one = await renderReactBanner({ banner: CompositionBanner, formats: ["gif", "webp"], concurrency: 1, posters: [30, 90] });
const many = await renderReactBanner({ banner: CompositionBanner, formats: ["gif", "webp"], concurrency: 8, posters: [30, 90] });

check(
  "windows stack via Series (2 sequences, overlap-clamped)",
  one.scenes === 2 && one.frames === 143, // 250ms @30fps → round(7.499…) = 7 overlap frames
  `${one.scenes} scenes, ${one.frames} frames, ${one.chunks} chunks (${one.mergedFrames} holds merged)`,
);
check(
  "concurrency 1 vs 8 → byte-identical GIF",
  one.files[0]!.buffer.equals(many.files[0]!.buffer),
  `${one.files[0]!.bytes} bytes`,
);
check(
  "concurrency 1 vs 8 → byte-identical WebP",
  one.files[1]!.buffer.equals(many.files[1]!.buffer),
  `${one.files[1]!.bytes} bytes`,
);
check(
  "posters byte-identical across concurrency",
  one.posters.every((p, i) => p.buffer.equals(many.posters[i]!.buffer)),
  `${one.posters.length} posters`,
);
check(
  "timings block present (observability)",
  one.timings.totalMs > 0 && one.timings.captureMs > 0 && one.timings.parseMs >= 0 && one.timings.auditMs >= 0,
  `capture ${one.timings.captureMs.toFixed(0)}ms · parse ${one.timings.parseMs.toFixed(0)}ms · audit ${one.timings.auditMs.toFixed(0)}ms · encode ${one.timings.encodeMs.toFixed(0)}ms`,
);

writeFileSync(join(OUT, "composition-c1.gif"), one.files[0]!.buffer);
writeFileSync(join(OUT, "composition-c8.webp"), many.files[1]!.buffer);
for (const p of one.posters) writeFileSync(join(OUT, `composition-poster-f${p.frame}.png`), p.buffer);

// ---------------------------------------------------------------------------
// 2. renderStill — the og-image path on every source
// ---------------------------------------------------------------------------

console.log("\n[2/3] renderStill() — 1200×630 og-images on all three source paths");

const ogHtml =
  '<div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 90px;background-color:#1a1b26;">' +
  '<div style="font-size:76px;font-weight:800;color:#c0caf5;">takumi-motion v0.5</div>' +
  '<div style="font-size:34px;color:#7aa2f7;margin-top:18px;">compose · still · parallel — deterministic by Rust</div>' +
  '<div style="margin-top:44px;width:220px;height:10px;background-color:#bb9af7;border-radius:5px;"></div>' +
  "</div>";

const ogColored = await renderStill({ html: ogHtml, width: 1200, height: 630 });
const ogTransparent = await renderStill({
  html: ogHtml.replace("#1a1b26", "transparent"),
  width: 1200,
  height: 630,
  background: "transparent",
});
const ogReact = await renderStill({ banner: CompositionBanner, width: 1200, height: 630, frame: 40 });
const ogFrame0 = await renderStill({ banner: CompositionBanner, width: 1200, height: 630, frame: 0 });

check("html still renders 1200×630 PNG", ogColored.physicalWidth === 1200 && ogColored.png[1] === 0x50, `${ogColored.bytes} bytes`);
check("transparent still keeps background=null report", ogTransparent.background === null, `${ogTransparent.bytes} bytes`);
check("react still renders from the banner", ogReact.source === "react" && ogReact.png[1] === 0x50, `frame ${ogReact.frame}, ${ogReact.bytes} bytes`);
check("different frames → different stills (animated banner)", !ogFrame0.png.equals(ogReact.png), `f0 ${ogFrame0.bytes} vs f40 ${ogReact.bytes} bytes`);

for (const [name, still] of [
  ["og-html.png", ogColored],
  ["og-html-transparent.png", ogTransparent],
  ["og-react-f40.png", ogReact],
] as const) {
  writeFileSync(join(OUT, name), still.png);
}

// ---------------------------------------------------------------------------
// 3. renderWithAudit — embeddability intact on the composed banner
// ---------------------------------------------------------------------------

console.log("\n[3/3] renderWithAudit — audit-as-data still routes the composed banner");

const audited = await renderWithAudit({ banner: CompositionBanner, skipDeterminismProbe: true });
check("audit routes to the react source", audited.audit.source === "react", `exit ${audited.exitCode}`);
check("no extent hard-failures", (audited.audit.extents?.hardFailures ?? 0) === 0, `${audited.audit.extents?.checked} chunks audited`);
check("budget within 4MB default", !audited.audit.budget.overBudget, `${audited.audit.budget.totalBytes} bytes total`);

console.log(`\n${failures === 0 ? "ALL PROOFS PASS" : `${failures} PROOF(S) FAILED`} → outputs in examples-output/v05-proof/`);
process.exit(failures === 0 ? 0 : 1);
