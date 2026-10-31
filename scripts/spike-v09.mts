// v0.9 day-one spikes — validate every bet's critical dependency against the
// real @takumi-rs/core binding BEFORE building.
//
// Spike A (Bet A draw engine): per-frame clipPath inset reveal + SVG image +
//   conic-gradient (Donut) + scaleX panel reveal.
// Spike B (Bet B Morph prewarm): renderer.measure two-state rects → absolute
//   matrices readable per node path (the FLIP baking input).
// Spike C (Bet C material): maskImage alpha, fontVariationSettings weight
//   track (variable font), backgroundClip text gradient.
//
// Run: cd upload/v08-extracted && npx tsx /home/z/my-project/scripts/spike-v09-ab.mts
import { Renderer } from "takumi-js/node";
import { ensureFonts } from "../src/fonts.js";

type Node = Record<string, unknown>;

const W = 400, H = 200;
const results: Array<{ probe: string; verdict: string; detail: string }> = [];

function box(style: Node, children?: Node[]): Node {
  return { type: "container", style, ...(children ? { children } : {}) };
}
function txt(text: string, style: Node = {}): Node {
  return { type: "text", text, style };
}

async function renderPng(renderer: Renderer, node: Node): Promise<Buffer> {
  return renderer.render(node as never, {
    width: W, height: H, format: "png",
  } as never);
}

async function measureTree(renderer: Renderer, node: Node) {
  return renderer.measure(node as never, { width: W, height: H } as never);
}

// ---------------------------------------------------------------------------
// Spike A — draw / reveal engines
// ---------------------------------------------------------------------------
async function spikeA(renderer: Renderer) {
  const inner = (clip: string | undefined) =>
    box({
      width: W, height: H, backgroundColor: "#0b1120", position: "relative", overflow: "hidden",
    }, [
      box({
        position: "absolute", left: 20, top: 60, width: 360, height: 40,
        backgroundColor: "#38bdf8", borderRadius: 8,
        ...(clip ? { clipPath: clip } : {}),
      }),
    ]);

  const full = await renderPng(renderer, inner(undefined));
  const at0 = await renderPng(renderer, inner("inset(0 100% 0 0)"));
  const at50 = await renderPng(renderer, inner("inset(0 50% 0 0)"));
  const atFull = await renderPng(renderer, inner("inset(0 0% 0 0)"));

  const differs = (a: Buffer, b: Buffer) => !a.equals(b);
  results.push({
    probe: "A1 clipPath inset reveal",
    verdict: differs(at0, at50) && differs(at50, atFull) ? "GO" : "NO-GO",
    detail: `0% vs 50% vs 100% all differ: ${differs(at0, at50) && differs(at50, atFull)}; ` +
      `full-clip ≈ unclipped: ${atFull.equals(full)}`,
  });

  // A2 — SVG data-uri image (sparkline evidence)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><path d="M0 100 L90 40 L180 70 L270 20 L360 55" stroke="#38bdf8" stroke-width="4" fill="none"/></svg>`;
  const svgNode = box({ width: W, height: H, backgroundColor: "#0b1120" }, [
    { type: "image", src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, width: 360, height: 120, style: { position: "absolute", left: 20, top: 40 } },
  ]);
  const svgPng = await renderPng(renderer, svgNode);
  const blank = await renderPng(renderer, box({ width: W, height: H, backgroundColor: "#0b1120" }));
  results.push({
    probe: "A2 SVG image render",
    verdict: !svgPng.equals(blank) ? "GO" : "NO-GO",
    detail: `svg differs from blank: ${!svgPng.equals(blank)} (${svgPng.length}B)`,
  });

  // A3 — conic-gradient (Donut two-half alternative evidence)
  const donut = box({ width: W, height: H, backgroundColor: "#0b1120", position: "relative" }, [
    box({
      position: "absolute", left: 100, top: 20, width: 160, height: 160, borderRadius: 999,
      backgroundImage: "conic-gradient(#38bdf8 0deg, #38bdf8 216deg, #1e293b 216deg, #1e293b 360deg)",
    }),
    box({
      position: "absolute", left: 130, top: 50, width: 100, height: 100, borderRadius: 999,
      backgroundColor: "#0b1120",
    }),
  ]);
  const donutPng = await renderPng(renderer, donut);
  results.push({
    probe: "A3 conic-gradient donut",
    verdict: !donutPng.equals(blank) ? "GO" : "NO-GO",
    detail: `donut differs from blank: ${!donutPng.equals(blank)} (${donutPng.length}B)`,
  });

  // A4 — scaleX panel reveal (transform-only fallback engine)
  const scaled = (scaleX: number) =>
    box({ width: W, height: H, backgroundColor: "#0b1120", position: "relative", overflow: "hidden" }, [
      box({
        position: "absolute", left: 0, top: 0, width: W, height: H,
        backgroundColor: "#38bdf8",
        transform: `scaleX(${scaleX})`, transformOrigin: "0% 50%",
      }),
    ]);
  const s0 = await renderPng(renderer, scaled(0.0001));
  const s50 = await renderPng(renderer, scaled(0.5));
  const s1 = await renderPng(renderer, scaled(1));
  results.push({
    probe: "A4 scaleX panel reveal",
    verdict: differs(s0, s50) && differs(s50, s1) ? "GO" : "NO-GO",
    detail: `scaleX 0.0001/0.5/1 all differ: ${differs(s0, s50) && differs(s50, s1)}`,
  });
}

// ---------------------------------------------------------------------------
// Spike B — two-state measure (Morph prewarm input)
// ---------------------------------------------------------------------------
interface WalkEntry { path: string; x: number; y: number; w: number; h: number; text: string }
function walkMeasured(node: any, path: string, out: WalkEntry[]): void {
  const m = node.transform as number[];
  out.push({
    path,
    x: m[4], y: m[5],
    w: node.width, h: node.height,
    text: (node.runs ?? []).map((r: any) => r.text).join(""),
  });
  (node.children ?? []).forEach((child: any, i: number) => walkMeasured(child, `${path}/${i}`, out));
}

async function spikeB(renderer: Renderer) {
  // State A: list row (wide, stacked). State B: grid card (narrow, repositioned).
  const mkState = (cardWidth: number, pad: number, fontSize: number) =>
    box({ width: W, height: H, backgroundColor: "#0b1120", position: "relative", padding: 24, display: "flex", flexDirection: "column", gap: 12 }, [
      box({
        width: cardWidth, padding: pad, backgroundColor: "#1e293b", borderRadius: 12,
        display: "flex", flexDirection: "row", alignItems: "center", gap: 10,
      }, [
        box({ width: 28, height: 28, borderRadius: 999, backgroundColor: "#38bdf8" }),
        txt("Revenue", { fontSize, fontWeight: 700, color: "#f1f5f9", whiteSpace: "pre" }),
      ]),
    ]);

  const a = await measureTree(renderer, mkState(352, 16, 28));
  const b = await measureTree(renderer, mkState(160, 10, 18));

  const walkA: WalkEntry[] = [], walkB: WalkEntry[] = [];
  walkMeasured(a, "", walkA);
  walkMeasured(b, "", walkB);

  const rowA = walkA.find((e) => e.text.includes("Revenue"));
  const rowB = walkB.find((e) => e.text.includes("Revenue"));
  const textA = walkA.find((e) => e.text === "Revenue");
  const textB = walkB.find((e) => e.text === "Revenue");

  const go = !!(rowA && rowB && textA && textB) &&
    (rowA.x !== rowB.x || rowA.y !== rowB.y) &&
    (textA.w !== textB.w || textA.h !== textB.h);

  results.push({
    probe: "B1 two-state measure rects",
    verdict: go ? "GO" : "NO-GO",
    detail:
      `rowA (${rowA?.x.toFixed(1)},${rowA?.y.toFixed(1)} ${rowA?.w.toFixed(0)}×${rowA?.h.toFixed(0)}) → ` +
      `rowB (${rowB?.x.toFixed(1)},${rowB?.y.toFixed(1)} ${rowB?.w.toFixed(0)}×${rowB?.h.toFixed(0)}); ` +
      `textA w=${textA?.w.toFixed(1)} h=${textA?.h.toFixed(1)} → textB w=${textB?.w.toFixed(1)} h=${textB?.h.toFixed(1)}`,
  });
}

// ---------------------------------------------------------------------------
// Spike C — material properties
// ---------------------------------------------------------------------------
async function spikeC(renderer: Renderer) {
  const blank = await renderPng(renderer, box({ width: W, height: H, backgroundColor: "#0b1120" }));

  // C1 — maskImage alpha gradient
  const masked = box({ width: W, height: H, backgroundColor: "#0b1120", position: "relative" }, [
    box({
      position: "absolute", inset: 0,
      backgroundImage: "linear-gradient(135deg, #38bdf8, #a78bfa)",
      maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
      WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
    }),
  ]);
  const maskedPng = await renderPng(renderer, masked);
  results.push({
    probe: "C1 maskImage alpha",
    verdict: !maskedPng.equals(blank) ? "GO" : "NO-GO",
    detail: `masked differs from blank: ${!maskedPng.equals(blank)} (${maskedPng.length}B)`,
  });

  // C2 — fontVariationSettings weight track (needs a variable face)
  let c2Detail = "skipped";
  let c2Go = false;
  try {
    const res = await ensureFonts(renderer, { name: "Noto Sans", weight: "100..900" as never });
    const wght = (v: string) =>
      box({ width: W, height: H, backgroundColor: "#0b1120", display: "flex", alignItems: "center", justifyContent: "center" }, [
        txt("Signal", {
          fontSize: 56, color: "#f1f5f9",
          fontVariationSettings: `'wght' ${v}`,
          fontFamily: "Noto Sans",
        } as Node),
      ]);
    const light = await renderPng(renderer, wght("200"));
    const heavy = await renderPng(renderer, wght("800"));
    c2Go = light.equals(heavy) === false;
    c2Detail = `registered ${res.families[0]?.weights ?? "?"} — light vs heavy differ: ${c2Go}`;
  } catch (e) {
    c2Detail = `unavailable: ${(e as Error).message.slice(0, 80)}`;
  }
  results.push({ probe: "C2 fontVariationSettings track", verdict: c2Go ? "GO" : "FALLBACK", detail: c2Detail });

  // C3 — gradient text via backgroundClip
  const gradText = box({ width: W, height: H, backgroundColor: "#0b1120", display: "flex", alignItems: "center", justifyContent: "center" }, [
    txt("Gradient", {
      fontSize: 56, fontWeight: 800, color: "transparent",
      backgroundImage: "linear-gradient(90deg, #38bdf8, #a78bfa)",
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
    } as Node),
  ]);
  const plainText = box({ width: W, height: H, backgroundColor: "#0b1120", display: "flex", alignItems: "center", justifyContent: "center" }, [
    txt("Gradient", { fontSize: 56, fontWeight: 800, color: "#38bdf8" }),
  ]);
  const gtPng = await renderPng(renderer, gradText);
  const ptPng = await renderPng(renderer, plainText);
  results.push({
    probe: "C3 backgroundClip gradient text",
    verdict: !gtPng.equals(blank) && !gtPng.equals(ptPng) ? "GO" : "NO-GO",
    detail: `renders and differs from plain text: ${!gtPng.equals(blank) && !gtPng.equals(ptPng)}`,
  });
}

// ---------------------------------------------------------------------------
const renderer = new Renderer();
await spikeA(renderer);
await spikeB(renderer);
await spikeC(renderer);

console.log("\n=== v0.9 spike results ===");
for (const r of results) {
  console.log(`${r.verdict.padEnd(9)} ${r.probe}\n          ${r.detail}`);
}
