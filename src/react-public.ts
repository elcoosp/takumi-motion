// takumi-motion — react-public.ts
// Single re-export point for the React scene runtime's public surface
// (mirrored at the "takumi-motion/react" subpath and the root barrel).

export * from "./react/index.js";

export {
  renderReactBanner,
  formatReactReport,
  auditChunks,
  type RenderReactBannerOptions,
  type ReactBannerReport,
  type ReactSeamReport,
  type ChunkExtentReport,
  type ReactExtentViolation,
} from "./react-render.js";

// v0.4 additions (not in react/index.ts to keep the subpath focused on
// authoring primitives; the root barrel carries the engine surface)
export type { UseNoiseOptions } from "./react/context.js";
