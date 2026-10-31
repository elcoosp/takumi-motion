// v0.9.1 QA probe — measure scene 2's boxes: where does the heading sit?
import { readFileSync } from "node:fs";
import { captureReactBanner } from "../src/react/capture.js";
import { getSharedRenderer } from "../src/measure.js";
import { fromHtml } from "@takumi-rs/helpers/html";

const banner = (await import("../examples/signals-reel.tsx")).SignalsReelBanner;
const capture = await captureReactBanner(banner, {
  data: JSON.parse(readFileSync(new URL("../examples/signals-data.json", import.meta.url), "utf8")),
});

const renderer = await getSharedRenderer();
const { node } = await fromHtml(capture.htmlFrames[100]);
const tree = await (renderer as any).measure(node, { width: 850, height: 200 });

function walk(n: any, path: string, depth: number): void {
  const m = n.transform as number[];
  const hasText = (n.runs ?? []).length > 0;
  const text = hasText ? ` text=${JSON.stringify((n.runs ?? []).map((r: any) => r.text).join("|").slice(0, 40))}` : "";
  if (depth <= 6 || hasText) {
    console.log(`${"  ".repeat(depth)}${path} x=${m[4]} y=${m[5]} w=${n.width?.toFixed?.(2)} h=${n.height?.toFixed?.(2)}${text}`);
  }
  for (const [i, c] of (n.children ?? []).entries()) walk(c, `${path}/${i}`, depth + 1);
}
walk(tree, "root", 0);
