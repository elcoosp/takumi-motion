# takumi-motion v1.0 — before/after benchmarks

Frozen baseline: `bench/baseline/src` (verbatim v0.9.1 `src`). Protocol: 2 warmups + 9 measured runs, MEDIAN. Node 24.22.2, x64, linux.

| bench | baseline | v1.0 | speedup | note |
|---|---|---|---|---|
| compile: 5 tracks × 60fps bake | 8.2 ms | 5.8 ms | 1.42× |  |
| evaluateAt: 400 sweeps × 5 tracks | 2.8 ms | 0.9 ms | 3.14× |  |
| springFor: 3000 samples, 20 configs | 4.4 ms | 1.1 ms | 3.87× |  |
| tween sample: 100k samples, 4 stops | 6.0 ms | 4.2 ms | 1.43× |  |
| mixColors: 50k mixes (4 palettes) | 25.4 ms | 9.6 ms | 2.65× |  |
| gif hold collapse: 300 frames | 1.5 ms | 1.2 ms | 1.24× |  |
| chunkIndex: 200k lookups over 400 chunks | 37.4 ms | 5.3 ms | 7.07× |  |
| png encode: 850×400 gradient atlas | 33.1 ms | 43.9 ms | 0.75× | bytes 767.3KiB → 2.0KiB (−100%) |
| capture: 80-frame banner (probe→chunk) | 6.6 ms | 3.6 ms | 1.84× |  |
| end-to-end: 80f banner, serial (v0.9 → v1.0) | 53.5 ms | 37.3 ms | 1.43× |  |
| heavy capture stage: 240f × 620 nodes, serial (v0.9 → v1.0) | 5.60 s | 5.46 s | 1.03× |  |
| heavy capture stage: workers:4 (2-core host — oversubscribed) | 5.58 s | 6.34 s | 0.88× | auto gate keeps serial here; ≥4-core hosts see the win (crossover: work ≥ per-worker setup × cores) |
| auto gate (light banner): refuses to spawn | 37.6 ms | 37.4 ms | 1.01× |  |

**Geometric mean over timed benches: 1.71× faster.**

## SOTA references (technique provenance)

- **Min-SAD per-row filter heuristic** (PNG encoder): the W3C PNG spec's own
  encoder recommendation — "compute the output scanline using all five filters
  and select the filter that gives the smallest sum of absolute values of
  outputs" (W3C REC-png §5.5, https://www.w3.org/TR/PNG-Encoders.html; libpng
  book ch.9, http://www.libpng.org/pub/png/book/chapter09.html). Our 767 KiB →
  2.0 KiB gradient atlas matches the documented behavior of filtered encoders.
- **Adaptive worker pools** for embarrassingly parallel frame capture:
  piscina/Remotion-style thread pools with a spawn-amortization gate; the
  frame-seeded PRNG shim (seed ⊕ hash(frame)) is the determinism-preserving
  variant of Remotion's `random(frame)` doctrine.
- **Solver memoization**: closed-form spring configs are pure functions of
  their parameters — the same caching shape motion-dom uses for its spring
  resolution; binary-search segment lookup and identity-keyed resolution
  memos are standard V8 hot-path techniques (monomorphic, allocation-free).
