/** @jsxImportSource react */
// examples/signals-reel.tsx — takumi-motion v0.9 "the signals reel"
//
// A FOREVER LOOP (Bet E): four scenes that end exactly where they began.
// Every v0.9 bet performs on one canvas —
//
//   01 signals   (Bet A)  <LineChart draw="reveal"> + <CountUp format="$,.0f">
//                         fed by signals-data.json through the data channel
//   02 morph     (Bet B)  <Morph> flips the dashboard list → grid, measured
//                         FLIP, TM_LAYOUT_SHIFT clean by construction
//   03 material  (Bet C+D) feathered <Reveal> quote card, <VariableText>
//                         weight swell, <GradientText> wordmark, <Particles>
//                         sparkle burst → settle
//   04 finale    (Bet E)  chips + loop glyph, exit="wrap" — the finale's exit
//                         crossfades into scene 1's frozen frame-0 layer and
//                         the seam lands byte-exact
//
// Render (from the package root):
//   npx tsx --tsconfig examples/tsconfig.json examples/signals-reel.tsx
//
// CLI equivalent (data channel via --data):
//   npx tsx src/cli.ts render examples/signals-reel.tsx \
//     --data examples/signals-data.json --format webp --out out
//
// Outputs: out/signals-reel.webp (hero) · .gif · posters · storyboard.png

import React from "react"; // classic-runtime scope (tsx CLI transforms JSX classic)
import {
  Banner,
  Scene,
  Layer,
  Fill,
  LineChart,
  CountUp,
  Morph,
  Reveal,
  VariableText,
  GradientText,
  Particles,
  useChartData,
  useCurrentFrame,
  useInterpolate,
  useSpring,
  useCue,
  useFrame,
  usePulse,
  smoothPulseFor,
  staggeredSpringFor,
  defineBanner,
  type ChartData,
} from "../src/react/index.js";
import { renderReactBanner, formatReactReport } from "../src/react-render.js";
import { renderStoryboard } from "../src/storyboard.js";
import { readFileSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url).pathname;

const CANVAS = { width: 850, height: 200, fps: 24 };
const ACCENT = "#38bdf8";
const VIOLET = "#a78bfa";
const TEXT = "#e2e8f0";
const DIM = "rgba(148,163,184,0.85)";

// ---------------------------------------------------------------------------
// Scene 01 — signals: the chart knows the numbers (Bet A)
// ---------------------------------------------------------------------------

function SceneSignals() {
  const data = useChartData<{
    mrr: number;
    delta: number;
    revenue: ChartData;
  }>("signals");
  const frame = useCurrentFrame();

  return (
    <Fill style={{ flexDirection: "column", alignItems: "flex-start", justifyContent: "center", padding: "0 44px", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        {/* Fixed-width counter: the string grows $0 → $128,400 — reserve the
            final width so the delta chip never gets pushed (TM_LAYOUT_SHIFT
            doctrine: reserve the space up front). */}
        <div style={{ width: 244, flexShrink: 0 }}>
          <CountUp to={data.mrr} format="$,.0f" durationFrames={64} delayFrames={10}
                   style={{ fontSize: 44, fontWeight: 800, color: TEXT }} />
        </div>
        <div style={{
          fontSize: 16, fontWeight: 700, color: "#34d399",
          opacity: useInterpolate([30, 40], [0, 1]),
        }}>
          +{Math.round(data.delta * 100)}% MoM
        </div>
      </div>
      <div style={{ fontSize: 13, color: DIM, letterSpacing: 0.4, opacity: useInterpolate([6, 14], [0, 1]) }}>
        monthly recurring revenue — live from metrics.json
      </div>
      <LineChart
        data={data.revenue}
        draw="reveal"
        drawDurationFrames={52}
        drawDelayFrames={18}
        width={520}
        height={92}
        strokeWidth={3}
        area
        grid
        showPoints
      />
    </Fill>
  );
}

// ---------------------------------------------------------------------------
// Scene 02 — morph: measured FLIP between two dashboard layouts (Bet B)
// ---------------------------------------------------------------------------

const MORPH_ITEMS = ["acme", "northwind", "lumen", "vertex"];

function SceneMorph() {
  const frame = useCurrentFrame();
  const headingOpacity = useInterpolate([0, 8], [0, 1]);

  return (
    <Fill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 16 }}>
      <Morph
        from="list"
        to="grid"
        switchFrame={22}
        durationFrames={18}
        staggerFrames={2}
        contentSwitchAt={0.85}
        morphKey="signals-dashboard"
        itemIds={MORPH_ITEMS}
        renderItem={(id, state) => (
          <div style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: state === "grid" ? "column" : "row",
            alignItems: state === "grid" ? "flex-start" : "center",
            justifyContent: state === "grid" ? "center" : "flex-start",
            gap: 6,
            padding: 6,
            backgroundColor: "rgba(148,163,184,0.10)",
            borderRadius: 10,
            boxSizing: "border-box",
          }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: id === "acme" ? ACCENT : VIOLET, flexShrink: 0 }} />
            <div style={{ fontSize: 12, fontWeight: 700, color: TEXT, whiteSpace: "pre" }}>{id}</div>
            {state === "list" && (
              <div style={{ fontSize: 10.5, color: DIM, marginLeft: "auto", whiteSpace: "pre" }}>+{18 + id.length * 3}%</div>
            )}
          </div>
        )}
        containerStyle={{
          list: { display: "flex", flexDirection: "column", gap: 8, height: 144 },
          grid: { display: "flex", flexWrap: "wrap", gap: 8, width: 320, height: 144, alignContent: "flex-start" },
        }}
        itemStyle={{
          list: { acme: { width: 380, height: 30 }, northwind: { width: 380, height: 30 }, lumen: { width: 380, height: 30 }, vertex: { width: 380, height: 30 } },
          grid: { acme: { width: 156, height: 54 }, northwind: { width: 156, height: 54 }, lumen: { width: 156, height: 54 }, vertex: { width: 156, height: 54 } },
        }}
      />
      <div style={{ fontSize: 13, fontWeight: 700, color: DIM, letterSpacing: 1.2, lineHeight: 1.2, opacity: headingOpacity, whiteSpace: "pre" }}>
        SAME TEAM. NEW SHAPE.
      </div>
    </Fill>
  );
}

// ---------------------------------------------------------------------------
// Scene 03 — material: surfaces + particles (Bet C + D)
// ---------------------------------------------------------------------------

function SceneMaterial() {
  const frame = useCurrentFrame();
  const quoteSpring = useSpring({ duration: 500, bounce: 0.1, delayFrames: 4 });
  const burst = 26; // confetti settles into a twinkle — finite churn

  return (
    <Fill style={{ alignItems: "center", justifyContent: "center" }}>
      <Particles count={20} mode="sparkle" seed="signals-dust" opacity={0.55} twinklePeriodFrames={16} />
      <Particles count={22} mode="confetti" seed="signals-burst" burstFrames={burst} speed={2.6}
                 colors={[ACCENT, VIOLET, "#f472b6"]} opacity={0.85} />
      <Reveal wipe="up" feather={22} drawDurationFrames={26} drawDelayFrames={6}
              style={{ width: 560, height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <div style={{
          fontSize: 26, fontWeight: 600, color: TEXT, textAlign: "center",
          transform: `scale(${(0.96 + 0.04 * quoteSpring).toFixed(4)})`,
          whiteSpace: "pre",
        }}>
          {"“the animation knows the numbers.”"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Fixed width: the weight swell widens "signal" — reserve the box. */}
          <div style={{ width: 58, flexShrink: 0 }}>
            <VariableText text="signal" from={300} to={800} durationFrames={34} drawDelayFrames={16} fontSize={17} style={{ color: ACCENT }} />
          </div>
          <div style={{ fontSize: 12, color: DIM, opacity: useInterpolate([20, 30], [0, 1]) }}>
            — a very happy design engineer
          </div>
        </div>
      </Reveal>
    </Fill>
  );
}

// ---------------------------------------------------------------------------
// Scene 04 — finale: wordmark + chips, then WRAP (Bet E)
// ---------------------------------------------------------------------------

function SceneFinale() {
  const frame = useCurrentFrame();
  const chipSpring = (i: number) => staggeredSpringFor(i, frame - 6, CANVAS.fps, { duration: 420, bounce: 0.28 });
  // No ambient breathe on the big surfaces — the size doctrine: big-area
  // opacity churn bloats GIF deltas. The SceneIndicator's wrap glyph carries
  // the ambient motion for this scene (tiny area, every frame differs).

  return (
    <Fill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
      <GradientText text="takumi-motion v0.9" fontSize={40} fontWeight={800} />
      <div style={{ display: "flex", gap: 8 }}>
        {["data motion", "measured FLIP", "material", "particles", "forever loop"].map((label, i) => (
          <div key={label} style={{
            fontSize: 12.5, fontWeight: 700, color: TEXT,
            padding: "5px 12px",
            backgroundColor: "rgba(148,163,184,0.10)",
            border: "1px solid rgba(148,163,184,0.25)",
            borderRadius: 999,
            opacity: Math.min(1, chipSpring(i)),
            // Pop: slight scale with the spring — a livelier entrance AND an
            // honest transform signal for the shift lint (matrix diagonal).
            transform: `translateY(${((1 - chipSpring(i)) * 10).toFixed(3)}px) scale(${(0.9 + 0.1 * chipSpring(i)).toFixed(4)})`,
            whiteSpace: "pre",
          }}>
            {label}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: DIM, letterSpacing: 0.6, opacity: useInterpolate([18, 28], [0, 1]) }}>
        rendered by Rust · looped by construction
      </div>
    </Fill>
  );
}

// ---------------------------------------------------------------------------
// The persistent indicator — with the loop glyph (Bet E signal)
// ---------------------------------------------------------------------------

function SceneIndicator() {
  const info = useFrame();
  const frame = info.absolute;
  // State selection reads the LANDING frame: during the wrap tail the reel
  // is about to loop, so the indicator's final frame must equal frame 0's
  // (the seam is byte-exact — the indicator obeys the same doctrine).
  const effective = (frame + 1) % Math.max(1, info.bannerFrames);
  const signalsStart = useCue("signals");
  const morphStart = useCue("morph");
  const materialStart = useCue("material");
  const finaleStart = useCue("finale");
  const pulse = usePulse(14);
  const labels = ["01 signals", "02 morph", "03 material", "04 finale"];
  const starts = [signalsStart, morphStart, materialStart, finaleStart];
  let active = 0;
  for (const [i, start] of starts.entries()) if (start !== undefined && effective >= start) active = i;
  // The wrap glow: the finale's appended wrap tail (finale duration 76f).
  const wrapGlow = finaleStart !== undefined && effective >= finaleStart + 76 && effective < info.bannerFrames - 1;

  return (
    <div style={{
      position: "absolute",
      top: 14,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
      gap: 10,
      pointerEvents: "none",
    }}>
      {labels.map((label, i) => (
        <div key={label} style={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: 1,
          color: i === active ? TEXT : "rgba(148,163,184,0.45)",
          whiteSpace: "pre",
        }}>
          {label}
        </div>
      ))}
      <div style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: wrapGlow ? ACCENT : "rgba(148,163,184,0.45)",
        opacity: wrapGlow
          ? Math.max(0.45 + 0.3 * smoothPulseFor(Math.floor(effective / 4), 6), 0.55 + 0.45 * pulse)
          : 0.45 + 0.3 * smoothPulseFor(Math.floor(effective / 4), 6),
        whiteSpace: "pre",
      }}>
        ↻ wrap
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The banner
// ---------------------------------------------------------------------------

const SignalsReel = defineBanner(function SignalsReel() {
  return (
    <Banner {...CANVAS} loop theme="midnight" transitionMs={220}
            fonts={{ name: "Inter", weight: "100..900" }}>
      <Layer bottom>
        <div style={{
          position: "absolute",
          left: 0, right: 0, bottom: 0, height: 3,
          background: `linear-gradient(90deg, ${ACCENT}, ${VIOLET})`,
          opacity: 0.35,
        }} />
      </Layer>
      {/* v0.9.1 — enter="push": the arriving scene slides in at FULL opacity
          in lockstep with the leaving one (exit="push" — BOTH sides must
          declare it, or the static leaving scene shows through the gaps).
          Scenes stay exactly adjacent; nothing ever superimposes. */}
      <Scene duration={90} label="signals" exit="push">
        <SceneSignals />
      </Scene>
      <Scene duration={80} label="morph" enter={{ kind: "push", ms: 240 }} exit="push">
        <SceneMorph />
      </Scene>
      <Scene duration={84} label="material" enter={{ kind: "push", ms: 240 }} exit="push">
        <SceneMaterial />
      </Scene>
      <Scene duration={76} label="finale" enter={{ kind: "push", ms: 240 }} exit="wrap">
        <SceneFinale />
      </Scene>
      <Layer top>
        <SceneIndicator />
      </Layer>
    </Banner>
  );
});

// ---------------------------------------------------------------------------
// Render — the data channel flows through renderReactBanner({ data })
// ---------------------------------------------------------------------------

const data = JSON.parse(readFileSync(new URL("./signals-data.json", import.meta.url), "utf8"));

const report = await renderReactBanner({
  banner: SignalsReel as never,
  data,
  width: CANVAS.width,
  height: CANVAS.height,
  fps: CANVAS.fps,
  formats: ["webp", "gif"],
  outDir: OUT,
  baseName: "signals-reel",
} as never);

console.log(formatReactReport(report));
console.log(`\nseam: ${report.seam.detail}`);

const sheet = await renderStoryboard({
  banner: SignalsReel as never,
  data,
  frames: 12,
  columns: 4,
  outDir: OUT,
  baseName: "signals-storyboard",
});
console.log(`storyboard: ${sheet.cells.length} cells → ${sheet.paths.png}`);

// Exported for QA/tooling (storyboard probes, frame extractors).
export { SignalsReel as SignalsReelBanner, CANVAS as SIGNALS_CANVAS };
