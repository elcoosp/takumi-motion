# takumi-motion v1.0 "Velocity" — performance design

Authoring record of the v1.0 performance pass. Every change is TDD'd,
byte-deterministic, and benchmarked against the frozen baseline in
`bench/baseline/` (a verbatim copy of the v0.9.1 `src/` tree).

## Findings (deep-dive)

The pipeline is: React/HTML → `renderToStaticMarkup` per frame → chunk merge
→ `fromHtml` (napi) → `renderAnimation` (Rust, rayon) → encode → post-process
(GIF hold collapse / PNG sequence / sprite sheet). Four classes of waste:

1. **Compat breakage** — takumi 2.19 rejects fractional `timeMs` (napi i64).
   4 tests red at baseline; every still/poster/filmstrip/storyboard call
   site leaks `frame × 1000/fps` floats into the engine.
2. **Recomputed pure math** — `springFor` rebuilds the analytic solver and
   re-scans its settle duration (up to 400 `next()` calls, each with
   exp/sin/cos) *per frame per component*. `createTweenSampler.sample`
   linearly scans segments and re-resolves easing closures per sample.
   `evaluateAt` re-resolves every track per call and finds transform tracks
   with `Array.find`. `parseToRgba` re-regexes identical color strings per
   frame. `compileTimeline` `JSON.stringify`s every step for dedupe and
   rebuilds the same fps grid for every group.
3. **Serial JS capture** — frames render one at a time in-process while the
   Rust stages overlap. Frame capture is embarrassingly parallel (each frame
   is a pure function of `(frame, props)` — the doctrine), so it maps onto a
   worker pool once the banner is addressable as a module.
4. **Output bytes** — the hand-rolled PNG encoder (sprite sheets, sequences)
   writes filter-0 rows; the standard min-sum-of-absolute-differences filter
   heuristic shrinks gradient-heavy atlases several-fold at equal
   determinism. GIF frame comparison copies every frame's bytes (`slice`)
   and compares in a JS loop where native `memcmp` (`Buffer#equals`) works.

## Changes

| # | Change | Type | Hot path |
|---|--------|------|----------|
| 1 | `toEngineMs()` — integer ms at every engine boundary | fix | stills/posters/filmstrip/storyboard/sequence/sprite |
| 2 | Spring generator + settle memoization keyed by transition params | perf | `springFor` (every Animated/Spring per frame) |
| 3 | Tween sampler: per-segment easing precompute + binary search | perf | compile bake, evaluators |
| 4 | compileTimeline: structural step dedupe (no `JSON.stringify`), grid computed once | perf | compile |
| 5 | `resolveTrack` WeakMap memo + `evaluateAt` per-target index (no `find`) | perf | evaluate/preview/audit |
| 6 | `parseToRgba` bounded cache | perf | color mixes per frame |
| 7 | Binary-search chunk index (capture + filmstrip) | perf | posters/sequence/sprite |
| 8 | `walkMeasured` scalar min/max (no array/map allocations) | perf | extent audit |
| 9 | GIF parser views (`subarray`, zero-copy) + `Buffer#equals` frame compare | perf | GIF hold collapse |
| 10 | PNG min-SAD filter heuristic (None/Sub/Up/Avg/Paeth) + `level` option | size | sprite sheet / sequence / stills |
| 11 | Worker-pool capture: `bannerModule` entry + `workers: "auto"` (tsx-aware), frame-seeded `Math.random` shim | parallelism | capture stage |
| 12 | Coverage config (v8) with 100% thresholds | quality | CI |

## Determinism doctrine (unchanged, now enforced harder)

- Every render stays a pure function of `(node/frames, timeMs, css)`.
  Concurrency only moves wall-clock; outputs are byte-identical at any
  concurrency (golden-tested, as in v0.5+).
- The `Math.random` shim becomes **frame-seeded** (`seed ⊕ hash(frame)`):
  a frame's output no longer depends on how many frames rendered before it,
  which is what makes worker-window capture byte-exact. The documented
  "use `randomFor`/`useRandom`" guidance is unchanged; the shim now also
  holds across worker partitions.
- PNG filtering is a deterministic heuristic (no adaptation on wall-clock).

## Breaking changes (accepted)

- Fractional `timeMs` passed to `renderer.render` through engine-facing
  options is rounded to whole ms (the engine itself now requires i64).
- `Math.random()` inside scenes is frame-seeded: consuming the shim stream
  across frames no longer yields a shared sequence.
- `renderSpriteSheet`/`exportFrameSequence` PNG bytes change (smaller);
  sprite `meta` gains `png: { level, filter }` provenance.
- New options on `renderReactBanner` (`bannerModule`, `workers`) — additive.
