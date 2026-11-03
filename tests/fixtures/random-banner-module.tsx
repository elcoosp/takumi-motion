// Fixture: worker-capture banner that CONSUMES Math.random (the shim). The
// frame-seeded shim must make every frame a pure function of (frame) —
// byte-identical output at any worker partition.
import { defineBanner, Banner, Scene } from "../../src/react/index.js";

export default defineBanner(function RandomBannerFixture() {
  return (
    <Banner width={400} height={160} fps={20} theme="midnight">
      <Scene duration={50}>
        <h1
          style={{
            fontSize: 40,
            fontWeight: 700,
            // consumes Math.random per frame (shimmed, frame-seeded)
            opacity: 0.4 + 0.5 * Math.random(),
            color: "#c0caf5",
          }}
        >
          random but deterministic
        </h1>
      </Scene>
    </Banner>
  );
});
