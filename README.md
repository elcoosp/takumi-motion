<div align="center">
  <img src="docs/logo.png" alt="Takumi Motion Logo" width="200"/>
  <p>
    <strong>A deterministic server-side animation engine: React components or raw HTML → GIF/WebP/APNG/PNG-sequence/sprite-sheet/still, rendered by Rust.</strong><br/>
    Implements a complete animation pipeline with data motion, measured FLIP (<code>&lt;Morph&gt;</code>), chart primitives, deterministic particles, forever reels with byte-exact seams, and per-frame X-ray auditing. Designed for clarity, testability, and pixel-perfect reproducibility.
  </p>
  <p>
    <img src="https://img.shields.io/badge/TypeScript-5.x-007ACC?style=flat-square&logo=typescript" alt="TypeScript"/>
    <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React"/>
    <img src="https://img.shields.io/badge/Rust-Takumi%20Engine-000000?style=flat-square&logo=rust" alt="Rust"/>
    <img src="https://img.shields.io/badge/Testing-Vitest-6E9F18?style=flat-square&logo=vitest" alt="Testing"/>
    <img src="https://img.shields.io/badge/Outputs-GIF%20%7C%20WebP%20%7C%20APNG-FF6B6B?style=flat-square" alt="Outputs"/>
    <img src="https://img.shields.io/badge/Architecture-Deterministic%20%26%20Frame--Indexed-9B59B6?style=flat-square" alt="Architecture"/>
    <img src="https://img.shields.io/badge/Quality-Audit%20%2B%20X--Ray-2ECC71?style=flat-square" alt="Quality"/>
  </p>
</div>

---

## Overview

Takumi Motion is a declarative, deterministic animation engine that bridges high-level React component trees or raw HTML with high-performance, server-side rendering. By compiling animation timelines ahead of time and delegating rasterization to a Rust backend (`takumi`), it guarantees byte-exact, reproducible outputs without the runtime overhead, layout thrashing, or non-determinism of traditional browser-based animation libraries.

## Key Features (v0.9.1)

- **Data Motion & Charts**: Deterministic chart primitives (`LineChart`, `BarChart`, `Donut`, `CountUp` v2) that react to a static data channel injected at setup, ensuring no network fetches occur during render.
- **Measured FLIP (`<Morph>`)**: Layout truth with `TM_LAYOUT_SHIFT` auditing. Interpolates position and size channels directly during prewarm, preventing text stretching or elliptical dots common in scale-based FLIP techniques.
- **Material Pack**: Declarative alpha masks (`<Mask>`), directional reveals (`<Reveal>`), variable font weight tracks (`<VariableText>`), and background-clip text fills (`<GradientText>`).
- **Deterministic Particles**: O(1) per-frame closed-form particle systems (`sparkle`, `confetti`) using seeded randomness (`mulberry32`), ensuring byte-identical replays across any frame index.
- **Forever Reel**: `<Banner loop>` with `enter="wrap"` or `exit="wrap"` guarantees byte-identical seams between the last and first frames, verified by `report.seam`.
- **X-ray Auditing**: Per-frame channel attribution (`--explain`) and labeled PNG storyboard contact sheets for precise size-budget instrumentation and visual QA.

## Installation

```bash
pnpm add takumi-motion
```

> [!NOTE]
> This engine relies on the `@takumi-rs/core` and `takumi-js` Rust bindings. Ensure your environment is configured to support native Rust binaries if you are building from source or running the CLI directly.

## Quick Start

Define a banner using React components, orchestrate scenes, and render it server-side to a deterministic format.

```tsx
import { defineBanner, Banner, Scene, Layer } from "takumi-motion/react";
import { renderReactBanner } from "takumi-motion";

export const launchBanner = defineBanner(function TakumiMotionLaunch() {
  return (
    <Banner preset="readme" theme="tokyo-night" transitionMs={250}>
      <Layer bottom>
        <div style={{ position: "absolute", bottom: 0, width: 850, height: 3, backgroundColor: "#7aa2f7" }} />
      </Layer>
      
      <Scene duration={100} enter="rise" exit="crossfade">
        <h1 style={{ fontSize: 48, fontWeight: 700, color: "#c0caf5" }}>
          Takumi Motion
        </h1>
      </Scene>
    </Banner>
  );
});

// Render server-side to WebP (or GIF, APNG, PNG-sequence, still)
const report = await renderReactBanner({ 
  banner: launchBanner, 
  format: "webp",
  out: "./out/launch-banner.webp"
});

console.log(report.lint); // Review authoring lint warnings (e.g., TM_LAYOUT_SHIFT)
```

## Core Pipeline

1. **Probe**: `<Banner>` registers metadata and scene inputs.
2. **Plan**: `planBanner()` computes frame-exact windows for each scene.
3. **Prewarm**: Each scene's opening frame renders once to prewarm caches (e.g., `<FitText>` measurement, `<Morph>` rect discovery). Outputs are discarded.
4. **Frames**: The real per-frame loop generates `htmlFrames` using pure functions of the frame index.
5. **Chunk**: Byte-identical frames are merged to optimize encoding.
6. **Lint**: Style trees, markup, and registry findings are evaluated and attached to `report.lint`.

## Development

> [!TIP]
> This project uses [`just`](https://github.com/casey/just) as a command runner and `pnpm` for package management. Ensure both are installed on your system before contributing.

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build

# Run the comprehensive Vitest suite
pnpm run test

# Run visual QA and smoke tests
pnpm run smoke

# Generate test fixtures
pnpm run fixtures
```

For advanced workflows, benchmarking, and frame extraction, refer to the `scripts/` directory or run `just --list` to see available task runners.

## Authoring & Best Practices

- **Style Safety**: Always use camelCase for style properties (e.g., `fontWeight`, not `font-weight`). React 19 serializes kebab-case keys in a way that causes Rust parse errors in takumi. The linter will catch this as `TM_KEBAB_STYLE`.
- **Determinism**: Never use `Math.random()` or network fetches inside render functions. Use the provided `randomFor` utilities or inject data via the `data` channel at setup.
- **Performance**: Settled animation descriptors return `null`, emitting no style overrides. This allows the chunk-merger to effectively collapse static frames, drastically reducing output file size.

For detailed guidelines on adding new animation primitives, handling layout shifts, and configuring chart primitives, refer to [`docs/AUTHORING.md`](docs/AUTHORING.md).
