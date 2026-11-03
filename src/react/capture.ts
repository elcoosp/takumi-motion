// takumi-motion — react/capture.ts
// The Node-side capture driver for the frame-driven React runtime.
//
// Pipeline:
//   1. PROBE  — render the user's tree once in "probe" phase; <Banner>
//               registers its resolved metadata + scene inputs into the
//               registry and renders null.
//   2. PLAN   — planBanner() turns scene inputs into the frame-exact plan.
//   3. FRAMES — renderToStaticMarkup() once per frame; <Banner> composes the
//               active scene(s) for that frame from the plan.
//   4. CHUNK  — consecutive identical HTML strings merge into scene chunks;
//               the chunks feed takumi's native sequential-scene encoder.
//
// Determinism doctrine enforced here: Math.random is shimmed to a seeded
// PRNG for the duration of capture (one warning on first use) so accidental
// nondeterminism still produces byte-stable output. Date.now is not shimmed —
// render must not consult the clock; that's a documented scene rule.

import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DriverContext, type BannerMeta, type DriverRegistry } from "./context.js";
import { DataContext } from "./data.js";
import { planBanner, type BannerPlan } from "./plan.js";
import { isReactElementValue } from "./primitives.js";
import { mulberry32 } from "./motion.js";
import { resolvePreset, bannerPresets, type BannerPreset } from "../presets.js";
import { resolveTheme, type Theme } from "../themes.js";
import type { FontSpec } from "../fonts.js";
import {
  collectLintWarnings,
  lintHtmlChunks,
  lintStyleTree,
  type LintWarning,
} from "../lint.js";
import { resolveFitRequests, getSharedRenderer } from "../measure.js";
import { ensureFonts } from "../fonts.js";
import { resolveMorphRequests, morphWarnings, morphRectOf, takeMorphRequests } from "./morph.js";
import { takeFitRequests, unmeasuredFitWarnings } from "./components.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A run of consecutive frames whose rendered HTML is byte-identical. */
export interface CaptureChunk {
  html: string;
  /** Number of frames this chunk spans (≥ 1). */
  frames: number;
  /** Global frame index of the chunk's first frame. v0.8: in OUTPUT space
   *  (0-based within the capture window when windowed). */
  startFrame: number;
}

export interface CaptureOptions {
  /** Overrides the fps resolved from <Banner> props/preset when given. */
  fps?: number;
  /** Ignored when the banner declares its own preset — used for defaults only. */
  preset?: string | BannerPreset;
  /** FontSpecs to merge with banner-declared fonts (CLI --font pass-through). */
  fonts?: FontSpec[];
  /** v0.8 — windowed capture: first OUTPUT frame to render (default 0). */
  fromFrame?: number;
  /** v0.8 — windowed capture: exclusive last OUTPUT frame (default: all). */
  toFrame?: number;
  /**
   * v0.9 Bet A — the data object for the banner ("the animation knows the
   * numbers"). Read once at setup (file load — never a network fetch at
   * render time) and provided to the tree via DataContext; components read
   * it with useChartData(). Render stays a pure function of (frame, data).
   */
  data?: unknown;
}

export interface CaptureResult {
  /** The planned timeline (frame-exact, AUTHORING frames). */
  plan: BannerPlan;
  /** v0.8 — frames actually rendered this capture (plan.totalFrames after
   *  tempo mapping, sliced to the capture window). Output-space length of
   *  htmlFrames/chunks. */
  outputFrames: number;
  /** v0.8 — the capture window: output-frame [from, to) and the tempo applied. */
  window: { from: number; to: number; tempo: number };
  /** Resolved banner metadata (probe phase). */
  meta: {
    presetName: string;
    width: number;
    height: number;
    fps: number;
    themeName: string;
    fontFamily: string;
    loop: boolean;
    transitionMs: number;
    /** null → transparent canvas. */
    background: string | null;
    fonts: FontSpec[];
    theme: Theme;
    preset: BannerPreset;
  };
  /** HTML per frame (length === plan.totalFrames). */
  htmlFrames: string[];
  /** Merged chunks (html + frame run length) — the encoder input. */
  chunks: CaptureChunk[];
  /** Determinism shims + plan clamp notices. */
  warnings: string[];
  /** v0.6 — the authoring lint: coded warnings for the known silent-failure
   *  classes (kebab styles, NaN values, empty styles, unmeasured FitText). */
  lint: LintWarning[];
  /** v0.9 Bet B — global (authoring) frames inside an active <Morph>
   *  transition window: authored motion the layout-shift lint exempts. */
  morphActiveFrames: number[];
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

const CAPTURE_RANDOM_SEED = 0x74a6d1; // "takumi" flavored

// ---------------------------------------------------------------------------
// Probe + plan (v1.0 — shared with the parallel capture pool)
// ---------------------------------------------------------------------------

export interface ProbeResult {
  registry: DriverRegistry;
  meta: BannerMeta;
  plan: BannerPlan;
  fps: number;
  theme: Theme;
  preset: BannerPreset;
  /** Output frames after tempo mapping (the full capture window size). */
  outputTotal: number;
  tempo: number;
  /** v1.0 — steady-state per-frame render cost in ms (probe timing). The
   *  workers:"auto" gate multiplies this by the frame count. */
  probeMs: number;
}

type ElementFactory = (phase: "probe" | "frame", frame: number, fps: number) => ReactElement;

/** Probe pass: discover <Banner> metadata + the frame-exact plan. Pure, cheap
 *  (one static render), and deterministic — every worker window probes to the
 *  identical plan, so the pool can size its windows on the main thread. */
export function probeReactBanner(
  input: ReactElement | ComponentType,
  options: CaptureOptions = {},
  elementFor?: ElementFactory,
  registryOverride?: DriverRegistry,
): ProbeResult {
  const registry: DriverRegistry = registryOverride ?? { errors: [] };
  const renderElement =
    elementFor ??
    ((phase: "probe" | "frame", frame: number, fps: number): ReactElement =>
      createElement(
        DriverContext.Provider,
        { value: { phase, absoluteFrame: frame, fps, registry } },
        createElement(
          DataContext.Provider,
          { value: options.data },
          isReactElementValue(input) ? input : createElement(input as ComponentType),
        ),
      ));
  // Probe render 1 = discovery (side effects into the registry). Render 2 =
  // steady-state timing — the per-frame cost estimate behind workers:"auto"
  // (the banner tree, fully warm, is exactly what a capture frame renders).
  renderToStaticMarkup(renderElement("probe", 0, options.fps ?? 20));
  const probeT0 = performance.now();
  renderToStaticMarkup(renderElement("probe", 0, options.fps ?? 20));
  const probeMs = performance.now() - probeT0;

  const meta = registry.banner;
  const sceneInputs = registry.sceneInputs;
  if (!meta || !sceneInputs) {
    throw new Error(
      "captureReactBanner: no <Banner> found in the rendered tree. " +
      "The default export must be a <Banner> element or a defineBanner()-marked component rendering one.",
    );
  }

  const fps = options.fps ?? meta.fps;
  const theme = resolveThemeByName(meta.themeName);
  // The probe carries the RESOLVED preset object (custom presets survive).
  const preset = (meta.preset as BannerPreset | undefined) ?? resolvePresetByName(meta.presetName, meta.width, meta.height);

  const plan = planBanner(sceneInputs as never, {
    fps,
    defaultTransitionMs: meta.transitionMs,
  });
  registry.planned = plan;

  const tempo = meta.tempo ?? 1;
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new Error(`captureReactBanner: tempo must be a finite positive number, got ${tempo}.`);
  }
  const outputTotal = tempo === 1 ? plan.totalFrames : Math.ceil(plan.totalFrames / tempo);

  return { registry, meta, plan, fps, theme, preset, outputTotal, tempo, probeMs };
}

export async function captureReactBanner(
  input: ReactElement | ComponentType,
  options: CaptureOptions = {},
): Promise<CaptureResult> {
  const warnings: string[] = [];
  const registry: DriverRegistry = { errors: [] };

  const elementFor = (phase: "probe" | "frame", frame: number, fps: number): ReactElement =>
    createElement(
      DriverContext.Provider,
      { value: { phase, absoluteFrame: frame, fps, registry } },
      createElement(
        DataContext.Provider,
        { value: options.data },
        isReactElementValue(input) ? input : createElement(input as ComponentType),
      ),
    );

  // --- 1+2. probe + plan (factored so the parallel pool can size windows) --
  const probed = probeReactBanner(input, options, elementFor, registry);
  const { meta, plan, fps, theme, preset } = probed;
  for (const w of plan.warnings) warnings.push(w);

  // --- 2b. output grid (v0.8): tempo mapping + capture window --------------
  // tempo scales AUTHORING time onto OUTPUT frames: output f sees authoring
  // frame floor(f × tempo) — scenes, overlaps, layers all speed up uniformly
  // because the mapping happens HERE, before anything downstream sees a frame.
  const { tempo, outputTotal } = probed;
  const windowFrom = Math.max(0, Math.min(options.fromFrame ?? 0, outputTotal - 1));
  const windowTo = Math.max(windowFrom + 1, Math.min(options.toFrame ?? outputTotal, outputTotal));
  if (options.fromFrame !== undefined && (!Number.isInteger(options.fromFrame) || options.fromFrame < 0)) {
    throw new Error(`captureReactBanner: fromFrame must be a non-negative integer, got ${options.fromFrame}.`);
  }
  if (options.toFrame !== undefined && (!Number.isInteger(options.toFrame) || options.toFrame < 1)) {
    throw new Error(`captureReactBanner: toFrame must be a positive integer, got ${options.toFrame}.`);
  }

  // --- 3. prewarm (v0.6) ---------------------------------------------------
  const htmlFrames: string[] = [];
  const originalRandom = Math.random;
  let randomWarned = false;

  // v1.0 — the determinism shim is FRAME-SEEDED: a frame's render is a pure
  // function of (frame, props), so accidental Math.random use produces the
  // same value sequence for a given frame no matter which worker window (or
  // serial pass) rendered it. This is what makes parallel capture
  // byte-identical to serial capture at ANY window partition.
  let activeFrame = -1;
  let frameRng = mulberry32(CAPTURE_RANDOM_SEED);
  const shimRandomFor = (frame: number): void => {
    activeFrame = frame;
    frameRng = mulberry32((CAPTURE_RANDOM_SEED ^ Math.imul(frame + 0x9e3779b1, 0x85ebca6b)) >>> 0);
  };
  Math.random = () => {
    if (!randomWarned) {
      randomWarned = true;
      warnings.push(
        "Math.random() was called during capture — shimmed to a frame-seeded PRNG for determinism. " +
        "Use useRandom(seed) for explicit, warning-free randomness.",
      );
    }
    return frameRng();
  };

  // One frame render, shim-seeded. Both the scene sweep and the capture walk
  // go through here so their shims see the same (frame)-seeded stream.
  const renderSeeded = (frame: number): string => {
    shimRandomFor(frame);
    return renderToStaticMarkup(elementFor("frame", frame, fps));
  };

  try {
    if (plan.scenes.some((s) => s.durationFrames > 0)) {
      for (const scene of plan.scenes) {
        const frame = Math.max(0, Math.min(scene.startFrame, plan.totalFrames - 1));
        renderSeeded(frame);
      }
    }
    const fitRequests = takeFitRequests(registry);
    const morphRequests = takeMorphRequests(registry);
    if (fitRequests.length > 0 || morphRequests.length > 0) {
      const renderer = await getSharedRenderer();
      const fonts = mergeFonts(meta.fonts as FontSpec[], options.fonts);
      if (fonts.length > 0) await ensureFonts(renderer, fonts);
      if (fitRequests.length > 0) await resolveFitRequests(fitRequests, renderer);
      // v0.9 Bet B — <Morph> prewarm: measure both states of every request
      // through the real renderer (the FLIP source of truth).
      if (morphRequests.length > 0) {
        await resolveMorphRequests(morphRequests, renderer, { width: meta.width, height: meta.height });
        // The scene sweep ran BEFORE measurement — re-check the cold flags:
        // keys whose rects are now cached were never actually cold.
        const store = registry as { morphColdKeys?: Set<string> };
        if (store.morphColdKeys) {
          for (const key of [...store.morphColdKeys]) {
            const request = morphRequests.find((r) => r.key === key);
            if (request && request.itemIds.every((id) =>
              morphRectOf(key, id, request.from) && morphRectOf(key, id, request.to))) {
              store.morphColdKeys.delete(key);
            }
          }
        }
      }
    }

    // --- 4. frames (v0.8: windowed + tempo-mapped) -------------------------
    for (let f = windowFrom; f < windowTo; f++) {
      const authored = tempo === 1 ? f : Math.min(plan.totalFrames - 1, Math.floor(f * tempo));
      htmlFrames.push(renderSeeded(authored));
    }
  } finally {
    Math.random = originalRandom;
  }

  // --- 5. chunk ------------------------------------------------------------
  const chunks = chunkFrames(htmlFrames);
  for (const chunk of chunks) chunk.startFrame += windowFrom;

  const fonts = mergeFonts(meta.fonts as FontSpec[], options.fonts);

  // --- 5. authoring lint (v0.6) --------------------------------------------
  // Tree walk catches styles the author literalized; chunk walk catches what
  // opaque components rendered (dropped declarations, NaN leaks); the
  // registry carries runtime-emitted warnings (unmeasured FitText).
  const lint = collectLintWarnings([
    ...(isReactElementValue(input) ? lintStyleTree(input, { strict: false }) : []),
    ...lintHtmlChunks(chunks.map((c) => c.html)),
    ...((registry as { lints?: LintWarning[] }).lints ?? []),
    ...unmeasuredFitWarnings(registry),
    ...morphWarnings(registry),
  ]);

  return {
    plan,
    outputFrames: windowTo - windowFrom,
    window: { from: windowFrom, to: windowTo, tempo },
    meta: {
      presetName: meta.presetName,
      width: meta.width,
      height: meta.height,
      fps,
      themeName: meta.themeName,
      fontFamily: meta.fontFamily,
      loop: meta.loop,
      transitionMs: meta.transitionMs,
      background: meta.background ?? null,
      fonts,
      theme,
      preset,
    },
    htmlFrames,
    chunks,
    warnings,
    lint,
    morphActiveFrames: [...((registry as { morphActiveFrames?: Set<number> }).morphActiveFrames ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Merge consecutive frames with byte-identical HTML into chunks (holds). */
export function chunkFrames(frames: string[]): CaptureChunk[] {
  const chunks: CaptureChunk[] = [];
  for (let i = 0; i < frames.length; i++) {
    const html = frames[i];
    const last = chunks[chunks.length - 1];
    if (last && last.html === html) {
      last.frames++;
    } else {
      chunks.push({ html, frames: 1, startFrame: i });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeFonts(banner: FontSpec[], extra?: FontSpec[]): FontSpec[] {
  const seen = new Set<string>();
  const out: FontSpec[] = [];
  for (const spec of [...banner, ...(extra ?? [])]) {
    const key = typeof spec === "string" ? spec : `${spec.name}|${JSON.stringify(spec.weight ?? null)}|${spec.style ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
  }
  return out;
}

function resolveThemeByName(name: string): Theme {
  try {
    return resolveTheme(name);
  } catch {
    return resolveTheme("midnight");
  }
}

function resolvePresetByName(name: string, width: number, height: number): BannerPreset {
  const found = bannerPresets[name];
  if (found) return found;
  // Custom preset object passed inline — reconstruct the essentials.
  return { ...resolvePreset("readme"), width, height, description: "custom (inline preset)" };
}
