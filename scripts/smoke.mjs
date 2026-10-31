// Smoke test: verify takumi native binding + fromJsx + renderAnimation end-to-end
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { Renderer } from "takumi-js";
import { writeFileSync } from "node:fs";

const r = new Renderer();
const el = {
  type: "div",
  props: { style: { width: 100, height: 100, backgroundColor: "#3b82f6" } },
  $$typeof: Symbol.for("react.element"),
};
const res = await fromJsx(el);
console.log("fromJsx keys:", Object.keys(res));
console.log("node type:", res.node?.type ?? JSON.stringify(res).slice(0, 300));

const buf = await r.renderAnimation({
  scenes: [{ node: res.node, durationMs: 1000 }],
  width: 200,
  height: 200,
  fps: 10,
  format: "gif",
  css: [
    {
      keyframes: "fade",
      steps: [
        { offset: "0", style: { opacity: 0 } },
        { offset: "1", style: { opacity: 1 } },
      ],
    },
    { selector: "div", style: { animation: "fade 1000ms linear both" } },
  ],
});
console.log("GIF bytes:", buf.length, "magic:", buf.slice(0, 6).toString("latin1"));
writeFileSync(new URL("../smoke.gif", import.meta.url), buf);

// Also verify timeMs static rendering works
const png = await r.render(res.node, { width: 200, height: 200, format: "png", timeMs: 500 });
console.log("PNG bytes:", png.length, "magic:", png.slice(0, 4).toString("latin1"));
console.log("SMOKE OK");
