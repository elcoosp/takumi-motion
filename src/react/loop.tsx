// takumi-motion — react/loop.tsx (v0.5)
// <Loop durationInFrames times> — a repeated window with rebased frames.
//
// The subtree sees frame = (parentFrame % durationInFrames) while the parent
// frame is inside the loop's total span (durationInFrames × times). After the
// span the subtree renders null — a real structural change, so the chunker
// sees honest boundaries. Everything stays a pure function of the parent
// frame, so the determinism doctrine holds.
//
//   <Scene duration={90}>
//     <Loop durationInFrames={30} times={3}>
//       {(iteration) => <Marquee offset={iteration * 40} />}
//     </Loop>
//   </Scene>
//
// Nested Loops compose naturally: the inner Loop rebases on whatever context
// the outer Loop provided.

import { createElement, type ReactNode } from "react";
import { FrameContext, useFrame, type FrameInfo } from "./context.js";

export interface LoopProps {
  /** Length of ONE iteration in frames — also the subtree's window length
   *  (useDuration() inside the loop reports this, like a mini-scene). */
  durationInFrames: number;
  /** Iteration count. Default Infinity — loop until the parent scope ends. */
  times?: number;
  /** Static children, or a render prop receiving the 0-based iteration index. */
  children?: ReactNode | ((iteration: number) => ReactNode);
}

const LOOP_MARKER_NAME = "__takumiLoop";

function LoopMarker(props: LoopProps): ReactNode {
  const parent = useFrame();

  const length = props.durationInFrames;
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`<Loop>: durationInFrames must be a positive integer, got ${length}.`);
  }
  const times = props.times ?? Infinity;
  if (times !== Infinity && (!Number.isInteger(times) || times < 1)) {
    throw new Error(`<Loop>: times must be a positive integer (or omitted for "until the scope ends"), got ${times}.`);
  }

  const totalFrames = times === Infinity ? Infinity : length * times;
  if (parent.frame >= totalFrames) return null;

  const childFrame = parent.frame % length;
  const iteration = Math.floor(parent.frame / length);
  const content =
    typeof props.children === "function" ? (props.children as (i: number) => ReactNode)(iteration) : props.children;

  return createElement(
    FrameContext.Provider,
    { value: rebaseForLoop(parent, childFrame, length) },
    content,
  );
}
Object.defineProperty(LoopMarker, LOOP_MARKER_NAME, { value: true });

/** Repeating window — children see a modulo-rebased frame context. */
export const Loop = LoopMarker as typeof LoopMarker & { readonly __takumiLoop: true };

/** True when the value is a <Loop> element. */
export function isLoopElement(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null &&
    (value as { $$typeof?: unknown }).$$typeof !== undefined &&
    (value as { type?: unknown }).type === LoopMarker
  );
}

/**
 * Build the child FrameInfo for the loop's local frame. `sceneFrames` is the
 * iteration length the CHILD authors against (useDuration inside the loop).
 * `absolute` KEEPS the true timeline position — a loop rebases local time,
 * not the global grid (frame 27 of a 20-frame loop really is absolute 27).
 * `timeMs` follows the child's local frame, matching the Sequence rebase
 * contract for springs/pulses.
 */
function rebaseForLoop(parent: FrameInfo, childFrame: number, sceneFrames: number): FrameInfo {
  return {
    frame: childFrame,
    absolute: parent.absolute,
    sceneFrames,
    bannerFrames: parent.bannerFrames,
    fps: parent.fps,
    timeMs: (childFrame * 1000) / parent.fps,
  };
}
