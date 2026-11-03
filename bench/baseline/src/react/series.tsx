// takumi-motion — react/series.tsx (v0.5)
// <Series> — auto-stacked sequential scenes.
//
// Remotion-flavored composition sugar: instead of hand-summing durations on
// the timeline cursor, <Series.Sequence durationInFrames> items stack
// back-to-back in declaration order. The <Banner> scan flattens the Series
// into its sequence elements and feeds them to the SAME planner <Scene>
// uses — so enter/exit transitions, clamps and crossfade synthesis all keep
// their v0.3 semantics. Series is pure sugar over the scene director.
//
//   <Banner>
//     <Layer bottom>…</Layer>
//     <Series>
//       <Series.Sequence durationInFrames={90}>…</Series.Sequence>
//       <Series.Sequence durationInFrames={120} enter="crossfade">…</Series.Sequence>
//     </Series>
//     <Layer top>…</Layer>
//   </Banner>

import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import type { TransitionInput } from "./plan.js";

// ---------------------------------------------------------------------------
// Series.Sequence
// ---------------------------------------------------------------------------

export interface SeriesSequenceProps {
  /** Content duration in FRAMES at the banner fps. */
  durationInFrames: number;
  /** How this sequence arrives (same vocabulary as <Scene enter>). Default "cut". */
  enter?: TransitionInput;
  /** How this sequence leaves (same vocabulary as <Scene exit>). Default "cut". */
  exit?: TransitionInput;
  children?: ReactNode;
}

const SERIES_SEQ_MARKER_NAME = "__takumiSeriesSequence";

/** Identity render — <Banner> collects these during its scan and composes
 *  them exactly like <Scene> elements (children under a FrameContext). */
function SeriesSequenceMarker(props: SeriesSequenceProps): ReactNode {
  return props.children ?? null;
}
Object.defineProperty(SeriesSequenceMarker, SERIES_SEQ_MARKER_NAME, { value: true });

/** One auto-stacked member of a <Series>. */
export const SeriesSequence = SeriesSequenceMarker as typeof SeriesSequenceMarker & {
  readonly __takumiSeriesSequence: true;
};

/** True when the value is a <Series.Sequence> element. */
export function isSeriesSequenceElement(value: unknown): value is ReactElement<SeriesSequenceProps> {
  return (
    isValidElement(value) &&
    typeof (value as { type: unknown }).type === "function" &&
    SERIES_SEQ_MARKER_NAME in ((value as { type: object }).type as object)
  );
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export interface SeriesProps {
  children?: ReactNode;
}

const SERIES_MARKER_NAME = "__takumiSeries";

/** Identity render — <Banner> flattens Series children during its scan. */
function SeriesMarker(props: SeriesProps): ReactNode {
  return props.children ?? null;
}
Object.defineProperty(SeriesMarker, SERIES_MARKER_NAME, { value: true });

/** Auto-stacked scene sequence — pure sugar over <Scene> windows. */
export const Series = SeriesMarker as typeof SeriesMarker & { readonly __takumiSeries: true };

/** True when the value is a <Series> element. */
export function isSeriesElement(value: unknown): value is ReactElement<SeriesProps> {
  return (
    isValidElement(value) &&
    typeof (value as { type: unknown }).type === "function" &&
    SERIES_MARKER_NAME in ((value as { type: object }).type as object)
  );
}

// ---------------------------------------------------------------------------
// Scan validation
// ---------------------------------------------------------------------------

/** Depth cap for future nested-series support — flat for now, error is clear. */
export const MAX_SERIES_NESTING = 1;

/**
 * Validate a <Series> element's children: EVERY meaningful child must be a
 * <Series.Sequence>. This is what makes the scan's flattening safe.
 */
export function validateSeriesChildren(el: ReactElement<SeriesProps>): void {
  Children.forEach(el.props.children, (child) => {
    if (child === null || child === undefined || typeof child === "boolean") return;
    if (isSeriesElement(child)) {
      throw new Error("<Series> cannot nest inside <Series> — declare one flat list of <Series.Sequence> items.");
    }
    if (!isSeriesSequenceElement(child)) {
      throw new Error(
        "<Series> children must be <Series.Sequence durationInFrames={…}> elements — " +
        "<Scene> and <Layer> live directly on <Banner>, not inside <Series>.",
      );
    }
  });
}
