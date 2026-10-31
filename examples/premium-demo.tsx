/** @jsxImportSource react */
// examples/premium-demo.tsx — takumi-motion v0.8.1 "The Choreography Reel"
//
// A 4-scene premium banner exercising the FULL v0.8 surface on one canvas.
// Every scene keeps MOVING until its exit (no dead frames — a static tail
// reads as a broken player), and a persistent cue-driven indicator makes the
// scene structure explicit:
//
//   01 overture   — <Camera> push-in anchored "left center" + <Wiggle> +
//                   chain(SlideFromLeft → hold → spring carryVelocity()) with
//                   opacity continuity (no blink) and a sub-perceptual 2%
//                   scale pickup (no mid-chain snap) + <Typewriter> block cursor
//   02 grammar    — cue-driven accent (useCue("grammar+2f")), kinetic
//                   SplitText, staggered entrances, <Sequence> code line with
//                   a blinking caret (the caret IS the anti-freeze beat)
//   03 stagecraft — <FollowPath> arc under the title with rotate:"auto",
//                   <Keyframes> OKLCH color shift across the whole scene,
//                   <Camera> pan
//   04 finale     — fixed-width <CountUp> columns (digits never reflow the
//                   row), format chips, <ZoomIn> wordmark pop, cascadeExit —
//                   and the reel ENDS ON CONTENT (chips + wordmark persist)
//
// Render (from the package root):
//   npx tsx --tsconfig examples/tsconfig.json examples/premium-demo.tsx
//
// Outputs (plus a windowed preview render demonstrating Bet F's --from/--to):
//   out/premium-demo.gif · .webp · posters · premium-demo-preview.gif

import {
  Banner,
  Scene,
  Layer,
  Animated,
  Camera,
  Wiggle,
  FollowPath,
  Keyframes,
  Sequence,
  CountUp,
  Typewriter,
  Fill,
  SplitText,
  chain,
  hold,
  cascadeExit,
  staggered,
  FadeInDown,
  FadeOut,
  ZoomIn,
  defineTransition,
  useCue,
  useAbsoluteFrame,
  useFrame,
  usePulse,
  staggeredSpringFor,
  defineBanner,
} from "../src/react/index.js";
import { renderReactBanner, formatReactReport } from "../src/react-render.js";

const OUT = new URL("./out/", import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const PHYS_SPRING = { stiffness: 170, damping: 11 } as const;

/** Linear slide — the velocity-carry producer with a real end-slope.
 *  Starts just INSIDE the canvas edge: off-canvas text hard-fails the extent
 *  audit (by design — the audit cannot know opacity), so entrances travel
 *  from the safe zone, not from beyond the edge. */
const SlideFromLeft = defineTransition({
  name: "SlideFromLeft",
  side: "enter",
  channels: { x: [-52, 0] },
  durationFrames: 14,
  easing: "linear",
});

/** The headline chain's last beat: a 2% scale pickup (sub-perceptual at 58px
 *  — no mid-chain snap) that springs to exactly 1 with the slide's carried
 *  momentum, so the landing overshoots ~3% and settles at rest scale 1. */
const SettleBreathe = defineTransition({
  name: "SettleBreathe",
  side: "enter",
  channels: { scale: [0.98, 1] },
  durationFrames: 1,
  easing: "linear",
}).springify(PHYS_SPRING).carryVelocity();

/** The headline chain: slide in → hold the landing → breathe with momentum. */
const HeadlineEnter = chain(SlideFromLeft, hold(6), SettleBreathe);

const headlineStyle = { fontSize: 58, fontWeight: 800, color: "#e2e8f0", letterSpacing: -1 };

/** The cursor-block span (font-independent — a glyph cursor renders as tofu
 *  in fonts that lack U+258C, as Sora does). */
function CaretBlock(props: { color: string; on: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.55em",
        height: "0.9em",
        marginLeft: "0.15em",
        backgroundColor: props.color,
        opacity: props.on ? 1 : 0,
      }}
    />
  );
}

/** Blinking caret component — hooks must live in a COMPONENT (Scene children
 *  are built eagerly in the parent's context; an inline usePulse() there
 *  throws "useFrame outside a scene"). */
function BlinkingCaret(props: { color: string; periodFrames?: number }) {
  const on = usePulse(props.periodFrames ?? 10) >= 0.5;
  return <CaretBlock color={props.color} on={on} />;
}

/** Kinetic word — per-WORD staggered spring rise (SplitText in a row).
 *  Word units (not chars): three big blocks rising read better at banner
 *  scale AND cost ~3× fewer glyph-delta frames than per-character springs —
 *  the v0.8 char version was 15 kB/frame of GIF. */
function KineticWord(props: { text: string }) {
  const { frame, fps } = useFrame();
  return (
    <div style={{ display: "flex", alignItems: "baseline", fontSize: 46, fontWeight: 700, color: "#e2e8f0" }}>
      <SplitText
        text={props.text}
        by="words"
        renderUnit={(unit) => {
          const p = staggeredSpringFor(unit.index, frame, fps, {
            ...PHYS_SPRING,
            from: 14,
            to: 0,
            intervalFrames: 3,
          });
          const reveal = Math.min(1, Math.max(0, (frame - unit.index * 3) / 5));
          return (
            <span
              key={`u${unit.index}`}
              style={{
                display: "inline-block",
                transform: `translateY(${p.toFixed(3)}px)`,
                opacity: reveal,
              }}
            >
              {unit.text}
            </span>
          );
        }}
      />
    </div>
  );
}

/**
 * A cue-gated accent bar — grows exactly when its cue expression fires.
 * Runs inside a <Scene>, so the cue (absolute) is compared against
 * useAbsoluteFrame(), not the scene-local frame.
 */
function CueBar(props: { cue: string; color: string; width: number }) {
  const at = useCue(props.cue);
  const frame = useAbsoluteFrame();
  const t = Math.min(1, Math.max(0, (frame - at) / 12));
  const eased = 1 - Math.pow(1 - t, 3);
  return (
    <div
      style={{
        width: Math.round(props.width * eased),
        height: 6,
        backgroundColor: props.color,
        borderRadius: 3,
        opacity: eased,
      }}
    />
  );
}

/** Persistent-layer version chip — appears on a cue from the FIRST scene. */
function VersionChip() {
  const start = useCue("overture+8f");
  return (
    <div style={{ position: "absolute", top: 36, right: 24 }}>
      <Animated entering={staggered(FadeInDown.duration(12), 0, { startFrames: start })}>
        <div
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#7dd3fc",
            border: "2px solid #155e75",
            borderRadius: 10,
            padding: "4px 14px",
          }}
        >
          v0.8 · choreography
        </div>
      </Animated>
    </div>
  );
}

/**
 * Persistent scene indicator — the reel's chapter marks. Label starts come
 * from the scene labels table (Bet A), the active stop is derived per frame,
 * and the whole strip is a top Layer so it survives every transition.
 * This is also the anti-"how many scenes am I watching" device.
 */
function SceneIndicator() {
  const frame = useAbsoluteFrame();
  const starts = [useCue("overture"), useCue("grammar"), useCue("stagecraft"), useCue("finale")];
  const names = ["overture", "grammar", "stagecraft", "finale"];
  let active = 0;
  for (let i = 0; i < starts.length; i++) {
    if (frame >= starts[i]) active = i;
  }
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 14,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {names.map((name, i) => (
        <div key={name} style={{ display: "flex", alignItems: "center" }}>
          {i > 0 && (
            <div style={{ width: 24, height: 2, marginRight: 10, backgroundColor: i <= active ? "#155e75" : "#1e293b" }} />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: i === active ? "#7dd3fc" : "#334155" }}>
              {`0${i + 1}`}
            </div>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: i === active ? "#e2e8f0" : "#334155" }}>
              {name}
            </div>
            {i === active && <div style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#38bdf8" }} />}
          </div>
          {i < names.length - 1 && <div style={{ width: 10 }} />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The reel
// ---------------------------------------------------------------------------

const PremiumReel = defineBanner(function PremiumReel() {
  return (
    <Banner preset="readme-wide" theme="tokyo-night" fonts={{ name: "Sora", weight: 700 }} fps={20}>
      <Layer top>
        <VersionChip />
      </Layer>
      <Layer top>
        <SceneIndicator />
      </Layer>

      {/* ── Scene 1 · overture — camera + wiggle + chain/carry + typewriter ── */}
      <Scene duration={76} label="overture">
        <Fill>
          {/* Camera is inset-0, so the padding lives on ITS child, not the
              Fill. transformOrigin "left center": a center-origin push-in
              shoves left-parked content off the canvas edge (the v0.8.1
              layout-shift bug — scale 1.1 moves x=64 to x≈-1 at 1280w). */}
          <Camera
            pushIn={{ from: 1, to: 1.1, durationFrames: 56 }}
            shake={{ amplitude: 1.2, frequency: 0.14, seed: "reel", durationFrames: 44 }}
            transformOrigin="left center"
            style={{ paddingLeft: 64, display: "flex", flexDirection: "column", justifyContent: "center", gap: 10 }}
          >
            <div>
              <Animated entering={HeadlineEnter}>
                <div style={headlineStyle}>takumi-motion v0.8</div>
              </Animated>
              <div style={{ height: 14 }} />
              <Wiggle amplitude={2} frequency={0.12} seed="ambient" style={{ display: "inline-block" }}>
                <div style={{ fontSize: 26, color: "#94a3b8", display: "inline-block" }}>
                  <Typewriter text="the choreography release — grammar & stagecraft" durationFrames={32} delayFrames={16} />
                </div>
              </Wiggle>
            </div>
          </Camera>
        </Fill>
      </Scene>

      {/* ── Scene 2 · grammar — labels/cues + stagger + kinetic type ── */}
      <Scene duration={76} enter="crossfade" exit="slide" label="grammar">
        <Fill style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", paddingLeft: 64, paddingBottom: 24, gap: 12 }}>
          <CueBar cue="grammar+2f" color="#38bdf8" width={180} />
          <KineticWord text="words become sentences" />
          {[
            "chain() composes motion back-to-back",
            "carryVelocity() hands momentum on",
            "labels + cues place every beat",
          ].map((line, i) => (
            <Animated key={i} entering={staggered(FadeInDown.duration(12), i, { intervalFrames: 4, startFrames: 8 })}>
              <div style={{ fontSize: 24, color: "#cbd5e1" }}>{line}</div>
            </Animated>
          ))}
          {/* The caret blinks forever — the scene never renders a dead tail.
              Period 16 (8-frame runs): the encoder merges half the frames —
              aliveness without churn. The line FADES in (a bare Sequence
              pop-in is one enormous GIF delta frame). */}
          <Sequence from={30} durationInFrames={46}>
            <Animated entering={FadeInDown.duration(10)}>
              <div style={{ fontSize: 19, color: "#7dd3fc", fontFamily: "monospace", whiteSpace: "pre" }}>
                {"chain(FadeInDown, hold(6), ZoomIn.springify().carryVelocity())"}
                <BlinkingCaret color="#7dd3fc" periodFrames={16} />
              </div>
            </Animated>
          </Sequence>
        </Fill>
      </Scene>

      {/* ── Scene 3 · stagecraft — followPath + OKLCH keyframes + camera pan ──
          Title parked TOP-center, the arc swings BELOW it — the v0.8 path
          flew the badge straight through the headline. The pan (Bet D) lives
          here; the push-in/shake live in scene 1 — fewer simultaneous
          full-frame channels keeps the GIF under budget. */}
      <Scene duration={92} enter="slide" exit="crossfade" label="stagecraft">
        <Camera pan={{ x: [14, -14], durationFrames: 36 }}>
          <Fill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 30 }}>
            <Keyframes
              frames={{
                0: { color: "#38bdf8" },
                24: { color: "#38bdf8", easing: "easeInOut" },
                48: { color: "#f472b6", easing: "easeInOut" },
                72: { color: "#f472b6", easing: "easeInOut" },
                92: { color: "#a78bfa" },
              }}
            >
              <div style={{ ...headlineStyle, color: undefined, fontSize: 64 }}>stagecraft</div>
            </Keyframes>
          </Fill>
          {/* A badge travels a shallow arc under the title, oriented along
              the tangent. Endpoints stay shallow (≤7° tangent) so the rotated
              pill never dips past the bottom edge, and inside the safe zone
              horizontally (x 150..1130). */}
          <FollowPath
            d="M 150 246 C 420 214 860 214 1130 246"
            durationFrames={72}
            delayFrames={4}
            rotate="auto"
            style={{ position: "absolute", top: 0, left: 0 }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#0f172a",
                backgroundColor: "#7dd3fc",
                borderRadius: 999,
                padding: "6px 18px",
              }}
            >
              followPath()
            </div>
          </FollowPath>
        </Camera>
      </Scene>

      {/* ── Scene 4 · finale — count-up + beats + cascade exit choreography ──
          Stat columns are FIXED-WIDTH: proportional digits reflow flex
          siblings every frame while counting (a real layout shift). The reel
          ends on content — chips, wordmark and tagline never exit. */}
      <Scene duration={88} enter="crossfade" label="finale">
        <Fill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 18 }}>
          <div style={{ display: "flex", gap: 24, alignItems: "flex-end" }}>
            {[
              { label: "frame-exact tests", to: 433 },
              { label: "motion presets", to: 26 },
              { label: "lint codes", to: 11 },
            ].map((stat, i) => (
              <Animated
                key={stat.label}
                style={{ width: 220, display: "flex", flexDirection: "column", alignItems: "center" }}
                entering={staggered(FadeInDown.duration(12), i, { intervalFrames: 5, startFrames: 4 })}
                exiting={cascadeExit(FadeOut, i, 3, { intervalFrames: 3 })}
              >
                <CountUp
                  to={stat.to}
                  durationFrames={20}
                  delayFrames={8}
                  spring={PHYS_SPRING}
                  style={{ fontSize: 64, fontWeight: 800, color: "#e2e8f0" }}
                />
                <div style={{ fontSize: 20, color: "#94a3b8" }}>{stat.label}</div>
              </Animated>
            ))}
          </div>
          {/* Beat: format chips (fixed content, cheap GIF deltas). */}
          <div style={{ display: "flex", gap: 12 }}>
            {["GIF", "WebP", "APNG", "stills"].map((chip, i) => (
              <Animated key={chip} entering={staggered(FadeInDown.duration(10), i, { intervalFrames: 3, startFrames: 32 })}>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: "#7dd3fc",
                    border: "2px solid #155e75",
                    borderRadius: 999,
                    padding: "3px 14px",
                  }}
                >
                  {chip}
                </div>
              </Animated>
            ))}
          </div>
          {/* Beat: wordmark pop — ZoomIn reads as intentional on a fresh
              element (mid-chain it reads as a snap; that's why the headline
              chain uses SettleBreathe instead). */}
          <Animated entering={ZoomIn.springify("snappy").delay(46)}>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#e2e8f0", letterSpacing: -0.5 }}>
              takumi-motion
            </div>
          </Animated>
          <div style={{ fontSize: 21, color: "#94a3b8" }}>
            deterministic server-side motion — every frame hash-verified
          </div>
        </Fill>
      </Scene>
    </Banner>
  );
});

export default PremiumReel;
export { PremiumReel };

// ---------------------------------------------------------------------------
// Render: full reel + a windowed preview (Bet F's --from/--to in action)
// (main-guarded so probe scripts can import the component without rendering)
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  const report = await renderReactBanner({
    banner: PremiumReel as never,
    outDir: OUT,
    baseName: "premium-demo",
    posters: [60, 196, 310],
    // The reel's OWN size contract: a freeze-free 4-scene showcase runs
    // ~0.21 MB/s of timeline (the readme-wide 3 MB banner budget calibrates
    // ~0.5 MB/s over a ~6 s single-scene banner). Size-engineered from
    // 4.12 MB: finite shake, word-unit kinetics, opacity cascade, merged
    // holds — every remaining byte is motion, not dead frames. WebP ships
    // ~40% under this line; use it where the budget is hard.
    budgetBytes: Math.round(3.5 * 1024 * 1024),
  });
  console.log(formatReactReport(report));

  const preview = await renderReactBanner({
    banner: PremiumReel as never,
    outDir: OUT,
    baseName: "premium-demo-preview",
    formats: ["gif"],
    fromFrame: 142, // the "stagecraft" scene only — windowed render (v0.8 Bet F)
    toFrame: 234,
    posters: false,
  });
  console.log(formatReactReport(preview));

  console.log(`\noutputs → ${OUT}`);
}
