// takumi-motion — react/follow-path.tsx (v0.8, Bet B)
// <FollowPath> — travel along an SVG path at constant speed.
//
// ```tsx
// <FollowPath d="M -40 100 C 200 20 400 160 900 60" durationFrames={48} rotate="auto">
//   <Badge />
// </FollowPath>
// ```
//
// The path is flattened to an arc-length table ONCE per `d` string (memoized
// in path.ts); per-frame resolution is a binary search + lerp — O(log n),
// zero allocation, byte-deterministic. After the travel ends the wrapper
// emits the constant END transform, so settled frames stay style-stable and
// chunk-merge. Before it starts (delayFrames) the element sits at the path's
// first point — FollowPath is a MOTION, not an entrance; nest it inside
// <Animated entering={FadeIn}> when you also want an arrival fade (the two
// transforms compose on nested divs).

import { createElement, type ReactNode } from "react";
import { useFrame } from "./context.js";
import { easingDefinitionToFunction } from "../easing.js";
import { pathPointAt } from "./path.js";
import type { TakumiStyle } from "../style.js";
import type { Easing } from "../types.js";

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export interface FollowPathProps {
  /** SVG path data — one continuous subpath (M L H V C S Q T Z; no arcs). */
  d: string;
  /** Frames the end-to-end travel spans. */
  durationFrames: number;
  /** Frames to wait at the path's start point before moving. Default 0. */
  delayFrames?: number;
  /** Easing over the travel. Default "easeInOut". */
  easing?: Easing;
  /** "auto" — orient along the tangent; a number — fixed rotation offset in
   *  degrees; false/undefined — no rotation. Default false. */
  rotate?: "auto" | number | false;
  /** Merged under the per-frame transform. */
  style?: TakumiStyle;
  children?: ReactNode;
}

/**
 * Travel a subtree along a path — the After Effects motion-path shape,
 * frame-indexed and deterministic:
 *
 * - constant speed by construction (arc-length parameterization, not
 *   offset-distance percentages);
 * - `rotate="auto"` aligns the subtree with the tangent (degrees, 0 = →);
 * - composes with every other wrapper — put YOUR transform-animated elements
 *   inside; this wrapper owns its own transform only.
 */
export function FollowPath(props: FollowPathProps): ReactNode {
  const { frame } = useFrame();
  const delay = props.delayFrames ?? 0;
  const duration = props.durationFrames;

  const raw = (frame - delay) / duration;
  const eased = easingDefinitionToFunction(props.easing ?? "easeInOut")(
    Math.min(1, Math.max(0, raw)),
  );
  const point = pathPointAt(props.d, eased);

  const parts: string[] = [
    `translateX(${r6(point.x)}px)`,
    `translateY(${r6(point.y)}px)`,
  ];
  if (props.rotate === "auto") {
    parts.push(`rotate(${r6(point.angle)}deg)`);
  } else if (typeof props.rotate === "number") {
    parts.push(`rotate(${r6(props.rotate)}deg)`);
  }

  return createElement("div", {
    style: {
      ...props.style,
      transform: parts.join(" "),
    },
  }, props.children);
}
