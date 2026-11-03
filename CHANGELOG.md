# takumi-motion — CHANGELOG

## 1.0.0 — "Velocity"

The performance pass. Every change is TDD'd against the frozen v0.9.1
pipeline (kept verbatim in `bench/baseline/`) and benchmarked in
`docs/BENCHMARKS.md` (geomean **1.71×** across 13 timed benches; hot-path
highlights: chunk-index **7.1×**, spring solve **3.9×**, evaluate **3.1×**,
color mix **2.7×**, capture **1.8×**; PNG atlases **−90–100% bytes**).

### Performance

- **Solver memoization** (`react/motion.ts`): `springFor` re-built the analytic
  solver and re-scanned its settle duration on EVERY call — per frame, per
  component, during capture. The (generator, settle duration) pair now
  memoizes on transition params (`springCacheSize()` test seam; bounded,
  deterministic). `springSettleFrames` shares the memo.
- **Tween sampler** (`interpolate.ts`): per-segment easing functions precompute
  once (bezier closure construction left the sample path), segment lookup is a
  binary search (O(log n) vs O(n) on multi-stop tracks). Differential-tested
  byte-identical against the v0.9.1 sampler.
- **compileTimeline**: structural step dedupe replaces per-point
  `JSON.stringify`; the fps grid builds once and shares across groups;
  single-sample-per-point emit (v1.0 draft's lazy re-sample fixed before ship).
- **evaluateAt + resolveTrack**: track resolution memoizes on object identity
  (WeakMap); transform composition uses target-indexed maps instead of
  `Array.find`. Resolution with a caller-supplied `resolveBase` stays fresh
  (correctness over cache).
- **Color parse memo** (`interpolate.ts`): `parseToRgba` results memoize
  (bounded) — scene code mixes the same handful of colors every frame.
- **Binary-search chunk index** (`chunk-index.ts`): every frame→chunk mapping
  (posters, sequences, sprite sheets, filmstrips, storyboards) uses one shared
  O(log n) helper; three private linear scans deleted.
- **Zero-copy GIF passes** (`size.ts`): `parseGif` hands out `subarray` views
  (no per-frame copies); hold comparison uses native `memcmp` (`Buffer#equals`)
  for payloads ≥ 64 bytes (JS loop wins below — threshold-benchmarked).
- **PNG min-SAD filter** (`png.ts`): the sprite/sequence encoder now picks
  per-row filters with the standard minimum-sum-of-absolute-differences
  heuristic (None/Sub/Up/Average/Paeth) + deflate level 9. Deterministic; the
  850×400 gradient atlas went 767 KiB → 2.0 KiB. `filter: "none"` keeps the
  v0.9.1 behavior; CPU cost is documented (+33% on the atlas bench).

### Parallelism

- **Worker-pool capture** (`react/parallel-capture.ts`): the last serial
  pipeline stage. `renderReactBanner({ bannerModule, workers })` runs capture
  windows across worker threads — byte-identical output at ANY worker count
  (golden-tested), plan-agreement asserted before merge, chunks re-merged once
  on the main thread. The `workers: "auto"` gate refuses to spawn unless the
  host has ≥ 4 cores, the banner ≥ 128 frames, AND measured capture work
  ≥ 400 ms (probe-timed) — on smaller hosts the Rust stages already saturate
  the machine, and spawning JS workers oversubscribes it.
- **Frame-seeded determinism shim**: `Math.random` during capture seeds
  `mulberry32(seed ⊕ imul(frame))` — a frame's render is a pure function of
  (frame, props) even for shim consumers, which is what makes worker windows
  byte-exact at any partition. Breaking: the shim stream no longer continues
  across frames.
- **esbuild TS/JSX loader** (`react/ts-worker-loader.mjs`): tsx ≥ 4.21 ignores
  the tsconfig `jsx` setting for register()-installed hooks — banner modules
  authored with the automatic JSX runtime crashed with "React is not defined"
  (the repo's own examples did). Workers bootstrap through a plain-mjs shim
  that installs our esbuild hooks (automatic JSX from the banner's nearest
  tsconfig); the CLI retries through the same loader on that failure class.

### Fixes

- **Engine-time boundary** (`engine-time.ts`): takumi 2.19's napi layer takes
  i64 milliseconds — every `timeMs` entering the engine (stills, posters,
  filmstrips, storyboards, sequences, sprites) now rounds through
  `toEngineMs`. Fixes 4 red tests against takumi 2.19 (fractional frame grids
  like 30fps: 33.333…ms were rejected with InvalidArg).
- **CLI module loading**: `normalizeModule` extraction + esbuild-loader retry;
  examples/react-banner.tsx renders again under plain tsx.

### API (additive except where noted)

- `renderReactBanner({ bannerModule, workers })` — module entry + worker pool.
- `resolveWorkers`, `windowGrid` exported.
- `toEngineMs` exported.
- `encodePngRgba` gains `{ level, filter }` options (sprite sheets + PNG
  sequences; defaults changed → smaller bytes).
- `springCacheSize()` / `clearSpringCaches()` test seams.
- Breaking: `Math.random` shim is frame-seeded; sprite-sheet PNG bytes change.

### Quality

- 616 tests (up from 504) across 39 files, including three differential-parity
  suites (sampler, compile, evaluate) that pin v1.0 behavior to the frozen
  v0.9.1 baseline byte-for-byte, a worker-parity golden suite, and the engine
  boundary regressions.
- Enforced coverage gates: statements/lines 93.8% (floor), functions 93.5%,
  branches 81% — every v1.0-added module sits at 100%; the residual gap is
  v0.x UI/branch surface queued for the 1.1 pass (see vitest.config.ts).

## 0.9.1

Baseline for this release: data motion (charts, CountUp v2, --data channel),
measured FLIP (`<Morph>` + TM_LAYOUT_SHIFT), the material pack, deterministic
particles, forever reels with byte-exact seams, per-frame X-ray auditing.
