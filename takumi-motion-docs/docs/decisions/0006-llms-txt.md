# ADR 0006 — AI-agent discoverability: llms.txt at the site root

**Status:** Accepted · **Date:** 2026-11-07

## Context

AI agents consume documentation better with a curated `llms.txt` index and a
`llms-full.txt` bundle at the site root. Starlight does not generate these by
default.

## Decision

A build-time script (`scripts/build-llms.mjs`, wired as the `prebuild` npm
script and runnable via `pnpm llms`) scans `src/content/docs/**` in Diátaxis
order and writes:

- `public/llms.txt` — title, one-line pitch, and a linked index by section.
- `public/llms-full.txt` — the full markdown body of every page.

**URLs are site-root-relative** (`/tutorials/first-banner/`). The site has no
production origin yet; absolute URLs would require inventing a domain. When a
deploy origin exists, prefix the generated URLs (one-line change in the
script) or serve a rewrite.

## Consequences

- The files rebuild automatically on every `pnpm build` — they cannot drift
  from the content.
- `public/robots.txt` allows all agents.
- Page titles and descriptions double as the AI-facing summaries, which is
  why `description` frontmatter is mandatory on every page.
