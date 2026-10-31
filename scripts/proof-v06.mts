// scripts/proof-v06.mts — the authoring experience release proof bar.
// Exercises every v0.6 bet end-to-end through the REAL pipeline:
//   1. Authoring lint — silent failures surface as coded report data
//   2. Engine-exact filmstrip — deterministic contact sheets, all paths
//   3. FitText og-image — measure-exact text, extents audited clean
//   4. Kit banner — CountUp/Typewriter/Glow rendered byte-deterministically
//   5. Init scaffold — the generated React banner renders out of the box
// …plus visual QA: outputs written into examples-output/v06/.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";

import { renderReactBanner } from "../src/react-render.js";
import { renderWithAudit } from "../src/with-audit.js";
import { renderFilmstrip } from "../src/filmstrip.js";
import { renderStill } from "../src/still.js";
import {
  defineBanner,
  Banner,
  Scene,
  Layer,
  Fill,
  FitText,
  CountUp,
  Typewriter,
  Glow,
  useSpring,
} from "../src/react/index.js";
import type { LintCode } from "../src/lint.js";

const OUT = "examples-output/v06";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// 1. The authoring lint — the kebab banner that used to break silently
// ---------------------------------------------------------------------------

console.log("\n1. authoring lint (TM_* codes as report data)");
{
  const KebabBanner = defineBanner(function KebabBanner() {
    return createElement(
      Banner,
      { width: 640, height: 200, fps: 30, background: "#0b1220" },
      createElement(
        Scene,
        { duration: 4 },
        // The v0.5 gotcha, intentionally left in: kebab key + numeric value.
        createElement("div", { style: { "line-height": 1.4, color: "#f1f5f9", fontSize: 28 } as never }, "lint me"),
      ),
    );
  });
  const report = await renderReactBanner({ banner: KebabBanner, formats: ["webp"] });
  const codes: LintCode[] = report.lint.map((w) => w.code);
  check("TM_KEBAB_STYLE detected", codes.includes("TM_KEBAB_STYLE"), codes.join(", "));
  check("lint channel is data (JSON-serializable)", JSON.parse(JSON.stringify(report.lint)).length === report.lint.length);
}

// ---------------------------------------------------------------------------
// 2. Engine-exact filmstrip
// ---------------------------------------------------------------------------

console.log("\n2. engine-exact filmstrip (renderStill × N on a contact sheet)");
{
  function StripTitle() {
    const x = useSpring({ from: -60, to: 0, stiffness: 170, damping: 16 });
    return createElement(
      "div",
      { style: { color: "#f1f5f9", fontSize: 42, fontWeight: 700, transform: `translateX(${x.toFixed(2)}px)` } },
      "filmstrip proof",
    );
  }
  const StripBanner = defineBanner(function StripBanner() {
    return createElement(
      Banner,
      { width: 640, height: 180, fps: 30, background: "#0b1220" },
      createElement(Scene, { duration: 40 }, createElement(Fill, { style: { alignItems: "center", justifyContent: "center" } }, createElement(StripTitle))),
    );
  });
  const a = await renderFilmstrip({ banner: StripBanner, count: 6, outDir: OUT, baseName: "filmstrip-react" });
  const b = await renderFilmstrip({ banner: StripBanner, count: 6 });
  check("react filmstrip deterministic", a.html.equals(b.html), `${a.frames.length} frames, ${a.columns}×${a.rows} grid → ${a.path ?? "(buffer)"}`);
  check("cells differ (spring moved)", !a.pngs[0].equals(a.pngs[a.pngs.length - 1]));

  const htmlStrip = await renderFilmstrip({
    html: '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:40px;color:#fff">og card</div>',
    width: 400,
    height: 200,
    durationMs: 1000,
    fps: 30,
    count: 4,
    outDir: OUT,
    baseName: "filmstrip-html",
  });
  check("html filmstrip renders", htmlStrip.pngs.every((p) => p.length > 0) && htmlStrip.html.length > 0);

  const { createTimeline } = await import("../src/timeline.js");
  const { h } = await import("../src/jsx.js");
  const tl = createTimeline({ fps: 30 });
  tl.add(".mover", { x: [0, 80] }, { type: "tween", duration: 800 });
  const declStrip = await renderFilmstrip({
    node: h("div", { className: "mover", style: { width: 60, height: 60, backgroundColor: "#38bdf8", borderRadius: 12 } }),
    timeline: tl.toJSON(),
    width: 400,
    height: 200,
    count: 5,
    outDir: OUT,
    baseName: "filmstrip-declarative",
  });
  check("declarative filmstrip renders", declStrip.pngs.length === 5);
}

// ---------------------------------------------------------------------------
// 3. FitText og-image — overflow impossible by construction
// ---------------------------------------------------------------------------

console.log("\n3. FitText og-image (measure-exact, audit clean)");
{
  const OgBanner = defineBanner(function OgBanner() {
    return createElement(
      Banner,
      { width: 1200, height: 630, fps: 30, background: "transparent" },
      createElement(
        Scene,
        { duration: 2 },
        createElement(
          Fill,
          { style: { flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "0 64px" } },
          createElement(FitText, { text: "takumi-motion v0.6", max: 88, fontWeight: 700, style: { color: "#f1f5f9" } }),
          createElement(FitText, { text: "the authoring experience release", max: 40, style: { color: "#94a3b8" } }),
          // NOTE: no <Glow> here — blur on an ALPHA canvas bands into hard
          // rings (takumi raster finding, docs/UPSTREAM.md). Glows belong on
          // solid backgrounds; transparent og-images get flat accents.
          createElement("div", { style: { width: 96, height: 6, backgroundColor: "#38bdf8", borderRadius: 3 } }),
        ),
      ),
    );
  });
  const still = await renderStill({ banner: OgBanner, frame: 0, outDir: OUT, baseName: "og-fittext" });
  check("og still renders (transparent)", still.png.length > 0, `${still.physicalWidth}×${still.physicalHeight}, ${(still.bytes / 1024).toFixed(1)}kB`);

  const report = await renderReactBanner({ banner: OgBanner, formats: [], posters: [0] });
  const hard = report.extents.violations.filter((v) => !v.decorative);
  check("extents audit clean (no hard violations)", hard.length === 0, `${report.extents.chunksChecked} chunks audited`);
}

// ---------------------------------------------------------------------------
// 4. Kit banner — the README workhorses
// ---------------------------------------------------------------------------

console.log("\n4. kit banner (CountUp + Typewriter + Glow, byte-deterministic)");
{
  const KitBanner = defineBanner(function KitBanner() {
    return createElement(
      Banner,
      { width: 850, height: 200, fps: 30, background: "#0b1220" },
      createElement(
        Layer,
        { bottom: true },
        createElement(Glow, { x: 140, y: 100, size: 280, color: "#38bdf8" }),
        createElement(Glow, { x: 700, y: 60, size: 220, color: "#c084fc", opacity: 0.1 }),
      ),
      createElement(
        Scene,
        { duration: 60 },
        createElement(
          Fill,
          { style: { flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 8, padding: "0 48px" } },
          createElement(CountUp, {
            to: 337,
            durationFrames: 30,
            delayFrames: 4,
            format: (n: number) => `${Math.round(n)} tests`,
            style: { color: "#f1f5f9", fontSize: 44, fontWeight: 700 },
          }),
          createElement(Typewriter, {
            text: "green. determinism intact.",
            durationFrames: 22,
            delayFrames: 26,
            cursorPeriodFrames: 12,
            style: { color: "#94a3b8", fontSize: 20 },
          }),
        ),
      ),
    );
  });
  const a = await renderReactBanner({ banner: KitBanner, formats: ["gif", "webp"], outDir: OUT, baseName: "kit-banner" });
  const b = await renderReactBanner({ banner: KitBanner, formats: ["gif", "webp"] });
  check("kit banner renders gif+webp", a.files.length === 2, a.files.map((f) => `${f.format} ${(f.bytes / 1024).toFixed(0)}kB`).join(" + "));
  check("byte-deterministic", a.files.every((f, i) => f.buffer.equals(b.files[i].buffer)));
  const audit = await renderWithAudit({ banner: KitBanner, formats: ["webp"] });
  check("audit passes", audit.exitCode === 0, `exit ${audit.exitCode}`);
}

// ---------------------------------------------------------------------------
// 5. Init scaffold — the generated banner renders out of the box
// ---------------------------------------------------------------------------

console.log("\n5. init scaffold renders (dogfooded Fill/FitText/CountUp/Glow)");
{
  const scaffoldDir = join(OUT, "scaffold");
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["dist/cli.js", "init", scaffoldDir, "--react"], { stdio: "pipe" });
  // Render the scaffold through the CLI itself — the loader, fonts, and
  // report pipeline all get exercised exactly as a fresh user would.
  const stdout = execFileSync(
    process.execPath,
    ["dist/cli.js", "render", join(scaffoldDir, "banner.tsx"), "--json", "--out", OUT, "--format", "webp"],
    { stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" },
  );
  const report = JSON.parse(stdout) as { files: Array<{ bytes: number }>; lint: Array<{ code: string }> };
  check("scaffold banner renders via CLI", report.files.length === 1 && report.files[0].bytes > 0, `${(report.files[0].bytes / 1024).toFixed(1)}kB`);
  check("scaffold has zero lint findings", report.lint.length === 0, report.lint.map((w) => w.code).join(",") || "clean");
}

console.log(failures === 0 ? "\nALL PROOFS PASS" : `\n${failures} PROOF(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
