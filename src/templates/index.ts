// takumi-motion — templates/index.ts
// Built-in banner templates. Each returns a Promise of { element, timeline }
// and is strict-seam checked at construction time (a template that cannot
// loop cleanly refuses to build rather than shipping a broken GIF).

export { typewriterBanner, type TypewriterProps } from "./typewriter.js";
export { countUpBanner, type CountUpProps, type CountUpStat } from "./countup.js";
export { gradientSweepBanner, type SweepProps } from "./sweep.js";
export { cascadeBanner, type CascadeProps } from "./cascade.js";
export { bannerTemplates } from "./registry.js";

import { typewriterBanner, type TypewriterProps } from "./typewriter.js";
import { countUpBanner, type CountUpProps } from "./countup.js";
import { gradientSweepBanner, type SweepProps } from "./sweep.js";
import { cascadeBanner, type CascadeProps } from "./cascade.js";
import { bannerTemplates } from "./registry.js";
import type { BannerResult } from "./shared.js";

export interface TemplateInvocation {
  name: keyof typeof bannerTemplates;
  props: TypewriterProps | CountUpProps | SweepProps | CascadeProps;
}

/** Instantiate a template by name with loose props (CLI plumbing). */
export async function buildTemplate(invocation: TemplateInvocation): Promise<BannerResult> {
  const builder = bannerTemplates[invocation.name];
  if (!builder) {
    throw new Error(`Unknown template '${String(invocation.name)}'. Available: ${Object.keys(bannerTemplates).join(", ")}.`);
  }
  return builder(invocation.props);
}
