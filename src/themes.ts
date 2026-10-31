// takumi-motion — themes.ts
// Design tokens for banner templates. A Theme carries every color the
// built-in templates use; templates never hardcode a color, so any banner
// re-skins through one prop.
//
// Design doctrine (v0.1 size engineering, now encoded): backgrounds are FLAT
// base colors — gradients + glow blur dither into GIF palette noise and
// balloon the file. Color depth comes from the drifting glow blobs, which
// stay small and soft. `glow` scales that ambient accent per theme.

export interface Theme {
  /** Theme id (resolved name). */
  name: string;
  /** Flat base background — GIF-palette friendly. */
  bg: string;
  /** Primary text. */
  text: string;
  /** Secondary text (taglines, labels). */
  textDim: string;
  /** Faint text (eyebrows, footnotes). */
  textFaint: string;
  /** Card/chip surface fill. */
  surface: string;
  /** Card/chip border. */
  surfaceBorder: string;
  /** Accent — glow, cursor, underline, gradient sweep highlight. */
  accent: string;
  /** Ambient glow opacity 0..1 (GIF size safety: keep ≤ 0.16). */
  glow: number;
  /** Suggested display font family (informational — themes may pair with fonts). */
  font?: string;
}

const KB = 0; // (placeholder to keep table compact)

export const themes: Record<string, Theme> = {
  // v0.1's default look — deep navy + violet glow.
  midnight: {
    name: "midnight",
    bg: "#0b1120",
    text: "#f1f5f9",
    textDim: "#8ea0b5",
    textFaint: "rgba(203, 213, 225, 0.55)",
    surface: "rgba(148, 163, 184, 0.10)",
    surfaceBorder: "rgba(148, 163, 184, 0.22)",
    accent: "#8b5cf6",
    glow: 0.12,
    font: "Space Grotesk",
  },

  // GitHub's own dark canvas — banners blend into the repo page.
  "github-dark": {
    name: "github-dark",
    bg: "#0d1117",
    text: "#e6edf3",
    textDim: "#8b949e",
    textFaint: "rgba(139, 148, 158, 0.6)",
    surface: "rgba(177, 186, 196, 0.08)",
    surfaceBorder: "rgba(177, 186, 196, 0.18)",
    accent: "#2f81f7",
    glow: 0.10,
    font: "Inter",
  },

  // GitHub light — for repos that ship light-mode READMEs.
  "github-light": {
    name: "github-light",
    bg: "#ffffff",
    text: "#1f2328",
    textDim: "#59636e",
    textFaint: "rgba(89, 99, 110, 0.62)",
    surface: "rgba(31, 35, 40, 0.05)",
    surfaceBorder: "rgba(31, 35, 40, 0.12)",
    accent: "#0969da",
    glow: 0.07,
    font: "Inter",
  },

  // Tokyo Night — the editor classic.
  "tokyo-night": {
    name: "tokyo-night",
    bg: "#1a1b26",
    text: "#c0caf5",
    textDim: "#7982a9" ,
    textFaint: "rgba(122, 130, 169, 0.6)",
    surface: "rgba(122, 130, 169, 0.10)",
    surfaceBorder: "rgba(122, 130, 169, 0.22)",
    accent: "#7aa2f7",
    glow: 0.11,
    font: "Sora",
  },

  // Dracula.
  dracula: {
    name: "dracula",
    bg: "#282a36",
    text: "#f8f8f2",
    textDim: "#a2acbf",
    textFaint: "rgba(162, 172, 191, 0.6)",
    surface: "rgba(248, 248, 242, 0.06)",
    surfaceBorder: "rgba(248, 248, 242, 0.16)",
    accent: "#bd93f9",
    glow: 0.11,
    font: "Outfit",
  },

  // Warm sunset accent on near-black — high energy, still GIF-cheap.
  sunburst: {
    name: "sunburst",
    bg: "#0f0a06",
    text: "#fdf4e3",
    textDim: "#c9a876",
    textFaint: "rgba(201, 168, 118, 0.55)",
    surface: "rgba(253, 244, 227, 0.06)",
    surfaceBorder: "rgba(253, 244, 227, 0.15)",
    accent: "#f59e0b",
    glow: 0.12,
    font: "Manrope",
  },

  // Ink-on-paper mono — terminal purists.
  "paper-mono": {
    name: "paper-mono",
    bg: "#faf8f3",
    text: "#1c1917",
    textDim: "#6b6259",
    textFaint: "rgba(107, 98, 89, 0.6)",
    surface: "rgba(28, 25, 23, 0.05)",
    surfaceBorder: "rgba(28, 25, 23, 0.14)",
    accent: "#1c1917",
    glow: 0.05,
    font: "JetBrains Mono",
  },
};

void KB;

export type ThemeName = keyof typeof themes;

/** A theme is a name from the registry or a full Theme object. */
export type ThemeInput = ThemeName | (string & {}) | Partial<Theme> & { name?: string };

/**
 * Resolve a theme by name, or complete a partial custom theme over the
 * default ('midnight'). Unknown names throw with the available list.
 */
export function resolveTheme(theme: ThemeInput = "midnight"): Theme {
  if (typeof theme !== "string") {
    const base = themes.midnight;
    const merged: Theme = { ...base, ...theme, name: theme.name ?? "custom" };
    return merged;
  }
  const found = themes[theme];
  if (!found) {
    throw new Error(
      `Unknown theme '${theme}'. Available: ${Object.keys(themes).join(", ")}. ` +
        `Pass a partial { bg, text, accent, ... } object for a custom palette.`
    );
  }
  return found;
}
