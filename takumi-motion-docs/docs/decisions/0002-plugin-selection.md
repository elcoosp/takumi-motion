# ADR 0002 — Plugin selection for Starlight 0.42

**Status:** Accepted · **Date:** 2026-11-07

## Context

The docs site uses Astro 7.4.7 + `@astrojs/starlight` 0.42.10. The HiDeoo
plugin ecosystem offers several "bells and whistles" plugins; each one is
included only when it serves this project. Verified peer ranges at execution
time (`pnpm view`): all considered plugins accept `@astrojs/starlight >=0.42`
/ `astro >=7.2.10`.

## Decision

**Included:**

| Plugin | Version | Why |
| --- | --- | --- |
| `starlight-links-validator` | 0.27.0 | Fails `pnpm build` on broken internal links — a release blocker for a 21-page site |
| `starlight-image-zoom` | 0.16.2 | Click-to-zoom on diagrams and screenshots at zero content cost |
| `starlight-heading-badges` | 0.8.0 | Badge support in headings for API-status marking |

**Omitted (with reasons):**

| Plugin | Reason |
| --- | --- |
| `starlight-typedoc` (0.23.2) | Generates API reference from the engine's TypeScript source. The deliverable is a standalone docs codebase that does not vendor the engine source, and the engine source carries no TSDoc comments — generation would produce empty or fabricated entries. The reference section is hand-written from the real source instead. |
| `starlight-blog` (0.30.2) | The repository's `CHANGELOG.md` is the canonical changelog; a blog would duplicate it and drift. |
| `starlight-openapi` | No OpenAPI specification exists in the project — the engine is not an HTTP API. |
| `starlight-versions` | Single released version (1.0.0); versioned docs are premature. |

## Consequences

- `pnpm build` hard-fails on broken internal links.
- If the engine later gains TSDoc comments or a second major version, revisit
  `starlight-typedoc` and `starlight-versions`.
