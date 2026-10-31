// Probe: verify takumi width/height = DEVICE px convention + measure() runs API
import { Renderer } from "takumi-js/node";
import { fromJsx } from "@takumi-rs/helpers/jsx";
import { writeFileSync } from "node:fs";

const h = (type, props = {}, ...children) => {
  const flat = children.flat().filter((c) => c !== null && c !== undefined);
  const p = { ...props };
  if (flat.length === 1) p.children = flat[0];
  else if (flat.length > 1) p.children = flat;
  return { $$typeof: Symbol.for("react.element"), type, props: p };
};

const renderer = new Renderer();

// 1. measure(): text run widths at dpr 1
const textEl = h("div", {
  style: { fontSize: 56, fontWeight: 800, letterSpacing: 2, whiteSpace: "pre", color: "#fff" },
  children: "takumi-motion",
});
const { node } = await fromJsx(textEl);
const m = await renderer.measure(node, { width: 4096, height: 512 });
console.log("measure@56px: node", m.width, "x", m.height, "runs:", JSON.stringify(m.runs));

const textEl2 = h("div", {
  style: { fontSize: 32, fontWeight: 800, letterSpacing: 0, whiteSpace: "pre", color: "#fff" },
  children: "takumi-motion",
});
const { node: node2 } = await fromJsx(textEl2);
const m2 = await renderer.measure(node2, { width: 4096, height: 512 });
console.log("measure@32px: node", m2.width, "x", m2.height, "runs:", JSON.stringify(m2.runs));

// 2. corrected-convention render: 850x200 CSS design on 1700x400 device canvas
const el = h("div", {
  style: {
    width: 850, height: 200, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", boxSizing: "border-box",
    padding: 32, backgroundColor: "#0b1020", fontFamily: "sans-serif",
  },
  children: [
    h("div", { style: { fontSize: 56, fontWeight: 800, color: "#f8fafc", letterSpacing: 2 } }, "takumi-motion"),
    h("div", { style: { fontSize: 15, color: "#94a3b8", letterSpacing: 4, marginTop: 14 } }, "RUST-NATIVE ANIMATION"),
    h("div", { style: { position: "absolute", left: 20, top: 20, width: 100, height: 100, backgroundColor: "#ff0044" } }),
  ],
});
const { node: probeNode } = await fromJsx(el);
const png = await renderer.render(probeNode, { width: 1700, height: 400, devicePixelRatio: 2, format: "png" });
writeFileSync("/home/z/my-project/qa/probe-2x.png", png);
console.log("probe png bytes:", png.length);

// 3. dpr 1 same design
const png1 = await renderer.render(probeNode, { width: 850, height: 200, devicePixelRatio: 1, format: "png" });
writeFileSync("/home/z/my-project/qa/probe-1x.png", png1);
console.log("probe 1x png bytes:", png1.length);
