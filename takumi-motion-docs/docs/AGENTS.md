# AGENTS.md — Documentation Authoring Rules

Rules for AI agents and humans contributing to this Starlight documentation
site for **takumi-motion**. Follow them without exception; they exist because
the engine guarantees byte-exact output, and the docs must be as reliable as
the bytes.

## Source of truth

1. **The source code wins.** Read `src/` in the takumi-motion repository
   before documenting any feature. Never invent flags, props, defaults, or
   commands. When the README disagrees with the code, the code wins — record
   the discrepancy in `docs/decisions/`.
2. **One Diátaxis type per page.** Tutorials (`/tutorials`), how-to guides
   (`/guides`), reference (`/reference`), explanation (`/explanation`). Mixing
   is forbidden; every page carries `type:` frontmatter declaring its kind
   (validated by the extended docs schema in `src/content.config.ts`).

## Page contract

Every page has:

- Frontmatter: `title` (clear, searchable), `description` (one sentence, used
  for SEO and `llms.txt`), `type` (Diátaxis kind).
- A one-sentence summary right after the heading.
- Prerequisites where relevant.
- **Next steps** as `<LinkCard>` components at the end.

## Writing style

- Second person ("you can configure…"), present tense, active voice.
- Imperative for instructions ("Run `pnpm install`").
- Never write "simply", "just", "easy", or "obviously".
- Explain technical terms on first use.
- Every code block carries a language tag; snippets are minimal and runnable.
- Show expected output for commands.

## Package manager

All install commands and scripts use **pnpm**. Where package-manager tabs
exist, pnpm is the first and default tab.

## Components

Import Starlight components in MDX:

```mdx
import { Card, CardGrid, LinkCard, Tabs, TabItem, Steps, Aside, FileTree } from '@astrojs/starlight/components';
```

Use `<Tabs>` for package-manager alternatives, `<Steps>` for tutorials,
`<Aside>` for notes/cautions, tables for reference signatures.

## Accuracy gates

- Units are **frames** unless a prop is explicitly milliseconds (`transitionMs`,
  `speed` in typewriter, ambient `periodMs`).
- Particles are `<Particles mode="sparkle" | "confetti">` — there are no
  `<Sparkle>`/`<Confetti>` components.
- `renderReactBanner` takes `formats` (array) and `outDir` (directory) — the
  upstream README's `format`/`out` example is wrong; do not copy it.
- Renderers consume `TimelineJSON` (`timeline.toJSON()`), not `Timeline`
  instances or compiled output.
- Exit codes: `render --budget` → 2 when over budget; `check` → 1 on failed
  audit; `renderWithAudit` → 0/1/2.

## Build gates

- `pnpm build` must exit cleanly — `starlight-links-validator` fails the build
  on broken internal links (release blocker).
- `pnpm check` runs on TypeScript 6.x (see `docs/decisions/0001-typescript-version.md`).
- `pnpm lint` runs markdownlint over the content.
- `pnpm llms` regenerates `public/llms.txt` and `public/llms-full.txt`
  (runs automatically before `build`).

## Branding

- Logo: `src/assets/logo-light.svg` / `logo-dark.svg` — derived from the real
  project logo (`docs/logo.png` in the engine repository). Never invent a logo.
- Accent: hue 13° burnt orange, derived from the logo pixels. Contrast values
  and the derivation live in `docs/decisions/0004-brand-and-logo.md`.
