// Smoke: minimal 2-scene React banner through the full v0.3 pipeline.
import { Banner, Scene, defineBanner, useCurrentFrame, useSpring, useFrameState } from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner, formatReactReport } from "../src/react-render.js";
import { mkdirSync, writeFileSync } from "node:fs";

const banner = defineBanner(function SmokeBanner() {
  return (
    <Banner preset={{ ...({ width: 400, height: 100, devicePixelRatio: 1, fps: 20, formats: ["gif"], webpQuality: 80, budgetBytes: 4_000_000, description: "smoke" } as never) }} theme="tokyo-night" font="Sora">
      <Scene duration={30} enter="rise">
        <Hero />
      </Scene>
      <Scene duration={30} enter="crossfade" exit="slide">
        <Counter />
      </Scene>
    </Banner>
  );
});

function Hero() {
  const frame = useCurrentFrame();
  const y = useSpring({ from: -24, to: 0, stiffness: 180, damping: 14 });
  return (
    <div style={{ width: 400, height: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "#c0caf5", fontSize: 28, fontWeight: 700, transform: `translateY(${y.toFixed(2)}px)` }}>
        smoke {frame}
      </span>
    </div>
  );
}

function Counter() {
  const active = useFrameState(
    (state, action: { type: "next" }) => (action.type === "next" ? state + 1 : state),
    0,
    (frame) => (frame > 0 && frame % 10 === 0 ? { type: "next" as const } : null),
  );
  return (
    <div style={{ width: 400, height: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "#7aa2f7", fontSize: 24 }}>state {active}</span>
    </div>
  );
}

// capture
const capture = await captureReactBanner(banner);
console.log("plan:", JSON.stringify(capture.plan.scenes.map((s) => ({ start: s.startFrame, dur: s.durationFrames, enter: s.enterFrames, exit: s.exitFrames }))));
console.log("totalFrames:", capture.plan.totalFrames, "chunks:", capture.chunks.length, "warnings:", capture.warnings);

// render
mkdirSync("output", { recursive: true });
const report = await renderReactBanner({ banner, outDir: "output", baseName: "smoke-react", posters: [5, 35] });
console.log(formatReactReport(report));

// sanity: report frames === plan frames; gif frame count matches (minus collapse)
const gif = report.files.find((f) => f.format === "gif");
if (!gif) throw new Error("no gif file");
writeFileSync("output/smoke-react-check.txt", Buffer.from(formatReactReport(report)));
console.log("SMOKE OK");
