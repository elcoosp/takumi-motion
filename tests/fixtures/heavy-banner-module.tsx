// Fixture: HEAVY capture — 240 frames × ~620 styled nodes/frame (~12ms SSR
// per frame) — the worker-pool bench banner (spawn cost must amortize).
import { defineBanner, Banner, Scene, useCurrentFrame } from "../../src/react/index.js";

function Grid({ frame }: { frame: number }) {
  const cells = [];
  for (let i = 0; i < 620; i++) {
    cells.push(
      <div
        key={i}
        style={{
          width: 8,
          height: 8,
          backgroundColor: i % 2 === 0 ? "#7aa2f7" : "#9ece6a",
          opacity: 0.2 + 0.6 * Math.abs(Math.sin((frame + i) / 12)),
          transform: `translateY(${Math.sin((frame + i * 7) / 9) * 3}px)`,
        }}
      />,
    );
  }
  return <div style={{ display: "flex", flexWrap: "wrap", width: 560, gap: 4 }}>{cells}</div>;
}

export default defineBanner(function HeavyBannerFixture() {
  return (
    <Banner width={600} height={200} fps={30} theme="tokyo-night">
      <Scene duration={240}>
        <GridFrames />
      </Scene>
    </Banner>
  );
});

/** Scene-scoped: the frame hook must run INSIDE a <Scene>. */
function GridFrames() {
  return <Grid frame={useCurrentFrame()} />;
}
