// QA: extract full-res poster frames from the signals reel.
import { SignalsReelBanner, SIGNALS_CANVAS } from "../examples/signals-reel.tsx";
import { readFileSync } from "node:fs";
import { renderReactBanner } from "../src/react-render.js";

const data = JSON.parse(readFileSync(new URL("../examples/signals-data.json", import.meta.url), "utf8"));
const report = await renderReactBanner({
  banner: SignalsReelBanner as never,
  data,
  width: SIGNALS_CANVAS.width,
  height: SIGNALS_CANVAS.height,
  fps: SIGNALS_CANVAS.fps,
  formats: [],
  posters: [150, 260],
  outDir: new URL("../examples/out/", import.meta.url).pathname,
  baseName: "qa-frame",
} as never);
for (const p of report.posters) console.log(`f${p.frame} → ${p.path} (${p.bytes}B)`);
