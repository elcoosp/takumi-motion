// takumi-motion — react/material.tsx (v0.9 Bet C)
// The material pack: surface treatments as runtime components.
//
//   <Reveal>            directional wipe that uncovers its children —
//                       mask-gradient engine (featherable), doubles as the
//                       draw engine behind <LineChart>'s clip reveal.
//   <Mask>              declarative mask_image wrapper (+ fade presets).
//   <VariableText>      fontVariationSettings weight tracks — text that
//                       swells from one weight to another (needs a variable
//                       font registered via <Banner fonts weight="100..900">).
//   <GradientText>      background-clip:text gradient fill.
//
// All are pure functions of (frame, props); settled frames emit NO override
// styles so the chunker keeps merging holds.

import { createElement, type ReactNode } from "react";
import { useCurrentFrame, useDriver } from "./context.js";
import { interpolateFor } from "./motion.js";
import type { TakumiStyle } from "../style.js";

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------------------
// Shared timing
// ---------------------------------------------------------------------------

interface DrawTiming {
  frame: number;
  /** Progress in [0, 1]; 0 before the delay, 1 after the draw window. */
  progress: number;
  /** True while 0 < progress < 1 (the only frames that need overrides). */
  animating: boolean;
}

function drawProgress(
  frame: number,
  durationFrames: number | undefined,
  delayFrames: number | undefined,
): DrawTiming {
  const duration = Math.max(1, durationFrames ?? 30);
  const delay = Math.max(0, delayFrames ?? 0);
  const local = frame - delay;
  if (local <= 0) return { frame, progress: 0, animating: false };
  if (local >= duration) return { frame, progress: 1, animating: false };
  return {
    frame,
    progress: interpolateFor(local, [0, duration], [0, 1], "easeInOut"),
    animating: true,
  };
}

// ---------------------------------------------------------------------------
// <Reveal>
// ---------------------------------------------------------------------------

export type RevealWipe = "left" | "right" | "up" | "down" | "circle";

export interface RevealProps {
  children?: ReactNode;
  /** Direction the reveal TRAVELS: "right" uncovers left→right (the
   *  LineChart draw direction), "left" right→left, "up" bottom→top,
   *  "down" top→bottom, "circle" radially outward. Default "right". */
  wipe?: RevealWipe;
  /** Frames from covered to fully revealed. Default 30. */
  drawDurationFrames?: number;
  drawDelayFrames?: number;
  /** Soft edge length in px. 0 = hard edge (palette-safe for GIF).
   *  Default 0. */
  feather?: number;
  /** Merged under the per-frame mask overrides. */
  style?: TakumiStyle;
}

/**
 * Directional wipe reveal. The children are ALWAYS laid out (no movement, no
 * reflow) — a per-frame mask gradient decides which part is visible, so the
 * encoder sees one stable tree with an alpha edge. At progress 1 the mask is
 * omitted entirely; before the draw the mask hides everything.
 *
 * ```tsx
 * <Reveal wipe="up" feather={24} drawDurationFrames={26}>
 *   <QuoteCard />
 * </Reveal>
 * ```
 */
export function Reveal(props: RevealProps): ReactNode {
  const frame = useCurrentFrame();
  const driver = useDriver();
  const width = props.style?.width as number | undefined ?? driver.registry.banner?.width ?? 320;
  const height = props.style?.height as number | undefined ?? driver.registry.banner?.height ?? 180;
  const { progress, animating } = drawProgress(frame, props.drawDurationFrames, props.drawDelayFrames);
  const wipe = props.wipe ?? "right";
  const feather = Math.max(0, props.feather ?? 0);

  if (!animating && progress >= 1) {
    return createElement("div", { style: props.style }, props.children);
  }

  const gradient = revealGradient(wipe, progress, feather, width, height);
  return createElement("div", {
    style: {
      ...(props.style ?? {}),
      maskImage: gradient,
      WebkitMaskImage: gradient,
    } as TakumiStyle,
  }, props.children);
}

/**
 * The mask gradient for one reveal state (deterministic string). Pixel-space
 * stops: the visible band grows from the START edge along the travel
 * direction, with an optional soft `feather` band ahead of the edge.
 */
export function revealGradient(
  wipe: RevealWipe,
  progress: number,
  feather: number,
  width: number,
  height: number,
): string {
  const visible = Math.max(0, Math.min(1, progress));
  const f = Math.max(0, feather);

  if (wipe === "circle") {
    const maxR = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2) + f;
    const r = r6(visible * maxR);
    return `radial-gradient(circle at 50% 50%, black 0px, black ${r}px, transparent ${r6(r + f)}px)`;
  }

  // Axis: 90deg → rightward, 270deg → leftward, 0deg → upward, 180deg →
  // downward (CSS gradient angles). Travel length = the box's extent along
  // the axis. feather=0 → same-position stops = hard cut (palette-safe).
  const axis = wipe === "right" ? 90 : wipe === "left" ? 270 : wipe === "up" ? 0 : 180;
  const span = wipe === "left" || wipe === "right" ? width : height;
  const edge = r6(visible * span);
  if (visible <= 0) {
    return `linear-gradient(${axis}deg, transparent 0px, transparent ${r6(span)}px)`;
  }
  return `linear-gradient(${axis}deg, black 0px, black ${edge}px, transparent ${r6(edge + f)}px)`;
}

// ---------------------------------------------------------------------------
// <Mask>
// ---------------------------------------------------------------------------

export type MaskFadePreset = "top" | "bottom" | "left" | "right";

export interface MaskProps {
  children?: ReactNode;
  /** Raw mask-image value (any CSS <mask-image>). Wins over `fade`. */
  image?: string;
  /** Convenience edge-fade presets (24px soft bands). */
  fade?: MaskFadePreset;
  /** Length of the fade band for presets, in px. Default 24. */
  fadeLength?: number;
  /** mask-mode. Default "alpha" (luminance surprises nobody here). */
  mode?: "alpha" | "luminance" | "match-source";
  style?: TakumiStyle;
}

const FADE_GRADIENTS: Record<MaskFadePreset, (len: number) => string> = {
  top: (len) => `linear-gradient(0deg, black ${len}px, transparent ${len * 2}px)`,
  bottom: (len) => `linear-gradient(180deg, black ${len}px, transparent ${len * 2}px)`,
  left: (len) => `linear-gradient(90deg, black ${len}px, transparent ${len * 2}px)`,
  right: (len) => `linear-gradient(270deg, black ${len}px, transparent ${len * 2}px)`,
};

/**
 * Declarative alpha mask over any subtree — the multi-gradient evidence
 * channel (spike C1). Use `image` for full control or `fade` for the common
 * edge-fade presets. Static by doctrine: a mask that changes per frame is a
 * <Reveal> (or raw style) job.
 */
export function Mask(props: MaskProps): ReactNode {
  const image = props.image ?? (props.fade ? FADE_GRADIENTS[props.fade](props.fadeLength ?? 24) : undefined);
  if (!image) {
    throw new Error("<Mask>: provide `image` (a CSS mask-image value) or `fade` (a preset).");
  }
  return createElement("div", {
    style: {
      ...(props.style ?? {}),
      maskImage: image,
      WebkitMaskImage: image,
      ...(props.mode ? { maskMode: props.mode } : {}),
    } as TakumiStyle,
  }, props.children);
}

// ---------------------------------------------------------------------------
// <VariableText>
// ---------------------------------------------------------------------------

export interface VariableTextProps {
  text: string;
  /** Starting weight. Default 300. */
  from?: number;
  /** Final weight. Default 800. */
  to?: number;
  /** Frames from `from` to `to`. Default: 24. */
  durationFrames?: number;
  drawDelayFrames?: number;
  /** Variation axis. Default "wght" (the only universally variable axis). */
  axis?: string;
  fontSize?: number;
  style?: TakumiStyle;
}

/**
 * Weight-swell text via fontVariationSettings — the variable-font track
 * (spike C2). Requires a VARIABLE font on the renderer (e.g.
 * `<Banner fonts={{ name: "Noto Sans", weight: "100..900" }}>`); a static
 * face renders its single weight throughout (visually a no-op — check the
 * font spec if the swell looks flat).
 *
 * ```tsx
 * <VariableText text="Signal" from={300} to={800} durationFrames={30} />
 * ```
 */
export function VariableText(props: VariableTextProps): ReactNode {
  const frame = useCurrentFrame();
  const { progress } = drawProgress(frame, props.durationFrames ?? 24, props.drawDelayFrames);
  const from = props.from ?? 300;
  const to = props.to ?? 800;
  const axis = props.axis ?? "wght";
  const weight = Math.round(from + (to - from) * progress);
  return createElement("div", {
    style: {
      ...(props.fontSize !== undefined ? { fontSize: props.fontSize } : {}),
      fontVariationSettings: `'${axis}' ${weight}`,
      whiteSpace: "pre",
      ...(props.style ?? {}),
    } as TakumiStyle,
  }, props.text);
}

// ---------------------------------------------------------------------------
// <GradientText>
// ---------------------------------------------------------------------------

export interface GradientTextProps {
  text: string;
  /** Any CSS background paint. Default: the classic sky→violet band. */
  gradient?: string;
  fontSize?: number;
  fontWeight?: number;
  style?: TakumiStyle;
}

/**
 * Gradient-filled text (spike C3): background-clip:text + transparent
 * foreground. Static by doctrine — the gradient itself can be re-specified
 * per frame by the author, but nothing here animates.
 */
export function GradientText(props: GradientTextProps): ReactNode {
  return createElement("div", {
    style: {
      ...(props.fontSize !== undefined ? { fontSize: props.fontSize } : {}),
      ...(props.fontWeight !== undefined ? { fontWeight: props.fontWeight } : {}),
      backgroundImage: props.gradient ?? "linear-gradient(90deg, #38bdf8, #a78bfa)",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      whiteSpace: "pre",
      ...(props.style ?? {}),
    } as TakumiStyle,
  }, props.text);
}
