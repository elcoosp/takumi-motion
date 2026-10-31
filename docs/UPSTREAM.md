# UPSTREAM.md — takumi-core contribution strategy (internal)

> **Status: DO-NOT-ENGAGE-YET.** This document records the upstream contribution
> strategy for the takumi-motion project so the reasoning survives team turnover
> and time. It is an internal planning artifact — nothing here has been sent to
> the takumi maintainer, and no issue/PR/communication should be filed from this
> document without an explicit decision to do so.
>
> Last updated: 2026-10. Repository state observed at takumi v2.17.1
> (@takumi-rs/core 2.17.1, published 2026-10).

## 0. Product context (why this doc exists)

takumi-motion is positioned as an OSS library whose primary use case is
**animated README banners** (GIF/WebP rendered from code), with secondary use as
an **embedded animation engine inside a forthcoming OG-image component**, and
tertiary/edge use as an animated og:image generator. Upstream contribution to
takumi is *not* a product goal — it is an **architecture option** that would
remove the one structural hack in our pipeline (frame-grid spring baking in JS).
We document it so that when the timing is right we engage deliberately, cheaply,
and from a position of preparedness.

## 1. The two-layer architecture and where upstream fits

Today the library works entirely against **released** `@takumi-rs/core` — no
fork, no patch:

```
Motion-compatible authoring API (TS)
  → TimelineJSON v1
  → compile.ts: springs baked frame-exact on the fps grid, emitted as
    structured CSS @keyframes (+ linear-eased keyframe segments)
  → @takumi-rs/core renderAnimation({ scenes, fps, format })   [Rust clock]
  → GIF / APNG / animated WebP / poster PNG
```

- **Layer 1 (ours, permanent):** the authoring layer — `createTimeline`, stagger,
  labels, Motion-semantics springs/inertia/easing, golden-tested against real
  `motion@14.6.0` at 1e-6 tolerance (60/60). This layer is versioned independently
  and never depends on upstream changes.
- **Layer 2 (upstream's, optional):** native spring evaluation in Rust. If/when
  merged, `compile.ts` switches from "bake N keyframes per spring" to emitting a
  single `spring()` timing function. Benefits: exact (non-grid) spring sampling,
  ~10–50× smaller CSS payloads for long springs, no fps-boundary artifacts, and
  spring math maintained once, in Rust, for all takumi consumers.

**Standing rule:** the JS layer must remain fully functional on latest released
npm versions at all times. Upstream work is additive acceleration, never a
dependency.

## 2. What takumi already has (verified at 2.17.1) — our evidence base

- **Rust-native animation clock:** `RenderOptions.time_ms` samples CSS
  `@keyframes` at time T (`takumi-core/src/style/animation.rs`:
  `sample_animation_progress`, segment resolution, easing application).
- **One-call batch rendering:** `renderAnimation({ scenes, fps, format })` in
  takumi-napi renders N frames in a single call, rayon-parallel per frame chunk,
  streaming into GIF/WebP/APNG encoders. `write_animation` on the Rust side.
- **Per-longhand interpolation:** `Animatable::interpolate(from, to, progress,
  sizing, current_color)` (`takumi-core/src/style/traits.rs`) — continuous for
  Length/Color/Transforms/BoxShadow/Filters/Opacity/Gradient angles/etc.;
  discrete-by-default for enums. Easings today: **cubic-bezier** (Newton solver)
  and **steps** only.
- **The seam:** `PreparedScene` in takumi-raster is explicitly documented
  upstream as "where wider per-frame layout reuse would later live".

What's missing — and all we would propose adding — is **spring (and decay)
physics as a timing function**, plus optionally a timeline runner.

## 3. Proposed phases (when we engage)

### Phase 1 — native `spring()` timing function (the high-value, small-PR ask)

Add a spring easing variant next to cubic-bezier/steps in the animation engine.

Sketch of the Rust surface (illustrative, to be adapted to upstream's patterns):

```rust
// takumi-core/src/style/animation.rs
pub enum TimingFunction {
    // existing: Linear, Ease, CubicBezier(..), Steps(..), ..
    Spring(SpringParams),
}

pub struct SpringParams {
    pub stiffness: f64,        // default 100
    pub damping: f64,          // default 10
    pub mass: f64,             // default 1
    pub initial_velocity: f64, // default 0
    // or duration+bounce form; see solver notes below
}
```

- Math: Motion's solver is **analytic closed-form** (underdamped / critical /
  overdamped cases, with the overdamped 300-rad/s duration limit), ~200 lines of
  deterministic f64 — not numerical integration. `duration + bounce` maps to
  `stiffness + damping` via a 12-iteration Newton root-find (`findSpring`).
  We have a verbatim TS port (`src/spring.ts`) plus golden fixtures from
  `motion@14.6.0` (25 ms grids, 9 spring configs, tolerance 1e-6) that translate
  directly into Rust unit tests. MIT-licensed; attribution straightforward.
- Semantics decisions to make with upstream: physical params vs duration+bounce
  form, rest thresholds (Motion: restSpeed 2 / restDelta 0.5, granular 0.01/0.005),
  and whether spring participates in `animation-iteration-count` (springs are
  settle-and-hold; mirroring belongs to the caller).
- Size of ask: one enum variant, one solver module, fixtures, docs. No changes to
  layout, paint, or the napi surface.

### Phase 2 — timeline runner in Rust (`render_timeline`)

Evaluate our TimelineJSON v1 (segments, `at` offsets, labels, stagger, repeat
folding) natively: one JSON payload in, N frames out. Removes the compile step
entirely and enables frame-grid-free evaluation. Larger ask; only worth it after
Phase 1 proves the collaboration works and after takumi-motion has real usage
numbers to justify it.

### Phase 3 — per-frame data mutation (text/stats)

For banner use cases (count-up stats, typewriter), CSS alone can't animate text
content. Options to discuss upstream: multi-scene composition semantics in
`renderAnimation`, or exposing per-frame node variants. Depends on what
`scenes: [{ node, durationMs }]` dedupes/caches between scenes today.

## 4. Engagement protocol (when the decision is made)

1. **Issue first, never a drive-by PR.** Open a GitHub discussion/issue titled
   e.g. *"Native spring() timing function for @keyframes — math + golden tests
   ready"*, containing: the 30-second problem statement (springs must be baked to
   N keyframes per animation today), the benchmark table below, the solver
   provenance (MIT, analytic, deterministic), and a link to takumi-motion as the
   consumer.
2. **Bring evidence, not opinions.** Benchmarks to include:

   | Metric | Measured (POC, baked-springs path) |
   |---|---|
   | 16-track card, 36 frames @850×315, GIF | 318 ms / 1.42 MB |
   | same, WebP | 159 ms / 525 KB |
   | CSS payload for one 800 ms spring @60fps | ~48 keyframe entries vs 1 |
   | Golden parity vs motion@14.6.0 | 60/60, tolerance 1e-6 |

3. **Match house style.** takumi-core uses `define_style!` macro property
   registration, `Animatable` trait, cssparser 0.38. PR must include Rust unit
   tests derived from our fixtures and pass their CI (MSRV 1.91).
4. **Feature-flag it** (`spring-easing` cargo feature) if the maintainer prefers
   opt-in rollout.
5. **License hygiene:** state plainly that solver math is a clean-room-adjacent
   port from MIT-licensed motion (framer-motion/motion-dom) with copyright
   attribution in the port header; dual MIT OR Apache-2.0 to match takumi.

## 5. Decision triggers — what changes the plan

| Trigger | Action |
|---|---|
| takumi ships native spring easing (or equivalent) on its own | Drop Phase 1; compile.ts emits their syntax; jump to Phase 2 if still valuable |
| takumi animation API churns heavily (v3+ changes) | Keep deferring; our JS layer is insulated by design |
| takumi-motion reaches meaningful adoption (stars/downloads/issues) | Engage earlier — user demand is the strongest card |
| Maintainer signals openness (replies to related issues, roadmap mentions) | Open the discussion issue within days |
| Maintainer goes quiet / project stalls >6 months | Freeze upstream track permanently; the JS layer already fully works |
| We need per-frame layout reuse for perf (long banners) | Mention PreparedScene seam (their own TODO comment) as Phase 2 groundwork |

## 6. Risks of engaging (why we're waiting)

- **Single-maintainer bandwidth.** One collaborator (kane50613). A premature
  medium-sized PR from an unknown consumer is easy to drop; a well-timed one with
  adoption evidence is not.
- **Semantic drift.** Motion's spring semantics (duration ignored when physical
  params present; velocity in units/ms; overdamped limit) contain quirks we
  deliberately reproduce for parity. Upstream may want "cleaner" semantics —
  resolving that takes a dialogue, and we should enter it only when we have
  something they want.
- **Maintenance mirror.** Anything merged upstream becomes API we're expected to
  track. Only accept that for capabilities that measurably beat our JS baking
  (currently: exactness and payload size — real but not yet painful at banner
  frame counts).

## 7. What exists today, ready to hand over

- `src/spring.ts` — verbatim analytic solver port (findSpring + closed forms)
- `src/inertia.ts`, `src/easing.ts` — decay + full easing set, same treatment
- `scripts/fixtures.json` + `tests/spring.test.ts` etc. — golden parity harness
  (regenerate against any motion version with `scripts/extract-fixtures.mjs`)
- `examples/og-card.tsx` — end-to-end demo producing the benchmark numbers above
- The RFC PDF (`takumi-motion-integration-rfc.pdf`, §5–7) — the long-form
  version of this document, already written for internal review

None of these are upstream-ready artifacts by themselves; on engagement day they
compose into the issue + PR within roughly a working day of packaging.

## v0.6 finding — blur on alpha canvases bands into hard rings (watch, don't engage)

Observed during v0.6 visual QA (2025-10): a `filter: blur(44px)` element on a
**transparent** canvas (`background: null`, alpha PNG render) produces a
hard-edged circle with concentric quantization rings instead of a soft falloff.
The same element on a solid background renders smoothly. Looks like alpha-edge
handling in the rasterizer's blur path (edge sampling against transparent
pixels + palette/alpha quantization). Not engaged — takumi-motion avoids the
combination in its own components (`<Glow>` documents "solid backgrounds only";
the og-fittext proof uses a flat accent on transparent). If a future takumi
release fixes alpha-edge blur sampling, revisit the doctrine.
