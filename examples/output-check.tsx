import React from "react"; // classic-runtime scope (tsx CLI transforms JSX classic)
import { renderReactBanner } from "../src/react-render.js";
import { launchBanner } from "./react-banner.js";
await renderReactBanner({ banner: launchBanner, outDir: "output", baseName: "final", posters: [97, 262, 322] });
console.log("done");
