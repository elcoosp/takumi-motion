// takumi-motion — audit.ts
// The Safety Net: mechanical checks that make the v0.1-pre failure modes
// impossible to ship. Three auditors, one verdict:
//
//  1. auditExtents  — walks the laid-out node tree (measure boxes are
//     absolute: takumi's MeasuredNode transform carries canvas position),
//     samples every transform track on a fine grid, applies peak transforms
//     to each target's box corners, and flags anything crossing the canvas
//     safe zone. Decorative bleed (glows, blurs) is allowed via a pattern
//     list and reported as warnings instead of errors.
//  2. seamEnergy    — a number for loop quality: the largest normalized
//     track delta across the loop seam. 0 = strict-perfect.
//  3. checkBanner   — extents + seam + size in one verdict for CI.

import { fromJsx } from "@takumi-rs/helpers/jsx";
import type { Node } from "@takumi-rs/helpers";
import type { Renderer } from "takumi-js/node";
import { resolveTrack, sampleTrackAt, type ResolvedTrack } from "./sampler.js";
import { checkLoopSeam, type SeamReport } from "./loop.js";
import type { ReactElementLike, TimelineJSON, TrackJSON } from "./types.js";
import { transformPropOrder, type TransformProp } from "./transform.js";

const isReactElement = (n: unknown): n is ReactElementLike =>
  typeof n === "object" && n !== null && "props" in (n as object) && "type" in (n as object);

// ---------------------------------------------------------------------------
// Extent audit
// ---------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Edge = "left" | "right" | "top" | "bottom";

export interface ExtentViolation {
  /** Track target selector. */
  target: string;
  /** The property whose peak pushed the box over. */
  property: string;
  /** Time of the worst sample, ms. */
  atMs: number;
  edge: Edge;
  /** Pixels beyond the safe zone (positive = outside). */
  overflowPx: number;
  /** true when the target matched an allow-bleed pattern — a warning, not a failure. */
  decorative: boolean;
  /** Human diagnosis with the peak value and the fix hint. */
  detail: string;
}

export interface ExtentReport {
  safe: boolean;
  canvas: { width: number; height: number };
  safeZonePx: number;
  /** Selector → base layout box (CSS px). */
  boxes: Record<string, Box>;
  /** Targets that had transform tracks checked. */
  checked: number;
  violations: ExtentViolation[];
  /** Selectors referenced by tracks but not found in the laid-out tree. */
  unmapped: string[];
}

export interface ExtentAuditOptions {
  width: number;
  height: number;
  /** Inset from each edge that content must stay within, CSS px. Default 8. */
  safeZone?: number;
  /** Selectors allowed to bleed (matched by substring or regex) — e.g. glows. Default /glow/i. */
  allowBleed?: Array<string | RegExp>;
  /** Audit sampling grid, Hz (independent of the render fps — finer is safer). Default 60. */
  sampleHz?: number;
  /** Warm renderer to reuse. */
  renderer?: Renderer;
}

interface Matrix2D {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

function apply(m: Matrix2D, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

const DEG = Math.PI / 180;

/**
 * Numeric transform matrix in the compiler's fixed order
 * (translate → scale → rotate → skew), matching buildTransform()'s emission
 * order so audits agree with what the Rust engine rasterizes.
 */
export function matrixFor(values: Partial<Record<TransformProp, number>>, origin: { x: number; y: number }): Matrix2D {
  const num = (k: TransformProp, dflt: number): number => values[k] ?? dflt;
  const x = num("x", 0);
  const y = num("y", 0);
  const sx = num("scaleX", num("scale", 1));
  const sy = num("scaleY", num("scale", 1));
  const θ = num("rotate", 0);
  const kx = num("skew", 0) + num("skewX", 0);
  const ky = num("skew", 0) + num("skewY", 0);

  let m = mul({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }, IDENTITY);
  if (sx !== 1 || sy !== 1) m = mul(m, { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
  if (θ !== 0) {
    const cos = Math.cos(θ * DEG);
    const sin = Math.sin(θ * DEG);
    m = mul(m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }
  if (kx !== 0) m = mul(m, { a: 1, b: 0, c: Math.tan(kx * DEG), d: 1, e: 0, f: 0 });
  if (ky !== 0) m = mul(m, { a: 1, b: Math.tan(ky * DEG), c: 0, d: 1, e: 0, f: 0 });

  // Shift to/from the transform origin: p' = O⁻¹ · M · O · p
  const to = mul(mul({ a: 1, b: 0, c: 0, d: 1, e: -origin.x, f: -origin.y }, m), { a: 1, b: 0, c: 0, d: 1, e: origin.x, f: origin.y });
  return to;
}

/** Parse a CSS transform-origin into box-local px. Default center/center. */
export function parseTransformOrigin(value: string | undefined, box: Box): { x: number; y: number } {
  const center = { x: box.width / 2, y: box.height / 2 };
  if (!value) return center;
  const tokens = value.trim().toLowerCase().split(/\s+/);
  const resolve = (token: string, size: number): number => {
    if (token === "left" || token === "top") return 0;
    if (token === "center") return size / 2;
    if (token === "right" || token === "bottom") return size;
    if (token.endsWith("%")) return (parseFloat(token) / 100) * size;
    if (token.endsWith("px")) return parseFloat(token);
    const n = parseFloat(token);
    return Number.isNaN(n) ? size / 2 : n;
  };
  const [tx, ty] = [resolve(tokens[0] ?? "center", box.width), resolve(tokens[1] ?? tokens[0] ?? "center", box.height)];
  return { x: tx, y: ty };
}

// --- node-tree walk: className → absolute box ------------------------------

interface WalkAccum {
  boxes: Record<string, Box>;
  originStrings: Record<string, string | undefined>;
  mismatched: number;
}

function walkPair(
  node: Node | undefined,
  measured: { width: number; height: number; transform: number[]; children: unknown[] } | undefined,
  acc: WalkAccum
): void {
  if (!node || !measured) {
    if (node) acc.mismatched++;
    return;
  }
  const className = (node as { className?: string }).className;
  const style = (node as { style?: Record<string, string | number> }).style;
  // MeasuredNode transform is absolute: translation components carry canvas position.
  const t = measured.transform;
  if (className && t.length >= 6) {
    const m: Matrix2D = { a: t[0]!, b: t[1]!, c: t[2]!, d: t[3]!, e: t[4]!, f: t[5]! };
    // The measured transform INCLUDES the node's own layout translation and its
    // local transform; box position = apply(m, 0, 0) when no local transform, but
    // to stay exact across scale/rotate we store the box as the AABB of the
    // transformed corners of the untransformed rect at (0,0,·,·) translated by (e,f).
    // For the common case (no static transform) this is exactly the layout box.
    const [x0, y0] = apply(m, 0, 0);
    const [x1, y1] = apply(m, measured.width, 0);
    const [x2, y2] = apply(m, 0, measured.height);
    const [x3, y3] = apply(m, measured.width, measured.height);
    const minX = Math.min(x0, x1, x2, x3);
    const minY = Math.min(y0, y1, y2, y3);
    const maxX = Math.max(x0, x1, x2, x3);
    const maxY = Math.max(y0, y1, y2, y3);
    for (const token of className.split(/\s+/).filter(Boolean)) {
      acc.boxes[`.${token}`] = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      const originRaw = style ? String(style.transformOrigin ?? "") : "";
      if (originRaw) acc.originStrings[`.${token}`] = originRaw;
    }
  }
  const children = (node as { children?: Node[] }).children ?? [];
  const measuredChildren = (measured.children ?? []) as Array<{ width: number; height: number; transform: number[]; children: unknown[] }>;
  if (children.length === measuredChildren.length) {
    for (let i = 0; i < children.length; i++) walkPair(children[i], measuredChildren[i], acc);
  } else {
    // Inline layouts synthesize extra measured children (inline boxes) — pair by
    // count order where possible; mark the subtree unmappable when counts diverge.
    acc.mismatched += Math.abs(children.length - measuredChildren.length);
    const by = Math.min(children.length, measuredChildren.length);
    for (let i = 0; i < by; i++) walkPair(children[i], measuredChildren[i], acc);
  }
}

// --- track sampling ---------------------------------------------------------

interface PeakState {
  atMs: number;
  values: Partial<Record<TransformProp, number>>;
  driver: TransformProp;
}

function tracksForTarget(tracks: TrackJSON[], target: string): TrackJSON[] {
  return tracks.filter((t) => t.target === target && transformPropOrder.includes(t.property as TransformProp));
}

function sampleState(trs: ResolvedTrack[], t: number): Partial<Record<TransformProp, number>> {
  const state: Partial<Record<TransformProp, number>> = {};
  for (const tr of trs) {
    const v = sampleTrackAt(tr, t - tr.delayMs);
    if (typeof v === "number") state[tr.property as TransformProp] = v;
  }
  return state;
}

/**
 * Audit the spatial extents of every animated target against the canvas
 * safe zone. Render-accurate: uses takumi's own layout for boxes and the
 * compiler's sampling semantics for track peaks.
 */
export async function auditExtents(
  nodeOrElement: Node | ReactElementLike,
  timeline: TimelineJSON,
  options: ExtentAuditOptions
): Promise<ExtentReport> {
  const width = options.width;
  const height = options.height;
  const safeZone = options.safeZone ?? 8;
  const allowBleed = options.allowBleed ?? [/glow/i, /ambient/i];
  const sampleHz = options.sampleHz ?? 60;

  const node = isReactElement(nodeOrElement) ? (await fromJsx(nodeOrElement as never)).node : nodeOrElement;

  const renderer = options.renderer ?? await (await import("./templates/shared.js")).getSharedRenderer();
  // Logical CSS px viewport (dpr 1) — boxes come back in design coordinates.
  const measured = await renderer.measure(node as never, { width, height } as never);

  const acc: WalkAccum = { boxes: {}, originStrings: {}, mismatched: 0 };
  walkPair(node as Node, measured as never, acc);

  const durationMs = timeline.durationMs;
  const stepMs = 1000 / sampleHz;
  const points: number[] = [];
  for (let t = 0; t <= durationMs + 1e-9; t += stepMs) points.push(Math.round(t * 1000) / 1000);
  // Structural boundaries: every track's start and end.
  for (const track of timeline.tracks) {
    const resolved = resolveTrack(track);
    points.push(resolved.delayMs);
    const span = Number.isFinite(resolved.totalMs) ? resolved.totalMs : durationMs;
    points.push(resolved.delayMs + span);
  }

  const targets = [...new Set(timeline.tracks.map((t) => t.target))];
  const violations: ExtentViolation[] = [];
  const unmapped: string[] = [];
  let checked = 0;

  for (const target of targets) {
    const box = acc.boxes[target];
    const tracks = tracksForTarget(timeline.tracks, target);
    if (tracks.length === 0) continue;
    if (!box) {
      unmapped.push(target);
      continue;
    }
    checked++;

    const resolved = tracks.map((t) => resolveTrack(t));
    const decorative = allowBleed.some((p) =>
      typeof p === "string" ? target.includes(p) : p.test(target)
    );
    const origin = parseTransformOrigin(acc.originStrings[target], box);

    let worst: Partial<Record<Edge, ExtentViolation>> = {};

    for (const t of points) {
      const values = sampleState(resolved, t);
      if (Object.keys(values).length === 0) continue;
      const m = matrixFor(values, origin);

      const corners: Array<[number, number]> = [
        apply(m, 0, 0),
        apply(m, box.width, 0),
        apply(m, 0, box.height),
        apply(m, box.width, box.height),
      ];
      const xs = corners.map((c) => c[0]! + box.x);
      const ys = corners.map((c) => c[1]! + box.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      const edges: Array<[Edge, number]> = [
        ["left", safeZone - minX],
        ["right", maxX - (width - safeZone)],
        ["top", safeZone - minY],
        ["bottom", maxY - (height - safeZone)],
      ];
      for (const [edge, over] of edges) {
        if (over > 0.5) {
          const driver = (Object.entries(values) as Array<[TransformProp, number]>)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0] ?? "transform";
          const prev = worst[edge!];
          if (!prev || prev.overflowPx < over) {
            worst[edge!] = {
              target,
              property: driver,
              atMs: t,
              edge: edge!,
              overflowPx: Math.round(over * 10) / 10,
              decorative,
              detail:
                `${target} reaches ${edge} +${(Math.round(over * 10) / 10)}px at t=${Math.round(t)}ms ` +
                `(peak ${driver}=${values[driver]}). Shrink the animation range, drop the font size, ` +
                `or clamp the overshoot.`,
            };
          }
        }
      }
    }

    violations.push(...Object.values(worst));
  }

  const hardFailures = violations.filter((v) => !v.decorative);
  return {
    safe: hardFailures.length === 0 && unmapped.length === 0,
    canvas: { width, height },
    safeZonePx: safeZone,
    boxes: acc.boxes,
    checked,
    violations: violations.sort((a, b) => b.overflowPx - a.overflowPx),
    unmapped,
  };
}

// ---------------------------------------------------------------------------
// Seam energy
// ---------------------------------------------------------------------------

export interface SeamEnergy {
  /** Max normalized track delta across the seam (0 = strict-perfect). */
  energy: number;
  /** The worst track. */
  worst?: { target: string; property: string; delta: number; range: number };
  /** Strict-seam verdict from checkLoopSeam. */
  report: SeamReport;
}

/**
 * Loop quality as a number: for every numeric track, |value(t=0) − value(t=end)|
 * normalized by the track's value range across the timeline. 0 means the
 * loop restarts pixel-identically; >0 quantifies the pop at the seam.
 */
export function seamEnergy(timeline: TimelineJSON): SeamEnergy {
  const report = checkLoopSeam(timeline);
  let energy = 0;
  let worst: SeamEnergy["worst"];

  for (const track of timeline.tracks) {
    const resolved: ResolvedTrack = resolveTrack(track);
    const start = sampleTrackAt(resolved, 0);
    const end = sampleTrackAt(resolved, timeline.durationMs - resolved.delayMs);
    if (typeof start !== "number" || typeof end !== "number") continue;
    const delta = Math.abs(start - end);
    if (delta === 0) continue;
    // Range across a coarse sweep for normalization.
    let min = start;
    let max = start;
    const steps = 48;
    for (let i = 1; i <= steps; i++) {
      const v = sampleTrackAt(resolved, (timeline.durationMs * i) / steps - resolved.delayMs);
      if (typeof v !== "number") continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = Math.max(max - min, 1e-9);
    const normalized = delta / range;
    if (normalized > energy) {
      energy = normalized;
      worst = { target: track.target, property: track.property, delta, range };
    }
  }

  return { energy: Math.round(energy * 1e6) / 1e6, worst, report };
}

// ---------------------------------------------------------------------------
// Aggregate check
// ---------------------------------------------------------------------------

export interface CheckOptions extends Omit<ExtentAuditOptions, "width" | "height"> {
  width: number;
  height: number;
  /** Size budgets per format (bytes) — run after rendering when provided. */
  fileSizes?: Array<{ format: string; bytes: number; budget: number }>;
  /** Seam energy above this fails (strict timelines only; wrapped timelines gate on the fade). Default 0.02. */
  seamTolerance?: number;
}

export interface CheckResult {
  /** false when any error-level finding exists — CI exit code 1. */
  ok: boolean;
  extents: ExtentReport;
  seam: SeamEnergy;
  sizes: Array<{ format: string; bytes: number; budget: number; ok: boolean }>;
  /** All findings, worst first — errors before warnings. */
  findings: Array<{ level: "error" | "warning"; message: string }>;
}

/**
 * Full pre-flight: extents + seam + optional size budgets. The CLI `check`
 * command and CI run this; error-level findings mean "do not ship".
 */
export async function checkBanner(
  nodeOrElement: Node | ReactElementLike,
  timeline: TimelineJSON,
  options: CheckOptions
): Promise<CheckResult> {
  const extents = await auditExtents(nodeOrElement, timeline, options);
  const seam = seamEnergy(timeline);
  const seamTolerance = options.seamTolerance ?? 0.02;

  const findings: CheckResult["findings"] = [];
  for (const v of extents.violations) {
    findings.push({
      level: v.decorative ? "warning" : "error",
      message: v.detail,
    });
  }
  for (const target of extents.unmapped) {
    findings.push({
      level: "warning",
      message: `Target '${target}' has transform tracks but no measurable box (inline layout?). Extents not verified for it.`,
    });
  }

  const seamOk =
    seam.report.seamless &&
    (seam.report.mode === "wrapped" ? true : seam.energy <= seamTolerance);
  if (!seamOk) {
    findings.push({
      level: "error",
      message:
        `Loop seam: energy ${seam.energy}` +
        (seam.worst ? ` (worst: ${seam.worst.target} ${seam.worst.property} Δ${seam.worst.delta.toFixed(3)})` : "") +
        `. ${seam.report.notes.join(" ")}`,
    });
  }

  const sizes = (options.fileSizes ?? []).map((f) => ({ ...f, ok: f.bytes <= f.budget }));
  for (const f of sizes) {
    if (!f.ok) {
      findings.push({
        level: "error",
        message: `${f.format} is ${f.bytes} bytes — over budget ${f.budget}. Lower fps, use webp, or simplify visuals.`,
      });
    }
  }

  findings.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));

  return {
    ok: findings.every((f) => f.level !== "error"),
    extents,
    seam,
    sizes,
    findings,
  };
}
