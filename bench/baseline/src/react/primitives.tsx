// takumi-motion — react/primitives.tsx
// The scene director: <Banner>, <Scene>, <Layer> + defineBanner().
//
// Composition model (Remotion-flavored, banner-scoped):
//
//   export default defineBanner(function LaunchBanner() {
//     return (
//       <Banner preset="readme" theme="tokyo-night" font="Sora">
//         <Layer bottom><AccentBar /></Layer>
//         <Scene duration={90} enter="rise"><Hero /></Scene>
//         <Scene duration={120} enter="crossfade" exit="slide"><Carousel /></Scene>
//         <Scene duration={60} enter="slide"><Cta /></Scene>
//         <Layer top><VersionChip /></Layer>
//       </Banner>
//     );
//   });
//
// <Scene> and <Layer> are DECLARATIVE MARKERS: <Banner> scans its children
// (without rendering them), plans the timeline from their props, and on each
// capture frame composes the active scene(s) itself — handing each a
// FrameContext with scene-local time. The marker functions only render
// children when invoked outside the planner (identity fallback).

import { Children, Fragment, createElement, isValidElement, type ComponentType, type ReactElement, type ReactNode } from "react";
import { DriverContext, FrameContext, useDriver, type BannerMeta, type DriverRegistry, type FrameInfo } from "./context.js";
import { composeFrame, type BannerPlan, type PlannedScene, type ScenePlanInput, type TransitionInput, type TransitionKind } from "./plan.js";
import { bannerPresets } from "../presets.js";
import { transitionStyle, type TransitionStyles } from "./transitions.js";
import { resolvePreset, type BannerPreset } from "../presets.js";
import { resolveTheme, type Theme, type ThemeInput } from "../themes.js";
import { resolveBackground } from "../surface.js";
import { isSeriesElement, isSeriesSequenceElement, validateSeriesChildren, type SeriesSequenceProps } from "./series.js";
import { LabelContext } from "./cue.js";
import type { FontSpec } from "../fonts.js";

// ---------------------------------------------------------------------------
// defineBanner — explicit marker for "this component is a takumi-motion banner"
// ---------------------------------------------------------------------------

export const BANNER_MARKER = Symbol.for("takumi-motion.defineBanner");

/**
 * Mark a React component as a takumi-motion banner. The CLI and
 * renderReactBanner() use the marker to route the export to the React
 * runtime (unmarked function exports keep the v0.2 template-factory
 * semantics).
 */
export function defineBanner<C extends ComponentType>(component: C): C {
  Object.defineProperty(component, BANNER_MARKER, { value: true, enumerable: false, configurable: true });
  return component;
}

/** True when the value is a defineBanner()-marked component. */
export function isDefinedBanner(value: unknown): boolean {
  return typeof value === "function" && (value as unknown as Record<symbol, unknown>)[BANNER_MARKER] === true;
}

/** True when the value is a React element (has $$typeof). */
export function isReactElementValue(value: unknown): value is ReactElement {
  return (
    typeof value === "object" && value !== null &&
    "$$typeof" in value && (value as { $$typeof: unknown }).$$typeof !== undefined
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface SceneProps {
  /** Scene content duration in FRAMES (at the banner fps). */
  duration: number;
  /** How this scene arrives. Overlaps the previous scene's tail. Default "cut". */
  enter?: TransitionInput;
  /** How this scene leaves. Overlapped by the next scene's head. Default "cut". */
  exit?: TransitionInput;
  /** v0.8 — cue label for this scene's start frame; addressed by cue
   *  expressions ("intro+12f") via useCue(). Must be unique per banner. */
  label?: string;
  children?: ReactNode;
}

const SCENE_MARKER_NAME = "__takumiScene";

/** Identity render — <Banner> composes scenes itself; this is the fallback. */
function SceneMarker(props: SceneProps): ReactNode {
  return props.children ?? null;
}
Object.defineProperty(SceneMarker, SCENE_MARKER_NAME, { value: true });

/** Declarative scene marker — one timed segment of the banner. */
export const Scene = SceneMarker as typeof SceneMarker & { readonly __takumiScene: true };

/** True when the value is a <Scene> element. */
export function isSceneElement(value: unknown): value is ReactElement<SceneProps> {
  return (
    isValidElement(value) &&
    typeof (value as { type: unknown }).type === "function" &&
    SCENE_MARKER_NAME in ((value as { type: object }).type as object)
  );
}

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export interface LayerProps {
  /** Paint above every scene. Default true when neither top/bottom given. */
  top?: boolean;
  /** Paint below every scene. */
  bottom?: boolean;
  children?: ReactNode;
}

const LAYER_MARKER_NAME = "__takumiLayer";

function LayerMarker(props: LayerProps): ReactNode {
  return props.children ?? null;
}
Object.defineProperty(LayerMarker, LAYER_MARKER_NAME, { value: true });

/** Declarative persistent layer — painted above/below every scene. */
export const Layer = LayerMarker as typeof LayerMarker & { readonly __takumiLayer: true };

/** True when the value is a <Layer> element. */
export function isLayerElement(value: unknown): value is ReactElement<LayerProps> {
  return (
    isValidElement(value) &&
    typeof (value as { type: unknown }).type === "function" &&
    LAYER_MARKER_NAME in ((value as { type: object }).type as object)
  );
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

export interface BannerProps {
  /** Canvas preset ("readme", "readme-wide", …) or custom object. Default "readme".
   *  A preset is a RECIPE — every field it sets can be overridden below (v0.4). */
  preset?: string | BannerPreset;
  /** Logical canvas width override (CSS px). Wins over the preset. */
  width?: number;
  /** Logical canvas height override (CSS px). Wins over the preset. */
  height?: number;
  /** Device pixel ratio override (output = logical × dpr). Wins over the preset. */
  dpr?: number;
  /** Canvas background: a CSS color, or "transparent"/null for an alpha canvas
   *  (GIF binary transparency + alpha WebP/APNG). Default: the theme's bg. */
  background?: string | null;
  /** Theme name or partial theme. Default "midnight". */
  theme?: ThemeInput;
  /** Overrides the preset's fps. The capture driver uses the SAME value. */
  fps?: number;
  /** Google Font(s) to register for the render + stack on the canvas root. */
  fonts?: FontSpec | FontSpec[];
  /** Strict-loop intent: the runtime reports seam (frame 0 vs last) in check/report. */
  loop?: boolean;
  /** Default enter/exit overlap duration for string-kind transitions. Default 250ms. */
  transitionMs?: number;
  /** v0.8 — composition-wide tempo (time-stretch). 1 = authored speed;
   *  2 = twice as fast; 0.5 = half speed. Applied by the capture driver's
   *  frame mapping — scenes never see it. Default 1. */
  tempo?: number;
  children?: ReactNode;
}

/**
 * The banner canvas + scene director. Must be rendered through the capture
 * runtime (DriverContext) — it cannot render in a plain browser DOM tree.
 *
 * v0.9 Bet E — `<Banner loop>` + the last scene's `enter="wrap"` (or
 * `exit="wrap"`) appends a crossfade tail into scene 1's frozen frame-0
 * layer, making the loop seam byte-exact (checked as TM_LOOP_SEAM).
 */
export function Banner(props: BannerProps): ReactNode {
  const driver = useDriver();

  // The preset is the BASE; explicit width/height/dpr overrides win (v0.4 —
  // the engine is not banner-constrained: any surface is first-class).
  const base = resolvePreset(props.preset ?? "readme");
  const preset: BannerPreset = props.width !== undefined || props.height !== undefined || props.dpr !== undefined
    ? {
        ...base,
        ...(props.width !== undefined ? { width: props.width } : {}),
        ...(props.height !== undefined ? { height: props.height } : {}),
        ...(props.dpr !== undefined ? { devicePixelRatio: props.dpr } : {}),
      }
    : base;
  const theme = resolveTheme(props.theme ?? "midnight");
  const fps = props.fps ?? preset.fps;
  const fonts = props.fonts ? (Array.isArray(props.fonts) ? props.fonts : [props.fonts]) : [];
  const transitionMs = props.transitionMs ?? 250;
  const tempo = props.tempo ?? 1;
  if (!Number.isFinite(tempo) || tempo <= 0) {
    throw new Error(`<Banner>: tempo must be a finite positive number (1 = authored speed), got ${tempo}.`);
  }
  // undefined → theme default; "transparent"/null → alpha canvas; a color paints the root.
  const background = props.background === undefined ? theme.bg : resolveBackground(props.background) ?? null;

  const { scenes, layers, sceneInputs } = scanChildren(props.children);

  if (driver.phase === "probe") {
    registerMeta(driver.registry, { preset, theme, fps, fonts, loop: props.loop ?? false, transitionMs, tempo, background }, scenes, layers, sceneInputs);
    return null;
  }

  const plan = driver.registry.planned as BannerPlan;
  if (!plan) throw new Error("takumi-motion: plan missing in frame phase (runtime bug — probe must run first).");

  const composition = composeFrame(plan, driver.absoluteFrame);
  const sceneEls = scenes;

  const content: ReactNode[] = [];

  // Bottom layers (paint first).
  for (const el of layers) {
    if (el.props.bottom && !el.props.top) {
      content.push(layerBody(el, plan, driver.absoluteFrame, preset, "bottom"));
    }
  }

  // Active scene(s).
  if (composition.mode === "single") {
    content.push(sceneBody(sceneEls[composition.scene.index], composition.scene, composition.localFrame, plan, preset, null));
  } else if (composition.mode === "overlap") {
    // v0.9.1 — "push" travels the FULL canvas width (the arriving scene
    // covers the leaving one; they slide in lockstep), other kinds keep the
    // subtle 48px drift distance.
    const pushDistance = (kind: TransitionKind): number | undefined => (kind === "push" ? preset.width : undefined);
    const leaveStyle = transitionStyle(composition.leaving.exit.kind, "exit", composition.progress, pushDistance(composition.leaving.exit.kind));
    const enterStyle = transitionStyle(composition.arriving.enter.kind, "enter", composition.progress, pushDistance(composition.arriving.enter.kind));
    content.push(sceneBody(sceneEls[composition.leaving.index], composition.leaving, composition.localFrame.leaving, plan, preset, leaveStyle));
    content.push(sceneBody(sceneEls[composition.arriving.index], composition.arriving, composition.localFrame.arriving, plan, preset, enterStyle));
  } else {
    // v0.9 Bet E — the wrap tail: scene 1's frozen frame-0 layer painted
    // FIRST (full opacity, the seam destination), the last scene fading out
    // on top. At progress 1 the leaving node DROPS — the final frame's DOM
    // is then byte-identical with frame 0 (the seam check proves it).
    const leaveStyle = transitionStyle("crossfade", "exit", composition.progress);
    const fadedOut = composition.progress >= 1 || (leaveStyle.opacity !== undefined && leaveStyle.opacity <= 0);
    if (!fadedOut) {
      content.push(sceneBody(sceneEls[composition.leaving.index], composition.leaving, composition.localFrame.leaving, plan, preset, leaveStyle));
    }
    content.push(sceneBody(sceneEls[composition.arriving.index], composition.arriving, 0, plan, preset, null));
  }

  // Top layers (paint last).
  for (const el of layers) {
    if (!el.props.bottom || el.props.top) {
      content.push(layerBody(el, plan, driver.absoluteFrame, preset, "top"));
    }
  }

  return createElement(LabelContext.Provider, {
    value: { labels: plan.labels, totalFrames: plan.totalFrames },
  }, createElement("div", {
    style: {
      position: "relative",
      width: preset.width,
      height: preset.height,
      // "transparent"/null → nothing painted (alpha canvas); a color paints the root.
      ...(background ? { backgroundColor: background } : {}),
      overflow: "hidden",
      fontFamily: fontFamilyStack(props, theme),
    },
    "data-takumi-banner": "",
  }, ...content));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function fontFamilyStack(props: BannerProps, theme: Theme): string {
  const primary = props.fonts
    ? (Array.isArray(props.fonts) ? props.fonts[0] : props.fonts)
    : undefined;
  const primaryName = typeof primary === "string" ? primary : primary?.name;
  const stack: string[] = [];
  if (primaryName) stack.push(primaryName);
  if (theme.font && theme.font !== primaryName) stack.push(theme.font);
  stack.push("sans-serif");
  return stack.join(", ");
}

function scanChildren(children: ReactNode): {
  /** Scene-compatible elements in play order — <Scene> elements and
   *  <Series.Sequence> elements (flattened out of <Series> wrappers). */
  scenes: Array<ReactElement<{ children?: ReactNode }>>;
  layers: Array<ReactElement<LayerProps>>;
  /** Planner inputs, index-aligned with `scenes`. */
  sceneInputs: ScenePlanInput[];
} {
  const scenes: Array<ReactElement<{ children?: ReactNode }>> = [];
  const layers: Array<ReactElement<LayerProps>> = [];
  const sceneInputs: ScenePlanInput[] = [];

  const pushScene = (el: ReactElement<{ children?: ReactNode }>): void => {
    const props = el.props as SceneProps | SeriesSequenceProps;
    const durationFrames = isSeriesSequenceElement(el)
      ? (props as SeriesSequenceProps).durationInFrames
      : (props as SceneProps).duration;
    scenes.push(el);
    const enterInput = props.enter;
    const exitInput = props.exit;
    const kindOf = (t: TransitionInput | undefined): TransitionKind | undefined =>
      t === undefined ? undefined : typeof t === "string" ? t : t.kind;
    sceneInputs.push({
      durationFrames,
      enter: enterInput,
      exit: exitInput,
      ...(isSeriesSequenceElement(el) ? {} : (props as SceneProps).label !== undefined ? { label: (props as SceneProps).label } : {}),
      // v0.9 Bet E — the loop seam: wrap declared on either edge of the LAST
      // scene (the planner honors it only there).
      ...(kindOf(enterInput) === "wrap" || kindOf(exitInput) === "wrap" ? { wrap: true } : {}),
    });
  };

  const walk = (nodes: ReactNode, insideSeries: boolean): void => {
    Children.forEach(nodes, (child) => {
      if (child === null || child === undefined || typeof child === "boolean") return;
      if (!isValidElement(child)) {
        throw new Error(
          `<Banner> children must be <Scene>, <Layer> or <Series> elements — got the value "${String(child)}".`,
        );
      }
      // Fragments flatten transparently — grouping <Scene>s with <> is natural.
      if (child.type === Fragment) {
        if (insideSeries) {
          throw new Error("<Series> children must be flat <Series.Sequence> elements — wrap groups in <Series> instead of fragments.");
        }
        walk((child.props as { children?: ReactNode }).children, false);
        return;
      }
      if (isSeriesElement(child)) {
        if (insideSeries) {
          throw new Error("<Series> cannot nest inside <Series> — declare one flat list of <Series.Sequence> items.");
        }
        validateSeriesChildren(child as ReactElement<SeriesLikeProps>);
        walk((child.props as SeriesLikeProps).children, true);
        return;
      }
      if (isSeriesSequenceElement(child)) {
        if (!insideSeries) {
          throw new Error(
            "<Series.Sequence> must be a direct child of <Series> — use <Scene duration={…}> at the top level.",
          );
        }
        pushScene(child as ReactElement<{ children?: ReactNode }>);
        return;
      }
      if (insideSeries) {
        throw new Error(
          `<Series> children must be <Series.Sequence> elements — got <${
            typeof (child as { type: unknown }).type === "function"
              ? (child as { type: ComponentType }).type.name || "anonymous component"
              : String((child as { type: unknown }).type)
          }>.`,
        );
      }
      if (isSceneElement(child)) {
        pushScene(child as ReactElement<{ children?: ReactNode }>);
        return;
      }
      if (isLayerElement(child)) {
        layers.push(child as ReactElement<LayerProps>);
        return;
      }
      throw new Error(
        `<Banner> children must be <Scene>, <Layer> or <Series> elements — got <${
          typeof (child as { type: unknown }).type === "function"
            ? (child as { type: ComponentType }).type.name || "anonymous component"
            : String((child as { type: unknown }).type)
        }>. Wrap custom UI inside a <Scene>.`,
      );
    });
  };

  walk(children, false);

  if (scenes.length === 0) {
    throw new Error("<Banner> needs at least one <Scene duration={…}> or <Series> child.");
  }
  return { scenes, layers, sceneInputs };
}

interface SeriesLikeProps {
  children?: ReactNode;
}

function registerMeta(
  registry: DriverRegistry,
  meta: { preset: BannerPreset; theme: Theme; fps: number; fonts: FontSpec[]; loop: boolean; transitionMs: number; tempo: number; background: string | null },
  scenes: Array<ReactElement<{ children?: ReactNode }>>,
  layers: Array<ReactElement<LayerProps>>,
  sceneInputs: ScenePlanInput[],
): void {
  const banner: BannerMeta = {
    presetName: presetNameOf(meta.preset),
    width: meta.preset.width,
    height: meta.preset.height,
    fps: meta.fps,
    themeName: meta.theme.name,
    fontFamily: fontFamilyStack({ fonts: meta.fonts } as BannerProps, meta.theme),
    loop: meta.loop,
    transitionMs: meta.transitionMs,
    background: meta.background,
    fonts: meta.fonts as unknown[],
    preset: meta.preset,
    tempo: meta.tempo,
  };
  registry.banner = banner;
  registry.sceneInputs = sceneInputs.map((input) => ({ ...input }));
  registry.layerInputs = layers.map((el) => ({ top: el.props.top, bottom: el.props.bottom }));
}

function presetNameOf(preset: BannerPreset): string {
  // resolvePreset returns the same object identity for named presets.
  for (const [name, p] of Object.entries(bannerPresets)) {
    if (p === preset) return name;
  }
  return "custom";
}

function sceneBody(
  el: ReactElement<{ children?: ReactNode }> | undefined,
  scene: PlannedScene,
  localFrame: number,
  plan: BannerPlan,
  preset: BannerPreset,
  transition: TransitionStyles | null,
): ReactNode {
  if (!el) throw new Error(`takumi-motion: scene ${scene.index} missing from the scanned children (runtime bug).`);
  const info: FrameInfo = {
    frame: localFrame,
    absolute: scene.startFrame + localFrame,
    sceneFrames: scene.durationFrames,
    bannerFrames: plan.totalFrames,
    fps: plan.fps,
    timeMs: localFrame * plan.frameMs,
  };
  const style: Record<string, string | number> = {
    position: "absolute",
    top: 0,
    left: 0,
    width: preset.width,
    height: preset.height,
  };
  if (transition?.opacity !== undefined) style.opacity = transition.opacity;
  if (transition?.transform) style.transform = transition.transform;

  return createElement(
    FrameContext.Provider,
    { key: `scene-${scene.index}`, value: info },
    createElement("div", { style, "data-scene": String(scene.index) }, el.props.children),
  );
}

function layerBody(
  el: ReactElement<LayerProps>,
  plan: BannerPlan,
  absoluteFrame: number,
  preset: BannerPreset,
  slot: "top" | "bottom",
): ReactNode {
  const info: FrameInfo = {
    frame: absoluteFrame,
    absolute: absoluteFrame,
    sceneFrames: plan.totalFrames,
    bannerFrames: plan.totalFrames,
    fps: plan.fps,
    timeMs: absoluteFrame * plan.frameMs,
  };
  return createElement(
    FrameContext.Provider,
    { key: `layer-${slot}`, value: info },
    createElement(
      "div",
      {
        style: {
          position: "absolute",
          top: 0,
          left: 0,
          width: preset.width,
          height: preset.height,
          pointerEvents: "none",
        },
        "data-layer": slot,
      },
      el.props.children,
    ),
  );
}

// Keep DriverContext referenced for d.ts consumers building custom runtimes.
export { DriverContext };
