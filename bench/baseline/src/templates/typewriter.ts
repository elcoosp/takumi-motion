// takumi-motion — templates/typewriter.ts
// Typing-reveal banner: characters fade in one by one, hold, then delete in
// reverse (terminal backspace) before the loop restarts — a strict seamless
// loop with NO global fade pulse. Text is measure-fitted to the canvas so it
// can never overflow.
//
// v0.2: theme tokens, motion personality, Google Fonts, and WINDOWED ambient
// — the glow drifts and the cursor blinks only inside the typing/deleting
// windows, freezing through the reading hold. Frozen holds render
// byte-identical GIF frames, which collapseGifHolds() merges: the hold costs
// ~one frame instead of ~30.

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

export interface TypewriterProps extends TemplateStyleProps {
  /** Text typed out across the banner. Long text auto-shrinks to fit. */
  text: string;
  /** Secondary line under the typed text. Static — visible from frame 0. */
  tagline?: string;
  /** Cursor + glow accent. Default: theme accent. */
  accent?: string;
  /** Root background. Default: theme bg (flat — GIF-friendly). */
  background?: string;
  /** ms between character reveals. Default 65. */
  speed?: number;
  /** Delay before the first character. Default 300. */
  startMs?: number;
  /** Hold after full reveal, ms. Default 1500 (scaled by personality holdBias). */
  holdMs?: number;
}

const TYPE_IN_MS = 150;   // per-char fade-in span
const DELETE_MS = 70;     // per-char backspace span
const BACK_STAGGER_MS = 38;
const TAIL_MS = 420;      // empty-line blink before the loop restarts

export async function typewriterBanner(props: TypewriterProps): Promise<BannerResult> {
  const width = props.width ?? 850;
  const height = props.height ?? 200;
  const text = props.text;
  if (!text.length) throw new Error("typewriterBanner: text must not be empty.");
  const fps = props.fps ?? 20;

  const style = await resolveTemplateStyle(props);
  const { theme, personality } = style;
  const accent = props.accent ?? theme.accent;
  const background = props.background ?? theme.bg;
  const speed = Math.max(20, props.speed ?? 65);
  const startMs = Math.max(0, props.startMs ?? 300);
  const holdMs = Math.max(200, (props.holdMs ?? 1500) * personality.holdBias);

  const chars = [...text];
  const n = chars.length;

  // Measure-fitted title: can never overflow the canvas.
  const fontSize = await fitFontSize({
    text,
    maxWidth: width - 2 * 64,
    fontWeight: 700,
    letterSpacing: 2,
    max: clamp(24, Math.round(height * 0.34), 62),
    min: 22,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    renderer: style.renderer,
  });

  // Loop period: type → hold → backspace → tail blink, grid-aligned.
  const typeSpan = (n - 1) * speed + TYPE_IN_MS;
  const deleteSpan = (n - 1) * BACK_STAGGER_MS + DELETE_MS;
  const typeEnd = startMs + typeSpan;
  const deleteStart = typeEnd + holdMs;
  const period = loopPeriod(deleteStart + deleteSpan + TAIL_MS, fps);

  // Windowed ambient: motion inside typing + deleting, frozen through the
  // hold and the tail (byte-identical frames → GIF hold collapse).
  const typeWindow = evenWindow(0, typeEnd, fps);
  const deleteWindow = evenWindow(deleteStart, deleteStart + deleteSpan, fps, typeWindow[1]);

  const tl = createTimeline({ fps });

  // Ambient glow, drifting only while text is moving.
  const glowEl = themeGlow("tw-glow", theme, {
    width: Math.round(width * 0.38),
    height: Math.round(height * 1.4),
    left: Math.round(width * 0.31),
    top: Math.round(-height * 0.2),
  });
  ambientWindow(tl, ".tw-glow", "drift", {
    periodMs: period,
    windows: [typeWindow, deleteWindow],
    intensity: personality.ambient,
    fps,
    label: "typewriterBanner glow",
  });

  // Typed characters: one multi-stop opacity track per char
  // (fade in → hold → backspace out). Ends exactly where it starts.
  const charStyle = textStyles(theme, fontSize, { weight: 700, letterSpacing: 2, lineHeight: 1.2 });
  const charEls = chars.map((ch, i) => {
    const typeAt = startMs + i * speed;
    const deleteAt = deleteStart + (n - 1 - i) * BACK_STAGGER_MS; // last char deletes first
    tl.add(`.tw-ch-${i}`, { opacity: [0, 1, 1, 0] }, {
      at: 0,
      type: "tween",
      duration: period,
      times: [
        typeAt / period,
        (typeAt + TYPE_IN_MS) / period,
        deleteAt / period,
        (deleteAt + DELETE_MS) / period,
      ],
      ease: ["easeOut", "linear", "easeIn"],
    });
    return h("div", {
      className: `tw-ch-${i}`,
      style: { ...charStyle, whiteSpace: "pre" },
      children: ch === " " ? "\u00a0" : ch,
    });
  });

  // Cursor: blinks while typing/deleting, solid through the hold and tail.
  const cursorEl = h("div", {
    className: "tw-cursor",
    style: {
      width: Math.round(fontSize * 0.52),
      height: Math.round(fontSize * 1.02),
      backgroundColor: accent,
      borderRadius: Math.max(3, Math.round(fontSize * 0.07)),
      marginLeft: Math.max(10, Math.round(fontSize * 0.22)),
    },
  });
  ambientWindow(tl, ".tw-cursor", "pulse", {
    periodMs: period,
    windows: [typeWindow, deleteWindow],
    amplitude: 0.85,
    phase: "high-low-high", // rests SOLID through the hold and tail
    fps,
    label: "typewriterBanner cursor",
  });

  let taglineEl: ReactElementLike | null = null;
  if (props.tagline) {
    taglineEl = h("div", {
      className: "tw-tagline",
      style: {
        ...textStyles(theme, clamp(12, Math.round(fontSize * 0.26), 19), { dim: true, weight: 500 }),
        letterSpacing: Math.max(3, Math.round(fontSize * 0.075)),
        marginTop: Math.round(fontSize * 0.5),
      },
      children: props.tagline,
    });
  }

  const element = root({
    width,
    height,
    className: "tw-root",
    background,
    theme,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    children: [
      glowEl,
      h("div", {
        style: { display: "flex", alignItems: "center", justifyContent: "center" },
        children: [...charEls, cursorEl],
      }),
      taglineEl,
    ],
  });

  const timeline = tl.toJSON();
  const seam = checkLoopSeam(timeline);
  if (!seam.seamless) {
    throw new Error(`typewriterBanner: internal loop check failed: ${seam.notes.join(" ")}`);
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
