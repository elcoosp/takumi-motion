/** @jsxImportSource react */
// examples/probe-css.tsx — v0.8.1 pre-flight: verify the CSS constructs the
// demo/layout fixes depend on, through the SAME pipeline as the demo.
//   1. transformOrigin ("left center" + "0% 50%") honored on scaled nodes
//   2. em-unit width/height on inline-block spans (Typewriter cursor)
//   3. backgroundColor: currentColor
//   4. fontVariantNumeric: "tabular-nums"
// Run: npx tsx examples/probe-css.tsx  → out/probe-css/*.png

import { createElement } from "react";
import { Banner, Scene, Fill } from "../src/react/index.js";
import { renderReactBanner } from "../src/react-render.js";

function Probe() {
  return (
    <Banner width={1280} height={300} fps={20} theme="tokyo-night" fonts={{ name: "Sora", weight: 700 }}>
      <Scene duration={4}>
        <Fill style={{ flexDirection: "column", justifyContent: "center", gap: 10, paddingLeft: 64 }}>
          {/* 1. origin left-center: with scale 1.3 the text must stay anchored
              at the LEFT (x = padding), not pushed off-canvas. */}
          <div style={{ transformOrigin: "left center", transform: "scale(1.3)", fontSize: 40, color: "#e2e8f0" }}>
            origin-left · stays anchored
          </div>
          <div style={{ transformOrigin: "0% 50%", transform: "scale(1.3)", fontSize: 40, color: "#7dd3fc" }}>
            origin-0% · stays anchored
          </div>
          {/* 2+3. cursor shape: em-sized block, currentColor background */}
          <div style={{ fontSize: 30, color: "#94a3b8", whiteSpace: "pre" }}>
            {"cursor: "}
            <span
              style={{
                display: "inline-block",
                width: "0.55em",
                height: "0.9em",
                backgroundColor: "currentColor",
                marginLeft: "0.1em",
              }}
            />
          </div>
          {/* 4. tabular numerals */}
          <div style={{ fontSize: 30, color: "#e2e8f0", fontVariantNumeric: "tabular-nums" }}>430 · 26 · 11</div>
        </Fill>
      </Scene>
    </Banner>
  );
}

const report = await renderReactBanner({
  banner: Probe as never,
  outDir: new URL("./out/probe-css/", import.meta.url).pathname,
  baseName: "probe-css",
  formats: ["gif"],
  posters: [1],
});
console.log(report.posters ?? report);
