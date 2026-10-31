// takumi-motion — templates/registry.ts
// Name → builder registry used by the CLI and programmatic lookups.
// Builders are async: templates measure-fit their text through the layout
// engine before composing the timeline.

import { typewriterBanner, type TypewriterProps } from "./typewriter.js";
import { countUpBanner, type CountUpProps } from "./countup.js";
import { gradientSweepBanner, type SweepProps } from "./sweep.js";
import { cascadeBanner, type CascadeProps } from "./cascade.js";
import type { BannerResult } from "./shared.js";

export const bannerTemplates: Record<
  string,
  (props: any) => Promise<BannerResult>
> = {
  typewriter: (props: TypewriterProps) => typewriterBanner(props),
  countup: (props: CountUpProps) => countUpBanner(props),
  sweep: (props: SweepProps) => gradientSweepBanner(props),
  cascade: (props: CascadeProps) => cascadeBanner(props),
};
