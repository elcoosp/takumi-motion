// takumi-motion — react/kit.tsx (v0.6 + v0.9 CountUp v2)
// The kinetic content kit: high-frequency banner patterns as runtime
// components. These are the things every README banner hand-rolls — a number
// counting up, text typing on, an ambient glow — extracted from the template
// factories into composable pieces that work INSIDE any <Scene>.
//
// Kit components are deliberately SIMPLE (direct per-frame text/opacity — the
// chunker merges holds automatically). The template factories in /recipes
// remain the advanced versions (digit-layer crossfades, measure-fitted
// layouts) for whole-banner composition.
//
// All kit components are deterministic: pure functions of (frame, props) —
// no Math.random, no clock.

import { createElement, type ReactNode } from "react";
import { useCurrentFrame, useDuration, useFps, usePulse } from "./context.js";
import { interpolateFor, springFor } from "./motion.js";
import type { TakumiStyle } from "../style.js";

// ---------------------------------------------------------------------------
// <CountUp>
// ---------------------------------------------------------------------------

export interface CountUpProps {
  /** Final value. */
  to: number;
  /** Start value. Default 0. */
  from?: number;
  /** Frames from start to finish. Default: the whole scene. */
  durationFrames?: number;
  /** Frames to wait before counting. Default 0. */
  delayFrames?: number;
  /** "linear" (default) or a spring config (motion-consistent overshoot). */
  spring?: { stiffness?: number; damping?: number };
  /** Easing name for the tween path. Default "easeOut". */
  ease?: Parameters<typeof interpolateFor>[3];
  /**
   * v0.9 — number formatting.
   *
   * A STRING is a compact format pattern:
   *   "$,.0f"  → $ prefix, thousands grouping, 0 decimals
   *   ",.1f"   → grouping, 1 decimal
   *   "+,.0f%" → + prefix (literal), thousands grouping, % suffix
   *   "ms"     → plain value + literal suffix
   * Grammar: `[prefix][, grouping][.Nf decimals][suffix]` — the prefix is
   * everything before the first `,`/`.Nf` marker; when the pattern contains
   * neither marker the WHOLE string is the suffix. tabular-nums is always
   * forced so digit columns never jitter.
   *
   * A FUNCTION formats per frame (v0.6 behavior, still supported).
   *
   * Default: Math.round().toString().
   */
  format?: string | ((value: number) => string);
  style?: TakumiStyle;
}

/**
 * Animated number (v2). The rendered STRING changes per frame during the
 * count (one chunk per value) and holds afterward — pair with WebP for cheap
 * text-only deltas.
 *
 * ```tsx
 * <Scene duration={90}>
 *   <CountUp to={128400} format="$,.0f" durationFrames={60} delayFrames={8} />
 *   <CountUp to={99.98} format=",.1f+%" />
 * </Scene>
 * ```
 */
export function CountUp(props: CountUpProps): ReactNode {
  const frame = useCurrentFrame();
  const sceneFrames = useDuration();
  const fps = useFps();
  const from = props.from ?? 0;
  const duration = props.durationFrames ?? sceneFrames;
  const local = Math.max(0, frame - (props.delayFrames ?? 0));

  let value: number;
  if (props.spring) {
    value = springFor(local, fps, {
      from,
      to: props.to,
      stiffness: props.spring.stiffness,
      damping: props.spring.damping,
    });
  } else {
    value = interpolateFor(local, [0, Math.max(1, duration)], [from, props.to], props.ease ?? "easeOut");
  }

  const text = typeof props.format === "string"
    ? formatNumberPattern(value, props.format)
    : props.format
      ? props.format(value)
      : String(Math.round(value));
  return createElement("div", { style: { fontVariantNumeric: "tabular-nums", ...(props.style ?? {}) } }, text);
}

// ---------------------------------------------------------------------------
// CountUp v2 — the compact format pattern (v0.9 Bet A)
// ---------------------------------------------------------------------------

interface NumberPattern {
  prefix: string;
  grouping: boolean;
  decimals: number | null;
  suffix: string;
}

const DECIMALS_RE = /^\.\d+f/;

/**
 * Parse "$,.0f" → { prefix: "$", grouping: true, decimals: 0, suffix: "" }.
 * Deterministic split: prefix = everything before the FIRST `,` or `.Nf`
 * marker; a pattern with neither marker is a literal suffix ("ms" → "42ms").
 */
export function parseNumberPattern(pattern: string): NumberPattern {
  const marker = /,|\.\d+f/.exec(pattern);
  if (!marker || marker.index === undefined) {
    return { prefix: "", grouping: false, decimals: null, suffix: pattern };
  }
  const prefix = pattern.slice(0, marker.index);
  let rest = pattern.slice(marker.index);
  let grouping = false;
  if (rest.startsWith(",")) {
    grouping = true;
    rest = rest.slice(1);
  }
  const dec = DECIMALS_RE.exec(rest);
  let decimals: number | null = null;
  if (dec) {
    decimals = Math.min(parseInt(dec[0].slice(1, -1), 10), 12);
    rest = rest.slice(dec[0].length);
  }
  return { prefix, grouping, decimals, suffix: rest };
}

/** Insert thousands separators into the integer part of a digit string. */
export function groupDigits(digits: string): string {
  const neg = digits.startsWith("-");
  const body = neg ? digits.slice(1) : digits;
  const [int, frac] = body.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""}`;
}

/** Format `value` through a CountUp pattern string (deterministic, no Intl). */
export function formatNumberPattern(value: number, pattern: string): string {
  const p = parseNumberPattern(pattern);
  const body = p.decimals !== null ? value.toFixed(p.decimals) : String(Math.round(value));
  return `${p.prefix}${p.grouping ? groupDigits(body) : body}${p.suffix}`;
}

// ---------------------------------------------------------------------------
// <Typewriter>
// ---------------------------------------------------------------------------

export interface TypewriterProps {
  /** The full text, typed on over durationFrames. */
  text: string;
  /** Frames from empty to full text. Default: the whole scene minus hold. */
  durationFrames?: number;
  /** Frames to wait before typing. Default 0. */
  delayFrames?: number;
  /** Show a blinking cursor. Default true. */
  cursor?: boolean;
  /** Cursor blink period in frames. Default 15 (even periods keep loops seam-safe). */
  cursorPeriodFrames?: number;
  /** Legacy GLYPH cursor (e.g. "_"). Default: a font-independent block span
   *  sized in em — banner fonts rarely ship U+258C, and a missing glyph
   *  renders as tofu (the v0.8 demo's Sora cursor drew ▯). */
  cursorChar?: string;
  /** Cursor color. Default "currentColor" — follows the text color. */
  cursorColor?: string;
  style?: TakumiStyle;
}

/**
 * Type-on text with a deterministic blinking cursor. Per-frame character
 * gating — the hold after completion is chunk-merged automatically.
 *
 * The default cursor is a styled inline-block (em-sized, currentColor) whose
 * OPACITY blinks — the layout box never appears/disappears, so the line
 * cannot reflow between blinks. Pass `cursorChar` for a glyph cursor.
 */
export function Typewriter(props: TypewriterProps): ReactNode {
  const frame = useCurrentFrame();
  const sceneFrames = useDuration();
  const duration = props.durationFrames ?? Math.max(1, sceneFrames - 12);
  const local = Math.max(0, frame - (props.delayFrames ?? 0));

  const visible = Math.min(
    props.text.length,
    Math.floor(interpolateFor(local, [0, Math.max(1, duration)], [0, props.text.length], "linear")),
  );
  const typed = props.text.slice(0, visible);

  const cursorOn = props.cursor !== false && usePulse(props.cursorPeriodFrames ?? 15) >= 0.5;

  let children: ReactNode;
  if (props.cursorChar !== undefined) {
    // Legacy glyph path — the author chose the character.
    children = cursorOn ? `${typed}${props.cursorChar}` : typed;
  } else if (props.cursor !== false) {
    children = [
      typed,
      createElement("span", {
        key: "takumi-cursor",
        style: {
          display: "inline-block",
          width: "0.55em",
          height: "0.9em",
          marginLeft: "0.12em",
          backgroundColor: props.cursorColor ?? "currentColor",
          opacity: cursorOn ? 1 : 0,
        } as TakumiStyle,
      }),
    ];
  } else {
    children = typed;
  }

  return createElement("div", { style: { whiteSpace: "pre", ...(props.style ?? {}) } }, children);
}

// ---------------------------------------------------------------------------
// <Glow>
// ---------------------------------------------------------------------------

export interface GlowProps {
  /** Glow color. Default the midnight accent. */
  color?: string;
  /** Blob diameter in px. Default 220. */
  size?: number;
  /** Center position (CSS px, canvas-absolute). */
  x?: number;
  y?: number;
  /** Blur radius in px. Default 44. */
  blur?: number;
  /** Peak opacity. Default 0.14 — tuned under the GIF dither size trap. */
  opacity?: number;
  /** Animate with useNoise-style drift? Off by default (drift = more unique chunks). */
  style?: TakumiStyle;
}

/**
 * Soft ambient glow blob (absolute, blurred, low opacity). The v0.1 size
 * doctrine baked in as defaults: low opacity + moderate blur keeps GIF
 * palette dithering under control; render glow-heavy surfaces as WebP when
 * in doubt.
 */
export function Glow(props: GlowProps): ReactNode {
  const size = props.size ?? 220;
  return createElement("div", {
    style: {
      position: "absolute",
      left: (props.x ?? 0) - size / 2,
      top: (props.y ?? 0) - size / 2,
      width: size,
      height: size,
      borderRadius: 999,
      backgroundColor: props.color ?? "#38bdf8",
      opacity: props.opacity ?? 0.14,
      filter: `blur(${props.blur ?? 44}px)`,
      pointerEvents: "none",
      ...(props.style ?? {}),
    },
  });
}
