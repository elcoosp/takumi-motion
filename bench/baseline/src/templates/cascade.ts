// takumi-motion — templates/cascade.ts
// Kinetic statement banner: the title reveals per-GLYPH (rise + fade, organic
// decelerating stagger from the motion personality), the accent rule draws
// with overshoot, the tagline fades in behind it. Hold. Then the whole line
// exits with a per-glyph cascade — every track returns to its t=0 value
// (strict seam, no global fade pulse).
//
// This is the layer single-string templates structurally cannot do: per-glyph
// CSS keyframes baked by the compiler, sampled in Rust. v0.2: theme tokens,
// motion personality, Google Fonts, windowed glow (frozen through the hold).

import { createTimeline } from "../timeline.js";
import { checkLoopSeam } from "../loop.js";
import { h } from "../jsx.js";
import type { ReactElementLike } from "../types.js";
import { ambientWindow } from "../personality.js";
import { deceleratingStagger, revealRow } from "../orchestrate.js";
import {
  clamp, root, themeGlow, loopPeriod, evenWindow, fitFontSize,
  resolveTemplateStyle, textStyles,
  type BannerResult, type TemplateStyleProps,
} from "./shared.js";

export interface CascadeProps extends TemplateStyleProps {
  /** Title, revealed glyph by glyph. Long text auto-shrinks to fit. */
  title: string;
  /** Secondary line, fades in after the cascade. */
  tagline?: string;
  accent?: string;
  background?: string;
  /** Delay before the first glyph. Default 260. */
  startMs?: number;
  /** Hold with the full line visible, ms. Default 1700 (× personality holdBias). */
  holdMs?: number;
  /** Per-glyph rise, px. Default 20. */
  rise?: number;
}

const EXIT_MS = 220;     // per-glyph exit span
const EXIT_TAIL_MS = 300; // invisible settle before the loop restarts

export async function cascadeBanner(props: CascadeProps): Promise<BannerResult> {
  const width = props.width ?? 850;
  const height = props.height ?? 200;
  const fps = props.fps ?? 20;

  const style = await resolveTemplateStyle(props);
  const { theme, personality } = style;
  const accent = props.accent ?? theme.accent;
  const background = props.background ?? theme.bg;
  const startMs = Math.max(0, props.startMs ?? 260);
  const holdMs = Math.max(300, (props.holdMs ?? 1700) * personality.holdBias);
  const rise = clamp(0, props.rise ?? 20, 48);

  const n = [...props.title].length;
  if (n === 0) throw new Error("cascadeBanner: title must not be empty.");

  // Fitted title size (per-glyph spans render like one run — same widths).
  const fontSize = await fitFontSize({
    text: props.title,
    maxWidth: width - 2 * 64,
    fontWeight: 800,
    letterSpacing: 1,
    max: clamp(24, Math.round(height * 0.32), 58),
    min: 20,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    renderer: style.renderer,
  });

  const staggerMs = personality.staggerMs;
  const inMs = 300;
  const runSpan = deceleratingStagger(n - 1, n, staggerMs) + inMs;
  const entranceEnd = startMs + runSpan + 80;
  const exitStart = entranceEnd + holdMs;
  const exitRun = deceleratingStagger(n - 1, n, staggerMs) + EXIT_MS;
  const period = loopPeriod(exitStart + exitRun + EXIT_TAIL_MS, fps);

  const tl = createTimeline({ fps });

  // Windowed glow: alive through the entrance and the exit, still on the hold.
  const entranceWindow = evenWindow(0, entranceEnd, fps);
  const exitWindow = evenWindow(exitStart, exitStart + exitRun, fps, entranceWindow[1]);
  const glowEl = themeGlow("ca-glow", theme, {
    width: Math.round(width * 0.36),
    height: Math.round(height * 1.35),
    left: Math.round(width * 0.32),
    top: Math.round(-height * 0.18),
  });
  ambientWindow(tl, ".ca-glow", "drift", {
    periodMs: period,
    windows: [entranceWindow, exitWindow],
    intensity: personality.ambient,
    fps,
    label: "cascadeBanner glow",
  });

  // Per-glyph cascade (the reveal tracks land on the timeline).
  const row = revealRow(tl, {
    text: props.title,
    classNamePrefix: "ca-g",
    periodMs: period,
    at: startMs,
    staggerMs,
    staggerCurve: personality.staggerCurve,
    inMs,
    rise,
    ease: personality.entrance,
    exitAt: exitStart,
    exitMs: EXIT_MS,
    tailMs: EXIT_TAIL_MS,
    exitEase: personality.exit,
    style: {
      ...textStyles(theme, fontSize, { weight: 800, letterSpacing: 1 }),
    },
  });

  // Accent rule: draws with the personality's overshoot after the glyphs land.
  const ruleEl = h("div", {
    className: "ca-rule",
    style: {
      width: Math.round(fontSize * 2.4),
      height: 4,
      backgroundColor: accent,
      borderRadius: 2,
      marginTop: Math.round(height * 0.07),
      transformOrigin: "left center",
    },
  });
  const ruleStart = startMs + runSpan * 0.55;
  tl.add(".ca-rule", { scaleX: [0, 1, 1, 0] }, {
    at: 0, type: "tween", duration: period,
    times: [
      ruleStart / period,
      (ruleStart + 420) / period,
      exitStart / period,
      (exitStart + EXIT_MS + 60) / period,
    ],
    ease: [personality.overshoot, "linear", personality.exit],
  });

  // Tagline: fades in as the rule lands, out with the cascade.
  let taglineEl: ReactElementLike | null = null;
  if (props.tagline) {
    taglineEl = h("div", {
      className: "ca-tagline",
      style: {
        ...textStyles(theme, clamp(12, Math.round(fontSize * 0.3), 19), { dim: true, weight: 500, letterSpacing: 3 }),
        marginTop: Math.round(height * 0.075),
        whiteSpace: "pre",
      },
      children: props.tagline,
    });
    tl.add(".ca-tagline", { opacity: [0, 1, 1, 0] }, {
      at: 0, type: "tween", duration: period,
      times: [
        (ruleStart + 200) / period,
        (ruleStart + 560) / period,
        exitStart / period,
        (exitStart + EXIT_MS) / period,
      ],
      ease: [personality.entrance, "linear", personality.exit],
    });
  }

  const element = root({
    width,
    height,
    className: "ca-root",
    background,
    theme,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    children: [glowEl, row.element, ruleEl, taglineEl],
  });

  const timeline = tl.toJSON();
  const seam = checkLoopSeam(timeline);
  if (!seam.seamless) {
    throw new Error(`cascadeBanner: internal loop check failed: ${seam.notes.join(" ")}`);
  }
  return {
    element,
    timeline,
    ...(props.font ? { fonts: [typeof props.font === "string" ? { name: props.font, weight: props.fontWeights ?? [400, 700] } : props.font] } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    theme: theme.name,
    motion: personality.name,
  };
}
