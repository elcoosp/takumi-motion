// takumi-motion — react/morph.tsx (v0.9 Bet B · Layout truth; v0.9.1 flight v2)
// Deterministic morph between two measured layouts.
//
// <Morph> renders ONE of two author-declared states per frame and, during the
// transition window, flies every item from its source rect to its target rect
// (First-Last-Invert-Play, realized through the POSITION+SIZE channels):
//
//   1. FIRST  — prewarm measures state A and state B through the real
//               renderer (takumi Renderer.measure on fromHtml'd probe trees,
//               the same pattern as <FitText>'s fit cache) — item rects AND
//               the container's own box;
//   2. LAST   — frames render the target state's true layout;
//   3. INVERT — during the flight each item is absolutely positioned at the
//               INTERPOLATED rect (lerp of source → target, eased), so text
//               never scales and glyphs stay crisp;
//   4. PLAY   — the container's own width/height interpolates too (the
//               parent's centering recenters it every frame), and settled
//               frames emit NO overrides, so chunk-merging resumes.
//
// v0.9.1 — why not scale? The original compensation applied non-uniform
// scale() to the whole item (2.4× for a 380→156px card), stretching text
// glyphs — visibly "thrashy". Rect channels move the box instead: content
// reflows inside a gliding box, dots stay round, text stays sharp.
//
// The scoped contract (pre-authorized fallback from the bet sheet): Morph
// OWNS the item wrappers — identity comes from out-of-flow marker runs
// (\u2063 invisible separator) that the prewarm walk matches between states.
// Authors keep full render control of item CONTENT via renderItem(id, state).
//
// Determinism: measurement happens ONCE per (banner, state) in a sync cache;
// render is a pure function of (frame, cache). No Math.random, no clock.

import { createElement, type ReactNode } from "react";
import { DriverContext, useCurrentFrame, useDriver } from "./context.js";
import { hashString } from "./motion.js";
import { renderToStaticMarkup } from "react-dom/server";
import type { TakumiStyle } from "../style.js";
import type { LintWarning } from "../lint.js";

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Invisible separator that prefixes marker runs (out-of-flow, 0-impact). */
export const MORPH_MARKER = "\u2063";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MorphRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MorphRequest {
  /** Namespace for the measurement cache (stable across phases). */
  key: string;
  itemIds: string[];
  from: string;
  to: string;
  /** Per-state container style. */
  containerStyle: Record<string, TakumiStyle | undefined>;
  /** Per-state, per-item wrapper style. */
  itemStyle: Record<string, Record<string, TakumiStyle | undefined>>;
  /** The AUTHOR's content renderer — called during measurement probes and
   *  frame renders alike (must be a pure function of (id, state)). */
  renderItem: (id: string, state: string) => ReactNode;
}

/** Sync cache: `key:id:state` → measured rect (CONTAINER-LOCAL). Filled by the capture prewarm. */
const morphCache = new Map<string, MorphRect>();

/** Container's own box per (key, state) — width/height drive the flight's
 *  container interpolation so a centered parent glides it smoothly. */
const morphContainers = new Map<string, MorphRect>();

/** Test/production seam. */
export function clearMorphCache(): void {
  morphCache.clear();
  morphContainers.clear();
}

/** Cache size (test seam) — items + containers. */
export function morphCacheSize(): number {
  return morphCache.size + morphContainers.size;
}

export function morphCacheKey(key: string, id: string, state: string): string {
  return `${key}:${id}:${state}`;
}

/** Read a measured rect (sync — the frame phase). Rects are CONTAINER-LOCAL
 *  (item origin minus container origin), so the flight is independent of how
 *  the real parent positions the container. */
export function morphRectOf(key: string, id: string, state: string): MorphRect | null {
  return morphCache.get(morphCacheKey(key, id, state)) ?? null;
}

/** Read the measured container box for a state (sync — the frame phase). */
export function morphContainerRectOf(key: string, state: string): MorphRect | null {
  return morphContainers.get(`${key}:${state}`) ?? null;
}

// ---------------------------------------------------------------------------
// Registry plumbing (probe → prewarm → frame), mirrors FitText's pattern
// ---------------------------------------------------------------------------

function registerMorphRequest(registry: unknown, request: MorphRequest): void {
  const store = registry as { morphRequests?: MorphRequest[]; morphKeys?: Set<string> };
  store.morphRequests ??= [];
  store.morphKeys ??= new Set<string>();
  if (store.morphKeys.has(request.key)) return;
  store.morphKeys.add(request.key);
  store.morphRequests.push(request);
}

/** Registry access for the capture prewarm (internal). */
export function takeMorphRequests(registry: unknown): MorphRequest[] {
  return (registry as { morphRequests?: MorphRequest[] }).morphRequests ?? [];
}

/** Cold-cache warnings drained by capture (internal). */
export function morphWarnings(registry: unknown): LintWarning[] {
  const store = registry as { morphColdKeys?: Set<string> };
  const cold = store.morphColdKeys;
  if (!cold || cold.size === 0) return [];
  return [...cold].map((key) => ({
    code: "TM_MORPH_UNMEASURED" as const,
    message: `<Morph key="${key}"> rendered without a prewarmed measurement — items will JUMP instead of morphing.`,
    hint: "Render through captureReactBanner/renderReactBanner/CLI (the prewarm pass runs there).",
    severity: "warn" as const,
  }));
}

// ---------------------------------------------------------------------------
// <Morph>
// ---------------------------------------------------------------------------

export interface MorphProps {
  /** Source state name. */
  from: string;
  /** Target state name. */
  to: string;
  /** Scene-local frame where the layout flips to `to`. Default 0. */
  switchFrame?: number;
  /** FLIP travel duration in frames. Default 14. */
  durationFrames?: number;
  /** Stable item ids — the morph pairs. */
  itemIds: string[];
  /** Item content per state (pure function of (id, state)). */
  renderItem: (id: string, state: string) => ReactNode;
  /** Per-state container style. */
  containerStyle?: Record<string, TakumiStyle | undefined>;
  /** Per-state, per-item wrapper style (the geometry contract). */
  itemStyle?: Record<string, Record<string, TakumiStyle | undefined>>;
  /** Cache namespace. Default: a hash of the config (stable per shape). */
  morphKey?: string;
  /** v0.9.1 — per-item flight delay in frames (item i starts i×stagger
   *  after switchFrame). 0 = all items fly together. Default 0. */
  staggerFrames?: number;
  /** v0.9.1 — flight progress (0..1) where item CONTENT flips from the
   *  source rendering to the target rendering. The box is mid-glide there;
   *  raise it if the target content needs the box near full target size.
   *  Default 0.5. */
  contentSwitchAt?: number;
  style?: TakumiStyle;
}

/**
 * Measured morph between two layouts of the SAME items:
 *
 * ```tsx
 * <Morph
 *   from="list" to="grid"
 *   switchFrame={20} durationFrames={14}
 *   itemIds={["a", "b", "c"]}
 *   renderItem={(id, state) => <Card id={id} mode={state} />}
 *   containerStyle={{ list: { display: "flex", flexDirection: "column", gap: 8 },
 *                     grid: { display: "flex", flexWrap: "wrap", gap: 8 } }}
 *   itemStyle={{ list: { width: 320, height: 56 },
 *                grid: { width: 150, height: 96 } }}
 * />
 * ```
 *
 * Before `switchFrame` the source state plays; during the flight each item
 * glides from its measured source rect to its measured target rect through
 * the position+size channels (no scale — glyphs stay crisp), and the
 * container's own box interpolates alongside. Measurement runs ONCE in the
 * capture prewarm — frames stay sync and byte-deterministic.
 */
export function Morph(props: MorphProps): ReactNode {
  const driver = useDriver();
  const frame = useCurrentFrame();

  const key = props.morphKey ?? defaultMorphKey(props);
  const request: MorphRequest = {
    key,
    itemIds: props.itemIds,
    from: props.from,
    to: props.to,
    containerStyle: props.containerStyle ?? {},
    itemStyle: props.itemStyle ?? {},
    renderItem: props.renderItem,
  };

  const switchFrame = Math.max(0, props.switchFrame ?? 0);
  const duration = Math.max(1, props.durationFrames ?? 14);
  const stagger = Math.max(0, Math.round(props.staggerFrames ?? 0));
  // The flight window covers the staggered tail: the last item starts
  // (n-1)×stagger late and still gets the full duration.
  const windowFrames = duration + stagger * Math.max(0, props.itemIds.length - 1);
  const transitioning = frame >= switchFrame && frame < switchFrame + windowFrames;
  const state = frame < switchFrame ? props.from : props.to;

  if (driver.phase === "probe") {
    registerMorphRequest(driver.registry, request);
    return null;
  }

  // v0.9 — declare the transition window: frames inside it are AUTHORED
  // motion (the shift lint exempts them; the morph moves boxes by design).
  if (transitioning) {
    const store = driver.registry as { morphActiveFrames?: Set<number> };
    store.morphActiveFrames ??= new Set();
    store.morphActiveFrames.add(driver.absoluteFrame);
  }

  const rectsReady = props.itemIds.every((id) => morphRectOf(key, id, props.from) && morphRectOf(key, id, props.to))
    && morphContainerRectOf(key, props.from) !== null
    && morphContainerRectOf(key, props.to) !== null;
  if (!rectsReady) {
    // Cold cache outside the runtime (plain renderToString) — register for
    // the next prewarm sweep, render the plain state, warn once per key.
    registerMorphRequest(driver.registry, request);
    const cold = (driver.registry as { morphColdKeys?: Set<string> }).morphColdKeys ??= new Set();
    cold.add(key);
  }

  const body = MorphBody({ request, state, style: props.style });

  if (!transitioning || !rectsReady) return body;

  // Flight: items glide from their source rects to the target layout through
  // position+size channels (v0.9.1 — no scale, glyphs stay crisp).
  return MorphFlightBody({
    request,
    frame,
    switchFrame,
    duration,
    stagger,
    windowFrames,
    contentSwitchAt: Math.min(1, Math.max(0, props.contentSwitchAt ?? 0.5)),
    style: props.style,
  });
}

function MorphBody(props: { request: MorphRequest; state: string; style?: TakumiStyle }): ReactNode {
  const { request, state } = props;
  return createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      ...(request.containerStyle[state] ?? {}),
      ...(props.style ?? {}),
    },
  }, request.itemIds.map((id) => morphItem(request, id, state)));
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The v0.9.1 flight: every item is absolutely positioned at its INTERPOLATED
 * rect (container-local source → target, easeInOut), the container's own
 * width/height interpolates on the un-staggered window (a centered parent
 * re-centers it every frame — no jump), and item CONTENT flips from the
 * source rendering to the target rendering at `contentSwitchAt`. No scale
 * anywhere: text stays crisp, dots stay round. Once every item has settled
 * the plain target body returns — byte-identical with post-flight frames —
 * and chunk-merging resumes.
 */
function MorphFlightBody(props: {
  request: MorphRequest;
  frame: number;
  switchFrame: number;
  duration: number;
  stagger: number;
  windowFrames: number;
  contentSwitchAt: number;
  style?: TakumiStyle;
}): ReactNode {
  const { request, frame, switchFrame, duration, stagger, windowFrames, contentSwitchAt } = props;

  const containerFrom = morphContainerRectOf(request.key, request.from);
  const containerTo = morphContainerRectOf(request.key, request.to);
  if (!containerFrom || !containerTo) return MorphBody({ request, state: request.to, style: props.style });

  // Container box: un-staggered progress across the whole window.
  const cp = easeInOutCubic(clamp01((frame - switchFrame) / windowFrames));
  const cw = r6(lerp(containerFrom.w, containerTo.w, cp));
  const ch = r6(lerp(containerFrom.h, containerTo.h, cp));

  const flown = request.itemIds.map((id, index) => {
    const from = morphRectOf(request.key, id, request.from);
    const to = morphRectOf(request.key, id, request.to);
    if (!from || !to) return morphItem(request, id, request.to);
    const u = clamp01((frame - switchFrame - index * stagger) / duration);
    // Settled items stay ABSOLUTE at their exact target rects until the whole
    // flight ends — in-flow siblings inside a still-lerping container could
    // re-wrap. The rects are measured, so this is visually the target layout.
    const q = u >= 1 ? 1 : easeInOutCubic(u);
    const contentState = q < contentSwitchAt ? request.from : request.to;
    return createElement("div", {
      key: `flight-${id}`,
      style: {
        position: "absolute",
        ...(request.itemStyle[contentState]?.[id] ?? {}),
        left: r6(lerp(from.x, to.x, q)),
        top: r6(lerp(from.y, to.y, q)),
        width: r6(lerp(from.w, to.w, q)),
        height: r6(lerp(from.h, to.h, q)),
      },
    },
      request.renderItem(id, contentState),
      markerSpan(request.key, id),
    );
  });

  // Every item settled AND the container arrived → plain target body (the
  // explicit box drops; identical HTML → chunks merge again).
  const allSettled = request.itemIds.every((_, index) =>
    clamp01((frame - switchFrame - index * stagger) / duration) >= 1);
  if (allSettled && cp >= 1) return MorphBody({ request, state: request.to, style: props.style });

  return createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      ...(request.containerStyle[request.to] ?? {}),
      width: cw,
      height: ch,
      ...(props.style ?? {}),
    },
  }, flown);
}

function morphItem(request: MorphRequest, id: string, state: string): ReactNode {
  return createElement("div", {
    key: `item-${id}`,
    style: {
      position: "relative",
      flexShrink: 0,
      ...(request.itemStyle[state]?.[id] ?? {}),
    },
  },
    request.renderItem(id, state),
    markerSpan(request.key, id),
  );
}

/** Out-of-flow identity marker: 0-impact on layout, visible to measure(). */
function markerSpan(key: string, id: string): ReactNode {
  return createElement("span", {
    style: {
      position: "absolute",
      top: 0,
      left: 0,
      opacity: 0,
      fontSize: 1,
      lineHeight: 1,
      whiteSpace: "pre",
    },
  }, `${MORPH_MARKER}${key}/${id}`);
}

function defaultMorphKey(props: MorphProps): string {
  const containerKeys = Object.keys(props.containerStyle ?? {}).join(",");
  return `morph-${hashString(`${props.itemIds.join(",")}|${props.from}>${props.to}|${containerKeys}`).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Prewarm (called by capture.ts): measure both states, fill the cache
// ---------------------------------------------------------------------------

interface WalkHit {
  rect: MorphRect;
}

/** Walk a measured tree; on a marker run, record the PARENT's rect. */
function collectMorphRects(node: any, parent: any | null, key: string, out: Map<string, MorphRect>): void {
  const marker = MORPH_MARKER;
  for (const run of node.runs ?? []) {
    const text: string = run.text ?? "";
    if (text.startsWith(marker)) {
      const rest = text.slice(marker.length);
      const slash = rest.indexOf("/");
      if (slash > 0) {
        const k = rest.slice(0, slash);
        const id = rest.slice(slash + 1);
        if (k === key && parent) {
          const m = parent.transform as number[];
          if (!out.has(id)) {
            out.set(id, { x: m[4], y: m[5], w: parent.width, h: parent.height });
          }
        }
      }
    }
  }
  for (const child of node.children ?? []) {
    collectMorphRects(child, node, key, out);
  }
}

/**
 * Async prewarm: for each Morph request, render both states to static
 * markup, parse + measure them through the real renderer, and cache every
 * item's CONTAINER-LOCAL rect plus the container's own box. Called from
 * captureReactBanner between the probe and the frame loop (fonts loaded).
 *
 * The probe tree is TWO-level: a canvas-sized positioning wrapper around the
 * real container. The container gets `width: "max-content"` when the author
 * didn't declare one, mirroring how a fit-content flex child measures in a
 * centered scene — so the cached box matches the real render's geometry and
 * the flight's container interpolation starts/ends exactly where the plain
 * states render.
 */
export async function resolveMorphRequests(requests: MorphRequest[], renderer: unknown, canvas: { width: number; height: number }): Promise<void> {
  if (requests.length === 0) return;
  const { fromHtml } = await import("@takumi-rs/helpers/html");
  const { createElement } = await import("react");

  for (const request of requests) {
    for (const state of [request.from, request.to]) {
      const cacheKeyPrefix = `${request.key}:`;
      const already = request.itemIds.every((id) => morphCache.has(`${cacheKeyPrefix}${id}:${state}`))
        && morphContainers.has(`${cacheKeyPrefix}${state}`);
      if (already) continue;

      const declared = request.containerStyle[state] ?? {};
      const containerStyle = declared.width === undefined ? { ...declared, width: "max-content" } : declared;
      const tree = createElement("div", {
        style: {
          width: canvas.width,
          height: canvas.height,
          position: "relative",
          display: "block",
        },
      },
        createElement("div", {
          style: {
            display: "flex",
            ...containerStyle,
          },
        }, request.itemIds.map((id) => morphItem(request, id, state))),
      );

      const html = renderToStaticMarkup(tree);
      const { node } = await fromHtml(html);
      const measured = await (renderer as { measure: (n: unknown, o: unknown) => Promise<any> }).measure(node, {
        width: canvas.width,
        height: canvas.height,
      });

      // The container is the wrapper's first element child.
      const containerNode = (measured.children ?? [])[0];
      if (!containerNode) continue;
      const cm = containerNode.transform as number[];
      const containerRect: MorphRect = { x: cm[4], y: cm[5], w: containerNode.width, h: containerNode.height };
      morphContainers.set(`${cacheKeyPrefix}${state}`, containerRect);

      // Item rects in canvas space → container-local.
      const out = new Map<string, MorphRect>();
      collectMorphRects(measured, null, request.key, out);
      for (const [id, rect] of out) {
        morphCache.set(morphCacheKey(request.key, id, state), {
          x: r6(rect.x - containerRect.x),
          y: r6(rect.y - containerRect.y),
          w: rect.w,
          h: rect.h,
        });
      }
    }
  }
}

// Re-exported for the capture driver's context typing.
export { DriverContext };
