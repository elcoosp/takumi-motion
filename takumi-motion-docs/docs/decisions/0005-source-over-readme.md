# ADR 0005 — API accuracy: source code over README

**Status:** Accepted · **Date:** 2026-11-07

## Context

Exploring the repository surfaced discrepancies between the upstream README
and the actual source code (`src/react-render.ts`, `src/react/particles.tsx`,
`src/cli.ts`). Documentation copied from the README would be wrong.

## Findings

1. **README Quick Start uses wrong option names.** It passes
   `format: "webp"` and `out: "./out/launch-banner.webp"` to
   `renderReactBanner` — the real options are **`formats: ["webp"]`** and
   **`outDir: "./out"`** (`src/react-render.ts`). All docs here use the
   source-verified names.
2. **No `<Sparkle>`/`<Confetti>` components.** Particles ship as a single
   `<Particles mode="sparkle" | "confetti">` (`src/react/particles.tsx`).
3. **The README omits implemented surface:** the `storyboard` CLI command,
   the `--budget` fps ladder, `--workers`/`--still`/`--sequence`/
   `--spritesheet`/`--filmstrip`/`--explain`/`--from`/`--to` flags, the
   `./kit`, `./audit`, `./fonts`, `./recipes` subpath exports, and the
   `check` seam-tolerance behavior. All are documented here.
4. **Exit codes:** `render --budget` exits 2 when over budget (after the fps
   ladder); `check` exits 1 on failed audits; `renderWithAudit` returns
   0/1/2. Documented in the CLI and CI guides.

## Decision

Document the **source code's** API. Every prop, flag, default, and report
field on this site was verified against `src/` (entry points, CLI parser,
component definitions, renderer option interfaces). Discrepancies with the
README are recorded here so the upstream docs can be fixed in the engine repo.

## Consequences

- The docs may drift from the README — intentionally, until the README is
  corrected upstream.
- A future contributor agent must re-verify against source when the engine
  version bumps.
