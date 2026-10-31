# takumi-motion

**Deterministic server-side animation engine: any React component or raw HTML string in, animation files and stills out — rendered by Rust.**
GIF / WebP / APNG / PNG frame sequences / sprite sheets / single-frame stills at **any user-given surface** (width, height, dpr, fps, duration, formats, transparent or colored background) — no browser, no headless Chrome, no After Effects. Banner presets exist, but they're *recipes*: every field they set can be overridden.

```bash
npx takumi-motion render banner.tsx --preset readme           # React scenes → GIF/WebP
npx takumi-motion render banner.tsx --width 1080 --height 1080 --background transparent   # any surface
npx takumi-motion render card.html  --css style.css --width 1200 --height 630              # raw HTML, no React
```

## 60-second quickstart

```bash
npx takumi-motion init my-banner --react     # scaffold banner.tsx + tsconfig.json
cd my-banner
npm i takumi-motion react react-dom
npx takumi-motion render banner.tsx --preset readme --out ./out
npx takumi-motion render banner.tsx --filmstrip   # engine-exact contact sheet
```

Open `out/banner-filmstrip.html` — every cell is a real Rust-rendered still of your banner. Iterate on the component, re-render, check `report.lint` when something looks off.

**Three authoring models, one engine:**

```tsx
// banner.tsx — a real React component tree, with state, rendered to GIF by Rust
import { Banner, Scene, Layer, Sequence, Freeze, defineBanner, useCurrentFrame, useSpring, useNoise } from "takumi-motion/react";

const FEATURES = ["zero browser", "spring physics", "multi-scene"];

export default defineBanner(function LaunchBanner() {
  return (
    <Banner width={1080} height={1080} background="transparent" fps={30}>
      <Layer bottom><AccentRail /></Layer>

      <Scene duration={90} enter="rise">
        <Hero />                    {/* useSpring() — the exact motion-ported solver */}
      </Scene>

      <Scene duration={150} enter="crossfade" exit="slide">
        <Sequence from={30} durationInFrames={60} speed={2}>
          <Carousel />              {/* time-remapped window inside the scene */}
        </Sequence>
        <Freeze at={12}><Sparkle /></Freeze>
      </Scene>

      <Scene duration={60} enter="slide">
        <Outro />                   {/* useNoise(seed) — deterministic organic drift */}
      </Scene>

      <Layer top><VersionChip /></Layer>
    </Banner>
  );
});
```

```ts
// banner.ts — or the declarative path: templates that measure-fit and never overflow
import { cascadeBanner } from "takumi-motion";

export default cascadeBanner({
  title: "your-project",
  tagline: "springs for your README",
  theme: "tokyo-night",       // 7 built-in themes
  motion: "snappy",           // snappy | smooth | playful | mechanical
  font: "Space Grotesk",      // any Google Font — fetched + registered automatically
});
```

```html
<!-- card.html — or raw HTML + CSS: no React, no timeline API. @keyframes work. -->
<div style="width:1200px;height:630px;display:flex;align-items:center;justify-content:center;">
  <div class="bar" style="height:8px;background-color:#7aa2f7;"></div>
</div>
```
```css
/* style.css */
@keyframes sweep { from { width: 60px; } to { width: 420px; } }
.bar { animation: sweep 1.5s ease-in-out infinite; }
```

All of it compiles to the same thing: one napi call hands the scene list to [Takumi](https://github.com/kane50613/takumi)'s Rust engine — frame-exact springs on the fps grid, every frame evaluated by the Rust-native animation clock, streamed into the encoders. The JS side never touches per-frame pixels.

**What this library is:** infrastructure — `component + props + output spec → file`. What it is NOT: a platform. No hosted service, no GitHub Action, no scheduler, no distribution rails — embed it in your own og-image server, banner service, or CI pipeline via the programmatic API (`renderWithAudit()` returns the whole verdict as JSON data) or drive the CLI with `--json`.

**What v0.9 adds — the data motion release (what resvg did for SVG, but for animation — part 2)**

v0.8 gave scenes their grammar. v0.9 gives the animation its *numbers*: charts whose motion is derived from the data they render, layout changes that are measured instead of guessed, surfaces and particles as first-class materials, and a loop seam that is byte-exact by construction. Six bets, each landed behind its gate (frame-exact tests → golden composition → tsc strict → size budget) — see `examples/signals-reel.tsx` for all of them on one looping canvas, fed by `examples/signals-data.json`.

```tsx
// the spine: the animation knows the numbers (Bet A)
const report = await renderReactBanner({ banner: Reel, data: metricsJson });
// CLI: npx takumi-motion render reel.tsx --data metrics.json --format webp

<Scene duration={90} label="signals">
  <CountUp to={data.mrr} format="$,.0f" />          {/* tabular-nums forced */}
  <LineChart data={data.revenue} draw="reveal" area grid />  {/* clip-sweep draw */}
  <BarChart data={data.retention} stagger spring />  {/* closed-form springs */}
  <Donut value={0.73} paint="transform" center={<CountUp to={73} />} />
</Scene>

// layout truth (Bet B): measured FLIP — same items, two layouts, no jump
<Morph from="list" to="grid" switchFrame={22} durationFrames={16}
       itemIds={ids} renderItem={(id, state) => <Card id={id} mode={state} />}
       containerStyle={{ list: {...}, grid: {...} }}
       itemStyle={{ list: {...}, grid: {...} }} />

// material pack (Bet C) + particles (Bet D): churn with a doctrine
<Reveal wipe="up" feather={22}><QuoteCard /></Reveal>
<Mask fade="bottom" fadeLength={32}><Photo /></Mask>
<VariableText text="signal" from={300} to={800} />   {/* variable-font track */}
<GradientText text="takumi-motion" />                {/* background-clip:text */}
<Particles count={20} mode="sparkle" />               {/* opacity twinkle — cheap */}
<Particles count={22} mode="confetti" burstFrames={26} /> {/* flies, then settles */}

// the forever reel (Bet E): the finale's exit wraps into scene 1 — byte-exact seam
<Banner loop>
  <Scene duration={90}>…</Scene>
  <Scene duration={76} exit="wrap">…</Scene>
</Banner>   {/* report.seam.mode === "exact" · looping posters default to frame 0 */}
```

- **Data kit (Bet A · the spine).** `renderReactBanner({ data })` / CLI `--data metrics.json` load ONE data object at setup (file reads are deterministic; network fetches at render time are a documented violation) and provide it via `DataContext` — components read it with `useChartData()`. `<LineChart draw="reveal">` builds ONE deterministic SVG per chart and sweeps a per-frame `clip-path: inset()` across it (the day-one spike settled the moonshot: takumi renders SVG as static imagery, so clip reveal IS the draw engine); `<BarChart>` grows bars with staggered closed-form springs (honest layout, grouped multi-series, `orientation` up/right); `<Donut paint="transform">` is the two-half mask sweep — pure rotate + clip, zero gradients, geometry proven at the pixel level — with `paint="conic"` as the premium alternative; **CountUp v2** adds compact format patterns (`"$,.0f"`, `",.1f"`, `"+,.0f%"`, `"ms"`) with a deterministic parser — no `Intl`, tabular-nums always forced.
- **Layout truth (Bet B · moonshot).** `<Morph from to switchFrame itemIds renderItem containerStyle itemStyle>` — deterministic FLIP between two measured layouts: the prewarm renders BOTH states, measures them through the real renderer (the `<FitText>` pattern), and frames play the target layout with translate/scale compensation decaying to identity. Identity travels via out-of-flow marker runs — zero layout impact. **`TM_LAYOUT_SHIFT`**: the extent audit's measured trees are re-walked to flag intra-scene box movement — rigid subtrees (parent moved too = transform-driven), authored particle fields, active-transform nodes and declared `<Morph>` windows are exempt; a lone pushed leaf is named with its pushing sibling's path and delta. The v0.8 reel's three layout accidents are now lint codes with fixes in the hint.
- **Material pack (Bet C).** `<Reveal wipe="left|right|up|down|circle" feather>` — directional mask-gradient reveals (feather=0 → hard cuts, palette-safe; settled frames emit NO mask); `<Mask image|fade>` — declarative alpha masks; `<VariableText from to>` — `fontVariationSettings` weight tracks (load a variable font: `{ name: "Inter", weight: "100..900" }`); `<GradientText>` — `background-clip: text` fills. All pixel-probed through the renderer.
- **Particles (Bet D).** `<Particles mode="sparkle"|"confetti" seed burstFrames>` — every particle's state is a closed form of the frame index (O(1)/particle/frame, any frame replays byte-identically). Sparkles twinkle in place (GIF delta = a few pixels — the cheap tier); confetti flies a ballistic arc and SETTLES into a twinkle at `burstFrames` (finite churn doctrine — unbounded or over-budget confetti trips **`TM_PARTICLE_CHURN`**). `randomFor`/mulberry32 only — never `Math.random`.
- **Forever reel (Bet E).** `<Banner loop>` + `enter="wrap"` (or `exit="wrap"`) on the LAST scene appends a crossfade tail into scene 1's frozen frame-0 layer — at the final wrap frame the leaving node DROPS, so frame 0 and the last frame are **byte-identical by construction** (`report.seam.mode === "exact"`; the golden composition proves it). An unwrapped loop banner now earns a coded **`TM_LOOP_SEAM`** finding pointing at the fix. Looping banners default their poster to frame 0 — the landing frame.
- **X-ray (Bet F).** `renderReactBanner({ explain: true })` / CLI `--explain` attaches `report.explain`: every frame attributed to channels (opacity / transform / clip / layout / paint / text / structure) with cheap-vs-expensive churn ranges — the size-budget instrument. **`takumi-motion storyboard <file>`** renders a labeled PNG contact sheet of the whole timeline (cells rasterized by the engine, the sheet itself a takumi document) + sidecar JSON — choreography at a glance.
- **Trust.** The golden harness gained four compositions (data-kit, morph-flip, material-particles, wrap-loop) — every bet locked behind byte-determinism. v0.8 composition hashes unchanged: zero regressions. 502 tests, tsc strict.

**What v0.7 adds — the motion language release (the Reanimated borrow)**

v0.6 made *content* authoring fast. v0.7 completes the trilogy with *motion* authoring: how things arrive and leave. The shapes are borrowed from [Reanimated](https://github.com/software-mansion/react-native-reanimated) — its most-loved authoring surface — re-derived on a frame-indexed, deterministic core (their reactive machinery needs threads and gestures; our purity is the product). Performance was a design constraint: every per-frame resolver benches in the hundreds of nanoseconds, settled frames emit **no style overrides at all** (the chunk-merger collapses identical frames), and parse caches make color interpolation ~0.5µs/frame.

```tsx
import { Animated, Keyframes, FadeInDown, FadeOutLeft, BounceIn, staggered, springPresets, Easing, interpolateColorFor } from "takumi-motion/react";

<Scene duration={60}>
  {/* Reanimated's entering/exiting — frame-indexed, anchored to the scene window */}
  <Animated entering={staggered(FadeInDown.duration(18), 3, { intervalFrames: 2 })}
            exiting={FadeOutLeft.duration(10)}>
    <Keyframes frames={{
      0:  { opacity: 0, scale: 0.8 },
      15: { opacity: 1, scale: 1, easing: "backOut" },   // easing INTO this stop
      45: { opacity: 1 },                                 // fill-forward hold
      59: { opacity: 0, easing: "easeIn" },
    }}>
      <span style={{ fontSize: 40, fontWeight: 700 }}>v0.7</span>
    </Keyframes>
  </Animated>
</Scene>

// Perceptual color interpolation — OKLCH default, hue takes the short path
const bg = interpolateColorFor(frame, [0, 45], ["#0f172a", "#1d4ed8"]);

// Physics with a FINITE answer — the question Reanimated can't ask
const settle = springSettleFrames(30, springPresets.bouncy);  // "how many frames?"
```

- **`<Animated entering exiting>` + 26 presets (Bet A).** `FadeInDown`, `ZoomIn`, `SlideInLeft`, `BounceIn`, and their exits — all **pure-data descriptor factories** with Reanimated's chainables (`.duration(f) .delay(f) .springify("bouncy") .damping(n) .stiffness(n) .velocity(v)`). Entering resolves from scene-local frame 0 (hidden before it starts, **no overrides after it settles**); exiting anchors so it ends exactly as the scene window closes; `staggered(preset, index)` bakes stagger slots. For your own elements: `useEntering(desc)` / `useExiting(desc)`. Custom presets: `defineTransition({ side, channels, durationFrames, easing })` — channels are `opacity/x/y/scale/rotate`, the 2D subset takumi renders.
- **`<Keyframes frames={{...}}>` (Bet B).** CSS-`@keyframes`/Reanimated-`Keyframe` semantics on native rails: properties **fill forward** between declaring stops, `easing` on a stop applies to the segment arriving at it (per property), numbers lerp, **colors mix in OKLCH**, transform channels (`x y scale rotate`) interpolate part-wise. Parsed once per authoring object (WeakMap), resolved per frame in O(props).
- **`interpolateColorFor` + `mixColor` in OKLCH (Bet C).** Perceptually uniform mixing — a 50/50 red/yellow mix is *orange*, not brown. Hue travels the short path; greys don't swing through random hues; `srgb` and `srgb-linear` spaces remain available. 148 named colors parse; output is takumi-safe `rgb()` with integer channels (the palette quantizer rounds anyway — integer output keeps chunk-merge effective). The compile-path `mixColors` is frozen (v0.6 byte-determinism); this is the new authoring surface.
- **Spring hygiene — borrowing from Reanimated's *weakness* (Bet D).** Reanimated springs are open-ended; a GIF is finite. `springSettleFrames(fps, options)` answers "when is this spring visually done?" (memoized); `overshootClamping` clamps to `[from, to]`; six named presets (`snappy bouncy gentle wobbly stiff slow`) spread into any spring. And the new lint pays for itself immediately: **`TM_TRANSITION_UNSETTLED`** fires when an entering/exiting descriptor cannot complete inside its scene window — enter still moving at the last frame, or exit starting before the window opens — with the settle math in the message.
- **The `Easing` namespace (Bet E).** `Easing.out(Easing.back(1.7))`, `Easing.bezier(…)`, `Easing.poly(n)`, `Easing.elastic(b)`, `Easing.steps(n, "start"|"end")`, `Easing.in/out/inOut` — RN's exact factory semantics (base curves are in-shaped; `in` is the identity), backed by the same motion-ported solver the named strings use. `bounceIn/bounceOut/bounceInOut` join the named easing set.
- **Performance doctrine (the constraint, measured).** `resolveTransitionAtFrame` ≈ 0.6µs, `springFor` ≈ 4.7µs, `interpolateColorFor` ≈ 0.5µs (warm), `springSettleFrames` memoized ≈ 0.4µs — against a 33ms frame budget. A 155-frame three-scene banner at 640×200 renders in ~0.6s wall. All values are r6-rounded so the chunk-merger keeps collapsing; settled descriptors emit null → zero overhead after arrival. `scripts/proof-v07.mts` prints the numbers.

**What v0.8 adds — the choreography release (the grammar & the stagecraft)**

> **v0.8.1 — the reel fixes.** The v0.8 demo reel surfaced four real defects, all fixed here: (1) **chain opacity continuity** — a chain segment with no opacity channel seeded `null`, so the first opacity preset after it (e.g. `ZoomIn` after a pure slide) replayed `opacity: [0,1]` and blinked the element invisible; worse, the `carryVelocity()` rebuild spread the *raw* segment and discarded the patch — both fixed, `continuityFrom` now seeds at 1 after opacity-less segments and carry segments spread the patched descriptor. (2) **`<Camera transformOrigin>`** — a center-origin push-in shoved left-parked content off the canvas edge (scale 1.1 moves x=64 to x≈-1 at 1280w); cameras now take any CSS origin. (3) **`<Typewriter>` cursor** — the default glyph `▌` renders as tofu in fonts that lack U+258C (Sora does); the cursor is now a font-independent em-sized block span whose *opacity* blinks (no reflow), with `cursorChar` kept as the legacy opt-in and `cursorColor` new. (4) **finite shake** — `<Camera shake durationFrames>` decays the tremor linearly to an exact rest, so impact shakes settle and the encoder merges the tail. `fontVariantNumeric` joined the verified style allowlist. The demo reel itself was re-choreographed: no static dead frames anywhere (a blinking caret and beat staggering replace the v0.8 reel's 1.5–2 s freezes), the arc rides *under* the title instead of through it, stat columns are fixed-width so counting digits can't reflow siblings, and a persistent cue-driven scene indicator makes the four scenes explicit.

v0.7 gave every element its *words* (entering/exiting, keyframes, color). v0.8 gives scenes their *grammar* — how motions chain, hand off momentum, and land on labeled beats — plus the *stagecraft* (camera, paths, organic noise) and the trust machinery that keeps all of it provably deterministic. Performance stays a design constraint: chains compile once per (instance, fps) into window tables, per-frame resolution is the same O(1) math a plain descriptor costs, paths flatten to memoized arc-length tables, and noise is pure seeded math.

```tsx
import { Animated, Camera, Wiggle, FollowPath, chain, hold, cascadeExit, useCue, FadeInDown, ZoomIn } from "takumi-motion/react";

<Scene duration={90} label="intro">                       {/* ← labels are plan data */}
  <Camera pushIn={{ from: 1, to: 1.1 }} shake={{ amplitude: 2, seed: 7 }}>
    <Animated entering={chain(                            {/* ← the sequence grammar */}
      SlideLinear,                                        //   tween producer…
      hold(6),                                            //   …frozen landing…
      ZoomIn.springify({ stiffness: 170, damping: 11 })   //   …physics receiver
        .carryVelocity(),                                 //   …with inherited momentum
    )}>
      <FollowPath d="M 0 80 C 120 0 240 160 360 40" durationFrames={48} rotate="auto">
        <Wiggle amplitude={3} seed="drift"><Badge /></Wiggle>
      </FollowPath>
    </Animated>
  </Camera>
</Scene>

const at = useCue("intro + 12f");                          // cue expressions, plan-resolved
```

- **The sequence grammar (Bet A).** `chain(...segments)` plays transition descriptors back-to-back with `hold(f)` gaps — a chain IS an entering/exiting descriptor (same resolution contract: start state before, **null after**, chunk-merge intact). Opacity continuity is built in: a chained preset that starts transparent continues the previous end-state opacity instead of blinking. **`carryVelocity()`** is the deferred v0.7 Bet F — the previous segment's terminal progress-velocity (one-frame finite difference, deterministic) injects into a physics-defined spring receiver. Physics honesty is linted, not silent: `TM_VELOCITY_DROPPED` reports settled producers, springless receivers, and time-defined receivers (the solver ignores velocity for duration-based springs — the message teaches the fix). **Labels + cues**: `<Scene label="intro">` registers plan-resolved start frames; `useCue("intro + 12f")` / `resolveCue()` place any beat by name (`end-10f` works too; unknown labels throw with the known list).
- **`<FollowPath>` motion paths (Bet B).** Travel any subtree along an SVG path (M/L/H/V/C/S/Q/T/Z — arcs throw with a hint) at **constant speed by construction** (arc-length parameterization — the thing offset-distance percentages can't do), with `rotate:"auto"` tangent orientation. The path flattens ONCE per `d` string into a cumulative arc-length table; per-frame lookup is a binary search. Baked as translate/rotate tracks, so it composes with Animated/Keyframes/Camera through the one pipeline.
- **The organic pack (Bet C).** `wiggleFor(seed, frame, {amplitude, frequency})` — After-Effects-wiggle shape, built on the v0.3 seed doctrine (`mulberry32` → `noiseFor`), O(1) per frame, byte-deterministic across machines. `<Wiggle>` wraps a subtree; `<Camera shake>` is literally the same noise applied to the camera. And the frame grid gets a voice: **`TM_NOISE_ALIASED`** fires when `frequency > 0.5` lattice cells per frame — motion the output's Nyquist limit cannot represent, diagnosed once per capture.
- **`<Camera>` — the virtual camera (Bet D).** `pushIn` (Ken Burns), `pan`, `shake`, and roll as root-transform choreography on one wrapper div — zero layout cost, canvas coordinates preserved inside. Transform order is translate → rotate → scale, so the push zooms the already-panned frame.
- **Exit choreography + tempo (Bet E).** `cascadeExit(preset, index, count)` — unit 0 leaves first and every unit still lands hidden exactly at the scene close. `<Banner tempo={1.5}>` stretches composition time at the capture driver (output frame *f* sees authored frame `floor(f × tempo)` — scenes, overlaps and layers all speed up uniformly; the declarative path gets `scaleTimeline()`).
- **Throughput & trust (Bet F).** The **golden-frame harness** (`tests/golden.test.tsx`): canonical compositions render twice and must be byte-identical (HTML + full Rust GIF bytes), with stored hashes in `tests/golden/golden-hashes.json` — `UPDATE_GOLDEN=1` regenerates after *intentional* changes; a hash diff IS a behavior diff. **Windowed render**: `renderReactBanner({ fromFrame, toFrame })` / CLI `--from N --to N` renders only an output-frame subrange (fast partial previews — capture, parse, audit and encode all shrink). Encoding was already parallel (Rust rayon) and chunk-parsing bounded-parallel (v0.5); v0.8's parallelism is *windowed* parallelism — N partial renders are independent pure captures.

**What v0.6 adds — the authoring experience release**

v0.5 made the engine compose. v0.6 makes *authoring* fast and mistake-proof — without touching the output surface or the engine:

- **The authoring lint (Bet A).** The known silent-failure classes are now **coded warnings in the report** (`report.lint: LintWarning[]` — audit-as-data, extended to authoring). React 19 serializes kebab-case style keys but skips its unitless table, so `"font-weight": 700` becomes `font-weight:700px` — invalid CSS that takumi **rejects outright**; the lint catches it in the style object AND in the captured markup (`TM_KEBAB_STYLE`, with a did-you-mean hint). Also: `TM_NAN_STYLE` (non-finite values leaked into styles), `TM_EMPTY_STYLE` (every declaration dropped), `TM_SPRING_DURATION` (a declarative spring track carrying a `duration` — silently ignored), `TM_FONT_NETWORK` (reproducibility), `TM_GLOW_GIF_DITHER` (blur + GIF at dpr 1 — the #1 size trap), `TM_FITTEXT_UNMEASURED`. Stable `TM_*` codes — render them in your own tooling, CI can fail on specific codes. CLI human output prints the findings; `--json` carries them.
- **Type-level style safety (Bet C).** `TakumiStyle` — the takumi-verified property map as a TypeScript type. Author with `style={{ fontSize: 32 } satisfies TakumiStyle}` and unsupported/mis-cased keys become compile errors. `SUPPORTED_STYLE_PROPS` / `UNITLESS_STYLE_PROPS` are the same lists as runtime data.
- **Content components (Bet C).** `<Fill>` — the AbsoluteFill convenience (absolute inset-0 **flex** container; takumi only applies alignment under explicit `display:flex` — Fill bakes that in). `<Img>` — images with sync `Buffer → data:` conversion plus an async `imageDataUriFromFile()` helper for the deterministic path. `<FitText>` — measure-exact auto-fitting text: the largest size whose takumi-measured width fits `maxWidth`; **overflow becomes impossible by construction**. Fitting is async in takumi but React render is sync — the capture runtime prewarms a fit cache (each scene renders once, requests resolve in one batch with the banner's fonts loaded), so `<FitText>` reads exact sizes synchronously in the frame loop.
- **The kinetic kit (Bet F).** `<CountUp to format>` — deterministic number animation (tween or spring); `<Typewriter text cursor>` — per-frame character gating with a loop-safe blinking cursor; `<Glow x y size color>` — the ambient glow blob with the size-doctrine defaults baked in (low opacity, moderate blur). All live in `takumi-motion/kit` (+ the root and `/react` barrels), all pure functions of the frame.
- **Engine-exact filmstrip preview (Bet B).** `takumi-motion render banner.tsx --filmstrip` (or `renderFilmstrip()` on any source path) writes a self-contained contact-sheet HTML where every cell is a **real Rust-rendered still** — not the CSS-approximation player, the actual pixels. `--filmstrip 0,15,30` picks frames; `--filmstrip 8` takes 8 evenly spaced. Byte-deterministic artifact — diffable in review, stable in CI.
- **Timeline transforms + plan hardening (Bet E).** `shiftTimeline(json, deltaMs)` / `concatTimelines([...])` — the declarative path's answer to `<Sequence>`/`<Series>`: move whole timelines, compose them back-to-back. `planRound()` pins the scene-overlap grid against float dust (`250ms @ 30fps` = exactly 7.5 frames — ties round toward less overlap, deterministically).
- **Init that dogfoods (Bet D).** `takumi-motion init --react` scaffolds a banner using `Fill`/`FitText`/`CountUp`/`Glow`/`Series` **plus its own `tsconfig.json`** (the tsx loader only honors a tsconfig whose `include` matches the file — the scaffold is self-contained and renders out of the box).

## What v0.5 adds — the composition & stills release

v0.4 made the engine general. v0.5 makes it compose — and makes the single frame a first-class output:

```tsx
// Series auto-stacks windows (no cursor math) · Loop repeats · SplitText staggers
<Banner width={960} height={240} fps={30}>
  <Series>
    <Series.Sequence durationInFrames={75} enter="crossfade" exit="crossfade">
      <SplitText text="v0.5 ships" by="chars" renderUnit={(u, { frame, fps }) => (
        <span style={{ display: "inline-block",
          opacity: staggeredSpringFor(u.index, frame, fps, { intervalFrames: 2 }),
          transform: `translateY(${(1 - staggeredSpringFor(u.index, frame, fps)) * 22}px)` }}>
          {u.text}
        </span>
      )} />
      <Loop durationInFrames={12}>{(i) => <Ticker iteration={i} />}</Loop>
    </Series.Sequence>
    <Series.Sequence durationInFrames={75} enter="crossfade">…</Series.Sequence>
  </Series>
</Banner>
```

```ts
// and the single frame — og images, cards, posters — on every source path:
const og = await renderStill({ html: cardHtml, width: 1200, height: 630 });
const f40 = await renderStill({ banner: MyBanner, frame: 40 });   // byte-identical to the poster
```

- **`<Series>` auto-stacking (Bet 1).** `<Series.Sequence durationInFrames>` items stack back-to-back in declaration order — no manual cursor math. They flatten into the SAME planner `<Scene>` uses, so `enter`/`exit` transitions, overlap clamps and crossfade synthesis carry through unchanged. `<Series>` mixes freely with `<Scene>` and `<Layer>`.
- **`<Loop>` repeated windows (Bet 2).** `<Loop durationInFrames times>` rebases its subtree to `frame % durationInFrames` while the parent frame is inside the span (render-prop children receive the iteration index; `times` omitted = loop until the scope ends). Loops nest inside `<Sequence>` and each other — everything stays a pure function of the frame.
- **Kinetic text kit (Bet 3).** `splitText(text, "chars" | "words")` — deterministic units (surrogate pairs stay whole); `staggerDelay(index, { intervalFrames, startFrames })`; `staggeredSpringFor(index, frame, fps, opts)` = a spring delayed by the unit's stagger slot; `useStaggeredSpring(index, opts)` hook; and `<SplitText text by renderUnit>` — per-character/per-word choreography in three lines, also usable outside the runtime.
- **`renderStill()` — the single-frame path (Bet 4).** OG images, cards, posters: `{ banner }`, `{ html, css }` or `{ node, timeline }` in → one PNG out, at any frame of the timeline (default: the settled 60% frame). The React still is **byte-identical to the pipeline poster** for the same frame. CLI: `takumi-motion render banner.tsx --still [frame]` — og-image mode with the same surface flags (`--width --height --dpr --background`).
- **Bounded-parallel pipeline (Bet 5).** Every napi stage now overlaps: chunk parsing, extent measurement, sequence-frame rendering and sprite-sheet cells all run under a `concurrency` cap (default: available cores, ≤ 8). The invariant is golden-tested: **output is byte-identical at any concurrency** — only wall-clock changes. `report.timings` breaks the render into capture / parse / audit / encode / total (JSON-serializable, CLI `--json` carries it).

## What v0.4 adds — the general engine release

v0.3 made React-authored banners possible. v0.4 removes the banner constraint: **the output surface, the inputs, and the outputs are all yours to specify.**

- **Unconstrained output surface (Bet 1).** `width` / `height` / `dpr` / `fps` / `duration` / `formats` / `quality` / `lossless` / `background` / `budgetBytes` are user-given everywhere — as `<Banner>` props, as pipeline options, and as CLI flags (`--width --height --dpr --background --quality --lossless`). Precedence: explicit option > component prop > preset. `background: "transparent"` produces a true alpha canvas (GIF binary transparency + alpha WebP/APNG). `resolveSurface()` is the pure merging function if you need it.
- **Time-control vocabulary (Bet 2).** `<Sequence from durationInFrames speed reverse>` — a time-remapped window whose subtree sees a rebased frame context (outside the window it renders nothing; `speed` and `reverse` compose); `<Freeze at={n}>` — a frozen island that renders the same output on every timeline frame; `useNoise(seed, { amplitude, frequency })` + `noiseFor()` — deterministic value noise for organic drift; `interpolate(value, inputRange, outputRange, { easing, extrapolateLeft/Right })` — the frame-agnostic Remotion-style mapper, exported from the root.
- **Output extensions (Bet 3).** `sequence: true` exports every frame as a numbered PNG plus a `frames.json` manifest (with the exact ffmpeg one-liner — the pressure valve for "video" without the engine taking on codecs). `spriteSheet: { columns, every }` renders the timeline into one atlas PNG + metadata JSON (zero-dependency deterministic PNG encoder; cells stream into a preallocated buffer, memory-bounded with a hard pixel ceiling). Both work on every source path.
- **Embeddability (Bet 4).** `renderWithAudit(options)` → `{ report, audit, exitCode, formatted }` where `audit` is pure JSON: resolved surface, per-file budget verdicts, extent findings (hard failures counted), loop-seam verdict, and a **byte-determinism probe** (the whole render runs twice and posters are compared). `exitCode`: 0 pass · 1 content failure · 2 over budget — CI as data. Subpath exports: `takumi-motion`, `/react`, `/audit`, `/fonts`, `/recipes`. Every CLI flag maps 1:1 to a library option, and `--json` prints the full report as JSON (buffers stripped) — drive the CLI from scripts.
- **Input extensions (Bet 5).** `renderHtmlAnimation({ html, css, … })` — raw HTML fragment + stylesheet strings (style rules and `@keyframes`) straight into the engine; full documents have their `<body>` extracted and `<style>` blocks hoisted. `loadFontFiles(renderer, [{ source: path | url | buffer, family, weight, style }])` — local/URL/raw TTF-OTF registration alongside the Google Fonts pipeline.
- **Engine performance (Bet 6).** Formats encode concurrently (napi tasks + Rust's rayon-parallel frames); `parallel: false` restores strict ordering. Sequence export writes frames one at a time (a 60s 1080p sequence never holds more than one frame buffer) and renders identical chunk-frames ONCE, re-writing the bytes — hold-heavy banners pay encoding cost once, disk cost per frame.

## What v0.3 added — the React scene runtime

v0.2 made banners correct and cheap. v0.3 removes the expressiveness ceiling: **write complex, state-driven, multi-scene animations as ordinary React components** — conditionals, derived values, state machines, arbitrary JS math per frame — and still get deterministic server-side GIF rendering.

- **Frame-driven React.** The runtime renders your component tree once per frame with `<FrameContext>` carrying scene-local time. `useCurrentFrame()` restarts at 0 per scene (Remotion convention); `useAbsoluteFrame()` sees the global grid. Hooks: `useSpring`, `useInterpolate`, `usePulse`, `useSmoothPulse`, `useRandom`, `useDuration`, `useFps` — all pure functions of the frame.
- **Real state, replayed deterministically.** `useFrameState(reducer, initial, events)` declares which actions fire on which frames; the hook replays the reducer from frame 0 to the current frame on every render. You get genuine state-machine semantics (counters, scene transitions, accumulation) that stay a pure function of `(frame, props)` — any frame renders in isolation, and output is byte-stable.
- **Determinism doctrine, enforced.** `Math.random()` is shimmed to a seeded PRNG during capture (one warning); `useRandom(seed)` is the explicit, warning-free path. Scene render = pure function of frame — no clock, no events.
- **Multi-scene composition on takumi's native encoder.** `renderAnimation` accepts a *sequential scene list* — each with its own node tree — which v0.2 never used. `<Scene duration enter exit>` maps onto it 1:1. Transitions (`crossfade`, `slide`, `rise`) are composite frames: the director renders BOTH subtrees absolutely stacked and animates opacity/offset while both keep playing. Overlap clamps guarantee never three scenes at once; scenes too short degrade to cuts with a warning.
- **Structural chunking (hold-collapse, generalized).** Consecutive frames with byte-identical HTML merge into one scene chunk; the encoder then samples static trees cheaply, and the v0.2 GIF hold-collapser merges the rest. A static 10-frame scene becomes one 500 ms GIF frame. State-heavy banners (per-frame drift) cost more unique frames — the report tells you exactly how many (`scenes → chunks (holds merged)`), and WebP carries drift far cheaper than GIF.
- **The Safety Net extends for free.** Every unique chunk's measured tree is audited (takumi's `measure()` — transforms are absolute canvas coordinates): text nodes crossing the canvas hard-fail (`TEXT WILL CLIP`), decorative boxes warn at the 8px safe zone, loop banners get a seam verdict (frame 0 vs last frame, byte-exact). `takumi-motion check` gates it in CI with exit codes.
- **Preview plays the exact capture.** `takumi-motion preview banner.tsx` writes a standalone HTML player containing the captured frames themselves — pixel-faithful to the export by construction (scrubber, scene ruler with enter-overlap marks, hold visualization, seam comparison, warnings HUD). No server, no bundler, no React in the page.
- **`init --react`** scaffolds a working multi-scene banner.tsx; the CLI auto-detects React exports (`defineBanner()` components and `<Banner>` elements) alongside the v0.2 template factories, and resolves the nearest `jsx: react-jsx` tsconfig for you.

## What v0.2 added (declarative path)

- **Google Fonts, exposed.** `font: "Space Grotesk"` (or full `{ name, weight, style, generic }` specs). Loads through takumi's css2 pipeline, registers on the shared renderer with per-subset dedup — the *same face* that measure-fits text renders it.
- **Themes** (7), **motion personalities** (`snappy | smooth | playful | mechanical`), **per-glyph orchestration** (`cascadeBanner`, `revealRow` / `revealUnits` / `waveUnits`).
- **GIF hold collapsing** via windowed ambient motion — real banners shed 40–60% of GIF bytes at zero visual cost; WebP dedupes natively.
- **Kit output** (`--kit`): readme GIF+WebP + retina WebP + lean GIF + poster + **static twin** (the `prefers-reduced-motion` fallback).
- **Zero-server preview** for baked keyframes; **`check`** as a CI gate (extents + seam energy + budgets, exit 1 on error).

## Why

GitHub READMEs are the one place animated images render reliably, forever — and the existing tools are static headers (capsule-render) or single-template toys (typing SVGs). `takumi-motion` gives banners **full CSS layout, real spring physics, and now real React composition** — as a deterministic build step you can commit. Same input → same bytes, every time (golden-tested).

## The React runtime, in depth

**Composition contract.** `<Banner>` children must be `<Scene>` / `<Layer>` elements (validated with targeted errors). `<Scene duration={frames} enter exit>` declares a timed segment; `<Layer top|bottom>` persists across every scene (frame = absolute frame). Durations are FRAMES at the banner fps.

**How a render flows:**

```
defineBanner component (your React tree)
  ├─ PROBE   renderToStaticMarkup once — <Banner> registers resolved meta + scene inputs
  ├─ PLAN    planBanner(): frame-exact windows + overlap clamps (pure, unit-tested)
  ├─ FRAMES  renderToStaticMarkup per frame — <Banner> composes active scene(s),
  │          hands each a FrameContext (scene-local frame), applies enter/exit styles
  ├─ CHUNK   consecutive byte-identical HTML merge into scene chunks
  └─ ENCODE  fromHtml per chunk → renderAnimation({ scenes: [...], css, fps })  ← one napi call
             + per-chunk extent audit + seam verdict + GIF hold collapse + budget report
```

**Transitions.** `enter`/`exit` take `"cut" | "crossfade" | "slide" | "rise"` or `{ kind, ms }` (default 250 ms). An overlap frame renders the leaving scene (fading/sliding out) *underneath* the arriving scene (fading/rising in); both scenes' local clocks keep advancing through the overlap. Overlap size = `max(enter.ms, exit.ms)` in frames, clamped so every scene keeps ≥1 exclusive frame.

**Looping.** Declarative banners loop by construction (strict seam checks at build time). React banners own their loop: if `loop` is declared, the runtime compares frame 0's HTML with the final frame's — byte-identical means a pixel-perfect seam, anything else is a `check` failure. One-shot launch banners just leave `loop` off.

**Costs, honestly.** Capture is ~0.1–0.5 ms/frame (banner-sized trees); layout runs once per unique chunk, not per frame. Per-frame style drift means per-frame unique frames — the GIF encoder can't merge what isn't identical, so drift-heavy banners are WebP territory. The report's `scenes → chunks (holds merged)` line makes the cost visible either way.

## Seamless loops (declarative path)

Built-in templates never fade-pulse: they **enter → hold → exit**, and every animated property returns to exactly its t=0 value before the loop restarts (verified by `checkLoopSeam`, audited by `check`). For hand-rolled timelines:

```ts
import { fadeWrap, checkLoopSeam, alignLoopPeriod, seamEnergy } from "takumi-motion";

const wrapped = fadeWrap(tl.toJSON(), { selector: ".root", inMs: 300, outMs: 300 });
checkLoopSeam(tl.toJSON());      // { seamless: true, mode: "strict" }
seamEnergy(tl.toJSON());         // { energy: 0 } — pixel-identical restart
```

Ambient motion is **windowed**: it moves inside active windows and freezes through holds — which is what makes hold frames byte-identical. Author your own with `ambientWindow()` or the classic `ambient()` mirror helper.

## Built-in templates (declarative)

All templates are `async` (they measure-fit text through the layout engine before composing the timeline), return `{ element, timeline, fonts?, theme?, motion? }`, and share one prop surface: `{ width, height, theme, motion, font, accent, background, fps }`. **Text never overflows**: titles and numbers are fitted with `fitFontSize` (exact widths from Takumi's `measure()`), and the extent auditor holds every template to an 8px safe zone.

| Template | Look |
|---|---|
| `typewriterBanner({ text, tagline, speed, holdMs })` | Typing reveal → hold → terminal backspace; cursor blinks while typing, rests solid while held |
| `countUpBanner({ title, stats, steps })` | Horizontal stat columns; count-up numbers (digit-layer trick) with overshoot underlines |
| `gradientSweepBanner({ title, subtitle })` | Tracking-in title, accent rule, sweep-out exit over paired drifting glows |
| `cascadeBanner({ title, tagline })` | Per-glyph cascade reveal, decelerating stagger — the kinetic-typography flagship |

## Themes & fonts

```ts
import { themes, fontCatalog, ensureFonts } from "takumi-motion";

themes["tokyo-night"];  // { bg, text, textDim, textFaint, surface, accent, glow, font }
fontCatalog.display;    // ["Space Grotesk", "Sora", "Outfit", "Manrope", "Archivo", "Inter"]
fontCatalog.mono;       // ["JetBrains Mono", "IBM Plex Mono", "Space Mono", "Fira Code"]

await ensureFonts(renderer, [{ name: "JetBrains Mono", weight: [400, 700] }]);
```

Backgrounds stay **flat base colors** (GIF palettes dither gradients into noise); color depth comes from drifting glows capped by each theme's `glow` token.

## Presets

| Preset | Canvas | Output | Budget |
|---|---|---|---|
| `readme` | 850×200 @1x, 20fps | GIF + WebP | 2 MB |
| `readme-hd` | 850×200 @2x, 20fps | WebP | 2 MB |
| `readme-lean` | 850×200 @1x, 12fps | GIF | 1.25 MB |
| `readme-profile` | 850×300 @1x, 20fps | GIF + WebP | 2.25 MB |
| `readme-wide` | 1280×300 @1x, 20fps | GIF + WebP | 3 MB |
| `og-card` | 1200×630 @1x, 20fps | GIF + WebP | 4 MB |

Over budget? `--budget 800000` walks a variant ladder (fps steps) and re-renders until the file fits, printing a vite-style table. Custom sizes: pass a `{ width, height, fps, ... }` object wherever a preset name works.

## CLI

```bash
takumi-motion render banner.tsx --preset readme --out ./out        # React banner (auto-detected)
takumi-motion render banner.tsx --width 1080 --height 560 --dpr 2  # any surface (user-given)
takumi-motion render banner.tsx --background transparent --format webp
takumi-motion render banner.tsx --still 18 --width 1200 --height 630  # single-frame PNG (og-image mode)
takumi-motion render banner.tsx --sequence --spritesheet --out ./out   # frames + atlas
takumi-motion render card.html --css style.css --width 1200 --height 630  # raw HTML path
takumi-motion render card.html --still --width 1200 --height 630      # raw HTML still
takumi-motion render banner.ts  --kit --out ./assets               # declarative asset set
takumi-motion render banner.tsx --budget 800000                    # variant ladder
takumi-motion render banner.tsx --json                             # full report as JSON (scripts/embedders)
takumi-motion render banner.tsx --filmstrip 0,15,30                # engine-exact contact sheet (v0.6)
takumi-motion storyboard banner.tsx --frames 12 --columns 4         # labeled PNG contact sheet + JSON (v0.9)
takumi-motion render reel.tsx --data metrics.json --explain         # data channel + per-frame X-ray (v0.9)
takumi-motion check  banner.tsx --preset readme                    # extents + seam + size → CI gate
takumi-motion preview banner.tsx -o banner-preview.html            # exact captured frames, no server
takumi-motion init [--react]                                       # scaffold banner.ts(x)
takumi-motion templates | presets | fonts                          # catalogs
```

Every render flag maps 1:1 to a library option (CLI = thin skin over the API — that's the embeddability contract). React exports are auto-detected: a `defineBanner()` component or a `<Banner>` element goes to the React runtime; template factories keep v0.2 semantics; `--react` forces the runtime for unmarked function components. The loader walks up from your file to find a `tsconfig.json` with `"jsx": "react-jsx"` — banner files can live anywhere in your repo. (Dev note: run the CLI through the installed bin / `dist/cli.js` when your module imports `takumi-motion` itself — that guarantees the runtime and your module share one module graph.)

`check` prints per-chunk extent findings (hard fail vs decorative warning), the seam verdict, and size budgets — wire it into CI and a banner that clips its text, jumps at the seam, or busts its budget *cannot ship*:

```yaml
# .github/workflows/banner.yml
- run: npx takumi-motion check banner.tsx --preset readme --out ./assets
- run: npx takumi-motion render banner.tsx --preset readme --out ./assets
```

## Architecture

1. **TS authoring layer, two dialects.**
   - *Declarative*: `createTimeline()` (Motion-compatible: springs, inertia, tweens, repeats, staggers, labels) → **TimelineJSON**, a plain object. Templates/themes/personalities compile down to it.
   - *React*: component tree → per-frame capture → structural chunks. Both dialects emit versioned, embeddable artifacts — this is the seam for embedding banners inside OG-image components later.
2. **Rust render layer.** The declarative path bakes CSS `@keyframes` frame-exact; the React path feeds the native sequential scene list. Either way, one `renderAnimation` call samples every frame inside Takumi's engine (rayon-parallel) and streams the encoders. Springs are the exact motion@14.6.0 port (60/60 golden fixtures at 1e-6 — `scripts/extract-fixtures.mjs`).

Works against **published npm versions only**. The upstream-contribution path (native `TimingFunction::Spring`, timeline runner) is documented in `docs/UPSTREAM.md` and deliberately **not engaged yet**.

## Repository layout

```
src/
  types.ts timeline.ts spring.ts inertia.ts easing.ts sampler.ts evaluate.ts
  compile.ts transform.ts render.ts presets.ts loop.ts jsx.ts      # v0.1 core
  fonts.ts themes.ts personality.ts orchestrate.ts                  # v0.2 design system
  audit.ts size.ts preview.ts kit.ts cli.ts                         # v0.2 pipeline
  react/ plan.ts motion.ts context.tsx primitives.tsx transitions.ts
         sequence.tsx series.tsx loop.tsx text.tsx capture.ts index.ts
                                                                    # v0.3+v0.4+v0.5 React runtime
  react-public.ts react-render.ts preview-react.ts                  # v0.3 pipeline
  surface.ts interpolate.ts sequence-export.ts sprite.ts            # v0.4 general engine
  html-source.ts with-audit.ts fonts.ts                             # v0.4 inputs + audit
  still.ts concurrency.ts                                           # v0.5 stills + parallel pipeline
  lint.ts style.ts measure.ts filmstrip.ts timeline-transforms.ts   # v0.6 authoring experience
  react/components.tsx react/kit.tsx                                # v0.6 Fill/Img/FitText + kit
  templates/ typewriter.ts countup.ts sweep.ts cascade.ts shared.ts registry.ts
tests/            # 337 tests: golden fixtures, planner, hooks, capture determinism,
                  # chunking, transitions, integration renders, seams, audits,
                  # Series/Loop/SplitText/stagger, stills, concurrency invariance,
                  # lint codes, filmstrip determinism, kit, FitText lifecycle
examples/         # react-banner.tsx (React showcase) + readme-banner.ts (all templates)
docs/UPSTREAM.md  # upstream strategy (DO-NOT-ENGAGE-YET)
```

## Development

```bash
npm install
npm test        # vitest — 337 tests
npm run build   # tsc → dist/
npx tsx examples/react-banner.tsx    # renders the React showcase into examples/output/
npm run proof:v06                    # the v0.6 proof bar → examples-output/v06/
```

Dependencies: `react` + `react-dom` (the runtime), `tsx` (banner module loader), peer `@takumi-rs/helpers >= 2.17`. Rendering needs the network only for Google Fonts; without it, banners fall back to takumi's bundled Geist.

For TSX banner files outside `src/`, the nearest `tsconfig.json` needs `"jsx": "react-jsx"` (with its `include` matching your file) — `examples/` and `scripts/` ship their own, and `init --react` scaffolds one for new projects.

## What v0.9.1 fixes — the motion-quality pass

Three defects in the v0.9 reel's motion, fixed at the engine level (not demo-level):

- **The morph is rect-channel now.** v0.9's FLIP compensated with non-uniform `scale()`
  — a 380→156px card stretched its text 2.4× mid-flight ("thrashy"), and states with
  different container widths jumped at the switch (prewarm measured at x=0, the real
  render centers). v0.9.1 flies every item through the **position+size channels**
  (interpolated `left/top/width/height`, measured rects, easeInOut) with the container's
  own box interpolating alongside — glyphs stay crisp, dots stay round, centered parents
  glide. New knobs: `staggerFrames` (cascaded flights), `contentSwitchAt` (when item
  content flips from source to target rendering).
- **`enter="push"` — the no-double-exposure transition.** `crossfade` (and even
  `slide`/`rise`) blend BOTH scenes during the overlap — dense scenes ghost through each
  other. `push` slides the arriving scene in from one full canvas-width at FULL opacity
  while the leaving scene slides out in lockstep; the two stay exactly adjacent for every
  frame, so nothing ever superimposes. Declare it on both sides (`enter={{ kind: "push",
  ms: 240 }}` + `exit="push"`). The extent audit exempts transition-overlap chunks.
- **The extent audit knows about scene transitions** (`extents.transitionChunksSkipped`)
  and no longer reports authored full-canvas motion as overflow; the reel's scene-2
  title column got real bottom clearance instead of sitting 2px from the canvas edge.

## Status

v0.9.1 — the motion-quality pass on top: the morph flies through position+size channels (no scale, no jumps), the new `push` scene transition replaces double-exposure crossfades, and the extent audit attributes authored transition motion. v0.9 — the data motion release: chart primitives driven by a first-class data channel (`--data` / `renderReactBanner({ data })`), the measured morph (`<Morph>`) with the `TM_LAYOUT_SHIFT` instrument, the material pack (`<Reveal>` / `<Mask>` / `<VariableText>` / `<GradientText>`), deterministic closed-form particles with a churn doctrine, the forever reel (`enter="wrap"` — byte-exact loop seams, `TM_LOOP_SEAM` when a loop jumps), and the X-ray (`--explain` per-frame attribution + the `storyboard` contact sheet) — layered on v0.8's choreography (chain/hold/carryVelocity, labels + cues, FollowPath, Camera, Wiggle, windowed renders, the golden-frame harness), v0.7's motion language (entering/exiting, Keyframes, OKLCH color), v0.6's authoring experience (coded lint, Fill/Img/FitText, the kinetic kit, filmstrips), v0.5's composition & stills (`<Series>`, `<Loop>`, `<SplitText>`, `renderStill()`, bounded-parallel pipeline), v0.4's general engine (user-given surfaces, time-control vocabulary, sequence/sprite exports, audit-as-data, raw HTML input), and the v0.3 React scene runtime. Banner presets remain as `takumi-motion/recipes` — a recipe, never a constraint. No hosted layer, no platform rails, no ecosystem adapters, no upstream engagement — by design, for now.
