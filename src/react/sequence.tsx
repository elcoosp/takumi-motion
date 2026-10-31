// takumi-motion — react/sequence.tsx (v0.4)
// Time-control vocabulary for the frame-driven runtime:
//
//   <Sequence from={30} durationInFrames={60} speed={2} reverse={false}>
//     …children see a REBASED FrameContext…
//   </Sequence>
//   <Freeze at={12}>…children see frame 12 forever…</Freeze>
//
// Composition model: these are ordinary components (NOT director markers —
// they nest INSIDE <Scene>/<Layer> content, or inside each other). Each reads
// the parent FrameContext, remaps the frame, and provides a new FrameContext
// for its subtree. Everything is a pure function of the parent frame, so the
// determinism doctrine holds: render = (frame, props).
//
// Window semantics (Remotion-flavored):
//   • `from` is expressed in the CURRENT scope's local frames (scene start = 0,
//     or the enclosing Sequence's rebased 0).
//   • Outside [from, from + durationInFrames) the subtree is NOT rendered —
//     it is absent from the captured HTML (a real structural change, so the
//     chunker sees honest scene boundaries).
//   • speed multiplies local time (2 = double pace); reverse plays the window
//     backwards; both compose with `from`, and frames round to integers.

import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { FrameContext, useFrame, type FrameInfo } from "./context.js";

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

export interface SequenceProps {
  /** First frame (in the current scope) where the subtree appears. Default 0. */
  from?: number;
  /** Window length in frames. Default: rest of the current scope. */
  durationInFrames?: number;
  /** Time remap: the subtree's frame advances `speed`× per timeline frame. Default 1. */
  speed?: number;
  /** Play the window backwards (last frame first). Composes with speed. */
  reverse?: boolean;
  children?: ReactNode;
}

const SEQUENCE_MARKER_NAME = "__takumiSequence";

function SequenceMarker(props: SequenceProps): ReactNode {
  const parent = useFrame();
  const from = props.from ?? 0;
  if (!Number.isInteger(from) || from < 0) {
    throw new Error(`<Sequence>: from must be a non-negative integer, got ${from}.`);
  }
  const speed = props.speed ?? 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`<Sequence>: speed must be a positive number, got ${speed}.`);
  }
  const duration = props.durationInFrames ?? Math.max(0, parent.sceneFrames - from);
  if (!Number.isInteger(duration) || duration < 1) {
    throw new Error(
      `<Sequence>: durationInFrames must be a positive integer, got ${duration}. ` +
      `(Default is "rest of the current scope" — the scope may be too short for from=${from}.)`,
    );
  }

  const local = parent.frame - from;
  if (local < 0 || local >= duration) return null;

  let child = Math.round(local * speed);
  if (props.reverse) child = duration - 1 - child;
  child = Math.min(duration - 1, Math.max(0, child));

  return createElement(
    FrameContext.Provider,
    { value: rebase(parent, child, duration) },
    props.children,
  );
}
Object.defineProperty(SequenceMarker, SEQUENCE_MARKER_NAME, { value: true });

/** Time-remapped window — children see a rebased frame context. */
export const Sequence = SequenceMarker as typeof SequenceMarker & { readonly __takumiSequence: true };

/** True when the value is a <Sequence> element. */
export function isSequenceElement(value: unknown): value is ReactElement<SequenceProps> {
  return (
    isValidElement(value) &&
    typeof (value as { type: unknown }).type === "function" &&
    SEQUENCE_MARKER_NAME in ((value as { type: object }).type as object)
  );
}

// ---------------------------------------------------------------------------
// Freeze
// ---------------------------------------------------------------------------

export interface FreezeProps {
  /** The frame the subtree sees — every timeline frame renders the SAME output. */
  at: number;
  children?: ReactNode;
}

const FREEZE_MARKER_NAME = "__takumiFreeze";

function FreezeMarker(props: FreezeProps): ReactNode {
  const parent = useFrame();
  if (!Number.isInteger(props.at) || props.at < 0) {
    throw new Error(`<Freeze>: at must be a non-negative integer, got ${props.at}.`);
  }
  return createElement(
    FrameContext.Provider,
    { value: rebase(parent, props.at, parent.sceneFrames) },
    props.children,
  );
}
Object.defineProperty(FreezeMarker, FREEZE_MARKER_NAME, { value: true });

/** Frozen-in-time subtree — deterministic static-island inside a moving scene. */
export const Freeze = FreezeMarker as typeof FreezeMarker & { readonly __takumiFreeze: true };

/** True when the value is a <Freeze> element. */
export function isFreezeElement(value: unknown): value is ReactElement<FreezeProps> {
  return (
    isValidElement(value) &&
    typeof (value as { type: unknown }).type === "function" &&
    FREEZE_MARKER_NAME in ((value as { type: object }).type as object)
  );
}

// ---------------------------------------------------------------------------
// Frame rebasing (shared)
// ---------------------------------------------------------------------------

/**
 * Build the child FrameInfo for a remapped local frame. `sceneFrames` is the
 * window length the CHILD authors against (a Sequence's durationInFrames, or
 * the parent's scope for Freeze). `absolute` tracks the UNMAPPED global
 * position (exact under speed=1/no reverse — the common case — and the
 * nearest unmapped frame under time remapping, which has no single global
 * position by definition).
 */
function rebase(parent: FrameInfo, childFrame: number, sceneFrames: number): FrameInfo {
  return {
    frame: childFrame,
    absolute: parent.absolute + (childFrame - parent.frame),
    sceneFrames,
    bannerFrames: parent.bannerFrames,
    fps: parent.fps,
    timeMs: (childFrame * 1000) / parent.fps,
  };
}
