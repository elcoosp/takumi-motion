// takumi-motion — presets.ts
// Banner presets: size / density / fps / format / size-budget bundles tuned
// for GitHub README deployment (and an og-card preset for the secondary use).

export type AnimationFormat = "gif" | "webp" | "apng";

export interface BannerPreset {
  /** Logical (CSS px) canvas size. Physical output = logical × devicePixelRatio. */
  width: number;
  height: number;
  /** Device pixel ratio. 2 = retina-crisp output at half the logical size cost. */
  devicePixelRatio: number;
  fps: number;
  /** Formats rendered by default. */
  formats: AnimationFormat[];
  /** WebP quality 0–100 (lossy). Ignored for GIF/APNG. */
  webpQuality: number;
  /** Soft per-file size budget in bytes — renderBanner warns (and reports) when exceeded. */
  budgetBytes: number;
  description: string;
}

const KB = 1024;

export const bannerPresets: Record<string, BannerPreset> = {
  // Default: 850×200 logical, GIF + WebP. GitHub README content column is ~830px.
  // 1x keeps the palette-bound GIF small; add 'readme-hd' for retina WebP.
  readme: {
    width: 850,
    height: 200,
    devicePixelRatio: 1,
    fps: 20,
    formats: ["gif", "webp"],
    webpQuality: 82,
    budgetBytes: 2 * 1024 * KB,
    description: "850×200 @1x, 20 fps GIF+WebP — standard project README banner",
  },
  // Retina-crisp variant: true 2x output. WebP-only — a 2x GIF dithers into
  // multi-MB palette noise; WebP carries 2x at a fraction of the size.
  "readme-hd": {
    width: 850,
    height: 200,
    devicePixelRatio: 2,
    fps: 20,
    formats: ["webp"],
    webpQuality: 82,
    budgetBytes: 2 * 1024 * KB,
    description: "850×200 @2x, 20 fps WebP — retina-crisp README banner",
  },
  // Fast-loading variant: 12 fps GIF only — for repos that care about every KB.
  "readme-lean": {
    width: 850,
    height: 200,
    devicePixelRatio: 1,
    fps: 12,
    formats: ["gif"],
    webpQuality: 78,
    budgetBytes: Math.round(1.25 * 1024 * KB),
    description: "850×200 @1x, 12 fps GIF — lean file, fast page loads",
  },
  // Profile README hero.
  "readme-profile": {
    width: 850,
    height: 300,
    devicePixelRatio: 1,
    fps: 20,
    formats: ["gif", "webp"],
    webpQuality: 82,
    budgetBytes: 2.25 * 1024 * KB,
    description: "850×300 @1x, 20 fps GIF+WebP — profile README hero",
  },
  // Wide banner (repo social-style header).
  "readme-wide": {
    width: 1280,
    height: 300,
    devicePixelRatio: 1,
    fps: 20,
    formats: ["gif", "webp"],
    webpQuality: 82,
    budgetBytes: 3 * 1024 * KB,
    description: "1280×300 @1x, 20 fps GIF+WebP — wide header",
  },
  // Secondary use: OG card (1200×630, 1x).
  "og-card": {
    width: 1200,
    height: 630,
    devicePixelRatio: 1,
    fps: 20,
    formats: ["gif", "webp"],
    webpQuality: 85,
    budgetBytes: 4 * 1024 * KB,
    description: "1200×630 @1x, 20 fps GIF+WebP — animated OG card",
  },
};

export function resolvePreset(nameOrPreset: string | BannerPreset): BannerPreset {
  if (typeof nameOrPreset !== "string") return nameOrPreset;
  const preset = bannerPresets[nameOrPreset];
  if (!preset) {
    throw new Error(
      `Unknown preset '${nameOrPreset}'. Available: ${Object.keys(bannerPresets).join(", ")}. ` +
        `Pass a custom { width, height, fps, ... } object for bespoke sizes.`
    );
  }
  return preset;
}

/** "1.4 MB" style formatting for reports and CLI output. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * KB) return `${(bytes / KB).toFixed(1)} kB`;
  return `${(bytes / (1024 * KB)).toFixed(2)} MB`;
}
