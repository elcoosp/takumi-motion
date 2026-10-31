// takumi-motion — templates/sweep.ts
// Statement banner: title, accent rule and subtitle enter with overshoot
// easing (spring feel, seam-safe), hold, then sweep out on the x axis while
// fading — every track returns to its t=0 value (strict seamless loop, no
// global fade pulse). Transform positions return "while invisible" during
// the tail gap. Title is measure-fitted.
//
// v0.2: theme tokens, motion personality (entrance/exit/overshoot eases and
// hold pacing), Google Fonts, and WINDOWED glows — the blobs drift during
// the entrance and exit, freezing through the hold so GIF frames collapse.

import { createTimeline } from "../timeline.js";
import { checkLoopSeam } from "../loop.js";
import { h } from "../jsx.js";
import type { ReactElementLike } from "../types.js";
import { ambientWindow } from "../personality.js";
import {
  clamp, root, themeGlow, loopPeriod, evenWindow, fitFontSize,
  resolveTemplateStyle, textStyles,
  type BannerResult, type TemplateStyleProps,
} from "./shared.js";

export interface SweepProps extends TemplateStyleProps {
  title: string;
  subtitle?: string;
  /** Second glow color. Default: a cool contrast to the theme accent. */
  secondaryColor?: string;
  /** Root background. Default: theme bg. */
  background?: string;
  /** Accent color for the rule under the title. Default: theme accent. */
  accent?: string;
  /** Hold after the entrance completes, ms. Default 1900 (× personality holdBias). */
  holdMs?: number;
}

const FADE_OUT_MS = 240;   // exit fade span (completes before transform return)
const EXIT_SPAN_MS = 300;  // exit sweep span on the x axis
const TRACK_MAX = 4;       // letter-tracking amplitude (px above final)

export async function gradientSweepBanner(props: SweepProps): Promise<BannerResult> {
  const width = props.width ?? 850;
  const height = props.height ?? 200;
  const fps = props.fps ?? 20;

  const style = await resolveTemplateStyle(props);
  const { theme, personality } = style;
  const accent = props.accent ?? theme.accent;
  const background = props.background ?? theme.bg;
  const secondary = props.secondaryColor ?? "#22d3ee";
  const holdMs = Math.max(400, (props.holdMs ?? 1900) * personality.holdBias);
  const padX = 72;

  // Measure-fitted title (at the WIDEST tracking state so nothing ever clips).
  const titleSize = await fitFontSize({
    text: props.title,
    maxWidth: width - 2 * padX,
    fontWeight: 800,
    letterSpacing: 1 + TRACK_MAX,
    max: clamp(24, Math.round(height * 0.3), 58),
    min: 20,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    renderer: style.renderer,
  });
  const subSize = props.subtitle
    ? await fitFontSize({
        text: props.subtitle,
        maxWidth: width - 2 * padX,
        fontWeight: 500,
        letterSpacing: 3,
        max: clamp(12, Math.round(titleSize * 0.32), 20),
        min: 11,
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        renderer: style.renderer,
      })
    : 14;

  // Loop period: entrance (~900ms) → hold → exit (~620ms incl. invisible return).
  const entranceEnd = 900;
  const exitStart = entranceEnd + holdMs;
  const period = loopPeriod(exitStart + EXIT_SPAN_MS + 40, fps);
  const outTitle = exitStart;
  const outSub = exitStart + 90;

  // Windowed glows: motion during entrance + exit, frozen through the hold.
  const entranceWindow = evenWindow(0, entranceEnd, fps);
  const exitWindow = evenWindow(exitStart, period, fps, entranceWindow[1]);

  const tl = createTimeline({ fps });

  const glowA = themeGlow("gs-glow-a", theme, {
    width: Math.round(width * 0.36),
    height: Math.round(height * 1.05),
    left: Math.round(-width * 0.05),
    top: Math.round(height * 0.1),
  }, 1.25);
  ambientWindow(tl, ".gs-glow-a", "drift", {
    periodMs: period,
    windows: [entranceWindow, exitWindow],
    intensity: personality.ambient,
    fps,
    label: "gradientSweepBanner glowA",
  });
  // Vertical float on a second windowed track (same windows, other axis).
  ambientWindow(tl, ".gs-glow-a", "float", {
    periodMs: period,
    windows: [entranceWindow, exitWindow],
    intensity: personality.ambient * 0.6,
    fps,
    label: "gradientSweepBanner glowA float",
  });

  const glowB = h("div", {
    className: "gs-glow-b",
    style: {
      position: "absolute",
      left: Math.round(width * 0.7),
      top: Math.round(-height * 0.12),
      width: Math.round(width * 0.3),
      height: Math.round(height * 0.85),
      borderRadius: 999,
      backgroundColor: secondary,
      opacity: 0.11,
      filter: "blur(46px)",
    },
  });
  ambientWindow(tl, ".gs-glow-b", "drift", {
    periodMs: period,
    windows: [entranceWindow, exitWindow],
    intensity: -personality.ambient * 0.8, // negative → mirrored direction
    fps,
    label: "gradientSweepBanner glowB",
  });

  // Title: rise + fade + tracking-in with the personality's entrance ease;
  // sweeps out left while fading; x returns to 0 during the invisible tail.
  const titleEl = h("div", {
    className: "gs-title",
    style: {
      ...textStyles(theme, titleSize, { weight: 800, letterSpacing: 1, lineHeight: 1.15 }),
      whiteSpace: "pre",
    },
    children: props.title,
  });
  tl.add(".gs-title", { opacity: [0, 1, 1, 0] }, {
    at: 0, type: "tween", duration: period,
    times: [150 / period, 460 / period, outTitle / period, (outTitle + FADE_OUT_MS) / period],
    ease: [personality.entrance, "linear", personality.exit],
  });
  tl.add(".gs-title", { y: [26, 0, 0, 26] }, {
    at: 0, type: "tween", duration: period,
    times: [140 / period, 620 / period, (outTitle + FADE_OUT_MS) / period, 1],
    ease: [personality.overshoot, "linear", "easeInOut"],
  });
  tl.add(".gs-title", { x: [0, -44, 0] }, {
    at: 0, type: "tween", duration: period,
    times: [outTitle / period, (outTitle + EXIT_SPAN_MS) / period, 1],
    ease: ["easeIn", "linear"],
  });
  tl.add(".gs-title", { letterSpacing: [1 + TRACK_MAX, 1, 1, 1 + TRACK_MAX] }, {
    at: 0, type: "tween", duration: period,
    times: [140 / period, 640 / period, outTitle / period, (outTitle + FADE_OUT_MS) / period],
    ease: [personality.entrance, "linear", personality.exit],
  });

  // Accent rule: draws out from the left (overshoot), drains back at the exit.
  const ruleEl = h("div", {
    className: "gs-rule",
    style: {
      width: Math.round(titleSize * 2.2),
      height: 4,
      backgroundColor: accent,
      borderRadius: 2,
      marginTop: Math.round(height * 0.075),
      transformOrigin: "left center",
      boxShadow: `0 0 16px ${accent}55`,
    },
  });
  tl.add(".gs-rule", { scaleX: [0, 1, 1, 0] }, {
    at: 0, type: "tween", duration: period,
    times: [380 / period, 700 / period, outTitle / period, (outTitle + FADE_OUT_MS + 60) / period],
    ease: [personality.overshoot, "linear", personality.exit],
  });

  // Subtitle: same in/out grammar as the title, on the same axes.
  let subtitleEl: ReactElementLike | null = null;
  if (props.subtitle) {
    subtitleEl = h("div", {
      className: "gs-sub",
      style: {
        ...textStyles(theme, subSize, { dim: true, weight: 500, letterSpacing: 3 }),
        marginTop: Math.round(height * 0.07),
        whiteSpace: "pre",
      },
      children: props.subtitle,
    });
    tl.add(".gs-sub", { opacity: [0, 1, 1, 0] }, {
      at: 0, type: "tween", duration: period,
      times: [560 / period, 880 / period, outSub / period, (outSub + FADE_OUT_MS) / period],
      ease: [personality.entrance, "linear", personality.exit],
    });
    tl.add(".gs-sub", { y: [14, 0, 0, 14] }, {
      at: 0, type: "tween", duration: period,
      times: [560 / period, 980 / period, (outSub + FADE_OUT_MS) / period, 1],
      ease: [personality.overshoot, "linear", "easeInOut"],
    });
    tl.add(".gs-sub", { x: [0, -36, 0] }, {
      at: 0, type: "tween", duration: period,
      times: [outSub / period, (outSub + EXIT_SPAN_MS) / period, 1],
      ease: ["easeIn", "linear"],
    });
  }

  const element = root({
    width,
    height,
    className: "gs-root",
    background,
    theme,
    align: "flex-start",
    paddingX: padX,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    children: [glowA, glowB, titleEl, ruleEl, subtitleEl],
  });

  const timeline = tl.toJSON();
  const seam = checkLoopSeam(timeline);
  if (!seam.seamless) {
    throw new Error(`gradientSweepBanner: internal loop check failed: ${seam.notes.join(" ")}`);
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
