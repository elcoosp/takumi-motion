// takumi-motion — public API
// Motion-style declarative animations for Takumi: author in TS, evaluate in Rust.

export type {
  AddOptions,
  AnimatableProperty,
  BezierDefinition,
  EasingName,
  InertiaTransition,
  KeyframesDefinition,
  PlaybackOptions,
  ReactElementLike,
  SpringTransition,
  StepsDefinition,
  TimelineJSON,
  TimelineOptions,
  TimelineTarget,
  TrackJSON,
  Transition,
  TransitionWithOptions,
  TweenTransition,
} from "./types.js";

export { createTimeline, getDefaultTransition, type Timeline } from "./timeline.js";
export { compileTimeline, type CompiledTimeline, type CompileOptions } from "./compile.js";
export { evaluateAt, type EvaluatedStyles, type EvaluateOptions } from "./evaluate.js";
export {
  cubicBezier,
  easingDefinitionToFunction,
  easingToCssTiming,
  getEasingForSegment,
  namedEasings,
  steps,
  Easing,
} from "./easing.js";
export {
  calcGeneratorDuration,
  springDefaults,
  springGenerator,
  type SpringGenerator,
  type SpringOptions,
} from "./spring.js";
export { inertiaGenerator, type InertiaGenerator, type InertiaOptions } from "./inertia.js";
export { createTweenSampler, mixColors, mixComplex, mixValues } from "./interpolate.js";

// Perceptual color interpolation (v0.7 — OKLCH is the default space).
// interpolate.ts mixColors stays verbatim for the compile path; this is the
// authoring surface.
export {
  parseColor,
  rgbaToCss,
  colorToOklch,
  mixColor,
  interpolateColorFor,
  type Rgba,
  type Oklch,
  type ColorSpace,
} from "./color.js";
export {
  buildTransform,
  buildTransformKeyframe,
  isTransformProp,
  transformPropOrder,
  valueToCss,
} from "./transform.js";
export { resolveTrack, sampleTrackAt, TrackError, type ResolvedTrack } from "./sampler.js";

// v0.1 banner kit — seamless loops, presets, templates, render pipeline
export {
  assertAmbientPeriod,
  checkLoopSeam,
  fadeWrap,
  alignLoopPeriod,
  type SeamCheck,
  type SeamReport,
  type WrapOptions,
} from "./loop.js";
export {
  bannerPresets,
  formatBytes,
  resolvePreset,
  type AnimationFormat,
  type BannerPreset,
} from "./presets.js";
export { h, cloneNode, type VNodeChildren, type VNodeProps, type VNodeStyle } from "./jsx.js";
export {
  formatReport,
  renderBanner,
  type BannerReport,
  type CollapseStats,
  type RenderBannerOptions,
  type RenderedFile,
} from "./render.js";
export {
  bannerTemplates,
  buildTemplate,
  cascadeBanner,
  countUpBanner,
  gradientSweepBanner,
  typewriterBanner,
  type CascadeProps,
  type CountUpProps,
  type CountUpStat,
  type SweepProps,
  type TemplateInvocation,
  type TypewriterProps,
} from "./templates/index.js";
export {
  assertAmbientPeriod as assertAmbientPeriodShared,
  evenWindow,
  fitFontSize,
  gridCeil,
  loopPeriod,
  measureTextWidth,
  resolveTemplateStyle,
  textStyles,
  themeGlow,
  TOKENS,
  type BannerResult,
  type FitTextOptions,
  type ResolvedStyle,
  type TemplateStyleProps,
} from "./templates/shared.js";

// v0.2 — fonts, themes, personality, orchestration, audit, size, preview, kit
export {
  ensureFonts,
  fontCatalog,
  fontStack,
  isCatalogFont,
  loadedFontFamilies,
  type EnsureFontsOptions,
  type FontFamilyResult,
  type FontLoadResult,
  type FontSpec,
  type GenericFamily,
} from "./fonts.js";
export {
  resolveTheme,
  themes,
  type Theme,
  type ThemeInput,
  type ThemeName,
} from "./themes.js";
export {
  ambient,
  ambientWindow,
  personalities,
  resolvePersonality,
  clampAmbientPx,
  type AmbientKind,
  type AmbientOptions,
  type AmbientWindowOptions,
  type Personality,
  type PersonalityName,
} from "./personality.js";
export {
  deceleratingStagger,
  revealRow,
  revealUnits,
  splitGlyphs,
  splitWords,
  visibleUnit,
  waveUnits,
  type RevealRow,
  type RevealUnitsOptions,
  type WaveUnitsOptions,
} from "./orchestrate.js";
export {
  auditExtents,
  checkBanner,
  parseTransformOrigin,
  seamEnergy,
  type CheckOptions,
  type CheckResult,
  type Edge,
  type ExtentAuditOptions,
  type ExtentReport,
  type ExtentViolation,
  type SeamEnergy,
} from "./audit.js";
export {
  collapseGifHolds,
  gifStats,
  optimizeBudget,
  parseGif,
  type CollapseResult,
  type GifStats,
  type GifStructure,
  type OptimizerAttempt,
  type OptimizerResult,
} from "./size.js";
export {
  renderPreviewForBanner,
  renderPreviewHtml,
  type PreviewOptions,
} from "./preview.js";
export {
  formatKitReport,
  renderKit,
  type KitBanner,
  type KitOptions,
  type KitReport,
} from "./kit.js";

// v0.9 Bet F — the X-ray: per-frame attribution (why each frame exists)
export {
  explainCapture,
  formatExplain,
  rangesOf,
  type ExplainChannel,
  type ExplainChange,
  type ExplainReport,
  type FrameAttribution,
} from "./explain.js";

// v0.3 — frame-driven React scene runtime (also at "takumi-motion/react")
export {
  Banner,
  Scene,
  Layer,
  defineBanner,
  isDefinedBanner,
  isReactElementValue,
  isSceneElement,
  isLayerElement,
  useFrame,
  useCurrentFrame,
  useAbsoluteFrame,
  useDuration,
  useFps,
  useFrameState,
  useSpring,
  useInterpolate,
  usePulse,
  useSmoothPulse,
  useRandom,
  useNoise,
  hashString,
  springFor,
  interpolateFor,
  randomFor,
  pulseFor,
  smoothPulseFor,
  noiseFor,
  frameToMs,
  mulberry32,
  planBanner,
  composeFrame,
  resolveTransition,
  DEFAULT_TRANSITION_MS,
  transitionStyle,
  TRANSITION_DISTANCE_PX,
  captureReactBanner,
  chunkFrames,
  renderReactBanner,
  formatReactReport,
  Sequence,
  Freeze,
  isSequenceElement,
  isFreezeElement,
  Series,
  SeriesSequence,
  isSeriesElement,
  isSeriesSequenceElement,
  Loop,
  isLoopElement,
  splitText,
  SplitText,
  useStaggeredSpring,
  staggerDelay,
  staggeredSpringFor,
  type BannerProps,
  type SceneProps,
  type LayerProps,
  type FrameInfo,
  type BannerPlan,
  type PlannedScene,
  type ScenePlanInput,
  type TransitionKind,
  type TransitionInput,
  type FrameComposition,
  type CaptureResult,
  type CaptureChunk,
  type CaptureOptions,
  type RenderReactBannerOptions,
  type ReactBannerReport,
  type ReactSeamReport,
  type ChunkExtentReport,
  type ReactExtentViolation,
  type SpringAtOptions,
  type SequenceProps,
  type FreezeProps,
  type SeriesProps,
  type SeriesSequenceProps,
  type LoopProps,
  type SplitMode,
  type TextUnit,
  type SplitTextProps,
  type SplitTextRenderContext,
  type StaggerOptions,
  type StaggeredSpringOptions,
  type UseNoiseOptions,
} from "./react-public.js";

// v0.4 — the general engine release: unconstrained surface, time vocabulary,
// sequence/sprite outputs, audit-as-data, raw HTML input, font files
export {
  resolveSurface,
  resolveBackground,
  deviceSize,
  type SurfaceSpec,
  type SurfaceFormat,
  type ResolvedSurface,
} from "./surface.js";
export { interpolate, type InterpolateOptions } from "./interpolate.js";
export {
  exportFrameSequence,
  type SequenceExportOptions,
  type SequenceExportResult,
  type SequenceManifest,
} from "./sequence-export.js";
export {
  renderSpriteSheet,
  encodePngRgba,
  type SpriteSheetOptions,
  type SpriteSheetMeta,
  type SpriteSheetResult,
  type SpriteFrameMeta,
} from "./sprite.js";
export {
  renderHtmlAnimation,
  parseFragment,
  type RenderHtmlOptions,
  type HtmlSourceReport,
  type HtmlRenderedFile,
  type SurfaceReportBlock,
} from "./html-source.js";
export {
  renderWithAudit,
  type WithAuditOptions,
  type WithAuditResult,
  type AuditReport,
  type BudgetFileVerdict,
  type SurfaceAudit,
} from "./with-audit.js";
export {
  loadFontFiles,
  type FontFileSpec,
  type FontFileResult,
  type LoadFontFilesOptions,
} from "./fonts.js";

// v0.5 — the composition & stills release: single-frame renders on every
// source path, bounded-parallel pipeline, concurrency primitives
export {
  renderStill,
  type RenderStillOptions,
  type StillResult,
} from "./still.js";
export {
  mapWithConcurrency,
  resolveConcurrency,
} from "./concurrency.js";
export type { RenderTimings } from "./react-render.js";

// v0.9 Bet F — the storyboard: a labeled PNG contact sheet of the timeline
export {
  renderStoryboard,
  sampleFrames,
  type StoryboardOptions,
  type StoryboardResult,
  type StoryboardCell,
} from "./storyboard.js";

// v0.6 — the authoring experience release: coded authoring lint, style-type
// safety, content components (Fill/Img/FitText), the kinetic kit, engine-exact
// filmstrip previews, timeline transforms, plan-grid hardening
export {
  lintStyleObject,
  lintStyleTree,
  lintHtmlChunk,
  lintHtmlChunks,
  lintTracks,
  lintFontSpecs,
  lintFontFiles,
  lintGlowDither,
  collectLintWarnings,
  formatLint,
  camelHint,
  NO_LINT,
  type LintCode,
  type LintWarning,
  type LintOptions,
} from "./lint.js";
export {
  SUPPORTED_STYLE_PROPS,
  UNITLESS_STYLE_PROPS,
  type TakumiStyle,
  type TakumiStyleValue,
  type StyleInput,
} from "./style.js";
export {
  Fill,
  Img,
  FitText,
  imageDataUri,
  imageDataUriFromFile,
  type FillProps,
  type ImgProps,
  type FitTextProps,
} from "./react/components.js";
export {
  CountUp,
  Typewriter,
  Glow,
  type CountUpProps as KitCountUpProps,
  type TypewriterProps as KitTypewriterProps,
  type GlowProps,
} from "./react/kit.js";
export {
  getSharedRenderer,
  setSharedRenderer,
  fitFontSizeCached,
  resolveFitRequests,
  clearMeasureCache,
  fitCacheSize,
  type FitRequest,
} from "./measure.js";
export {
  renderFilmstrip,
  evenFrames,
  type RenderFilmstripOptions,
  type FilmstripResult,
} from "./filmstrip.js";
export {
  shiftTimeline,
  concatTimelines,
} from "./timeline-transforms.js";
export { planRound } from "./react/plan.js";
