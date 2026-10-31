// takumi-motion — preview-react.ts
// Standalone preview for React-authored banners: plays the EXACT captured
// HTML frames in a browser (no server, no bundler, no React on the page).
//
// Why frame-swap instead of live React in the browser: the captured frames
// are what the encoder actually consumed — the preview is pixel-faithful to
// the export by construction, including every transition composite and every
// spring settle. A live-React preview would re-render with browser CSS
// approximations AND need a bundler for the user's TSX; the frame-swap
// player needs neither.
//
// The player carries: play/pause, frame scrubber, chunk map (which frames
// are unique vs holds), seam view (frame 0 vs last frame side by side), and
// the capture/audit warnings.

import type { CaptureResult } from "./react/capture.js";

export interface ReactPreviewOptions {
  title?: string;
}

/** JSON-escape an embedded string (script-safe: `</` can never appear). */
function jsonSafe(s: string): string {
  return JSON.stringify(s).replace(/<\//g, "<\\/");
}

export function renderReactPreviewHtml(capture: CaptureResult, options: ReactPreviewOptions = {}): string {
  const { meta, plan, chunks } = capture;
  const title = options.title ?? "takumi-motion preview";
  const width = meta.width;
  const height = meta.height;
  const fps = meta.fps;
  const totalFrames = plan.totalFrames;

  // Embed: chunk html + frame→chunk index (compact).
  const chunkHtml = chunks.map((c) => jsonSafe(c.html));
  const frameToChunk: number[] = [];
  for (const [ci, c] of chunks.entries()) {
    for (let f = 0; f < c.frames; f++) frameToChunk.push(ci);
  }

  // Scene boundaries for the timeline ruler.
  const sceneMarks = plan.scenes.map((s) => ({
    start: s.startFrame,
    end: s.startFrame + s.durationFrames - 1,
    enter: s.enterFrames,
    label: `S${s.index + 1}`,
  }));

  const warnings = capture.warnings;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
         background: #0d1117; color: #e6edf3; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; padding: 24px; }
  h1 { font-size: 15px; font-weight: 600; color: #8b949e; margin: 0 0 16px; letter-spacing: .02em; }
  .stage { position: relative; transform-origin: top center; margin-bottom: 20px; }
  .stage-inner { width: ${width}px; height: ${height}px; position: relative; overflow: hidden; border-radius: 6px;
                 box-shadow: 0 8px 40px rgba(0,0,0,.5); background: #000; }
  .stage-inner iframe { border: 0; width: ${width}px; height: ${height}px; display: block; pointer-events: none; }
  .controls { width: min(720px, 92vw); display: flex; flex-direction: column; gap: 10px; }
  .row { display: flex; align-items: center; gap: 10px; }
  button { background: #21262d; color: #e6edf3; border: 1px solid #363b42; border-radius: 6px;
           padding: 6px 14px; font: inherit; cursor: pointer; }
  button:hover { background: #30363d; }
  button.primary { background: #1f6feb; border-color: #1f6feb; }
  input[type="range"] { flex: 1; accent-color: #1f6feb; }
  .meta { font-variant-numeric: tabular-nums; color: #8b949e; min-width: 110px; text-align: right; }
  .ruler { position: relative; height: 26px; border-radius: 4px; overflow: hidden; background: #161b22;
           border: 1px solid #30363d; display: flex; }
  .ruler .seg { position: relative; height: 100%; border-right: 1px solid #0d1117; display:flex; align-items:center;
                justify-content:center; font-size: 10px; color: #7982a9; overflow: hidden; }
  .ruler .seg.entermark { box-shadow: inset 3px 0 0 #7aa2f7; }
  .ruler .seg.hold { background: #1c2128; }
  .ruler .cursor { position: absolute; top: 0; bottom: 0; width: 2px; background: #f59e0b; left: 0; }
  .seam { display: none; gap: 8px; margin-top: 6px; }
  .seam.on { display: flex; }
  .seam .half { flex: 1; position: relative; }
  .seam .half iframe { width: 100%; height: ${height}px; border: 0; background: #000; border-radius: 4px; pointer-events: none; }
  .seam .tag { position: absolute; top: 6px; left: 6px; background: rgba(0,0,0,.65); padding: 1px 7px;
               border-radius: 4px; font-size: 11px; color: #8b949e; }
  .warnings { width: min(720px, 92vw); margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
  .warnings div { background: rgba(187, 128, 9, .12); border: 1px solid rgba(187, 128, 9, .4); color: #d29922;
                  border-radius: 6px; padding: 6px 10px; font-size: 12.5px; }
  .kbd { color: #8b949e; font-size: 12px; }
</style>
</head>
<body>
<h1>${escapeHtml(title)} — ${width}×${height} @ ${fps}fps · ${totalFrames}f · ${chunks.length} chunks · ${plan.scenes.length} scenes</h1>

<div class="stage" id="stage"><div class="stage-inner" id="frame"></div></div>

<div class="controls">
  <div class="ruler" id="ruler"><div class="cursor" id="cursor"></div></div>
  <div class="row">
    <button class="primary" id="play">Pause</button>
    <input type="range" id="scrub" min="0" max="${totalFrames - 1}" value="0" step="1">
    <span class="meta" id="meta">0 / ${totalFrames - 1}</span>
  </div>
  <div class="row">
    <button id="seamBtn">Compare seam (0 ↔ last)</button>
    <span class="kbd">space = play · ←/→ = step · s = seam</span>
  </div>
</div>

<div class="seam" id="seam">
  <div class="half"><div class="tag">frame 0</div><div id="seamFirst"></div></div>
  <div class="half"><div class="tag">frame ${totalFrames - 1}</div><div id="seamLast"></div></div>
</div>

<div class="warnings">${warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join("")}</div>

<script>
const CHUNKS = [${chunkHtml.join(",")}];
const FRAME_TO_CHUNK = ${JSON.stringify(frameToChunk)};
const SCENE_MARKS = ${JSON.stringify(sceneMarks)};
const FPS = ${fps};
const TOTAL = ${totalFrames};
const SIZE = [${width}, ${height}];
// captured HTML is a bare <div> — zero the iframe body so the banner sits flush
const FRAME_WRAP = '<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>';

const stageInner = document.getElementById("frame");
const ruler = document.getElementById("ruler");
const cursor = document.getElementById("cursor");
const scrub = document.getElementById("scrub");
const playBtn = document.getElementById("play");
const metaEl = document.getElementById("meta");
const seamEl = document.getElementById("seam");
const seamFirst = document.getElementById("seamFirst");
const seamLast = document.getElementById("seamLast");

// scene ruler segments
for (const m of SCENE_MARKS) {
  const seg = document.createElement("div");
  seg.className = "seg" + (m.enter > 0 ? " entermark" : "");
  seg.style.width = ((m.end - m.start + 1) / TOTAL * 100) + "%";
  seg.textContent = m.label;
  seg.title = "scene " + m.label.slice(1) + " · frames " + m.start + "–" + m.end + (m.enter ? " · " + m.enter + " enter-overlap frames" : "");
  ruler.insertBefore(seg, cursor);
}

let frame = 0;
let playing = true;
let rafId = 0;
let lastSwap = 0;

function showFrame(f) {
  const html = CHUNKS[FRAME_TO_CHUNK[f]];
  if (stageInner.dataset.chunk !== String(FRAME_TO_CHUNK[f])) {
    // iframe isolation: <style> rules can't leak into the player chrome
    stageInner.innerHTML = "";
    const doc = document.createElement("iframe");
    doc.setAttribute("scrolling", "no");
    stageInner.appendChild(doc);
    const d = doc.contentDocument;
    d.open(); d.write(FRAME_WRAP + html); d.close();
    stageInner.dataset.chunk = String(FRAME_TO_CHUNK[f]);
  }
  cursor.style.left = (f / TOTAL * 100) + "%";
  scrub.value = f;
  metaEl.textContent = f + " / " + (TOTAL - 1);
}

function loop(t) {
  if (playing) {
    if (t - lastSwap >= 1000 / FPS) {
      lastSwap = t;
      frame = (frame + 1) % TOTAL;
      showFrame(frame);
    }
  }
  rafId = requestAnimationFrame(loop);
}

playBtn.addEventListener("click", () => {
  playing = !playing;
  playBtn.textContent = playing ? "Pause" : "Play";
});
scrub.addEventListener("input", () => { frame = Number(scrub.value); playing = false; playBtn.textContent = "Play"; showFrame(frame); });
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); playBtn.click(); }
  if (e.key === "ArrowRight") { frame = Math.min(TOTAL - 1, frame + 1); playing = false; playBtn.textContent = "Play"; showFrame(frame); }
  if (e.key === "ArrowLeft") { frame = Math.max(0, frame - 1); playing = false; playBtn.textContent = "Play"; showFrame(frame); }
  if (e.key === "s") { seamEl.classList.toggle("on"); }
});
document.getElementById("seamBtn").addEventListener("click", () => seamEl.classList.toggle("on"));

// seam view renders frame 0 and last frame statically
function renderStatic(host, f) {
  const doc = document.createElement("iframe");
  doc.setAttribute("scrolling", "no");
  host.appendChild(doc);
  const d = doc.contentDocument;
  d.open(); d.write(FRAME_WRAP + CHUNKS[FRAME_TO_CHUNK[f]]); d.close();
}
renderStatic(seamFirst, 0);
renderStatic(seamLast, TOTAL - 1);

// scale stage to fit viewport
function fit() {
  const stage = document.getElementById("stage");
  const scale = Math.min(1, (window.innerWidth - 48) / SIZE[0]);
  stage.style.transform = "scale(" + scale + ")";
  stage.style.height = (SIZE[1] * scale) + "px";
}
window.addEventListener("resize", fit);
fit();

showFrame(0);
rafId = requestAnimationFrame(loop);
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
