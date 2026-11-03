// Fixture: worker-capture banner module (default export, no fonts, no random).
import { defineBanner, Banner, Scene, Animated, FadeInDown, FadeOutLeft } from "../../bench/baseline/src/react/index.js";

export default defineBanner(function ModuleBannerFixture() {
  return (
    <Banner width={600} height={200} fps={20} theme="tokyo-night">
      <Scene duration={40} enter="crossfade" exit="crossfade">
        <Animated entering={FadeInDown.duration(12)} exiting={FadeOutLeft.duration(10)}>
          <h1 style={{ fontSize: 44, fontWeight: 700, color: "#c0caf5" }}>worker capture</h1>
        </Animated>
      </Scene>
      <Scene duration={40} enter="crossfade">
        <h1 style={{ fontSize: 44, fontWeight: 700, color: "#7aa2f7" }}>second scene</h1>
      </Scene>
    </Banner>
  );
});
