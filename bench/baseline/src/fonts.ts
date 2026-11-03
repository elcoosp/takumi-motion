// takumi-motion — fonts.ts
// Google Fonts exposure for banners: load families through takumi's css2
// pipeline (helpers' googleFonts()) and register every coverage subset on a
// Renderer. Registration is deduped per Renderer instance, so templates can
// call ensureFonts() for measure-fitting and renderBanner can call it again
// before the Rust render with zero duplicate fetches.
//
// Takumi bundles Geist (Latin) by default — banners render offline out of the
// box. Google Fonts are an additive layer: pass `font: "Space Grotesk"` and
// the whole pipeline (measure → compile → render) uses it consistently.

import type { Renderer } from "takumi-js/node";

/** Subset descriptors handed back by @takumi-rs/helpers' googleFonts(). */
interface FontSubsetLike {
  name: string;
  key: string;
  weight?: number;
  style?: string;
  unicodeRange: [number, number][];
  generic?: GenericFamily;
  data: () => Promise<ArrayBuffer>;
}

/** CSS generic family keywords a registered subset may claim. */
export type GenericFamily =
  | "serif" | "sans-serif" | "monospace" | "system-ui"
  | "ui-sans-serif" | "ui-serif" | "ui-monospace" | "ui-rounded"
  | "cursive" | "fantasy" | "emoji" | "math";

/** One family to load: a bare name, or a name with weight/style/generic. */
export type FontSpec =
  | string
  | {
      name: string;
      /** One weight, several, or a variable range like "100..900". Default 400. */
      weight?: number | number[] | string;
      /** "normal" (default), "italic", or both. */
      style?: "normal" | "italic" | ("normal" | "italic")[];
      /** CSS generic the family claims, so `sans-serif` stacks can reach it. */
      generic?: GenericFamily;
    };

export interface FontFamilyResult {
  /** Family name as registered — use it in CSS `fontFamily`. */
  name: string;
  /** Weights that ended up registered (sorted). */
  weights: number[];
  /** Number of unicode-range subsets registered for the family. */
  subsets: number;
  /** True when every subset was already on this Renderer (no fetch happened). */
  cached: boolean;
}

export interface FontLoadResult {
  families: FontFamilyResult[];
  /** Total subsets newly registered on the Renderer. */
  registered: number;
  /** Subsets skipped because a previous call already registered them. */
  skipped: number;
}

export interface EnsureFontsOptions {
  /** `font-display` for the css2 request. Default "swap". */
  display?: "auto" | "block" | "swap" | "fallback" | "optional";
  /** css2 base URL override (e.g. a Bunny Fonts mirror) for air-gapped setups. */
  baseUrl?: string;
  /** Abort signal for the fetches. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Per-Renderer dedup registry
// ---------------------------------------------------------------------------

const registeredKeys = new WeakMap<Renderer, Set<string>>();

function keySetFor(renderer: Renderer): Set<string> {
  let set = registeredKeys.get(renderer);
  if (!set) {
    set = new Set();
    registeredKeys.set(renderer, set);
  }
  return set;
}

/** Families already registered on this Renderer (informational). */
export function loadedFontFamilies(renderer: Renderer): string[] {
  const families = new Set<string>();
  for (const key of keySetFor(renderer)) families.add(key.split(" ")[0] ?? key);
  return [...families].sort();
}

function normalizeSpecs(specs: FontSpec[]): Array<Exclude<FontSpec, string>> {
  return specs.map((spec) => (typeof spec === "string" ? { name: spec } : spec));
}

/**
 * Load Google Font families onto a Renderer and register every coverage
 * subset. Repeat calls with the same families are cheap: subsets already on
 * the Renderer are skipped without touching the network.
 *
 * @example
 *   await ensureFonts(renderer, [{ name: "Space Grotesk", weight: [500, 700] }]);
 *   // fontFamily in styles: 'Space Grotesk'
 */
export async function ensureFonts(
  renderer: Renderer,
  specs: FontSpec | FontSpec[],
  options: EnsureFontsOptions = {}
): Promise<FontLoadResult> {
  const list = normalizeSpecs(Array.isArray(specs) ? specs : [specs]);
  if (list.length === 0) return { families: [], registered: 0, skipped: 0 };

  const { googleFonts } = await import("@takumi-rs/helpers");
  const subsets = (await googleFonts({
    families: list as never,
    display: options.display ?? "swap",
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  })) as unknown as FontSubsetLike[];

  const seen = keySetFor(renderer);
  interface FamilyAcc {
    name: string;
    weights: Set<number>;
    subsets: number;
    fetched: boolean;
  }
  const byFamily = new Map<string, FamilyAcc>();
  let registered = 0;
  let skipped = 0;

  for (const subset of subsets) {
    let family = byFamily.get(subset.name);
    if (!family) {
      family = { name: subset.name, weights: new Set<number>(), subsets: 0, fetched: false };
      byFamily.set(subset.name, family);
    }
    if (typeof subset.weight === "number") family.weights.add(subset.weight);

    if (seen.has(subset.key)) {
      skipped++;
      continue;
    }

    // Register the subset AS a FontLoader: takumi takes the lazy data() loader,
    // downloads on demand, and dedups repeat registrations by the stable
    // subset key itself — so double ensureFonts calls never re-fetch bytes.
    await renderer.registerFont(subset as never);
    seen.add(subset.key);
    family.subsets++;
    family.fetched = true;
    registered++;
  }

  return {
    families: [...byFamily.values()].map((f) => ({
      name: f.name,
      weights: [...f.weights].sort((a, b) => a - b),
      subsets: f.subsets,
      cached: !f.fetched,
    })),
    registered,
    skipped,
  };
}

/**
 * CSS `fontFamily` value putting `family` first with safe fallbacks.
 * Multi-word families are emitted unquoted (each word is a valid CSS
 * identifier and takumi's parser handles the list form).
 */
export function fontStack(family: string, ...fallbacks: string[]): string {
  return [family, ...fallbacks].join(", ");
}

// ---------------------------------------------------------------------------
// Curated catalog — families that hold up in a 200px-tall banner
// ---------------------------------------------------------------------------

/**
 * Banner-proven Google families by role. These are recommendations, not
 * restrictions — any css2 family name loads through ensureFonts().
 */
export const fontCatalog = {
  /** Tight, high-impact display faces for titles. */
  display: ["Space Grotesk", "Sora", "Outfit", "Manrope", "Archivo", "Inter"],
  /** Tabular-feeling monos for typewriter/count-up digits. */
  mono: ["JetBrains Mono", "IBM Plex Mono", "Space Mono", "Fira Code"],
  /** Editorial serifs that stay legible small. */
  serif: ["Playfair Display", "Lora", "Fraunces"],
  /** Neutral body faces for taglines and labels. */
  body: ["Inter", "Manrope", "Noto Sans"],
} as const;

export type FontCatalogRole = keyof typeof fontCatalog;

/** True when `name` appears in the curated catalog (any role). */
export function isCatalogFont(name: string): boolean {
  return Object.values(fontCatalog).some((list) => (list as readonly string[]).includes(name));
}

// ---------------------------------------------------------------------------
// Generic font-file loader (v0.4) — local paths, URLs, buffers
// ---------------------------------------------------------------------------

/** One font file to register: a local path, an http(s) URL, or raw bytes. */
export interface FontFileSpec {
  /** Local filesystem path, http(s) URL, or raw font bytes (TTF/OTF). */
  source: string | Uint8Array;
  /** Family name to register under. Default: the font file's internal name
   *  (when takumi can read it) or the URL/path basename without extension. */
  family?: string;
  /** Explicit weight override (variable fonts: the instance to register). */
  weight?: number;
  /** "normal" | "italic". Default: the font file's internal style. */
  style?: "normal" | "italic";
}

export interface FontFileResult {
  families: Array<{ name: string; weight?: number; style?: string; bytes: number; from: "path" | "url" | "buffer" }>;
  registered: number;
}

export interface LoadFontFilesOptions {
  /** Fetch implementation for URL sources (injectable — tests, proxies). Default: globalThis.fetch. */
  fetchImpl?: typeof fetch;
  /** Abort signal for URL fetches. */
  signal?: AbortSignal;
}

/**
 * Register raw font files (TTF/OTF — skrifa's sfnt scope; WOFF/WOFF2 are NOT
 * sfnt and are rejected by the engine). Local paths and URLs are read eagerly;
 * buffers pass straight through. Repeat calls with the same family+data dedupe
 * through takumi's own registration keying.
 *
 * @example
 *   await loadFontFiles(renderer, [{ source: "./assets/Brand.ttf", family: "Brand" }]);
 */
export async function loadFontFiles(
  renderer: Renderer,
  specs: FontFileSpec | FontFileSpec[],
  options: LoadFontFilesOptions = {},
): Promise<FontFileResult> {
  const list = Array.isArray(specs) ? specs : [specs];
  if (list.length === 0) return { families: [], registered: 0 };

  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const families: FontFileResult["families"] = [];
  let registered = 0;

  for (const [i, spec] of list.entries()) {
    let data: Uint8Array;
    let from: "path" | "url" | "buffer";
    let inferred: string | undefined;

    if (typeof spec.source === "string" && /^https?:\/\//i.test(spec.source)) {
      from = "url";
      const res = await doFetch(spec.source, { signal: options.signal });
      if (!res.ok) {
        throw new Error(`loadFontFiles[${i}]: fetching ${spec.source} failed — HTTP ${res.status}.`);
      }
      data = new Uint8Array(await res.arrayBuffer());
      inferred = basenameOf(spec.source);
    } else if (typeof spec.source === "string") {
      from = "path";
      const { readFileSync } = await import("node:fs");
      data = new Uint8Array(readFileSync(spec.source));
      inferred = basenameOf(spec.source);
    } else {
      from = "buffer";
      data = spec.source;
    }

    const name = spec.family ?? inferred;
    if (!name) {
      throw new Error(
        `loadFontFiles[${i}]: no family name — the source is a bare buffer; pass { family: "…" }.`,
      );
    }

    await renderer.registerFont({
      name,
      data,
      ...(spec.weight !== undefined ? { weight: spec.weight } : {}),
      ...(spec.style !== undefined ? { style: spec.style } : {}),
    } as never);
    seenKeyAdd(renderer, `${name} file:${from}:${data.length}`);
    families.push({ name, ...(spec.weight !== undefined ? { weight: spec.weight } : {}), ...(spec.style !== undefined ? { style: spec.style } : {}), bytes: data.length, from });
    registered++;
  }

  return { families, registered };
}

function basenameOf(source: string): string {
  const base = source.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Track file-loaded families in the same per-renderer registry ensureFonts uses. */
function seenKeyAdd(renderer: Renderer, key: string): void {
  const seen = keySetFor(renderer);
  seen.add(key);
}
