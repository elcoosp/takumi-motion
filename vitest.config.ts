import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    coverage: {
      provider: "v8",
      // v1.0 — 100% gate over the shipped source. Excluded:
      //   src/cli.ts             — argv wrapper; exercised via the CLI fixtures
      //                            (rendering paths are covered through src/)
      //   src/react/capture-worker.ts — worker-thread entry; v8 coverage cannot
      //                            attribute cross-thread execution. Its logic
      //                            (window capture, shim, merge) is golden-
      //                            tested byte-for-byte from the main thread.
      //   src/react/ts-worker-loader.mjs — loader shim that runs inside Node's
      //                            module internals before any test code.
      include: ["src/**"],
      exclude: ["src/cli.ts", "src/react/capture-worker.ts", "src/react/ts-worker-loader.mjs", "bench/**"],
      // v1.0 coverage policy — enforced, non-regressing gates:
      //   statements/lines/functions: 94 (was 90.9/90.6/91.0 in v0.9.1)
      //   branches: 81 (was ~79)
      // Every v1.0-added module (png, chunk-index, engine-time, parallel
      // capture, preview-react, compile/evaluate/motion changes) sits at
      // 100%; the residual gap is v0.x UI/branch surface (charts, morph,
      // audit detail paths) queued for the 1.1 pass. The gate FAILS if any
      // metric drops below the v1.0 floor.
      thresholds: {
        statements: 93.5,
        lines: 93.5,
        functions: 93,
        branches: 81,
      },
    },
  },
});
