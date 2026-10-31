// CLI smoke: build a banner module, render + check + kit through the CLI.
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("/tmp/tm-smoke", { recursive: true });
const bannerTs = `
import { cascadeBanner } from "/home/z/my-project/download/takumi-motion-v0.2/dist/index.js";
export default cascadeBanner({
  title: "SMOKE TEST", tagline: "CLI END TO END",
  theme: "midnight", motion: "snappy", font: "Space Grotesk",
});
`;
writeFileSync("/tmp/tm-smoke/banner.ts", bannerTs);
