// takumi-motion — react/text.tsx (v0.5)
// Kinetic typography kit for the React runtime. The declarative path has
// orchestrate.ts (splitGlyphs / splitWords / waveUnits); this is the
// React-native counterpart: deterministic splitting + per-unit stagger
// springs, so per-character and per-word choreography is three lines.
//
//   <SplitText
//     text="ship faster"
//     by="chars"
//     renderUnit={(unit, { frame, fps }) => (
//       <span style={{
//         display: "inline-block",
//         opacity: staggeredSpringFor(unit.index, frame, fps, { intervalFrames: 2 }),
//         transform: `translateY(${(1 - staggeredSpringFor(unit.index, frame, fps)) * 14}px)`,
//       }}>{unit.text}</span>
//     )}
//   />
//
// Splitting is deterministic (Array.from — surrogate pairs stay whole) and
// the component is hook-free by default, so it also renders in plain React
// trees (preview pages, Storybook) with the frame context defaulting to 0.

import { createElement, Fragment, useContext, type ReactNode } from "react";
import { FrameContext } from "./context.js";

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

export type SplitMode = "chars" | "words";

export interface TextUnit {
  /** The unit's text — one glyph (chars mode) or one word (words mode). */
  text: string;
  /** Unit index (0-based). In chars mode spaces carry an index too. */
  index: number;
  /** Total unit count. */
  total: number;
  /** True for whitespace glyphs (chars mode). Words mode never emits spaces. */
  isSpace: boolean;
}

/**
 * Split `text` into deterministic animation units.
 *
 * - `"chars"` — every glyph via Array.from (surrogate pairs stay whole;
 *   combining marks remain separate — good enough for banner choreography).
 *   Whitespace glyphs are units with `isSpace: true`.
 * - `"words"` — runs of whitespace split words; whitespace is NOT part of
 *   the output (spacing is the renderer's job — SplitText's default renderer
 *   inserts single spaces between word units).
 */
export function splitText(text: string, mode: SplitMode = "chars"): TextUnit[] {
  if (typeof text !== "string") {
    throw new Error(`splitText: text must be a string, got ${typeof text}.`);
  }
  if (mode === "words") {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    return words.map((text, index) => ({ text, index, total: words.length, isSpace: false }));
  }
  const glyphs = Array.from(text);
  return glyphs.map((text, index) => ({
    text,
    index,
    total: glyphs.length,
    isSpace: /\s/.test(text),
  }));
}

// ---------------------------------------------------------------------------
// SplitText
// ---------------------------------------------------------------------------

export interface SplitTextRenderContext {
  /** Frame from the enclosing FrameContext (0 outside a scene). */
  frame: number;
  /** fps from the enclosing FrameContext (30 outside a scene). */
  fps: number;
}

export interface SplitTextProps {
  text: string;
  /** Unit granularity. Default "chars". */
  by?: SplitMode;
  /** Render one unit. Receives the unit plus the enclosing frame context —
   *  use staggeredSpringFor(unit.index, frame, fps) for classic staggered
   *  entrances. Default: plain <span>s (words joined with single spaces). */
  renderUnit?: (unit: TextUnit, context: SplitTextRenderContext) => ReactNode;
}

const SCENE_FRAME_FALLBACK: SplitTextRenderContext = { frame: 0, fps: 30 };

function defaultSpan(text: string, index: number): ReactNode {
  return createElement("span", { key: `takumi-unit-${index}`, style: { display: "inline-block" } }, text);
}

/**
 * Map text through animation units. Hook usage is guarded: the frame context
 * is read with useContext directly (NOT useFrame) so the component also works
 * outside the runtime — context.frame defaults to 0 there.
 */
export function SplitText(props: SplitTextProps): ReactNode {
  const by = props.by ?? "chars";
  const units = splitText(props.text, by);
  const frameCtx = useContext(FrameContext);
  const context: SplitTextRenderContext = frameCtx
    ? { frame: frameCtx.frame, fps: frameCtx.fps }
    : SCENE_FRAME_FALLBACK;

  if (props.renderUnit) {
    const renderUnit = props.renderUnit;
    return units.map((unit) => {
      const rendered = renderUnit(unit, context);
      return rendered === null || rendered === undefined ? null : rendered;
    });
  }

  // Default renderer: inline-block spans; words mode joins with single spaces.
  return units.map((unit, i) => (
    <Fragment key={`takumi-unit-${unit.index}`}>
      {unit.isSpace ? unit.text : defaultSpan(unit.text, unit.index)}
      {by === "words" && i < units.length - 1 ? " " : null}
    </Fragment>
  ));
}
