// takumi-motion — react/chain.ts (v0.8, Bet A)
// The sequence grammar: chain descriptors BACK-TO-BACK on one element, with
// holds between them and opt-in velocity continuity across the handoffs.
//
// ```tsx
// <Animated entering={chain(
//   FadeInDown.duration(14),        // slide in …
//   hold(8),                        // … hold the landing …
//   ZoomIn.springify().carryVelocity(), // … then breathe with inherited momentum
// )}>
// ```
//
// A chain IS a valid entering/exiting descriptor (pure data, same resolution
// contract): before it starts the element sits at the first segment's start
// state; between segments the previous segment's END state holds; after the
// chain settles the resolver returns null so identical frames chunk-merge.
//
// VELOCITY CONTINUITY (the deferred v0.7 Bet F, opt-in per segment):
// `.carryVelocity()` on a segment measures the previous segment's terminal
// progress-velocity (one-frame finite difference — deterministic, frame-grid
// honest) and injects it as that segment's spring `velocity`. Physics
// honesty: a spring that fully SETTLED carries ≈0 velocity — the handoff is
// real when the previous segment is cut short (a linear/eased tween, or a
// spring whose slot ends before rest). Dropped carries surface as
// TM_VELOCITY_DROPPED, never as silent no-ops.
//
// Compile-once doctrine: windows, carry patches and velocity measurements are
// computed once per (chain instance, fps) and memoized — per-frame resolution
// is a window lookup + the same O(1) math a plain descriptor costs.

import {
  springFor,
  springSettleFrames,
  type SpringAtOptions,
} from "./motion.js";
import { easingDefinitionToFunction } from "../easing.js";
import {
  applyChannels,
  type PresetChannels,
  type ResolvedTransition,
  type TransitionContext,
  type TransitionDescriptor,
  type TransitionFactory,
} from "./enter-exit.js";

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** A frozen gap between two motion segments. Resolves to the previous
 *  segment's end state (or the next segment's start state when leading). */
export interface HoldSegment {
  readonly kind: "hold";
  readonly frames: number;
  readonly name: string;
}

/** `hold(8)` — freeze the previous segment's end state for 8 frames. */
export function hold(frames: number): HoldSegment {
  if (!Number.isInteger(frames) || frames < 1) {
    throw new Error(`hold(): frames must be a positive integer, got ${frames}.`);
  }
  return { kind: "hold", frames, name: `hold(${frames})` };
}

export type ChainSegmentInput = TransitionFactory | HoldSegment;

/** Discriminant guard — TransitionFactory has no `kind`, holds do. */
export function isHoldSegment(value: ChainSegmentInput): value is HoldSegment {
  return "kind" in value && value.kind === "hold";
}

// ---------------------------------------------------------------------------
// Chain descriptor (IS a TransitionDescriptor for <Animated> purposes)
// ---------------------------------------------------------------------------

export interface ChainDescriptor extends TransitionDescriptor {
  /** The declared segments, in play order. */
  readonly segments: readonly ChainSegmentInput[];
}

export interface ChainFactory extends ChainDescriptor {
  /** `entering`/`exiting` alias — chains can flow either way (validated). */
  side: "enter" | "exit";
}

/** True when the value is a chain() composite (has the segments array). */
export function isChainDescriptor(value: unknown): value is ChainDescriptor {
  return (
    typeof value === "object" && value !== null &&
    Array.isArray((value as { segments?: unknown }).segments) &&
    typeof (value as { side?: unknown }).side === "string"
  );
}

// Terminal velocities below this are "settled" — imperceptible momentum.
const MOTION_EPSILON = 1e-3;

/**
 * Compose transition segments back-to-back:
 *
 * ```tsx
 * entering={chain(FadeInDown.duration(14), hold(6), ZoomIn.springify("bouncy").carryVelocity())}
 * ```
 *
 * Rules:
 * - at least one motion segment required; holds may lead/trail/intersperse;
 * - every motion segment must share one side (a chain is an entering OR an
 *   exiting — mixing sides is a composition error, not a runtime surprise);
 * - each motion segment keeps its own delay; the window it occupies is
 *   delay + nominal span (settle frames for springs);
 * - OPACITY CONTINUITY: presets are standalone, so most declare opacity
 *   [0, 1] — chained back-to-back they would blink to transparent at every
 *   handoff. Chains therefore CONTINUE the previous end-state opacity into a
 *   segment that starts fully transparent (its [0, b] becomes [prevEnd, b]).
 *   Transform channels stay verbatim — position resets ARE choreography. Opt
 *   out with defineTransition({ channels: { opacity: [0, 1], … } }) and a
 *   leading hold, or by authoring segments that don't start at 0.
 * - a segment marked `.carryVelocity()` receives the previous motion
 *   segment's terminal velocity (see module doc).
 */
export function chain(...items: ChainSegmentInput[]): ChainFactory {
  if (items.length === 0) {
    throw new Error("chain(): at least one segment is required.");
  }

  const motion = items.filter((item): item is TransitionFactory => !isHoldSegment(item));
  if (motion.length === 0) {
    throw new Error("chain(): at least one motion segment (a transition preset) is required.");
  }
  const side = motion[0].side;
  for (const seg of motion) {
    if (seg.side !== side) {
      throw new Error(
        `chain(): mixed sides — "${seg.preset}" is a ${seg.side} but "${motion[0].preset}" is a ${side}. ` +
        `A chain is one entering OR one exiting; use two <Animated> wrappers to cross the boundary.`,
      );
    }
  }

  const name = `chain(${items.map((item) => (isHoldSegment(item) ? item.name : item.preset)).join(" → ")})`;

  const descriptor: ChainDescriptor = {
    side,
    preset: name,
    durationFrames: 0, // nominal span is fps-dependent (springs) — windows are compiled per fps
    delayFrames: 0,
    easing: "linear",
    channels: {} as PresetChannels,
    segments: items,
  };
  return descriptor as ChainFactory;
}

// ---------------------------------------------------------------------------
// Compilation — once per (chain, fps)
// ---------------------------------------------------------------------------

interface CompiledWindow {
  kind: "motion" | "hold";
  /** Patched motion segment (carry velocity injected). */
  seg?: TransitionDescriptor;
  /** Unpatched motion segment — the velocity probe evaluates THIS. */
  raw?: TransitionDescriptor;
  start: number;
  span: number;
  /** End-state style override for holds (constant per compilation). */
  holdState?: ResolvedTransition | null;
}

interface CompiledChain {
  windows: CompiledWindow[];
  totalFrames: number;
  /** TM_VELOCITY_DROPPED messages, computed once. */
  velocityDropped: string[];
}

// chain instance → fps → compiled. WeakMap so authoring objects can be GC'd;
// the inner Map is bounded by distinct fps values (tiny in practice).
const compiledCache = new WeakMap<object, Map<number, CompiledChain>>();

function nominalSpanFrames(seg: TransitionDescriptor, fps: number): number {
  return seg.spring
    ? springSettleFrames(fps, { ...seg.spring, from: 0, to: 1, delayFrames: 0 })
    : seg.durationFrames;
}

/** Progress of a descriptor's motion at chain-local frame `local`, ignoring its delay slot. */
function progressOf(seg: TransitionDescriptor, local: number, fps: number): number {
  if (seg.spring) {
    return springFor(local, fps, { ...seg.spring, from: 0, to: 1 });
  }
  const raw = Math.min(1, Math.max(0, (local - seg.delayFrames) / seg.durationFrames));
  return easingDefinitionToFunction(seg.easing)(raw);
}

/** Terminal progress-velocity of `seg`, in progress-units/second (one-frame FD). */
function terminalVelocity(seg: TransitionDescriptor, localEnd: number, fps: number): number {
  const at = Math.max(1, localEnd);
  const p1 = progressOf(seg, at, fps);
  const p0 = progressOf(seg, at - 1, fps);
  return (p1 - p0) * fps;
}

function compileChain(chainDesc: ChainDescriptor, fps: number): CompiledChain {
  const velocityDropped: string[] = [];
  const windows: CompiledWindow[] = [];
  let cursor = 0;
  let lastMotion: { raw: TransitionDescriptor; localEnd: number } | null = null;
  /** End-state opacity carried across segments/holds (chain opacity continuity). */
  let continuityFrom: number | null = null;

  for (const item of chainDesc.segments) {
    if (isHoldSegment(item)) {
      // Hold state: previous segment's end state, or the next segment's start
      // state when the chain leads with a hold.
      let state: ResolvedTransition | null = null;
      if (lastMotion) {
        state = applyChannels(lastMotion.raw.channels, 1);
      } else {
        const next = chainDesc.segments.find((s): s is TransitionFactory => !isHoldSegment(s));
        if (next) state = applyChannels(next.channels, 0);
      }
      windows.push({ kind: "hold", start: cursor, span: item.frames, holdState: state });
      cursor += item.frames;
      continue;
    }

    const raw = item as unknown as TransitionDescriptor;

    // Opacity continuity (see chain() doc): continue the previous end-state
    // opacity into a segment that would otherwise blink to transparent.
    let channels = raw.channels;
    const rawOpacity = channels.opacity;
    if (continuityFrom !== null && rawOpacity && rawOpacity[0] === 0 && rawOpacity[1] > 0) {
      channels = { ...channels, opacity: [continuityFrom, rawOpacity[1]] as [number, number] };
    }
    const rawSeg: TransitionDescriptor = { ...raw, channels };
    let seg = rawSeg;

    // The continuity reference AFTER this segment: its own (patched)
    // end-state opacity — and when the segment declares NO opacity channel it
    // never hides anything, so it seeds the carried reference at 1. Without
    // this seed, the first opacity-declaring segment after an opacity-less
    // one (SlideLinear → ZoomIn) replayed opacity [0,1] and blinked the
    // element invisible at the handoff (found by the v0.8 demo reel).
    continuityFrom = rawSeg.channels.opacity ? rawSeg.channels.opacity[1] : 1;

    if (raw.carry) {
      const prev = lastMotion;
      if (!prev) {
        velocityDropped.push(
          `${raw.preset} asked for carryVelocity() but nothing precedes it in the chain — there is no velocity to carry.`,
        );
      } else if (!raw.spring) {
        velocityDropped.push(
          `${raw.preset} asked for carryVelocity() but it is not springified — only springs can receive velocity. Add .springify() (or .damping()/.bounce()).`,
        );
      } else if (raw.spring.duration !== undefined || raw.spring.visualDuration !== undefined) {
        velocityDropped.push(
          `${raw.preset} asked for carryVelocity() but its spring is time-defined (duration/visualDuration) — those springs ignore velocity by physics. ` +
            `Give it a physics spring instead: .springify({ stiffness: 170, damping: 11 }) (or springPresets.wobbly/stiff).`,
        );
      } else {
        // Spring producers always settle inside their window (the window IS
        // the settle span) → they hand off ≈0 velocity by construction; only
        // tween producers can be genuinely cut short and carry momentum.
        const v = prev.raw.spring ? 0 : terminalVelocity(prev.raw, prev.localEnd, fps);
        if (Math.abs(v) < MOTION_EPSILON) {
          velocityDropped.push(
            `${raw.preset} asked for carryVelocity() but "${prev.raw.preset}" settled before the handoff (≈0 velocity) — the carry is a no-op. ` +
              `Use a tween producer (its end-slope is real momentum) or shorten the previous segment's window.`,
          );
        } else {
          // NOTE: spread rawSeg (the continuity-patched segment), NOT raw —
          // rebuilding from raw discarded the opacity patch and blinked the
          // element at every carry handoff (second half of the v0.8.1 demo bug).
          seg = { ...rawSeg, spring: { ...raw.spring, velocity: v } as SpringAtOptions };
        }
      }
    }

    const span = raw.delayFrames + nominalSpanFrames(raw, fps);
    windows.push({ kind: "motion", seg, raw, start: cursor, span });
    cursor += span;
    lastMotion = { raw, localEnd: span };
  }

  return { windows, totalFrames: cursor, velocityDropped };
}

function compiledFor(chainDesc: ChainDescriptor, fps: number): CompiledChain {
  let byFps = compiledCache.get(chainDesc);
  if (!byFps) {
    byFps = new Map<number, CompiledChain>();
    compiledCache.set(chainDesc, byFps);
  }
  const hit = byFps.get(fps);
  if (hit) return hit;
  const compiled = compileChain(chainDesc, fps);
  byFps.set(fps, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Resolution — O(1) window lookup + plain descriptor math
// ---------------------------------------------------------------------------

/**
 * Resolve a chain at scene-local `frame`. Null once the whole chain has
 * settled (style-stable — chunk-merge stays effective).
 *
 * Anchoring matches single descriptors: ENTER chains start at frame 0
 * (before their window the element sits at the first segment's start state);
 * EXIT chains anchor their END to the scene's close — the chain occupies the
 * last `totalFrames` frames of the window and returns null before it starts.
 */
export function resolveChainAtFrame(
  chainDesc: ChainDescriptor,
  frame: number,
  ctx: TransitionContext,
): ResolvedTransition | null {
  const compiled = compiledFor(chainDesc, ctx.fps);
  const anchor = chainDesc.side === "exit" ? ctx.totalFrames - compiled.totalFrames : 0;
  const local = frame - anchor;

  if (local < 0) {
    // Before the chain: ENTER chains paint their start state (hidden, not
    // absent); EXIT chains leave the element in its authored style.
    if (chainDesc.side === "enter") {
      const first = compiled.windows.find((w) => w.kind === "motion");
      return first?.raw ? applyChannels(first.raw.channels, 0) : null;
    }
    return null;
  }
  if (local >= compiled.totalFrames) return null;

  // Few segments in practice — a linear scan beats a binary search here.
  for (const window of compiled.windows) {
    if (local < window.start) break;
    const inWindow = local - window.start;
    if (inWindow >= window.span) continue;

    if (window.kind === "hold") {
      return window.holdState ?? null;
    }
    // Motion window: resolve the (possibly patched) segment on its own clock.
    return resolveMotionInWindow(window, inWindow, ctx);
  }
  return null;
}

function resolveMotionInWindow(window: CompiledWindow, local: number, ctx: TransitionContext): ResolvedTransition | null {
  const seg = window.seg;
  if (!seg) return window.holdState ?? null;
  if (seg.spring) {
    // Spring: its settle defines the window; resolve on a clean clock.
    const p = springFor(local - seg.delayFrames, ctx.fps, { ...seg.spring, from: 0, to: 1 });
    return applyChannels(seg.channels, p);
  }
  const raw = (local - seg.delayFrames) / seg.durationFrames;
  const clamped = Math.min(1, Math.max(0, raw));
  const p = easingDefinitionToFunction(seg.easing)(clamped);
  return applyChannels(seg.channels, p);
}

// ---------------------------------------------------------------------------
// Diagnosis (audit-as-data — evaluated ONCE per capture at the scene's end)
// ---------------------------------------------------------------------------

/**
 * Why the chain cannot finish inside the scene window (TM_TRANSITION_UNSETTLED),
 * or null when it fits. Enter chains must fit from frame 0; exit chains must
 * fit before the scene close.
 */
export function chainSettleIssue(chainDesc: ChainDescriptor, ctx: TransitionContext): string | null {
  const compiled = compiledFor(chainDesc, ctx.fps);
  if (compiled.totalFrames <= ctx.totalFrames) return null;
  const over = compiled.totalFrames - ctx.totalFrames;
  const anchoring = chainDesc.side === "exit"
    ? "the exit would start before frame 0 and is cut mid-motion at the scene's first frame"
    : "the tail is cut before the chain settles";
  return (
    `${chainDesc.preset} spans ${compiled.totalFrames}f but the scene window is ${ctx.totalFrames}f — ` +
    `${anchoring} (${over}f over).`
  );
}

/**
 * TM_VELOCITY_DROPPED diagnoses — computed during compilation (memoized),
 * returned as messages. Empty when every carry landed.
 */
export function chainVelocityIssues(chainDesc: ChainDescriptor): string[] {
  // Velocity probes need an fps; compilation happens on first resolve. Use
  // the cached compilation under ANY fps — the dropped-velocity verdicts that
  // depend on fps (spring settles) are already computed by the time any frame
  // rendered. If the chain never resolved, compile at 20 (the engine default).
  let byFps = compiledCache.get(chainDesc);
  const compiled = byFps?.values().next().value ?? compileChain(chainDesc, 20);
  return compiled.velocityDropped;
}
