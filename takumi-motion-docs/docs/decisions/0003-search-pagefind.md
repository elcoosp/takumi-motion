# ADR 0003 — Search: keep Pagefind, no DocSearch

**Status:** Accepted · **Date:** 2026-11-07

## Context

Starlight ships with Pagefind — zero-config, index-at-build static search. It
requires no external service, no API keys, and no data sharing. Algolia
DocSearch is an alternative that requires an approved DocSearch application
(appId, apiKey, indexName).

## Decision

Keep Pagefind as the search solution. The docs config explicitly sets
`pagefind: true` to document the choice. No DocSearch plugin is installed
because there is no approved DocSearch application for this project.

## Consequences

- `pnpm build` generates the Pagefind index automatically; no extra step.
- Search returns results for key terms out of the box (verified against
  "spring", "budget", "workers", "lint" during the build gate).
- If an approved DocSearch application appears later, add
  `@astrojs/starlight-docsearch` to `plugins` alongside Pagefind per the
  Starlight docs.
