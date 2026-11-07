# ADR 0001 — Pin TypeScript to 6.x for `astro check`

**Status:** Accepted · **Date:** 2026-11-07

## Context

The docs site runs `astro check` as a type-quality gate. As of Astro 7.4
(`astro 7.4.7`, `@astrojs/check 0.9.12`), `astro check` does not support
TypeScript 7. Running it against TypeScript 7.0.2 fails with:

> astro check does not currently support TypeScript 7.0

The experimental workaround (`tsc` + `@astrojs/ts-content-mapper`) exists but
is not the stable default path.

The dependency graph agrees: `@astrojs/check@0.9.12` declares
`peerDependencies: { "typescript": "^5.0.0 || ^6.0.0" }` — TypeScript 7 is
outside the accepted range.

## Decision

Pin `typescript` to the latest 6.x release — **`6.0.3`** (exact, no caret) in
`package.json` devDependencies. `pnpm check` therefore runs on TypeScript 6.x.

## Consequences

- `pnpm check` works on the stable, supported path.
- Upgrading to TypeScript 7 waits until `astro check` ships support for it
  (or the experimental path is explicitly requested and verified).
- The pin is exact (`6.0.3`), so a future 6.x patch release requires a
  deliberate bump rather than arriving through a lockfile-free install.
