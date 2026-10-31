// CLI smoke fixture — a minimal user banner file for `takumi-motion render`.
// Templates are async (they measure-fit text), so export a function.
import { gradientSweepBanner } from "takumi-motion";

export default async () =>
  gradientSweepBanner({
    title: "Rendered via CLI",
    subtitle: "ONE COMMAND · NO BROWSER",
    accent: "#f472b6",
    secondaryColor: "#818cf8",
  });
