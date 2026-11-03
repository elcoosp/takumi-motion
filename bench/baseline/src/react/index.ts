// takumi-motion — react/index.ts
// The frame-driven React scene runtime ("takumi-motion/react").

// Primitives
export {
  Banner,
  Scene,
  Layer,
  defineBanner,
  isDefinedBanner,
  isReactElementValue,
  isSceneElement,
  isLayerElement,
  type BannerProps,
  type SceneProps,
  type LayerProps,
} from "./primitives.js";

// Context + hooks
export {
  useFrame,
  useCurrentFrame,
  useAbsoluteFrame,
  useDuration,
  useFps,
  useFrameState,
  useSpring,
  useStaggeredSpring,
  useInterpolate,
  usePulse,
  useSmoothPulse,
  useRandom,
  useNoise,
  hashString,
  FrameContext,
  DriverContext,
  type FrameInfo,
  type DriverInfo,
  type DriverRegistry,
  type BannerMeta,
  type UseNoiseOptions,
} from "./context.js";

// Pure motion math
export {
  springFor,
  interpolateFor,
  randomFor,
  pulseFor,
  smoothPulseFor,
  frameToMs,
  msToFrames,
  mulberry32,
  staggerDelay,
  staggeredSpringFor,
  springPresets,
  springSettleFrames,
  type SpringAtOptions,
  type SpringPresetName,
  type StaggerOptions,
  type StaggeredSpringOptions,
} from "./motion.js";

// Planning + transitions
export {
  planBanner,
  composeFrame,
  resolveTransition,
  DEFAULT_TRANSITION_MS,
  type BannerPlan,
  type PlannedScene,
  type ScenePlanInput,
  type TransitionKind,
  type TransitionInput,
  type TransitionSpec,
  type FrameComposition,
  type PlanOptions,
} from "./plan.js";
export { transitionStyle, TRANSITION_DISTANCE_PX, type TransitionStyles } from "./transitions.js";

// Capture (Node)
export { captureReactBanner, chunkFrames, type CaptureResult, type CaptureChunk, type CaptureOptions } from "./capture.js";

// Time-control vocabulary (v0.4)
export {
  Sequence,
  Freeze,
  isSequenceElement,
  isFreezeElement,
  type SequenceProps,
  type FreezeProps,
} from "./sequence.js";
export { noiseFor } from "./motion.js";

// Composition + kinetic text kit (v0.5)
export {
  Series,
  SeriesSequence,
  isSeriesElement,
  isSeriesSequenceElement,
  type SeriesProps,
  type SeriesSequenceProps,
} from "./series.js";
export { Loop, isLoopElement, type LoopProps } from "./loop.js";
export {
  splitText,
  SplitText,
  type SplitMode,
  type TextUnit,
  type SplitTextProps,
  type SplitTextRenderContext,
} from "./text.js";

// Content components + kit (v0.6)
export {
  Fill,
  Img,
  FitText,
  imageDataUri,
  imageDataUriFromFile,
  takeFitRequests,
  type FillProps,
  type ImgProps,
  type FitTextProps,
} from "./components.js";
export {
  CountUp,
  Typewriter,
  Glow,
  parseNumberPattern,
  groupDigits,
  formatNumberPattern,
  type CountUpProps,
  type TypewriterProps,
  type GlowProps,
} from "./kit.js";

// Data channel + chart kit (v0.9 Bet A — "the animation knows the numbers")
export {
  DataContext,
  useChartData,
  hasChartData,
} from "./data.js";
export {
  LineChart,
  BarChart,
  Donut,
  CHART_COLORS,
  niceMax,
  chartMaxOf,
  compactNumber,
  type ChartSeries,
  type ChartData,
  type LineChartProps,
  type BarChartProps,
  type DonutProps,
} from "./charts.js";

// Material pack (v0.9 Bet C — surfaces: wipes, masks, variable text, gradient fill)
export {
  Reveal,
  Mask,
  VariableText,
  GradientText,
  revealGradient,
  type RevealProps,
  type RevealWipe,
  type MaskProps,
  type MaskFadePreset,
  type VariableTextProps,
  type GradientTextProps,
} from "./material.js";

// Layout truth (v0.9 Bet B — measured morph between two layouts)
export {
  Morph,
  clearMorphCache,
  morphCacheSize,
  morphRectOf,
  morphContainerRectOf,
  MORPH_MARKER,
  type MorphProps,
  type MorphRequest,
  type MorphRect,
} from "./morph.js";

// Particles (v0.9 Bet D — deterministic celebration dust, two churn tiers)
export {
  Particles,
  CONFETTI_BUDGET,
  type ParticlesProps,
  type ParticleArea,
} from "./particles.js";

// Declarative motion vocabulary (v0.7 — the Reanimated borrow)
export {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeInLeft,
  FadeInRight,
  FadeInDownBig,
  FadeInUpBig,
  FadeInLeftBig,
  FadeInRightBig,
  ZoomIn,
  SlideInDown,
  SlideInUp,
  SlideInLeft,
  SlideInRight,
  BounceIn,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  FadeOutLeft,
  FadeOutRight,
  ZoomOut,
  SlideOutDown,
  SlideOutUp,
  SlideOutLeft,
  SlideOutRight,
  BounceOut,
  transitionPresets,
  defineTransition,
  staggered,
  cascadeExit,
  resolveTransitionAtFrame,
  transitionStartFrame,
  transitionEndFrame,
  transitionSettleIssue,
  type TransitionSide,
  type TransitionDescriptor,
  type TransitionFactory,
  type TransitionContext,
  type ResolvedTransition,
  type PresetChannels,
} from "./enter-exit.js";
export {
  Animated,
  Keyframes,
  useEntering,
  useExiting,
  type AnimatedProps,
  type KeyframesProps,
  type KeyframeStop,
  type KeyframeValue,
  type KeyframeTransform,
} from "./animated.js";

// Sequence grammar + stagecraft (v0.8 — the Choreography Release)
export {
  chain,
  hold,
  isChainDescriptor,
  resolveChainAtFrame,
  chainSettleIssue,
  chainVelocityIssues,
  type ChainDescriptor,
  type ChainFactory,
  type ChainSegmentInput,
  type HoldSegment,
} from "./chain.js";
export {
  pathPointAt,
  pathLength,
  parsePathSegments,
  type PathPoint,
} from "./path.js";
export { FollowPath, type FollowPathProps } from "./follow-path.js";
export {
  Camera,
  Wiggle,
  type CameraProps,
  type CameraPushIn,
  type CameraPan,
  type CameraShake,
  type WiggleProps,
} from "./camera.js";
export {
  LabelContext,
  parseCue,
  resolveCue,
  useCue,
  type LabelFrameContextValue,
  type ParsedCue,
} from "./cue.js";
export {
  wiggleFor,
  isNoiseAliased,
  hashString as hashSeed,
  type WiggleOptions,
} from "./motion.js";
