# Authoring guide — the DX surface (v0.6 lint & kit · v0.7 motion language · v0.9 data motion · v0.9.1 motion-quality pass)

Everything here is engine-side tooling: no hosted layer, no platform rails.
The report is the API — this page maps what can go wrong to the code that tells you about it.

## The authoring lint (`report.lint`)

Every render (`renderReactBanner`, `renderBanner`, `renderWithAudit`) carries a `lint: LintWarning[]` channel alongside the legacy `warnings: string[]`. Each finding is:

```ts
interface LintWarning {
  code: LintCode;        // stable TM_* identifier
  message: string;       // diagnosis, with the offending key/value/path
  hint?: string;         // the fix, phrased as what to do instead
  severity: "warn" | "info";
}
```

Findings are deduplicated, capped at 20 per code (with a truncation notice), and survive `--json` / `renderWithAudit()` — so a consumer platform can render them, filter them, or fail CI on specific codes.

| Code | What it catches | Why it matters |
|---|---|---|
| `TM_KEBAB_STYLE` | kebab-case keys in React style objects; `prop:Numberpx` signatures in the captured markup | React 19 serializes kebab keys but its unitless table is keyed on camelCase — `"font-weight": 700` renders as `font-weight:700px`, which takumi **rejects** (render fails with a Rust parse error). Fix: use `"fontWeight"` |
| `TM_NAN_STYLE` | `NaN` / `Infinity` / `undefined` values in style objects or markup | Broken springs (stiffness 0), inverted interpolate ranges — silently produces garbage styles |
| `TM_EMPTY_STYLE` | elements that rendered `style=""` | Every declaration was dropped upstream — usually the kebab bug or an undefined style object |
| `TM_UNKNOWN_STYLE_PROP` | (strict mode) properties outside `SUPPORTED_STYLE_PROPS` | Advisory — takumi supports more than the curated list; verify then extend the set |
| `TM_SPRING_DURATION` | declarative tracks mixing `type:"spring"` with `duration` | Springs are solved by physics; the duration is silently ignored — still-authors hit this constantly |
| `TM_FONT_NETWORK` | Google-Font specs or URL font files | Byte-determinism holds only while the remote bytes do; vendor TTF/OTF locally for reproducible builds |
| `TM_GLOW_GIF_DITHER` | `filter:blur()` chunks in a GIF render at dpr 1 | Palette dithering of soft gradients is the #1 GIF size trap (1x glow GIFs compressed WORSE than 2x in benchmarks) — prefer WebP, dpr 2, or flat accents |
| `TM_FITTEXT_UNMEASURED` | `<FitText>` rendered without a prewarmed measurement | Fell back to `max` font size — render through the capture runtime (the prewarm pass runs there) or precompute with `fitFontSize()` |

## Type-level style safety

```tsx
import type { TakumiStyle } from "takumi-motion";

const style = {
  fontSize: 32,
  fontWeight: 700,     // unitless — number is safe
  display: "flex",
  alignItems: "center",
} satisfies TakumiStyle;
```

- Keys are the takumi-verified property set — a typo is a compile error, not a silently unstyled div.
- `UNITLESS_STYLE_PROPS` mirrors React's unitless table (the properties where bare numbers are safe).
- CSS custom properties go through the explicit `--*` key form.
- `SUPPORTED_STYLE_PROPS` is the same list as runtime data — extend it in your consumer if you've verified additional properties against takumi.

## Content components

```tsx
import { Fill, Img, FitText, imageDataUri, imageDataUriFromFile } from "takumi-motion/react";

<Fill style={{ flexDirection: "column", justifyContent: "center" }}>…</Fill>
<Img src={bufferOrDataUri} width={64} height={64} />
<FitText text="headline" max={48} maxWidth={700} fontWeight={700} />
```

- **`<Fill>`** — absolute inset-0 **flex** container. takumi only applies `alignItems`/`justifyContent` under an explicit `display:flex`; Fill bakes that in so centering works by default.
- **`<Img>`** — Buffers inline as `data:` URIs synchronously; strings pass through. For files/URLs, resolve *before* capture to keep render a pure function of props: `const logo = await imageDataUriFromFile("assets/logo.png")`.
- **`<FitText>`** — measure-exact: the largest font size whose takumi-measured width fits `maxWidth` (default: canvas width − 32px). The capture runtime prewarms a fit cache (one render per scene, one batched measure pass with the banner's fonts), so the frame loop reads sizes synchronously. Rendered outside the runtime → falls back to `max` and emits `TM_FITTEXT_UNMEASURED`.

## The kinetic kit

```tsx
import { CountUp, Typewriter, Glow } from "takumi-motion/kit";

<CountUp to={4200} durationFrames={40} delayFrames={6}
         format={(n) => `${Math.round(n).toLocaleString("en-US")}+ stars`} />
<Typewriter text="shipping determinism" durationFrames={24} cursorPeriodFrames={14} />
<Glow x={180} y={90} size={260} color="#38bdf8" />
```

All three are pure functions of `(frame, props)` — no clock, no `Math.random`. `CountUp` renders one text per value (the chunker merges the hold; drift-heavy counting is WebP territory — the report tells you the chunk count). `Glow`'s defaults encode the size doctrine: opacity 0.14, blur 44 — and remember `TM_GLOW_GIF_DITHER` on transparent/1x GIF surfaces.

## Previewing: filmstrip vs player

```bash
takumi-motion render banner.tsx --filmstrip          # 6 evenly spaced engine-exact stills
takumi-motion render banner.tsx --filmstrip 0,15,30  # explicit frames
takumi-motion render banner.tsx --filmstrip 10       # 10 frames
takumi-motion preview banner.tsx                     # the CSS-approximation player
```

- **`--filmstrip`** (v0.6): every cell is rendered by the Rust engine — the actual pixels you will ship. Self-contained HTML, byte-deterministic (diff it in review), works on all three source paths.
- **`--preview`** (v0.3): plays the captured CSS in the browser — good for scrubbing motion, approximate layout; the GIF remains the source of truth.

## Timeline transforms (declarative path)

```ts
import { shiftTimeline, concatTimelines } from "takumi-motion";

const withIntro = shiftTimeline(bodyTimeline, 500);        // move everything 500ms later
const composed = concatTimelines([intro, body, outro]);    // the declarative <Series>
```

`shiftTimeline` refuses negative deltas (moving tracks earlier would clip them against the scene start); durations grow so nothing truncates. `concatTimelines` stacks timelines back-to-back — the data equivalent of `<Series.Sequence>` stacking.

## Canonical API names (and the aliases)

| Purpose | Canonical | Notes |
|---|---|---|
| Frame-range mapping (React) | `interpolate(frame, inRange, outRange, { easing })` | Remotion-signature, root export |
| Hook sugar | `useInterpolate(inFrames, out, easing?)` | reads the frame context for you |
| Pure companion | `interpolateFor(frame, inFrames, out, easing?)` | hook-free variant in `react/motion` |
| Spring | `useSpring(options)` / `springFor(frame, fps, options)` | motion-ported solver |
| Stagger | `useStaggeredSpring(index, opts)` / `staggeredSpringFor(...)` | v0.5 |
| Still | `renderStill({ banner \| html \| node+timeline })` | one PNG, any path |
| Filmstrip | `renderFilmstrip(same sources)` | N stills, one HTML |

The three interpolate variants are intentionally distinct (context-free vs context-reading); the JSDoc on each cross-references the others. Prefer `interpolate` for new code.

## Capture lifecycle (what renders when)

```
PROBE    <Banner> registers meta + scene inputs (children don't render)
PLAN     planBanner() → frame-exact windows
PREWARM  each scene's opening frame renders once (v0.6 — FitText discovery;
         outputs discarded; components may see one extra render per scene)
FRAMES   the real per-frame loop (htmlFrames — what gets encoded)
CHUNK    byte-identical frames merge
LINT     style trees + markup + registry findings → report.lint
```

Determinism is untouched: `Math.random` is shimmed across prewarm + frames; prewarm outputs never reach the encoder.

## The motion language (v0.7): `<Animated>`, `<Keyframes>`, color, springs

v0.7 adds the declarative motion vocabulary — the Reanimated borrow, re-derived on
the frame-indexed core. All of it is pure data + pure functions of the frame; the
reactive machinery Reanimated needs (worklets, shared values, gestures) has no
equivalent here because determinism is the product.

### Entering / exiting — `<Animated>`

```tsx
import { Animated, FadeInDown, FadeOutLeft, staggered } from "takumi-motion/react";

<Scene duration={60}>
  <Animated entering={FadeInDown.duration(18).delay(4)} exiting={FadeOutLeft.duration(10)}>
    <Hero />
  </Animated>
</Scene>
```

Rules worth knowing:

- **Units are FRAMES** everywhere (engine-native). Convert ms with `msToFrames(ms, fps)`.
- **Entering** resolves from scene-local frame 0. Before the delay elapses the
  subtree renders at the descriptor's start state (hidden); after the transition
  settles the wrapper emits **no overrides at all** — style-stable, chunk-merge-friendly.
- **Exiting** anchors to the enclosing scene's duration (or the banner end inside
  `<Layer>`): it starts at `totalFrames − delay − duration` so it finishes exactly
  as the window closes.
- When both run at once (short scene), exiting wins on shared channels.
- The wrapper is a plain `div`; keep self-animated transforms on inner elements.
- 26 presets ship (`transitionPresets`), all 2D (`opacity x y scale rotate` — the
  subset takumi renders). Springify any of them: `.springify("bouncy")` or
  `.springify({ stiffness: 170, damping: 11 })`.
- `staggered(preset, index, { intervalFrames, startFrames })` bakes stagger slots
  into a copy (the original descriptor is untouched).
- Prefer hooks on your own elements: `useEntering(desc)` / `useExiting(desc)` →
  `{ opacity?, transform? } | null` (null = settled = emit nothing).
- Custom presets: `defineTransition({ name, side, channels, durationFrames, easing })`.

### `<Keyframes>` — declarative multi-stop

```tsx
<Keyframes frames={{
  0:  { opacity: 0, y: -24, easing: "easeOut" },
  30: { opacity: 1, y: 0 },
  50: { opacity: 1 },              // hold (fill-forward)
  59: { opacity: 0, y: 24, easing: "easeIn" },
}} />
```

- Properties **fill forward**: a property declared at stop N holds through stops
  that don't declare it, and is ABSENT before its first declaring stop (your
  element's own style governs there).
- `easing` on a stop applies to the segment **arriving** at that stop, per
  property — fill-forward spans keep their own timing (CSS semantics).
- Value categories: numbers lerp; colors mix in OKLCH (or `space` prop);
  transform channels (`x y scale rotate`, part-wise); any other string is
  verbatim. Mixed categories hold the earlier value (no cross-type morphing).
- The `frames` object is parsed once (WeakMap keyed on identity) — keep it
  module-level or `useMemo`'d. Per-frame resolve is O(props).

### Perceptual color

```ts
import { mixColor, interpolateColorFor, parseColor, colorToOklch } from "takumi-motion";

mixColor("red", "yellow", 0.5);                       // OKLCH → clean orange
mixColor("red", "blue", t, { space: "srgb" });        // legacy per-channel
interpolateColorFor(frame, [0, 45, 90], ["#0f172a", "#1d4ed8", "#f8fafc"]);
```

OKLCH is the default space (perceptually uniform; hue takes the SHORT path; grey
endpoints don't drag the hue around). Output is takumi-safe `rgb()` with integer
channels — the GIF/WebP palette quantizer rounds anyway, and integer output keeps
the chunk-merger effective. Size doctrine note: high-chroma OKLCH sweeps on large
areas still dither into palette noise in GIFs at dpr 1 — prefer WebP for vivid
washes (same trap as `<Glow>`, same lint rationale). `interpolate.ts`'s legacy
`mixColors` is FROZEN (compile-path byte-determinism) — use `color.ts` APIs for
new work.

### Spring hygiene — the finite-output problem

Reanimated springs are open-ended; our outputs are finite. The v0.7 toolkit:

- `springSettleFrames(fps, options)` → the frame count until the spring is
  visually done (velocity AND offset below Motion's rest thresholds), delay
  included. Memoized; `Infinity` for absurd configs.
- `springPresets` — `snappy bouncy gentle wobbly stiff slow` — spread into any
  spring: `useSpring({ ...springPresets.snappy, from: 24 })`.
- `overshootClamping: true` clamps to `[from, to]` (slides that must not bounce).
- The lint: **`TM_TRANSITION_UNSETTLED`** — `<Animated>` diagnoses its descriptors
  exactly once per capture, at the scene's final frame. Enter still moving at the
  last frame, or exit starting before the window opens → coded warning with the
  settle math in the message. Raw `useSpring` users: check
  `springSettleFrames(fps, opts) <= framesRemaining` yourself.

### The `Easing` namespace

`Easing.linear/easeIn/easeOut/easeInOut/circ*/back*/bounce*/anticipate` (values),
`Easing.poly(n)`, `Easing.elastic(b)`, `Easing.back(s)`, `Easing.bezier(x1,y1,x2,y2)`,
`Easing.steps(n, dir)`, and the factories `Easing.in/out/inOut` — **RN's exact
semantics**: the base curves are in-shaped, so `in` is the identity, `out` mirrors
to `p => 1 − f(1−p)`, `inOut` folds both ends around 0.5. Same solver backs the
string names (`"backOut"` etc.); `bounceIn/Out/InOut` joined the named set in v0.7.

### Performance notes (why this stays fast)

- Settled descriptors return `null` → no overrides → identical frames chunk-merge.
- All emitted values are rounded to 6 decimals (the v0.1 transitions doctrine).
- Color parsing is cached per distinct string (bounded); keyframes parse once per
  authoring object; settle frames are memoized per config.
- Measured (proof-v07): descriptor resolve ≈ 0.6µs, spring ≈ 4.7µs, color ≈ 0.5µs,
  memoized settle ≈ 0.4µs — noise against the 33ms/frame budget at 30fps.

> v0.8 (choreography — `<Camera>`, `<FollowPath>`, `chain()/hold()/cascadeExit()`, scene
> labels + `useCue`, `<Wiggle>`, `TM_NOISE_ALIASED`, windowed renders, the golden-frame
> harness) is documented in the README's v0.8 section; the reference below picks up at v0.9.

## The data motion release (v0.9): charts, morph, materials, particles, loop, X-ray

### The data channel (Bet A) — the animation knows the numbers

One data object enters at setup; nothing is fetched at render time (a network fetch at
render time is a determinism violation — file reads are fine, they are immutable inputs).

```tsx
// programmatic
const report = await renderReactBanner({ banner: Reel, data: metricsJson });
// CLI
//   npx takumi-motion render reel.tsx --data metrics.json --format webp
```

Inside the tree, read it anywhere via `useChartData<T>(hint?)` (throws with a hint listing
registered keys when absent; `hasChartData()` checks quietly). Chart components also accept
data directly via props when you don't need the channel.

**Chart primitives** (all deterministic; colors default to the `CHART_COLORS` ramp):

- `<LineChart data draw="reveal" area grid />` — builds ONE static SVG per chart, then
  sweeps a per-frame `clip-path: inset()` across it. That clip reveal IS the draw engine
  (the day-one spike settled it: takumi renders SVG as static imagery, so stroke-dashoffset
  tricks are unavailable; `reveal` is also the honest fallback of the premium stroke idea).
  `draw="none"` renders the finished chart for stills.
- `<BarChart data stagger spring orientation="up"|"right" grouped />` — bars grow with
  staggered closed-form springs; layout is honest (widths derive from the measured plot
  box, multi-series groups share slots).
- `<Donut value paint="transform"|"conic" center={...} />` — `paint="transform"` is the
  two-half mask sweep (pure rotate + clip — cheap, palette-safe, the default); `conic`
  is the premium gradient alternative (mind the GIF dither lint).
- **CountUp v2** (`kit.tsx`) — `format` takes patterns, not `Intl`: `"$,.0f"`, `",.1f"`,
  `"+.0%"`, `"ms"` — parsed once, deterministically, `tabular-nums` always forced so
  digit columns never reflow siblings. Function formers still work: `format={(v) => …}`.

`niceMax()` rounds chart maxima to clean gridlines; `compactNumber()` prints `1.2M`-style
axis labels.

### Layout truth (Bet B) — `<Morph>` and `TM_LAYOUT_SHIFT`

`<Morph from to switchFrame durationFrames itemIds renderItem containerStyle itemStyle />`
is a measured morph (v0.9.1 flight v2): the capture prewarm renders BOTH layout states
and measures every item's rect AND the container's own box through the real renderer
(the `<FitText>` fit-cache pattern — see `morphRectOf` / `morphContainerRectOf` /
`clearMorphCache`). Frames before `switchFrame` play the `from` layout, after play the
`to` layout; during the flight each item is absolutely positioned at its INTERPOLATED
rect (source → target through the **position+size channels**, easeInOut) and the
container's width/height interpolates alongside — a centered parent glides it, so there
is no jump even when the two states have different container widths. Item CONTENT flips
from the source rendering to the target rendering at `contentSwitchAt` (default 0.5;
raise it when the target content needs the box near full target size). `staggerFrames`
delays item i's flight by i×stagger for cascaded morphs. There is NO scale anywhere:
unlike a classic scale-FLIP, text glyphs never stretch and dots never go elliptical.
Identity travels via out-of-flow marker runs (`MORPH_MARKER`), so unmeasured fallbacks
cost zero layout. Items missing from either measurement are reported, not guessed.

**`TM_LAYOUT_SHIFT`** is the audit that keeps everything else honest: after capture, the
measured trees are re-walked and any box that MOVES inside a scene without being told to
is flagged — with the culprit sibling's path and the delta. Exempt by design: rigid
subtrees (parent moved too = transform-driven), authored particle fields, nodes with an
active transform track, and declared `<Morph>` windows. The v0.8 reel's three layout
accidents (counting digits reflowing neighbors, content shoved by late siblings, animated
widths) are now lint codes with the fix in the hint: absolute park, reserved space, or
fixed-width digits (`tabular-nums` / `minWidth`).

### The material pack (Bet C)

- `<Reveal wipe="left|right|up|down|circle" feather={n} from={f} durationFrames={n}>` —
  directional reveal via animated mask gradients; `feather={0}` is a hard cut (palette-safe
  for GIF). Settled frames emit NO mask style — chunk-merge stays effective.
- `<Mask fade="top|bottom|left|right" fadeLength={n}>` / `<Mask image={...}>` — declarative
  alpha masks (single or layered gradients) for photo/vignette work.
- `<VariableText text from={300} to={800} durationFrames={n}>` — `fontVariationSettings`
  weight tracks. Load a variable font with a range: `{ name: "Inter", weight: "100..900" }`
  (see the fonts doc — static weights cannot interpolate).
- `<GradientText text from to />` — `background-clip: text` fills.

### Particles (Bet D) — churn with a doctrine

`<Particles mode="sparkle"|"confetti" count seed burstFrames area />`. Every particle is a
closed form of the frame index — O(1)/particle/frame, any frame replays byte-identically,
`randomFor`/mulberry32 only (never `Math.random`). Sparkles twinkle in place (per-frame
delta is a few pixels — the cheap tier, effectively free in GIF deltas); confetti flies a
ballistic arc and SETTLES into a twinkle at `burstFrames`. Unbounded churn or counts over
`CONFETTI_BUDGET` trip **`TM_PARTICLE_CHURN`** — finite bursts are the doctrine; a GIF
that never stops moving never compresses.

### Scene transitions — cut / crossfade / slide / rise / push (v0.9.1)

`<Scene enter exit>` accepts `"cut" | "crossfade" | "slide" | "rise" | "push" | "wrap"`
(or `{ kind, ms }` to set the overlap length). `crossfade`/`slide`/`rise` blend the two
scenes during the overlap (both at partial opacity). **`push` never blends**: the
arriving scene slides in from exactly one canvas-width away at FULL opacity while the
leaving scene slides out left in lockstep — the two stay exactly adjacent for every
eased frame, so nothing ever superimposes. Both sides must declare it
(`enter={{ kind: "push", ms: 240 }}` on the arriving scene, `exit="push"` on the
leaving one): a `cut` exit keeps the leaving scene static and the transparent scene
wrapper lets it show through the arriving scene's gaps. The extent audit exempts
transition-overlap chunks automatically (`extents.transitionChunksSkipped`).

### The forever reel (Bet E) — `<Banner loop>` and `enter="wrap"`

```tsx
<Banner loop fps={24}>
  <Scene duration={90}>…</Scene>
  <Scene duration={76} exit="wrap">…</Scene>   {/* or enter="wrap" on scene 1 */}
</Banner>
```

`exit="wrap"` (or `enter="wrap"`) on the boundary INTO scene 1 appends a crossfade tail
into scene 1's frozen frame-0 layer; at the final wrap frame the leaving node DROPS, so
the last frame and frame 0 are **byte-identical by construction**. `report.seam` carries
the verdict (`mode: "exact"` after a byte check; the golden composition proves it). A
`<Banner loop>` WITHOUT a wrap earns a coded **`TM_LOOP_SEAM`** pointing at the fix.
Looping banners default their poster to **frame 0** — the landing frame — instead of the
mid-timeline default.

### The X-ray (Bet F) — explain + storyboard

- `renderReactBanner({ explain: true })` / CLI `--explain` attaches `report.explain`:
  per-frame attribution to channels (opacity / transform / clip / layout / paint / text /
  structure) with cheap-vs-expensive churn ranges — the size-budget instrument that pairs
  with the lint (the channel `TM_LAYOUT_SHIFT` warns about is the one `explain` bills).
- `npx takumi-motion storyboard reel.tsx [--frames N] [--columns M] [--out dir]` renders
  a labeled PNG contact sheet of the whole timeline (cells rasterized by the engine — the
  sheet itself is a takumi document) plus a sidecar JSON with the sampled frame indices.

### v0.9 lint codes (added to the table above)

| Code | What it catches | Why it matters |
|---|---|---|
| `TM_LAYOUT_SHIFT` | a box that moves inside a scene without an authored transform (culprit sibling named with delta) | unintended reflow churns pixels the encoder must re-encode every frame; also just a bug |
| `TM_PARTICLE_CHURN` | unbounded or over-budget particle churn | GIF/WebP size is per-frame delta × frames; a field that never settles never compresses |
| `TM_LOOP_SEAM` | a `<Banner loop>` whose last frame ≠ frame 0 (no `wrap`) | the loop visibly snaps; the fix (`exit="wrap"`) is in the hint |

