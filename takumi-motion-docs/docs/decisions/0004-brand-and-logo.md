# ADR 0004 — Brand and logo: derived from the real project logo

**Status:** Accepted · **Date:** 2026-11-07

## Context

The engine repository carries one brand asset: `docs/logo.png` (1024×1024) —
a faceted orange/black geometric emblem on an orange gradient field. Starlight
needs a header logo that reads on both light and dark chrome, plus a favicon.

Sampling the logo pixels (PIL, 4px stride):

| Sample | Value |
| --- | --- |
| Background field corners | `#F45427` … `#5E281E` (gradient) |
| Saturated orange average | **`#D94922`** (35,752 samples) |
| Vivid facet highlight | `#DF4D24` / `#F38A67` |
| Dark facet average | `#171518` |
| **Brand HSL** | **hsl(13, 73%, 49%)** |

## Decision

- **Logo files:** `src/assets/logo-light.svg` and `logo-dark.svg` embed the
  real logo pixels (240×240 Lanczos resize, base64) inside an SVG with a
  rounded-rect clip (`rx=52`) — a badge treatment that keeps the emblem
  authentic and legible on both light and dark headers. The dark variant
  applies a 10% darkening overlay so the badge sits calmer on dark chrome.
  A `favicon.svg` (128×128, `rx=28`) lives in `public/`.
- **Accent color:** derived from the sampled brand hue 13°. Starlight's
  custom properties are overridden in `src/styles/custom.css` per theme:

| Variable | Light | Dark |
| --- | --- | --- |
| `--sl-color-accent-low` | `hsl(13, 100%, 96%)` | `hsl(13, 55%, 16%)` |
| `--sl-color-accent` | `hsl(13, 92%, 47%)` | `hsl(13, 96%, 60%)` |
| `--sl-color-accent-high` | `hsl(13, 73%, 38%)` | `hsl(13, 100%, 74%)` |

- **WCAG check** (relative luminance math, verified in the derivation script):
  - Light `accent-high` `#A8381A` on white: **6.47:1** (AA ✓)
  - Dark `accent-high` `#FF977A` on `#1B1C22`: **8.06:1** (AA ✓)
  - Dark `accent` `#FB6137` on `#1B1C22`: **5.56:1** (AA ✓)

The default Starlight blue accent is fully replaced. The built-in light/dark
theme toggle stays enabled.

## Consequences

- The logo is the actual project mark — no invented iconography.
- Both theme modes pass AA contrast for accent text; the numbered ramp vars
  (`accent-400/500/600`) are also set for components that read them.
- If the project later ships an SVG logo (transparent background), replace the
  embedded-raster badge with it directly in `src/assets/`.
