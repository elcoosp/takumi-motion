// tests/golden.test.ts — v0.8 Bet F: the golden-frame trust harness.
//
// Canonical compositions (each exercising a different v0.8 subsystem) render
// TWICE; the harness asserts:
//   1. cross-run determinism — two captures produce byte-identical HTML;
//   2. one composition renders through the FULL Rust pipeline (GIF bytes)
//      and must be byte-identical across renders;
//   3. stored hashes (tests/golden/golden-hashes.json) match — the CI guard
//      for physics/easing/compiler regressions.
//
// Hashes are environment-bound (fonts/rasterizers differ per machine). When
// an intentional change shifts them, regenerate in-place:
//
//   UPDATE_GOLDEN=1 npx vitest run tests/golden.test.ts
//
// …and review the diff like code: a hash change IS a behavior change.

import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Banner,
  Scene,
  Animated,
  Camera,
  Wiggle,
  FollowPath,
  Keyframes,
  chain,
  hold,
  cascadeExit,
  FadeInDown,
  FadeOutRight,
  ZoomIn,
  LineChart,
  BarChart,
  CountUp,
  Morph,
  Reveal,
  VariableText,
  GradientText,
  Particles,
  defineBanner,
  defineTransition,
  type ChartData,
} from "../src/react/index.js";
import { captureReactBanner } from "../src/react/capture.js";
import { renderReactBanner } from "../src/react-render.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const HASH_FILE = join(HERE, "golden", "golden-hashes.json");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

const canvas = { width: 240, height: 120, fps: 20 };

const SlideLinear = defineTransition({
  name: "SlideLinear",
  side: "enter",
  channels: { x: [-120, 0] },
  durationFrames: 12,
  easing: "linear",
});

// --- Canonical compositions (one per v0.8 subsystem, kept small + fast) ----

function ChainCarryBanner() {
  return (
    <Banner {...canvas}>
      <Scene duration={40}>
        <Animated entering={chain(SlideLinear, hold(4), ZoomIn.springify({ stiffness: 170, damping: 11 }).carryVelocity())}>
          <div style={{ fontSize: 24, color: "#e2e8f0" }}>carry</div>
        </Animated>
      </Scene>
    </Banner>
  );
}

function StagecraftBanner() {
  return (
    <Banner {...canvas}>
      <Scene duration={30}>
        <Camera pushIn={{ from: 1, to: 1.15 }} pan={{ y: [6, -6] }} shake={{ amplitude: 2, frequency: 0.2, seed: "golden" }}>
          <Wiggle amplitude={3} frequency={0.12} seed="w">
            <div style={{ fontSize: 20, color: "#94a3b8" }}>stagecraft</div>
          </Wiggle>
        </Camera>
      </Scene>
    </Banner>
  );
}

function PathCascadeBanner() {
  const lines = ["leave", "in", "order"];
  return (
    <Banner {...canvas}>
      <Scene duration={34}>
        <FollowPath d="M -30 60 C 60 20 140 90 240 40" durationFrames={24} rotate="auto">
          <div style={{ fontSize: 14, color: "#f8fafc" }}>path</div>
        </FollowPath>
        <Keyframes
          frames={{
            0: { opacity: 0, easing: "easeOut" },
            8: { opacity: 1 },
            22: { opacity: 1 },
            30: { opacity: 0, easing: "easeIn" },
          }}
        >
          <div style={{ fontSize: 12, color: "#38bdf8" }}>kf</div>
        </Keyframes>
        {lines.map((line, i) => (
          <Animated key={i} exiting={cascadeExit(FadeOutRight, i, lines.length, { intervalFrames: 2 })}>
            <div style={{ fontSize: 10 }}>{line}</div>
          </Animated>
        ))}
      </Scene>
    </Banner>
  );
}

// --- Harness ---------------------------------------------------------------

// --- v0.9 canonical compositions (one per bet, kept small + fast) -----------

const GOLDEN_DATA: ChartData = {
  labels: ["Jan", "Feb", "Mar", "Apr"],
  series: [{ name: "g", color: "#38bdf8", points: [120, 240, 180, 420] }],
};

function DataKitBanner() {
  return (
    <Banner {...canvas}>
      <Scene duration={44}>
        <LineChart data={GOLDEN_DATA} draw="reveal" drawDurationFrames={22} drawDelayFrames={4} width={150} height={70} />
        <CountUp to={128400} format="$,.0f" durationFrames={20} delayFrames={4} style={{ fontSize: 14 }} />
      </Scene>
    </Banner>
  );
}

function MorphFlipBanner() {
  return (
    <Banner {...canvas}>
      <Scene duration={44}>
        <Morph
          from="list"
          to="grid"
          switchFrame={14}
          durationFrames={10}
          morphKey="golden-flip"
          itemIds={["a", "b"]}
          renderItem={(id, state) => <div style={{ fontSize: 11, color: "#f8fafc" }}>{`${id}:${state}`}</div>}
          containerStyle={{
            list: { display: "flex", flexDirection: "column", gap: 6 },
            grid: { display: "flex", flexWrap: "wrap", gap: 6, width: 160 },
          }}
          itemStyle={{
            list: { a: { width: 140, height: 22 }, b: { width: 140, height: 22 } },
            grid: { a: { width: 77, height: 30 }, b: { width: 77, height: 30 } },
          }}
        />
      </Scene>
    </Banner>
  );
}

function MaterialParticlesBanner() {
  return (
    <Banner {...canvas}>
      <Scene duration={40}>
        <Particles count={10} seed="golden-dust" twinklePeriodFrames={14} />
        <Reveal wipe="up" feather={10} drawDurationFrames={18} drawDelayFrames={2}
                style={{ width: 160, height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <GradientText text="golden" fontSize={20} fontWeight={800} />
        </Reveal>
        <VariableText text="swell" from={300} to={800} durationFrames={24} drawDelayFrames={4} fontSize={13} style={{ color: "#38bdf8" }} />
      </Scene>
    </Banner>
  );
}

function WrapLoopBanner() {
  return (
    <Banner {...canvas} loop>
      <Scene duration={18}>
        <div style={{ fontSize: 18, color: "#f8fafc" }}>open</div>
      </Scene>
      <Scene duration={20} enter="crossfade" exit="wrap">
        <div style={{ fontSize: 18, color: "#f8fafc" }}>finale</div>
      </Scene>
    </Banner>
  );
}

const COMPOSITIONS: Array<{ name: string; component: Parameters<typeof defineBanner>[0] }> = [
  { name: "chain-carry", component: defineBanner(ChainCarryBanner) },
  { name: "stagecraft", component: defineBanner(StagecraftBanner) },
  { name: "path-cascade", component: defineBanner(PathCascadeBanner) },
  { name: "data-kit", component: defineBanner(DataKitBanner) },
  { name: "morph-flip", component: defineBanner(MorphFlipBanner) },
  { name: "material-particles", component: defineBanner(MaterialParticlesBanner) },
  { name: "wrap-loop", component: defineBanner(WrapLoopBanner) },
];

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

const frameDigest = (htmlFrames: string[]): string => sha256(htmlFrames.join("\u0000"));

async function renderGoldenGif(): Promise<Buffer> {
  const report = await renderReactBanner({
    banner: defineBanner(ChainCarryBanner) as never,
    width: 120,
    height: 60,
    dpr: 1,
    fps: 10,
    formats: ["gif"],
    posters: false,
    concurrency: 2,
  } as never);
  return report.files[0].buffer;
}

describe("golden frames (v0.8 trust harness)", () => {
  it("two independent captures produce byte-identical HTML per composition", async () => {
    for (const { name, component } of COMPOSITIONS) {
      const a = await captureReactBanner(component as never);
      const b = await captureReactBanner(component as never);
      expect(frameDigest(a.htmlFrames), `${name}: cross-run determinism`).toBe(frameDigest(b.htmlFrames));
    }
  });

  it("the full Rust pipeline is byte-deterministic for the golden GIF", async () => {
    const a = await renderGoldenGif();
    const b = await renderGoldenGif();
    expect(a.equals(b)).toBe(true);
    expect(a.subarray(0, 3).toString("latin1")).toBe("GIF");
  });

  it("stored hashes match (regenerate with UPDATE_GOLDEN=1 after intentional changes)", async () => {
    const digests: Record<string, string> = {};
    for (const { name, component } of COMPOSITIONS) {
      const capture = await captureReactBanner(component as never);
      digests[`${name}:frames`] = frameDigest(capture.htmlFrames);
    }
    digests["chain-carry:gif"] = sha256(await renderGoldenGif());

    if (UPDATE) {
      mkdirSync(dirname(HASH_FILE), { recursive: true });
      writeFileSync(HASH_FILE, `${JSON.stringify(digests, null, 2)}\n`);
      console.log(`golden hashes written → ${HASH_FILE}`);
      return;
    }

    expect(existsSync(HASH_FILE), "golden-hashes.json missing — run UPDATE_GOLDEN=1 once").toBe(true);
    const stored = JSON.parse(readFileSync(HASH_FILE, "utf8")) as Record<string, string>;
    for (const [key, digest] of Object.entries(digests)) {
      expect(stored[key], `${key} drifted — behavior changed; review and regenerate`).toBe(digest);
    }
  });
});
