#!/usr/bin/env bash
set -euo pipefail

if [ -f bench/baseline/src/react/index.ts ]; then
    git add -f bench/baseline/src/react/index.ts
    git commit -m "chore(bench): inventory public react primitives baseline exports"
fi

if [ -f bench/baseline/src/react/kit.tsx ]; then
    git add -f bench/baseline/src/react/kit.tsx
    git commit -m "feat(bench): backport continuous text typewriters and countup baseline models"
fi

if [ -f bench/baseline/src/react/loop.tsx ]; then
    git add -f bench/baseline/src/react/loop.tsx
    git commit -m "feat(bench): re-export loop window modulo wrappers"
fi

if [ -f bench/baseline/src/react/material.tsx ]; then
    git add -f bench/baseline/src/react/material.tsx
    git commit -m "feat(bench): capture baseline gradient wipe and variable weight surfaces"
fi

if [ -f bench/baseline/src/react/morph.tsx ]; then
    git add -f bench/baseline/src/react/morph.tsx
    git commit -m "feat(bench): track baseline layoutBody translation and body morph mappings"
fi

if [ -f bench/baseline/src/react/motion.ts ]; then
    git add -f bench/baseline/src/react/motion.ts
    git commit -m "feat(bench): anchor baseline spring and tween progress samplers"
fi

if [ -f bench/baseline/src/react/particles.tsx ]; then
    git add -f bench/baseline/src/react/particles.tsx
    git commit -m "feat(bench): backport baseline ballistic sparkles and confetti matrices"
fi

if [ -f bench/baseline/src/react/path.ts ]; then
    git add -f bench/baseline/src/react/path.ts
    git commit -m "feat(bench): freeze baseline arc-length travel parametric search arrays"
fi

if [ -f bench/baseline/src/react/plan.ts ]; then
    git add -f bench/baseline/src/react/plan.ts
    git commit -m "feat(bench): parse baseline scene windows and overlap bounds"
fi

if [ -f bench/baseline/src/react/primitives.tsx ]; then
    git add -f bench/baseline/src/react/primitives.tsx
    git commit -m "feat(bench): register baseline layer definitions and banner nodes"
fi

if [ -f bench/baseline/src/react/sequence.tsx ]; then
    git add -f bench/baseline/src/react/sequence.tsx
    git commit -m "feat(bench): anchor baseline time remappers and window freezes"
fi

if [ -f bench/baseline/src/react/series.tsx ]; then
    git add -f bench/baseline/src/react/series.tsx
    git commit -m "feat(bench): flatten series sequences during banner scans"
fi

if [ -f bench/baseline/src/react/text.tsx ]; then
    git add -f bench/baseline/src/react/text.tsx
    git commit -m "feat(bench): expose SplitText typographic components"
fi

if [ -f bench/baseline/src/react/transitions.ts ]; then
    git add -f bench/baseline/src/react/transitions.ts
    git commit -m "chore(bench): handle transition styles matching push and slide parameters"
fi

if [ -f bench/baseline/src/render.ts ]; then
    git add -f bench/baseline/src/render.ts
    git commit -m "feat(bench): map baseline timeline serialization rules"
fi

if [ -f bench/baseline/src/sampler.ts ]; then
    git add -f bench/baseline/src/sampler.ts
    git commit -m "feat(bench): evaluate baseline repeat folded track lookups"
fi

if [ -f bench/baseline/src/sequence-export.ts ]; then
    git add -f bench/baseline/src/sequence-export.ts
    git commit -m "feat(bench): backport baseline png frame sequence file writers"
fi

if [ -f bench/baseline/src/templates/cascade.ts ]; then
    git add -f bench/baseline/src/templates/cascade.ts
    git commit -m "feat(bench): wire baseline per-glyph cascade entrance templates"
fi

if [ -f bench/baseline/src/templates/countup.ts ]; then
    git add -f bench/baseline/src/templates/countup.ts
    git commit -m "feat(bench): unroll baseline digital counter layers"
fi

if [ -f bench/baseline/src/templates/index.ts ]; then
    git add -f bench/baseline/src/templates/index.ts
    git commit -m "chore(bench): expose public baseline recipe entries"
fi

if [ -f bench/baseline/src/templates/registry.ts ]; then
    git add -f bench/baseline/src/templates/registry.ts
    git commit -m "chore(bench): catalogue baseline template factory mapping lists"
fi

if [ -f bench/baseline/src/templates/shared.ts ]; then
    git add -f bench/baseline/src/templates/shared.ts
    git commit -m "chore(bench): freeze baseline layout tokens and ceiling grids"
fi

if [ -f bench/baseline/src/templates/sweep.ts ]; then
    git add -f bench/baseline/src/templates/sweep.ts
    git commit -m "feat(bench): map baseline horizontal tracking sweep animations"
fi

if [ -f bench/baseline/src/templates/typewriter.ts ]; then
    git add -f bench/baseline/src/templates/typewriter.ts
    git commit -m "feat(bench): isolate baseline typewriter character gating metrics"
fi

if [ -f bench/baseline/src/themes.ts ]; then
    git add -f bench/baseline/src/themes.ts
    git commit -m "chore(bench): catalog baseline layout flat base colors allowlist"
fi

if [ -f tests/fixtures/banner-module-baseline.tsx ]; then
    git add -f tests/fixtures/banner-module-baseline.tsx
    git commit -m "test(infra): declare baseline parallel worker capture target fixture"
fi

if [ -f tests/fixtures/banner-module.tsx ]; then
    git add -f tests/fixtures/banner-module.tsx
    git commit -m "test(infra): declare active parallel worker capture target fixture"
fi

if [ -f tests/fixtures/heavy-banner-module-baseline.tsx ]; then
    git add -f tests/fixtures/heavy-banner-module-baseline.tsx
    git commit -m "test(infra): register baseline heavy grid load test fixture"
fi

if [ -f tests/fixtures/heavy-banner-module.tsx ]; then
    git add -f tests/fixtures/heavy-banner-module.tsx
    git commit -m "test(infra): register active heavy grid load test fixture"
fi

if [ -f tests/fixtures/random-banner-module.tsx ]; then
    git add -f tests/fixtures/random-banner-module.tsx
    git commit -m "test(infra): record frame-seeded math random loader test fixture"
fi

if [ -f tests/sampler-parity.test.ts ]; then
    git add -f tests/sampler-parity.test.ts
    git commit -m "test(parity): evaluate twin sampler outputs against v0.9.1 baseline"
fi

if [ -f commit.sh ]; then
    git add -f commit.sh
    git commit -m "chore(infra): track individual shell serialization script"
fi
