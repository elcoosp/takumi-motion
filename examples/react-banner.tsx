// examples/react-banner.tsx — the v0.3 self-hosted proof:
// takumi-motion's own launch banner, authored as a real React component
// tree with scenes, transitions, a frame-driven state machine, and
// persistent layers. Run (after `npm run build` so the self-reference
// resolves to dist/):
//
//   npx tsx examples/react-banner.tsx
//   npx takumi-motion render examples/react-banner.tsx --preset readme --out ./out
//
// The banner is ONE-SHOT (loop: false — a launch splash, not a loop).

import { mkdirSync } from "node:fs";
import { Banner, Scene, Layer, defineBanner, useCurrentFrame, useSpring, useInterpolate, useFrameState, interpolateFor } from "takumi-motion/react";
import { renderReactBanner, formatReactReport } from "takumi-motion";

const ACCENT = "#7aa2f7";

// ---------------------------------------------------------------------------
// The banner — 3 scenes + 2 persistent layers, 850×200 @ 20fps
// ---------------------------------------------------------------------------

export const launchBanner = defineBanner(function TakumiMotionLaunch() {
  return (
    <Banner
      preset="readme"
      theme="tokyo-night"
      fonts={[{ name: "Sora", weight: [400, 600, 700] }, { name: "JetBrains Mono", weight: 400 }]}
      transitionMs={250}
    >
      <Layer bottom>
        {/* accent rail along the bottom edge, whole banner long */}
        <div style={{ position: "absolute", left: 0, bottom: 0, width: 850, height: 3, backgroundColor: ACCENT, opacity: 0.4 }} />
        {/* faint corner glyph, decorative */}
        <CornerGlyph />
      </Layer>

      <Scene duration={100} enter="rise" exit="crossfade">
        <TitleScene />
      </Scene>

      <Scene duration={165} enter="rise" exit="slide">
        <FeatureCarousel />
      </Scene>

      <Scene duration={75} enter="slide">
        <OutroScene />
      </Scene>

      <Layer top>
        <VersionChip />
      </Layer>
    </Banner>
  );
});

export default launchBanner;

// ---------------------------------------------------------------------------
// Scene 1 — title drops in on a spring, tagline fades, underline grows
// ---------------------------------------------------------------------------

function TitleScene() {
  const frame = useCurrentFrame();
  const titleY = useSpring({ from: -34, to: 0, stiffness: 165, damping: 15 });
  const taglineOpacity = useInterpolate([12, 30], [0, 1], "easeOut");
  const underlineWidth = useInterpolate([18, 50], [0, 190], "easeOut");

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{
        color: "#c0caf5",
        fontSize: 48,
        fontWeight: 700,
        letterSpacing: 0.5,
        transform: `translateY(${titleY.toFixed(2)}px)`,
      }}>
        takumi-motion
      </div>
      <div style={{
        marginTop: 10,
        color: "#7982a9",
        fontSize: 20,
        opacity: taglineOpacity.toFixed(3),
      }}>
        real React state, rendered by Rust
      </div>
      <div style={{
        marginTop: 14,
        width: underlineWidth.toFixed(1),
        height: 3,
        backgroundColor: ACCENT,
        opacity: 0.65,
        borderRadius: 2,
      }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene 2 — feature carousel driven by useFrameState (deterministic replay)
//
// Each feature: slide-in (11f) → hold (25f) → slide-out (8f). Holds are
// byte-identical frames, so the chunker merges them and the GIF stays small.
// ---------------------------------------------------------------------------

const FEATURES = [
  "multi-scene timelines",
  "spring physics on every glyph",
  "GIF · WebP · poster, one call",
];

function FeatureCarousel() {
  const frame = useCurrentFrame();
  const active = useFrameState(
    (state, action: { type: "next" }) => (action.type === "next" ? (state + 1) % FEATURES.length : state),
    0,
    (f) => (f.frame > 0 && f.frame % 45 === 0 ? { type: "next" as const } : null),
  );

  const seg = frame % 45;
  // Per-segment easings (in: easeOut · hold: linear · out: easeIn) expressed as
  // three segments — the linear middle leg is a constant hold by values.
  const slideX = seg <= 11 ? interpolateFor(seg, [0, 11], [26, 0], "easeOut")
    : seg >= 36 ? interpolateFor(seg, [36, 44], [0, -18], "easeIn")
    : 0;
  const opacity = seg <= 10 ? interpolateFor(seg, [0, 10], [0, 1], "easeOut")
    : seg >= 36 ? interpolateFor(seg, [36, 44], [1, 0], "easeIn")
    : 1;
  const eyebrow = useInterpolate([4, 18], [0, 1], "easeOut");

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#565f89", fontSize: 13, letterSpacing: 3, opacity: eyebrow.toFixed(3), marginBottom: 14 }}>
        WHAT SHIPPED
      </div>
      <div style={{
        color: "#c0caf5",
        fontSize: 34,
        fontWeight: 600,
        transform: `translateX(${slideX.toFixed(2)}px)`,
        opacity: opacity.toFixed(3),
      }}>
        {FEATURES[active]}
      </div>
      {/* carousel progress dots */}
      <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
        {FEATURES.map((_, i) => (
          <div key={i} style={{
            width: i === active ? 18 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i === active ? ACCENT : "rgba(122,130,169,0.3)",
          }} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene 3 — the CTA chip, breathing softly (seam-safe smooth pulse)
// ---------------------------------------------------------------------------

function OutroScene() {
  const frame = useCurrentFrame();
  const chipScale = useInterpolate([0, 14], [0.86, 1], "easeOut");
  const chipOpacity = useInterpolate([0, 12], [0, 1], "easeOut");
  const breathe = 1 + 0.015 * Math.sin((frame / 24) * Math.PI * 2) * (frame > 20 ? 1 : frame / 20);

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{
        backgroundColor: "rgba(122,130,169,0.12)",
        border: "1px solid rgba(122,130,169,0.35)",
        borderRadius: 12,
        padding: "16px 30px",
        transform: `scale(${(chipScale * breathe).toFixed(4)})`,
        opacity: chipOpacity.toFixed(3),
      }}>
        <span style={{ color: ACCENT, fontSize: 27, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>
          npm i takumi-motion
        </span>
      </div>
      <div style={{ marginTop: 14, color: "#565f89", fontSize: 15, letterSpacing: 1 }}>
        springs · scenes · GIF / WebP / poster — zero browser
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persistent layers
// ---------------------------------------------------------------------------

function CornerGlyph() {
  return (
    <div style={{
      position: "absolute",
      left: 28,
      top: 24,
      width: 14,
      height: 14,
      borderLeft: `3px solid ${ACCENT}`,
      borderTop: `3px solid ${ACCENT}`,
      opacity: 0.5,
    }} />
  );
}

function VersionChip() {
  return (
    <div style={{
      position: "absolute",
      right: 22,
      top: 20,
      color: "#7982a9",
      fontSize: 13,
      fontFamily: "JetBrains Mono, monospace",
      backgroundColor: "rgba(122,130,169,0.10)",
      border: "1px solid rgba(122,130,169,0.25)",
      borderRadius: 6,
      padding: "3px 9px",
    }}>
      v0.3
    </div>
  );
}

// ---------------------------------------------------------------------------
// Direct-run convenience: `npx tsx examples/react-banner.tsx`
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith("react-banner.tsx")) {
  mkdirSync("output", { recursive: true });
  const report = await renderReactBanner({
    banner: launchBanner,
    outDir: "output",
    baseName: "takumi-motion-react",
    posters: [40, 180, 300],
  });
  console.log(formatReactReport(report));
}
