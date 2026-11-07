# ADR 0007 — Override `@emnapi/runtime` to 1.11.1 for `astro check`

**Status:** Accepted · **Date:** 2026-11-07

## Context

`pnpm check` (`astro check`) failed to start in a way that first looked like a
missing dependency: `astro check` prompted to install `@astrojs/check`, which
was already installed. Root cause, found by importing the package directly:

```
TypeError: this.bridge.setLastError is not a function
  at @emnapi/runtime/dist/emnapi.js
```

Dependency chain: `@astrojs/check` → `@astrojs/language-server` →
`@astrojs/astro2tsx` → `@napi-rs/wasm-runtime` (peer
`@emnapi/runtime: ^1.7.1 || ^2.0.0-alpha.4`) → pnpm resolved the prerelease
**`@emnapi/runtime@2.0.0-beta.2`**, whose WASM bridge API does not match the
glue code (`setLastError`, `deleteEnv` missing). The resolution failure inside
`getPackage()` is what triggered astro's interactive install prompt, which
then hung in non-interactive shells — the reason `pnpm check` appeared to
"hang" rather than fail.

## Decision

Pin `@emnapi/runtime` to the stable line via `pnpm-workspace.yaml`:

```yaml
overrides:
  "@emnapi/runtime": 1.11.1
```

(`package.json` `pnpm.overrides` is no longer read by pnpm 12 — the setting
lives in `pnpm-workspace.yaml`.) `1.11.1` is proven in this dependency tree —
the Astro compiler's WASM binding already resolved it successfully at build
time. After the override, `import('@astrojs/check')` succeeds and
`pnpm check` completes: **0 errors, 0 warnings, 0 hints** on TypeScript 6.0.3.

## Consequences

- `pnpm check` works non-interactively and in CI.
- When `@napi-rs/wasm-runtime` ships glue compatible with a stable emnapi 2.x,
  remove the override.
- A benign build-time warning remains (`@astrojs/sitemap` wants a `site` URL);
  it is expected — the skill forbids configuring `site` without a real deploy
  origin.
