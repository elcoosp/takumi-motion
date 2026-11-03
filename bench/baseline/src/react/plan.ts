// takumi-motion — react/plan.ts
// Pure timeline planner for the React scene runtime.
//
// The planner turns <Scene duration enter exit> declarations into a frame-exact
// plan: every scene's global frame window, and where consecutive scenes
// OVERLAP to play enter/exit transitions. Overlap is the core mechanic —
// takumi's renderAnimation plays scenes sequentially, so a crossfade between
// scene A and scene B is realized as composite frames where BOTH subtrees
// render (the director stacks them absolutely and animates opacity/transform).
//
// All units are FRAMES at the banner fps. Plans are pure data — no React, no
// I/O — so the whole planning layer is unit-testable in isolation.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Transition vocabulary for <Scene enter exit>. "wrap" is Bet E's loop seam.
 *  "push" (v0.9.1) is the no-double-exposure slide: the arriving scene slides
 *  in from the right at FULL opacity while the leaving scene slides out left
 *  in lockstep — the two stay exactly adjacent, so nothing ever superimposes. */
export type TransitionKind = "cut" | "crossfade" | "slide" | "rise" | "push" | "wrap";

/** `enter="crossfade"` or `enter={{ kind: "slide", ms: 300 }}`. */
export type TransitionInput = TransitionKind | { kind: TransitionKind; ms?: number };

export interface TransitionSpec {
  kind: TransitionKind;
  /** Overlap duration in milliseconds. 0 for "cut". */
  ms: number;
}

/** Raw input collected from a <Scene> element's props. */
export interface ScenePlanInput {
  /** Scene content duration in frames. */
  durationFrames: number;
  enter?: TransitionInput;
  exit?: TransitionInput;
  /** v0.8 — cue label for this scene's start frame (unique across scenes). */
  label?: string;
  /** v0.9 Bet E — after this scene ends, crossfade into scene 1's frame-0
   *  layer for a pixel-perfect loop seam. Only honored on the LAST scene. */
  wrap?: boolean;
}

/** One scene's resolved position on the global frame grid. */
export interface PlannedScene {
  index: number;
  /** Global frame where this scene's window starts (its enter overlap included). */
  startFrame: number;
  /** Content frames (declared duration). The scene PLAYS through overlaps —
   *  its local frame keeps advancing while it arrives or leaves. */
  durationFrames: number;
  /** Head overlap frames: scene index-1 is still visible during them. */
  enterFrames: number;
  /** Tail overlap frames: scene index+1 arrives while this one is still visible. */
  exitFrames: number;
  enter: TransitionSpec;
  exit: TransitionSpec;
}

export interface BannerPlan {
  fps: number;
  /** Milliseconds per frame (1000 / fps). */
  frameMs: number;
  /** Total frames on the global grid (overlaps subtracted, wrap frames
   *  appended). */
  totalFrames: number;
  scenes: PlannedScene[];
  /** v0.8 — label → the labeled scene's global start frame (enter overlap
   *  included). Resolved ONCE at plan time; cue expressions read this table. */
  labels: Record<string, number>;
  /** Non-fatal adjustments (transitions clamped to cuts, etc). */
  warnings: string[];
  /** v0.9 Bet E — appended tail frames that crossfade the last scene into
   *  scene 1's frozen frame-0 layer (the loop seam). 0 when not wrapping. */
  wrapFrames: number;
}

export interface PlanOptions {
  fps: number;
  /** Default overlap duration for `enter="slide"`-style string inputs. Default 250ms. */
  defaultTransitionMs?: number;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export const DEFAULT_TRANSITION_MS = 250;

/**
 * Plan-grid rounding, hardened against float dust (v0.6): 250ms @ 30fps is
 * exactly 7.5 frames, but binary float produces 7.499999… — Math.round would
 * then flip-flop between 7 and 8 depending on accumulated dust. The plan
 * semantics are "ties round toward LESS overlap" (never invent extra overlap
 * from rounding), so the bias is subtractive: 7.5 → 7, 7.4999999 → 7,
 * 7.5001 → 8. Deterministic for any fps that divides 1000 into exact decimals.
 */
export function planRound(frames: number): number {
  return Math.round(frames - 1e-9);
}

const CUT: TransitionSpec = { kind: "cut", ms: 0 };

export function resolveTransition(input: TransitionInput | undefined, defaultMs: number): TransitionSpec {
  if (input === undefined || input === "cut") return CUT;
  if (typeof input === "string") return { kind: input, ms: defaultMs };
  if (input.kind === "cut") return CUT;
  return { kind: input.kind, ms: input.ms ?? defaultMs };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/**
 * Plan a sequence of scenes onto the global frame grid.
 *
 * Overlap rule: between scene i-1 and scene i, the overlap is
 * `max(enter(i).ms, exit(i-1).ms)` rounded to whole frames, clamped so that
 * (a) scene i-1 keeps at least one exclusive frame even with both of its
 * overlaps active, and (b) scene i keeps at least one frame after its enter.
 * A clamped-to-zero overlap degrades to a hard cut (with a warning).
 */
export function planBanner(inputs: ScenePlanInput[], opts: PlanOptions): BannerPlan {
  if (inputs.length === 0) throw new Error("planBanner: at least one <Scene> is required.");
  if (inputs.length > 64) throw new Error(`planBanner: ${inputs.length} scenes is a lot — cap is 64 (keep banners banner-sized).`);

  const fps = opts.fps;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`planBanner: invalid fps ${fps}.`);
  const frameMs = 1000 / fps;
  const defaultMs = opts.defaultTransitionMs ?? DEFAULT_TRANSITION_MS;
  const warnings: string[] = [];

  for (const [i, s] of inputs.entries()) {
    if (!Number.isInteger(s.durationFrames) || s.durationFrames < 1) {
      throw new Error(`Scene ${i}: duration must be a positive integer number of frames, got ${s.durationFrames}.`);
    }
  }

  const scenes: PlannedScene[] = [];
  let cursor = 0; // exclusive end of the previous scene's window
  let prevTailOverlap = 0;
  const labels: Record<string, number> = {};

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const enter = resolveTransition(input.enter, defaultMs);
    const exit = resolveTransition(input.exit, defaultMs);

    if (input.label !== undefined) {
      if (!/^[A-Za-z_][\w-]*$/.test(input.label)) {
        throw new Error(
          `Scene ${i}: label "${input.label}" must match [A-Za-z_][\w-]* (it is addressed by cue expressions like "${input.label}+12f").`,
        );
      }
      if (input.label === "end") {
        throw new Error(`Scene ${i}: "end" is a reserved cue label — rename the scene's label.`);
      }
      if (input.label in labels) {
        throw new Error(`Scene ${i}: label "${input.label}" is already used by another scene — cue labels must be unique.`);
      }
    }

    let enterFrames = 0;
    if (i > 0) {
      const prev = inputs[i - 1];
      const prevExit = resolveTransition(prev.exit, defaultMs);
      const overlapMs = Math.max(
        enter.kind !== "cut" ? enter.ms : 0,
        prevExit.kind !== "cut" ? prevExit.ms : 0,
      );
      if (overlapMs > 0) {
        const raw = planRound(overlapMs / frameMs);
        // (a) prev scene: prevTailOverlap (its head) + enterFrames (its tail) ≤ prev.duration - 1
        // (b) this scene: enterFrames ≤ duration - 1
        const clamped = Math.max(
          0,
          Math.min(raw, prev.durationFrames - 1 - prevTailOverlap, input.durationFrames - 1),
        );
        if (clamped !== raw) {
          warnings.push(
            `Transition into scene ${i} clamped from ${raw} to ${clamped} overlap frames ` +
            `(scene durations too short for ${Math.round(overlapMs)}ms).` + (clamped === 0 ? " Degrading to a hard cut." : ""),
          );
        }
        enterFrames = clamped;
      }
    }

    // The scene's window starts INSIDE the previous scene's tail: the overlap
    // frames are shared — prev keeps playing its content while this one arrives.
    const startFrame = cursor - enterFrames;
    if (input.label !== undefined) labels[input.label] = startFrame;

    scenes.push({
      index: i,
      startFrame,
      durationFrames: input.durationFrames,
      enterFrames,
      exitFrames: 0, // filled on the next iteration
      enter,
      exit,
    });

    cursor = startFrame + input.durationFrames;
    prevTailOverlap = enterFrames;
  }

  // Backfill tail overlaps: scene i's exitFrames = scene i+1's enterFrames.
  for (let i = 0; i < scenes.length - 1; i++) {
    scenes[i].exitFrames = scenes[i + 1].enterFrames;
  }

  // v0.9 Bet E — the wrap: the LAST scene may crossfade into scene 1's
  // frozen frame-0 layer so a looping banner lands its seam byte-exactly.
  let wrapFrames = 0;
  const last = inputs[inputs.length - 1];
  const wantsWrap =
    (last.enter !== undefined && resolveTransition(last.enter, defaultMs).kind === "wrap") ||
    (last.exit !== undefined && resolveTransition(last.exit, defaultMs).kind === "wrap");
  if (wantsWrap) {
    const wrapMs = Math.max(
      last.enter !== undefined && resolveTransition(last.enter, defaultMs).kind === "wrap"
        ? resolveTransition(last.enter, defaultMs).ms
        : 0,
      last.exit !== undefined && resolveTransition(last.exit, defaultMs).kind === "wrap"
        ? resolveTransition(last.exit, defaultMs).ms
        : 0,
    );
    const raw = planRound(Math.max(wrapMs, 1) / frameMs);
    // Keep at least one exclusive content frame; cap so the wrap stays a
    // fraction of the scene (a wrap longer than the scene is a mood, not a
    // seam).
    wrapFrames = Math.max(1, Math.min(raw, last.durationFrames - 1));
    if (inputs.length === 1) {
      wrapFrames = 0;
      warnings.push("wrap on a single-scene banner is a no-op — the seam IS the content.");
    }
  } else if (
    inputs.slice(0, -1).some(
      (s) =>
        (s.enter !== undefined && resolveTransition(s.enter, defaultMs).kind === "wrap") ||
        (s.exit !== undefined && resolveTransition(s.exit, defaultMs).kind === "wrap"),
    )
  ) {
    warnings.push("wrap is only honored on the LAST scene — other scenes' wrap declarations are ignored.");
  }

  return {
    fps,
    frameMs,
    totalFrames: cursor + wrapFrames,
    scenes,
    labels,
    warnings,
    wrapFrames,
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export type FrameComposition =
  | { mode: "single"; scene: PlannedScene; localFrame: number }
  | {
      mode: "overlap";
      /** The scene finishing (plays its exit) — lower paint order. */
      leaving: PlannedScene;
      /** The scene arriving (plays its enter) — higher paint order. */
      arriving: PlannedScene;
      localFrame: { leaving: number; arriving: number };
      /** 0 → 1 across the overlap (eased by the transition applier, not here). */
      progress: number;
    }
  | {
      /** v0.9 Bet E — a wrap tail frame: the last scene fades out OVER
       *  scene 1's frozen frame-0 layer (painted first, full opacity). At
       *  progress 1 the leaving node drops → byte-exact with frame 0. */
      mode: "wrap";
      leaving: PlannedScene;
      /** Always scenes[0], frozen at localFrame 0. */
      arriving: PlannedScene;
      localFrame: { leaving: number; arriving: number };
      progress: number;
    };

/**
 * Which scene(s) paint on global frame `frame`.
 *
 * Scenes are active for [startFrame, startFrame + durationFrames). During an
 * overlap exactly two adjacent scenes are active — the planner's clamps
 * guarantee never three.
 */
export function composeFrame(plan: BannerPlan, frame: number): FrameComposition {
  if (frame < 0 || frame >= plan.totalFrames) {
    throw new RangeError(`composeFrame: frame ${frame} outside plan (0..${plan.totalFrames - 1}).`);
  }

  // v0.9 Bet E — wrap tail: past the last scene's window, the director
  // crossfades the last scene out over scene 1's frozen frame-0 layer.
  const last = plan.scenes[plan.scenes.length - 1];
  const lastEnd = last.startFrame + last.durationFrames;
  if (plan.wrapFrames > 0 && frame >= lastEnd) {
    return {
      mode: "wrap",
      leaving: last,
      arriving: plan.scenes[0],
      localFrame: { leaving: frame - last.startFrame, arriving: 0 },
      progress: (frame - lastEnd + 1) / plan.wrapFrames,
    };
  }

  for (let i = plan.scenes.length - 1; i >= 0; i--) {
    const scene = plan.scenes[i];
    if (frame < scene.startFrame) continue;
    const local = frame - scene.startFrame;
    if (local >= scene.durationFrames) continue;

    if (local < scene.enterFrames && i > 0) {
      const prev = plan.scenes[i - 1];
      return {
        mode: "overlap",
        leaving: prev,
        arriving: scene,
        localFrame: {
          leaving: frame - prev.startFrame,
          arriving: local,
        },
        progress: (local + 1) / scene.enterFrames,
      };
    }
    return { mode: "single", scene, localFrame: local };
  }
  throw new Error(`composeFrame: frame ${frame} matched no scene (plan inconsistency).`);
}
