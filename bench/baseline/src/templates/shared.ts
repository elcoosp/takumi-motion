// takumi-motion — templates/shared.ts
// Design-token plumbing, layout helpers, and measure-based text fitting
// shared by the built-in banner templates.
//
// v0.2: everything is theme-driven (no hardcoded colors), Google Fonts flow
// through the shared renderer (measure-fitting and rendering use the SAME
// face), and every template resolves a personality for coherent motion.
//
// Text fitting: takumi's Renderer.measure() returns exact laid-out text-run
// widths, so templates never guess font metrics — titles/numbers are fitted
// to their layout box and cannot overflow (the bug class that produced
// clipped banners in v0.1-pre).

import type { Renderer } from "takumi-js/node";
import type { ReactElementLike, TimelineJSON } from "../types.js";
import { h, type VNodeChildren, type VNodeStyle } from "../jsx.js";
import { resolveTheme, type Theme, type ThemeInput } from "../themes.js";
import { resolvePersonality, type Personality, type PersonalityName } from "../personality.js";
import { ensureFonts, fontStack, type FontLoadResult, type FontSpec } from "../fonts.js";

export const FONT_STACK = "sans-serif"; // resolves to Takumi's bundled Geist (Latin)

/** v0.1 token alias — midnight theme's palette. New code uses resolveTheme(). */
export const TOKENS = {
  text: "#f1f5f9",
  textDim: "#8ea0b5",
  textFaint: "rgba(203, 213, 225, 0.55)",
  surface: "rgba(148, 163, 184, 0.10)",
  surfaceBorder: "rgba(148, 163, 184, 0.22)",
} as const;

export interface BannerResult {
  /** React-shaped element — renderBanner runs fromJsx on it automatically. */
  element: ReactElementLike;
  timeline: TimelineJSON;
  /** Font families the template registered for measurement — renderBanner
   *  loads the same specs before rendering so output matches the fit. */
  fonts?: FontSpec[];
  /** Primary font family used in styles (informational). */
  fontFamily?: string;
  /** Theme the template resolved (informational). */
  theme?: string;
  /** Motion personality the template resolved (informational). */
  motion?: string;
}

export function clamp(min: number, value: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// Shared renderer + text measurement
// v0.6: the implementation moved to measure.ts (first-class module with the
// sync fit-cache <FitText> uses); templates re-export for compatibility.
// ---------------------------------------------------------------------------

export {
  getSharedRenderer,
  setSharedRenderer,
  measureTextWidth,
  fitFontSize,
  clearMeasureCache,
  type FitTextOptions,
} from "../measure.js";
import { getSharedRenderer } from "../measure.js";

// ---------------------------------------------------------------------------
// Shared template props: theme + motion + font, resolved once
// ---------------------------------------------------------------------------

export interface TemplateStyleProps {
  /** Theme name or partial token object. Default "midnight". */
  theme?: ThemeInput;
  /** Motion personality. Default "snappy". */
  motion?: PersonalityName | Personality;
  /** Google Font family (name or full spec) for the banner text.
   *  Loaded through the shared renderer so fitting and rendering agree. */
  font?: FontSpec;
  /** Extra font weights to register when `font` is a bare name. Default [700]. */
  fontWeights?: number[];
  /** Logical canvas size in px. */
  width?: number;
  height?: number;
  /** Timeline grid fps — MUST match the render fps. */
  fps?: number;
  /** Reuse a warm Renderer for text measurement. */
  renderer?: Renderer;
}

export interface ResolvedStyle {
  theme: Theme;
  personality: Personality;
  fontFamily?: string;
  fontResult?: FontLoadResult;
  renderer: Renderer;
}

/**
 * Resolve the shared template props: theme tokens, personality, and the
 * Google Font (registered on the renderer used for measurement — the same
 * renderer renderBanner defaults to, so output matches the fit).
 */
export async function resolveTemplateStyle(
  props: TemplateStyleProps,
  defaults: { theme?: ThemeInput; motion?: PersonalityName | Personality } = {}
): Promise<ResolvedStyle> {
  const theme = resolveTheme(props.theme ?? defaults.theme ?? "midnight");
  const personality = resolvePersonality(props.motion ?? defaults.motion ?? "snappy");
  const renderer = props.renderer ?? (await getSharedRenderer());

  let fontFamily: string | undefined;
  let fontResult: FontLoadResult | undefined;
  if (props.font) {
    const spec: FontSpec =
      typeof props.font === "string"
        ? { name: props.font, weight: props.fontWeights ?? [400, 700] }
        : props.font;
    fontResult = await ensureFonts(renderer, spec);
    fontFamily = fontStack(spec.name, "sans-serif");
  }

  return { theme, personality, fontFamily, fontResult, renderer };
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function root(opts: {
  width: number;
  height: number;
  className: string;
  /** Gradient (backgroundImage) or flat color (backgroundColor). */
  background: string;
  children: VNodeChildren;
  /** Horizontal padding. Default 48. */
  paddingX?: number;
  /** Vertical padding. Default 0 (rows center themselves). */
  paddingY?: number;
  justify?: string;
  align?: string;
  /** Theme tokens — text color + font family come from here. */
  theme?: Theme;
  /** Primary font family (CSS font-family value). */
  fontFamily?: string;
}): ReactElementLike {
  const isPaint = /gradient\(|url\(|none|^initial$|^unset$|^inherit$/.test(opts.background);
  const bgStyle = isPaint
    ? { backgroundImage: opts.background }
    : { backgroundColor: opts.background };
  return h("div", {
    className: opts.className,
    style: {
      width: opts.width,
      height: opts.height,
      display: "flex",
      flexDirection: "column",
      justifyContent: opts.justify ?? "center",
      alignItems: opts.align ?? "center",
      padding: `${opts.paddingY ?? 0}px ${opts.paddingX ?? 48}px`,
      ...bgStyle,
      fontFamily: opts.fontFamily ?? FONT_STACK,
      color: opts.theme?.text ?? TOKENS.text,
      position: "relative",
      overflow: "hidden",
      boxSizing: "border-box",
    },
    children: opts.children,
  });
}

/** Absolute-positioned soft glow blob, moved by transform tracks. */
export function glow(opts: {
  className: string;
  width: number;
  height: number;
  color: string;
  opacity: number;
  blur: number;
  left: number;
  top: number;
}): ReactElementLike {
  return h("div", {
    className: opts.className,
    style: {
      position: "absolute",
      left: opts.left,
      top: opts.top,
      width: opts.width,
      height: opts.height,
      borderRadius: 999,
      backgroundColor: opts.color,
      opacity: opts.opacity,
      filter: `blur(${opts.blur}px)`,
    },
  });
}

/** Theme-driven glow defaults: accent color at the theme's ambient opacity. */
export function themeGlow(
  className: string,
  theme: Theme,
  size: { width: number; height: number; left: number; top: number },
  opacityScale = 1
): ReactElementLike {
  return glow({
    className,
    ...size,
    color: theme.accent,
    opacity: Math.min(0.16, theme.glow * opacityScale),
    blur: 44,
  });
}

/** Standard text styles from theme tokens. */
export function textStyles(theme: Theme, size: number, opts: {
  weight?: number;
  dim?: boolean;
  faint?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
} = {}): VNodeStyle {
  return {
    fontSize: size,
    fontWeight: opts.weight ?? 700,
    color: opts.faint ? theme.textFaint : opts.dim ? theme.textDim : theme.text,
    ...(opts.letterSpacing !== undefined ? { letterSpacing: opts.letterSpacing } : {}),
    ...(opts.lineHeight !== undefined ? { lineHeight: opts.lineHeight } : {}),
  };
}

// ---------------------------------------------------------------------------
// Loop-period helpers (strict seams — no full-banner fade pulses)
// ---------------------------------------------------------------------------

/** Round a duration up to the fps frame grid. */
export function gridCeil(ms: number, fps: number): number {
  const frameMs = 1000 / fps;
  return Math.round(Math.ceil(ms / frameMs - 1e-9) * frameMs * 1000) / 1000;
}

/**
 * Loop period for strict-seam banners: grid-aligned AND spanning an EVEN
 * number of frames. Ambient mirror tracks run at period/2 — an odd frame
 * count would make period/2 land between frames, and the timeline duration
 * (rounded up by toJSON/compile) would overshoot the period, leaving ambient
 * tracks slightly off their start value at the seam.
 */
export function loopPeriod(ms: number, fps: number): number {
  const frameMs = 1000 / fps;
  const frames = Math.max(2, Math.ceil(ms / frameMs - 1e-9));
  const even = frames % 2 === 0 ? frames : frames + 1;
  // Raw frames×frameMs — deliberately NOT µs-rounded: rounding 4166.666… up to
  // 4166.667 would push toJSON/compile's ceil to the NEXT frame, inflating the
  // timeline past the ambient mirror cycle and breaking the seam.
  return even * frameMs;
}

/**
 * Snap a window boundary pair to whole-even-frame alignment: start rounds
 * DOWN to the frame grid, length rounds UP to an even frame count. Guarantees
 * ambientWindow's invariants for windows derived from content timings
 * (per-character staggers etc. land off-grid).
 *
 * `minStart` keeps consecutive windows non-overlapping after snapping: the
 * start never lands before it (rounds up to the next frame past it when the
 * floor would collide).
 */
export function evenWindow(startMs: number, endMs: number, fps: number, minStart = -Infinity): [number, number] {
  const frameMs = 1000 / fps;
  const floorStart = Math.floor(startMs / frameMs);
  // Exclusive lower bound: the snapped start must land STRICTLY after minStart
  // (the previous window's end), else adjacent windows collide after rounding.
  const minStartFrames = minStart === -Infinity ? floorStart : Math.floor(minStart / frameMs) + 1;
  const s = Math.max(floorStart, minStartFrames) * frameMs;
  const frames = Math.max(2, Math.ceil((endMs - s) / frameMs - 1e-9));
  const even = frames % 2 === 0 ? frames : frames + 1;
  return [Math.round(s * 1000) / 1000, Math.round((s + even * frameMs) * 1000) / 1000];
}

/**
 * Ambient tracks (glow drift, cursor blink) must complete whole mirror cycles
 * within the loop period to keep strict seams honest: mirror full cycle =
 * 2 × duration, so author them with `duration = period / 2` (or /4, /6 …).
 * This helper asserts the convention at construction time.
 *
 * Canonical home: loop.ts — re-exported here for template compatibility.
 */
export { assertAmbientPeriod } from "../loop.js";
