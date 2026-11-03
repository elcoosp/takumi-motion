// takumi-motion — preview.ts
// Zero-server preview: emit a standalone HTML file that plays the EXACT CSS
// the Rust engine samples. The compiled timeline is plain @keyframes + longhand
// animation rules, so a browser can replay it frame-for-frame (approximation:
// the browser's layout/text stack differs marginally from takumi's — good
// enough to iterate on motion; the GIF remains the source of truth).
//
// Controls: play/pause, a scrubber (animation-delay trick), loop counter,
// seam jump (t=0 ↔ t=end), and the file's canvas size.

import { compileTimeline } from "./compile.js";
import { resolvePreset, type BannerPreset } from "./presets.js";
import type { ReactElementLike, TimelineJSON } from "./types.js";

// ---------------------------------------------------------------------------
// Style serialization (camelCase style objects → CSS text)
// ---------------------------------------------------------------------------

const PX_PROPS = new Set([
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "fontSize", "letterSpacing", "lineHeight", "padding", "paddingX", "paddingY",
  "marginTop", "marginBottom", "marginLeft", "marginRight", "margin",
  "borderRadius", "borderWidth", "gap", "top", "left", "right", "bottom",
]);

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function styleToCss(style: Record<string, string | number | undefined> | undefined): string {
  if (!style) return "";
  return Object.entries(style)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const value = typeof v === "number" && PX_PROPS.has(k) ? `${v}px` : String(v);
      return `${kebab(k)}: ${value};`;
    })
    .join(" ");
}

function cssValueToCss(value: string | number, prop: string): string {
  return typeof value === "number" && PX_PROPS.has(prop) ? `${value}px` : String(value);
}

// ---------------------------------------------------------------------------
// Element tree → HTML
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function elementToHtml(el: ReactElementLike): string {
  const props = (el.props ?? {}) as {
    className?: string;
    style?: Record<string, string | number | undefined>;
    children?: unknown;
  };
  const tag = typeof el.type === "string" ? el.type : "div";
  const attrs = [
    props.className ? ` class="${escapeHtml(props.className)}"` : "",
    props.style ? ` style="${escapeHtml(styleToCss(props.style))}"` : "",
  ].join("");
  const children = props.children;
  let inner = "";
  if (typeof children === "string" || typeof children === "number") {
    inner = escapeHtml(String(children));
  } else if (Array.isArray(children)) {
    inner = children.map((c) =>
      typeof c === "string" || typeof c === "number"
        ? escapeHtml(String(c))
        : c && typeof c === "object" && "props" in (c as object)
          ? elementToHtml(c as ReactElementLike)
          : ""
    ).join("");
  } else if (children && typeof children === "object" && "props" in (children as object)) {
    inner = elementToHtml(children as ReactElementLike);
  }
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Compiled CSS entries → CSS text
// ---------------------------------------------------------------------------

export function cssEntriesToText(entries: unknown[]): string {
  const out: string[] = [];
  for (const entry of entries as Array<Record<string, unknown>>) {
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (entry.keyframes) {
      const steps = (entry.steps ?? []) as Array<{ offset: string; style?: Record<string, unknown> }>;
      const body = steps.map((step) => {
        const style = (step.style ?? {}) as Record<string, string | number>;
        const decls = Object.entries(style)
          .map(([k, v]) => `${kebab(k)}: ${typeof v === "number" ? cssValueToCss(v, k) : v};`)
          .join(" ");
        return `${step.offset} { ${decls} }`;
      }).join("\n  ");
      out.push(`@keyframes ${entry.keyframes} {\n  ${body}\n}`);
      continue;
    }
    if (entry.selector) {
      out.push(`${entry.selector} { ${styleToCss(entry.style as never)} }`);
      continue;
    }
  }
  return out.join("\n\n");
}

// ---------------------------------------------------------------------------
// Preview document
// ---------------------------------------------------------------------------

export interface PreviewOptions {
  width: number;
  height: number;
  /** Grid fps used to compile the timeline (match the render fps). */
  fps?: number;
  /** Page background outside the canvas. */
  pageBackground?: string;
  title?: string;
}

/**
 * Build the standalone preview HTML for a banner element + timeline.
 * Write it to a .html file and open it in any browser — no server, no deps.
 */
export function renderPreviewHtml(
  element: ReactElementLike,
  timeline: TimelineJSON,
  options: PreviewOptions
): string {
  const fps = options.fps ?? 20;
  const compiled = compileTimeline(timeline, { fps });
  const cssText = cssEntriesToText(compiled.css);
  const body = elementToHtml(element);
  const durationMs = Math.round(compiled.durationMs);
  const pageBg = options.pageBackground ?? "#16181d";

  return `<!doctype html>
<!-- takumi-motion preview — plays the exact CSS the Rust engine samples. -->
<!-- Approximation: the browser's layout differs marginally from takumi's;   -->
<!-- the rendered GIF/WebP remains the source of truth.                      -->
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title ?? "takumi-motion preview")}</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 18px;
    background: ${pageBg}; font: 13px/1.5 ui-monospace, "JetBrains Mono", monospace;
    color: #9da6b3; padding: 24px;
  }
  .stage { position: relative; }
  .canvas {
    width: ${options.width}px; height: ${options.height}px;
    transform-origin: top left; position: relative; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,.5);
  }
  .scaled { transform: scale(var(--s, 1)); transform-origin: top left; }
  .hud { display: flex; align-items: center; gap: 12px; width: 100%; max-width: ${options.width}px; }
  button, input[type="range"] {
    font: inherit; color: #cdd5df; background: #23262d; border: 1px solid #333842;
    border-radius: 6px; padding: 5px 12px; cursor: pointer;
  }
  input[type="range"] { flex: 1; padding: 0; height: 26px; }
  .t { min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
  .loops { min-width: 90px; }
  .hint { opacity: .65; }
  @media (max-width: ${options.width + 48}px) { .canvas { --s: calc((100vw - 48px) / ${options.width}); } }
</style>
<style id="timeline-css">
${cssText}
</style>
</head>
<body>
  <div class="stage"><div class="canvas scaled"><div id="root" style="position:absolute;inset:0;width:${options.width}px;height:${options.height}px;overflow:hidden;">${body}</div></div></div>
  <div class="hud">
    <button id="toggle">pause</button>
    <button id="seam" title="jump to the loop seam">seam</button>
    <input id="scrub" type="range" min="0" max="${durationMs}" value="0" step="1">
    <span class="t" id="time">0 / ${durationMs} ms</span>
    <span class="loops" id="loops">loops: 0</span>
  </div>
  <div class="hint">${options.width}×${options.height} · ${fps}fps grid · scrubber drives animation-delay; the Rust engine samples this exact keyframe set</div>
<script>
(() => {
  const D = ${durationMs};
  const root = document.getElementById("root");
  const animated = [...root.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none");
  const scrub = document.getElementById("scrub");
  const time = document.getElementById("time");
  const loops = document.getElementById("loops");
  const toggle = document.getElementById("toggle");
  let playing = true;
  let t0 = performance.now();
  let offset = 0;
  let count = 0;
  let lastT = 0;

  function apply(ms) {
    for (const el of animated) {
      el.style.animationPlayState = "paused";
      el.style.animationDelay = (-ms) + "ms";
    }
    scrub.value = Math.round(ms);
    time.textContent = Math.round(ms) + " / " + D + " ms";
  }
  function tick(now) {
    if (playing) {
      const t = (now - t0) + offset;
      const wrapped = t % D;
      if (wrapped < lastT) { count++; loops.textContent = "loops: " + count; }
      lastT = wrapped;
      apply(wrapped);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  scrub.addEventListener("input", () => {
    playing = false; toggle.textContent = "play";
    offset = Number(scrub.value); t0 = performance.now();
    lastT = offset; apply(offset);
  });
  toggle.addEventListener("click", () => {
    playing = !playing;
    toggle.textContent = playing ? "pause" : "play";
    if (playing) { offset = Number(scrub.value); t0 = performance.now(); }
  });
  document.getElementById("seam").addEventListener("click", () => {
    playing = false; toggle.textContent = "play";
    offset = D - 1; t0 = performance.now(); lastT = offset; apply(offset);
  });
  apply(0);
})();
</script>
</body>
</html>`;
}

export interface PreviewTarget {
  element: ReactElementLike;
  timeline: TimelineJSON;
}

/** Convenience: preview for a template result at a named/custom preset. */
export function renderPreviewForBanner(banner: PreviewTarget, preset: string | BannerPreset = "readme"): string {
  const p = resolvePreset(preset);
  return renderPreviewHtml(banner.element, banner.timeline, {
    width: p.width,
    height: p.height,
    fps: p.fps,
    title: `takumi-motion preview — ${p.width}×${p.height}`,
  });
}
