// takumi-motion — explain.ts (v0.9 Bet F)
// The X-ray instrument: WHY does every frame exist?
//
// A banner's bytes are driven by its unique frames. `explainCapture` diffs
// each captured frame against its predecessor and attributes every change to
// a CHANNEL:
//
//   opacity     — alpha-only deltas (cheap in GIF palettes)
//   transform   — movement/rotation/scale (re-paint, no re-flow)
//   clip        — clip-path sweeps (reveals; cheap, monotonic)
//   layout      — width/height/position/font-size (REAL layout churn —
//                 the channel TM_LAYOUT_SHIFT warns about)
//   paint       — background/color/filter deltas
//   text        — rendered string changed (CountUp, Typewriter)
//   structure   — elements appeared/disappeared (scene boundaries, gates)
//
// The doctrine this feeds: opacity/clip churn is nearly free, transform churn
// is honest motion, layout/text churn is where size budgets die. The summary
// counts churn frames (layout+text+structure) so authors can see exactly
// which frame ranges carry the weight — and whether that's intentional.
//
// Pure functions over the capture's htmlFrames; no renderer calls, no I/O.

import type { CaptureResult } from "./react/capture.js";
import { composeFrame } from "./react/plan.js";

// ---------------------------------------------------------------------------
// Types (JSON-safe — report.explain flows into CLI --json)
// ---------------------------------------------------------------------------

export type ExplainChannel =
  | "opacity"
  | "transform"
  | "clip"
  | "layout"
  | "paint"
  | "text"
  | "structure";

export interface ExplainChange {
  channel: ExplainChannel;
  /** CSS property (style channels) or a short description (text/structure). */
  property: string;
  /** Previous value (truncated). */
  from?: string;
  /** New value (truncated). */
  to?: string;
  /** How many elements changed this property this frame. */
  count: number;
}

export interface FrameAttribution {
  /** Output frame index. */
  frame: number;
  /** "start" (frame 0), "hold" (byte-identical to previous), "change". */
  kind: "start" | "hold" | "change";
  /** Active scene index (plan lookup; layers excluded). */
  scene: number;
  /** For "change": what changed, grouped by property. */
  changes: ExplainChange[];
}

export interface ExplainReport {
  frames: FrameAttribution[];
  summary: {
    totalFrames: number;
    /** Frames that differ from their predecessor (encoder work). */
    uniqueFrames: number;
    /** Frames byte-identical to their predecessor (chunk-merged holds). */
    holds: number;
    /** Unique frames whose changes are opacity/clip only (cheap churn). */
    cheapFrames: number;
    /** Unique frames with layout/text/structure changes (expensive churn). */
    churnFrames: number;
    /** The churn frame indexes, compressed into inclusive ranges. */
    churnRanges: Array<{ from: number; to: number }>;
    /** Property histogram across unique frames (top first). */
    channels: Array<{ channel: ExplainChannel; frames: number }>;
  };
}

// ---------------------------------------------------------------------------
// Frame analysis
// ---------------------------------------------------------------------------

interface FrameFacts {
  /** style declarations, counted per element occurrence: "prop:value" × n. */
  decls: Map<string, number>;
  /** property → occurrence count (for pairing adds/removes). */
  propCounts: Map<string, number>;
  /** text runs, counted. */
  texts: Map<string, number>;
  /** tag skeleton (structure fingerprint). */
  skeleton: string;
}

const STYLE_RE = /style="([^"]*)"/g;
const TEXT_RE = />([^<>]+)</g;
const TAG_RE = /<\/?[A-Za-z][\w-]*/g;

/** property → attribution channel. */
function channelOf(property: string): ExplainChannel {
  if (property === "opacity") return "opacity";
  if (property === "transform" || property === "transformOrigin") return "transform";
  if (property === "clipPath") return "clip";
  if (
    property === "width" || property === "height" || property === "left" ||
    property === "top" || property === "right" || property === "bottom" ||
    property === "fontSize" || property === "lineHeight" || property === "gap" ||
    property === "padding" || property === "margin" || property === "flexBasis"
  ) {
    return "layout";
  }
  return "paint";
}

function analyzeFrame(html: string): FrameFacts {
  const decls = new Map<string, number>();
  const propCounts = new Map<string, number>();
  let m: RegExpExecArray | null;

  STYLE_RE.lastIndex = 0;
  while ((m = STYLE_RE.exec(html)) !== null) {
    for (const raw of m[1].split(";")) {
      const decl = raw.trim();
      if (!decl) continue;
      decls.set(decl, (decls.get(decl) ?? 0) + 1);
      const prop = decl.slice(0, decl.indexOf(":")).trim();
      if (prop) propCounts.set(prop, (propCounts.get(prop) ?? 0) + 1);
    }
  }

  const texts = new Map<string, number>();
  TEXT_RE.lastIndex = 0;
  while ((m = TEXT_RE.exec(html)) !== null) {
    const text = m[1].trim();
    if (!text) continue;
    texts.set(text, (texts.get(text) ?? 0) + 1);
  }

  const skeleton = (html.match(TAG_RE) ?? []).join(",");

  return { decls, propCounts, texts, skeleton };
}

const truncate = (s: string, max = 28): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

/**
 * Diff two frames' facts into per-property changes. A property "changed"
 * when its declaration multiset differs (an element moved/animated) or its
 * occurrence count changed (structure carrying that property).
 */
function diffFacts(prev: FrameFacts, next: FrameFacts): ExplainChange[] {
  const changes: ExplainChange[] = [];

  // Group declaration deltas by property.
  const removedByProp = new Map<string, Map<string, number>>();
  const addedByProp = new Map<string, Map<string, number>>();
  const collect = (decl: string, delta: number): void => {
    const prop = decl.slice(0, decl.indexOf(":")).trim();
    if (!prop) return;
    const bucket = delta < 0 ? removedByProp : addedByProp;
    if (!bucket.has(prop)) bucket.set(prop, new Map());
    const values = bucket.get(prop)!;
    values.set(decl, (values.get(decl) ?? 0) + Math.abs(delta));
  };
  for (const [decl, n] of prev.decls) {
    const delta = n - (next.decls.get(decl) ?? 0);
    if (delta > 0) collect(decl, -delta);
  }
  for (const [decl, n] of next.decls) {
    const delta = n - (prev.decls.get(decl) ?? 0);
    if (delta > 0) collect(decl, delta);
  }

  const props = new Set([...removedByProp.keys(), ...addedByProp.keys()]);
  for (const prop of props) {
    const removed = removedByProp.get(prop) ?? new Map();
    const added = addedByProp.get(prop) ?? new Map();
    const fromValues = [...removed.entries()].sort((a, b) => b[1] - a[1]);
    const toValues = [...added.entries()].sort((a, b) => b[1] - a[1]);
    const count = Math.max(
      [...removed.values()].reduce((s, n) => s + n, 0),
      [...added.values()].reduce((s, n) => s + n, 0),
    );
    changes.push({
      channel: channelOf(prop),
      property: prop,
      ...(fromValues[0] ? { from: truncate(fromValues[0][0].slice(prop.length + 1)) } : {}),
      ...(toValues[0] ? { to: truncate(toValues[0][0].slice(prop.length + 1)) } : {}),
      count,
    });
  }

  // Text deltas.
  const textRemoved = new Map<string, number>();
  const textAdded = new Map<string, number>();
  for (const [text, n] of prev.texts) {
    const delta = n - (next.texts.get(text) ?? 0);
    if (delta > 0) textRemoved.set(text, delta);
  }
  for (const [text, n] of next.texts) {
    const delta = n - (prev.texts.get(text) ?? 0);
    if (delta > 0) textAdded.set(text, delta);
  }
  const textCount = Math.max(
    [...textRemoved.values()].reduce((s, n) => s + n, 0),
    [...textAdded.values()].reduce((s, n) => s + n, 0),
  );
  if (textCount > 0) {
    changes.push({
      channel: "text",
      property: "text",
      ...(textRemoved.size > 0 ? { from: truncate([...textRemoved.keys()][0]) } : {}),
      ...(textAdded.size > 0 ? { to: truncate([...textAdded.keys()][0]) } : {}),
      count: textCount,
    });
  }

  // Structure delta.
  if (prev.skeleton !== next.skeleton) {
    changes.push({ channel: "structure", property: "tree", count: 1 });
  }

  // Stable, deterministic order: channel severity then property name.
  const order: Record<ExplainChannel, number> = {
    structure: 0, text: 1, layout: 2, transform: 3, clip: 4, paint: 5, opacity: 6,
  };
  changes.sort((a, b) => order[a.channel] - order[b.channel] || a.property.localeCompare(b.property));
  return changes;
}

// ---------------------------------------------------------------------------
// Capture → ExplainReport
// ---------------------------------------------------------------------------

/** Compress sorted frame indexes into inclusive ranges. */
export function rangesOf(frames: number[]): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const f of frames) {
    const last = ranges[ranges.length - 1];
    if (last && f === last.to + 1) last.to = f;
    else ranges.push({ from: f, to: f });
  }
  return ranges;
}

/**
 * Attribute every captured frame. Cheap (string multiset diffs only — no
 * renderer calls); safe to run on any capture, any length.
 */
export function explainCapture(capture: CaptureResult): ExplainReport {
  const frames: FrameAttribution[] = [];
  const channelFrames = new Map<ExplainChannel, number>();
  const churn: number[] = [];

  let prev: FrameFacts | null = null;
  for (const [i, html] of capture.htmlFrames.entries()) {
    const scene = sceneAtFrame(capture, i);
    if (prev === null) {
      frames.push({ frame: i, kind: "start", scene, changes: [] });
      prev = analyzeFrame(html);
      continue;
    }
    const facts = analyzeFrame(html);
    const identical = facts.skeleton === prev.skeleton && multisetEqual(facts.decls, prev.decls) && multisetEqual(facts.texts, prev.texts);
    if (identical) {
      frames.push({ frame: i, kind: "hold", scene, changes: [] });
    } else {
      const changes = diffFacts(prev, facts);
      frames.push({ frame: i, kind: "change", scene, changes });
      for (const change of changes) {
        channelFrames.set(change.channel, (channelFrames.get(change.channel) ?? 0) + 1);
      }
      if (changes.some((c) => c.channel === "layout" || c.channel === "text" || c.channel === "structure")) {
        churn.push(i);
      }
    }
    prev = facts;
  }

  const holds = frames.filter((f) => f.kind === "hold").length;
  const uniqueFrames = frames.filter((f) => f.kind !== "hold").length;
  const cheapFrames = frames.filter(
    (f) => f.kind === "change" && f.changes.every((c) => c.channel === "opacity" || c.channel === "clip"),
  ).length;

  const channels = [...channelFrames.entries()]
    .map(([channel, count]) => ({ channel, frames: count }))
    .sort((a, b) => b.frames - a.frames);

  return {
    frames,
    summary: {
      totalFrames: frames.length,
      uniqueFrames,
      holds,
      cheapFrames,
      churnFrames: churn.length,
      churnRanges: rangesOf(churn),
      channels,
    },
  };
}

function multisetEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function sceneAtFrame(capture: CaptureResult, frame: number): number {
  try {
    const composition = composeFrame(capture.plan, frame);
    return composition.mode === "single" ? composition.scene.index : composition.arriving.index;
  } catch {
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Human table
// ---------------------------------------------------------------------------

/**
 * Render the explain report as a compact human table (CLI output). The JSON
 * report carries the full data — this is the read-through.
 */
export function formatExplain(explain: ExplainReport, maxRows = 16): string {
  const s = explain.summary;
  const lines: string[] = [];
  lines.push(
    `explain: ${s.uniqueFrames} unique / ${s.totalFrames} frames (${s.holds} holds) · ` +
    `cheap churn ${s.cheapFrames}f · expensive churn ${s.churnFrames}f`,
  );
  if (s.channels.length > 0) {
    lines.push(
      `  channels: ${s.channels.slice(0, 5).map((c) => `${c.channel} ×${c.frames}`).join(" · ")}`,
    );
  }
  if (s.churnRanges.length > 0) {
    const shown = s.churnRanges.slice(0, 6).map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`));
    lines.push(`  churn frames: ${shown.join(", ")}${s.churnRanges.length > 6 ? ` (+${s.churnRanges.length - 6} more)` : ""}`);
  }

  const changes = explain.frames.filter((f) => f.kind === "change" && f.changes.length > 0);
  for (const frame of changes.slice(0, maxRows)) {
    const detail = frame.changes
      .map((c) => (c.channel === "text" || c.channel === "structure"
        ? `${c.channel}${c.from !== undefined || c.to !== undefined ? ` ${c.from ?? "∅"}→${c.to ?? "∅"}` : ""}`
        : `${c.property} ${c.from ?? "∅"}→${c.to ?? "∅"}`))
      .join(", ");
    lines.push(`  f${String(frame.frame).padStart(4)} scene${frame.scene} ${truncate(detail, 110)}`);
  }
  if (changes.length > maxRows) lines.push(`  … ${changes.length - maxRows} more changed frames (see report.explain)`);
  return lines.join("\n");
}
