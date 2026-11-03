// takumi-motion — layout-shift.ts (v0.9 Bet B · the lint half)
// TM_LAYOUT_SHIFT: point at the culprit when a box MOVES without being told
// to. The v0.8 demo shipped three separate bugs of exactly this class (text
// reflowing under an animated sibling, a counter column nudging its row, an
// arc plate shifting on font settle) — all invisible until the bytes shipped.
//
// The detector walks the MEASURED trees of consecutive unique chunks (the
// same trees the extent audit already measures — no extra renderer calls):
//
//   • intra-scene only — cross-scene movement is choreography, not shift;
//   • a node "moved" when its absolute origin changes ≥ minShiftPx on an
//     axis while its own SIZE and text stayed identical (a mover, not a
//     resizer — resizers are usually the cause, not the victim);
//   • "pushed by sibling" when a PRECEDING same-level sibling's width or
//     height changed along the movement axis with matching sign (the classic
//     pushed-victim signature) — the finding names that sibling path+delta;
//   • findings dedupe across pairs (same scene/path/axis/delta = one report).
//
// It is a pointed INSTRUMENT, not a proof: authored layout animation (bar
// growth, FitText settle) also moves boxes — the author judges. Severity is
// "warn"; the hint carries the three sanctioned fixes from the doctrine.

import type { MeasuredNode } from "takumi-js/node";
import type { LintWarning } from "./lint.js";

export interface LayoutShiftFinding {
  /** Output frame where the shift appears (the target chunk's first frame). */
  frame: number;
  /** Host-element path from the canvas root, e.g. "/2/0/1". */
  path: string;
  axis: "x" | "y";
  /** Origin delta in px (positive = moved right/down). */
  deltaPx: number;
  /** The node's own text (identity hint), when it carries runs. */
  text?: string;
  /** The preceding sibling that grew/shrank and pushed this node. */
  pushedBy?: { path: string; axis: "width" | "height"; deltaPx: number };
}

export interface LayoutShiftOptions {
  /** Minimum origin movement to report, in px. Default 1. */
  minShiftPx?: number;
  /** Maximum findings. Default 8. */
  maxFindings?: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Matrix diagonal — ≠1 on either side means a transform is active. */
  scaleX: number;
  scaleY: number;
}

interface WalkNode {
  rect: Rect;
  children: WalkNode[];
}

/** Normalize a MeasuredNode into (rect, text, children) for aligned walks. */
function toWalkNode(node: MeasuredNode): WalkNode {
  const m = node.transform as number[];
  return {
    rect: {
      x: m[4],
      y: m[5],
      w: node.width,
      h: node.height,
      text: (node.runs ?? []).map((r) => r.text).join(""),
      scaleX: m[0],
      scaleY: m[3],
    },
    children: (node.children ?? []).map(toWalkNode),
  };
}

const SIZE_EPS = 0.05;
const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Detect intra-scene layout shifts between consecutive unique chunks.
 * `startFrames[i]` is the output frame of measured tree i; `sceneAt(frame)`
 * resolves the active scene (cross-scene pairs are skipped).
 */
export function detectLayoutShifts(
  measured: MeasuredNode[],
  startFrames: number[],
  sceneAt: (frame: number) => number,
  opts: LayoutShiftOptions = {},
): LayoutShiftFinding[] {
  const minShift = opts.minShiftPx ?? 1;
  const maxFindings = opts.maxFindings ?? 8;
  const findings: LayoutShiftFinding[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < measured.length && findings.length < maxFindings; i++) {
    const frameB = startFrames[i];
    if (sceneAt(startFrames[i - 1]) !== sceneAt(frameB)) continue;

    const a = toWalkNode(measured[i - 1]);
    const b = toWalkNode(measured[i]);
    walkPair(a, b, "", 0, 0, sceneAt(frameB), frameB, minShift, maxFindings, seen, findings);
  }

  return findings.slice(0, maxFindings);
}

function walkPair(
  a: WalkNode,
  b: WalkNode,
  path: string,
  /** The PAIR's own origin delta — rigid-subtree exemption context. */
  parentDx: number,
  parentDy: number,
  scene: number,
  frame: number,
  minShift: number,
  maxFindings: number,
  seen: Set<string>,
  out: LayoutShiftFinding[],
): void {
  if (out.length >= maxFindings) return;
  if (a.children.length === 0 || a.children.length !== b.children.length) return;

  // Size deltas of the children (pusher evidence).
  const sizeDelta = b.children.map((bc, i) => ({
    w: bc.rect.w - a.children[i].rect.w,
    h: bc.rect.h - a.children[i].rect.h,
  }));

  // Authored-field exemption: when MANY same-level leaves move on the same
  // pair (a particle field, a FLIP flight), that's choreography — the
  // pushed-victim signature is exactly ONE node moving.
  let moverCount = 0;
  for (let i = 0; i < a.children.length; i++) {
    const ca = a.children[i];
    const cb = b.children[i];
    if (ca.children.length !== 0) continue;
    const moved =
      Math.abs(cb.rect.x - ca.rect.x) >= minShift || Math.abs(cb.rect.y - ca.rect.y) >= minShift;
    const sameBox = Math.abs(ca.rect.w - cb.rect.w) < SIZE_EPS && Math.abs(ca.rect.h - cb.rect.h) < SIZE_EPS;
    if (moved && sameBox && ca.rect.text === cb.rect.text) moverCount++;
  }
  const authoredField = moverCount >= 3;

  for (let i = 0; i < a.children.length && out.length < maxFindings; i++) {
    const ca = a.children[i];
    const cb = b.children[i];
    const childPath = `${path}/${i}`;

    const dx = cb.rect.x - ca.rect.x;
    const dy = cb.rect.y - ca.rect.y;
    const movedX = Math.abs(dx) >= minShift;
    const movedY = Math.abs(dy) >= minShift;
    const sameBox = Math.abs(ca.rect.w - cb.rect.w) < SIZE_EPS && Math.abs(ca.rect.h - cb.rect.h) < SIZE_EPS;
    const sameText = ca.rect.text === cb.rect.text;

    // Leaf movers only — containers move when their children do. A mover
    // whose PARENT moved by the same delta on the same axis rides a rigid
    // subtree (transform-driven authored motion) — exempt it.
    if ((movedX || movedY) && sameBox && sameText && ca.children.length === 0) {
      const axis: "x" | "y" = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      const delta = axis === "x" ? dx : dy;
      const parentDelta = axis === "x" ? parentDx : parentDy;
      const rigid = Math.abs(parentDelta) >= minShift && Math.sign(parentDelta) === Math.sign(delta);
      // A ≠1 matrix diagonal on either side = an active transform (scale):
      // layout NEVER changes the diagonal — the origin movement is authored.
      const transformed =
        Math.abs(ca.rect.scaleX - 1) > 0.005 || Math.abs(ca.rect.scaleY - 1) > 0.005 ||
        Math.abs(cb.rect.scaleX - 1) > 0.005 || Math.abs(cb.rect.scaleY - 1) > 0.005;
      if (rigid || authoredField || transformed) {
        walkPair(ca, cb, childPath, dx, dy, scene, frame, minShift, maxFindings, seen, out);
        continue;
      }
      const dedupeKey = `${scene}:${childPath}:${axis}:${Math.round(delta)}`;

      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        // Pusher: a PRECEDING sibling whose size changed along the axis with
        // matching sign (grew → pushed right/down; shrank → pulled left/up).
        let pushedBy: LayoutShiftFinding["pushedBy"];
        for (let j = 0; j < i && !pushedBy; j++) {
          if (axis === "x") {
            const dw = sizeDelta[j].w;
            if (Math.abs(dw) >= minShift && Math.sign(dw) === Math.sign(delta)) {
              pushedBy = { path: `${path}/${j}`, axis: "width", deltaPx: r2(dw) };
            }
          } else {
            const dh = sizeDelta[j].h;
            if (Math.abs(dh) >= minShift && Math.sign(dh) === Math.sign(delta)) {
              pushedBy = { path: `${path}/${j}`, axis: "height", deltaPx: r2(dh) };
            }
          }
        }
        out.push({
          frame,
          path: childPath,
          axis,
          deltaPx: r2(delta),
          ...(ca.rect.text ? { text: ca.rect.text.slice(0, 24) } : {}),
          ...(pushedBy ? { pushedBy } : {}),
        });
      }
    }

    walkPair(ca, cb, childPath, dx, dy, scene, frame, minShift, maxFindings, seen, out);
  }
}

/**
 * Convert findings into lint warnings (TM_LAYOUT_SHIFT). The hint carries
 * the three sanctioned fixes — the v0.8 lessons, written down.
 */
export function layoutShiftWarnings(findings: LayoutShiftFinding[]): LintWarning[] {
  return findings.map((f) => ({
    code: "TM_LAYOUT_SHIFT" as const,
    message:
      `a box${f.text ? ` ("${f.text}")` : ""} at ${f.path} moved ${f.axis === "x" ? "horizontally" : "vertically"} by ` +
      `${f.deltaPx}px at frame ${f.frame}` +
      (f.pushedBy ? ` — pushed by ${f.pushedBy.path} (${f.pushedBy.axis} ${f.pushedBy.deltaPx >= 0 ? "+" : ""}${f.pushedBy.deltaPx}px)` : ""),
    hint:
      "Layout changed between frames of the same scene. Fixes: (1) absolutely position the mover so it leaves the flow, " +
      "(2) reserve the final space up front, (3) fixed-width digits (tabular-nums) on animated counters. " +
      "Use <Morph> when the movement is intentional.",
    severity: "warn" as const,
  }));
}
