// takumi-motion — lint.ts (v0.6)
// The authoring linter: catches the KNOWN silent-failure classes at capture
// time and reports them as data (audit-as-data doctrine) instead of waiting
// for them to surface as broken pixels or Rust-side parse errors.
//
// Warning codes (stable API — consumers switch on them):
//
//   TM_KEBAB_STYLE       kebab-case key in a React style object. React 19
//                        serializes it but warns on stderr, and — worse —
//                        does NOT apply its unitless table to kebab keys, so
//                        numeric values get a px suffix (`"font-weight": 700`
//                        → `font-weight:700px`), which takumi REJECTS.
//   TM_NAN_STYLE         NaN/undefined/Infinity leaked into a style value.
//   TM_EMPTY_STYLE       an element rendered `style=""` — every declaration
//                        was dropped upstream (usually the kebab bug).
//   TM_UNKNOWN_STYLE_PROP property outside SUPPORTED_STYLE_PROPS (strict
//                        mode only — takumi supports more than the curated
//                        list, so this is advisory).
//   TM_SPRING_DURATION   a declarative track mixes `type: "spring"` with an
//                        explicit `duration` — springs are solved by physics;
//                        the duration is silently ignored (still-authors hit
//                        this constantly).
//   TM_FONT_NETWORK      fonts fetched over the network — builds stay
//                        byte-deterministic only while the remote bytes do.
//   TM_GLOW_GIF_DITHER   blur filters + GIF at dpr 1: palette dithering of
//                        soft gradients is the #1 size trap (the v0.1
//                        finding — 1x glow GIFs compressed WORSE than 2x).
//   TM_FITTEXT_UNMEASURED <FitText> rendered without a prewarmed measurement
//                        (outside the capture runtime) — fell back to max.
//   TM_TRANSITION_UNSETTLED an entering/exiting transition (or chain) cannot
//                        complete inside the scene window — cut mid-motion.
//
// v0.8 additions:
//   TM_NOISE_ALIASED     organic noise frequency exceeds the frame grid's
//                        Nyquist limit (> 0.5 lattice cells per frame) — the
//                        GIF/WebP frame grid CANNOT represent that motion;
//                        output will alias into jitter instead of wiggle.
//   TM_VELOCITY_DROPPED  carryVelocity() was requested on a chain segment
//                        that cannot receive it (previous segment settled to
//                        ≈0 velocity, or the next segment is not a spring).

import { isValidElement, type ReactNode, type ReactElement } from "react";
import { Children } from "react";
import { SUPPORTED_STYLE_PROPS, UNITLESS_STYLE_PROPS } from "./style.js";
import type { TrackJSON, TransitionWithOptions } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LintCode =
  | "TM_KEBAB_STYLE"
  | "TM_NAN_STYLE"
  | "TM_EMPTY_STYLE"
  | "TM_UNKNOWN_STYLE_PROP"
  | "TM_SPRING_DURATION"
  | "TM_FONT_NETWORK"
  | "TM_GLOW_GIF_DITHER"
  | "TM_FITTEXT_UNMEASURED"
  | "TM_TRANSITION_UNSETTLED"
  | "TM_NOISE_ALIASED"
  | "TM_VELOCITY_DROPPED"
  | "TM_MORPH_UNMEASURED"
  | "TM_LAYOUT_SHIFT"
  | "TM_PARTICLE_CHURN"
  | "TM_LOOP_SEAM";

export interface LintWarning {
  code: LintCode;
  /** Human-readable diagnosis — includes the offending key/value/path. */
  message: string;
  /** Actionable fix, phrased as the thing to do instead. */
  hint?: string;
  /** "warn" surfaces in CLI output; "info" is report-only. */
  severity: "warn" | "info";
}

export interface LintOptions {
  /** Flag properties outside SUPPORTED_STYLE_PROPS (advisory). Default false. */
  strict?: boolean;
  /** Path prefix for messages (e.g. "scene-1 > span"). */
  path?: string;
}

// ---------------------------------------------------------------------------
// Style-object lint (the React layer — where the bugs are authored)
// ---------------------------------------------------------------------------

const isPlainKey = (key: string): boolean => !key.startsWith("--");

/** kebab-case → camelCase ("font-weight" → "fontWeight") for the fix hint. */
export function camelHint(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Lint one style object. Pure — no React, no I/O. */
export function lintStyleObject(
  style: Record<string, unknown> | null | undefined,
  options: LintOptions = {},
): LintWarning[] {
  if (!style || typeof style !== "object") return [];
  const warnings: LintWarning[] = [];
  const where = options.path ? ` (at ${options.path})` : "";

  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;

    // NaN / Infinity values render as garbage or get dropped downstream.
    if (typeof value === "number" && !Number.isFinite(value)) {
      warnings.push({
        code: "TM_NAN_STYLE",
        message: `style.${key}${where} is ${String(value)} — it will serialize to "${key}:${String(value)}" and produce broken styles.`,
        hint: "Check the math feeding this property (springs can divide by zero; interpolate ranges can invert).",
        severity: "warn",
      });
      continue;
    }
    if (typeof value === "string" && (value === "NaN" || value === "undefined" || value === "Infinity")) {
      warnings.push({
        code: "TM_NAN_STYLE",
        message: `style.${key}${where} is the literal string "${value}".`,
        hint: "Coerce the source value before assigning it to style.",
        severity: "warn",
      });
      continue;
    }

    if (!isPlainKey(key)) continue; // CSS custom properties pass through

    // kebab-case keys: React serializes them BUT its unitless table is keyed
    // on camelCase — the kebab key MISSES it, so numeric values get a px
    // suffix unconditionally (`"font-weight": 700` → `font-weight:700px`,
    // which takumi rejects outright).
    if (key.includes("-")) {
      const camel = camelHint(key);
      const px = typeof value === "number";
      warnings.push({
        code: "TM_KEBAB_STYLE",
        message:
          `style key "${key}"${where} is kebab-case — React serializes it but skips its unitless table` +
          (px ? `, so ${value} becomes "${key}:${value}px" (invalid CSS — takumi rejects it).` : "."),
        hint: `Use the camelCase key "${camel}" instead.`,
        severity: "warn",
      });
      continue;
    }

    // Numeric value on a unitless property is fine; numeric on a NON-unitless
    // property gets px (correct for lengths). Numeric on UNKNOWN camelCase
    // property: React px-suffixes unless it knows the property — advisory only
    // in strict mode via the allowlist check below.

    if (options.strict && !SUPPORTED_STYLE_PROPS.has(key)) {
      warnings.push({
        code: "TM_UNKNOWN_STYLE_PROP",
        message: `style.${key}${where} is not in takumi-motion's verified property list — it may not render.`,
        hint: "Check SUPPORTED_STYLE_PROPS; extend it via consumers if you have verified the property against takumi.",
        severity: "info",
      });
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Element-tree lint — walks every style object the author literalized
// (host elements, fragments, arrays). Component internals are opaque until
// render; the HTML-chunk lint below covers what this cannot see.
// ---------------------------------------------------------------------------

export function lintStyleTree(node: ReactNode, options: LintOptions = {}): LintWarning[] {
  const warnings: LintWarning[] = [];
  const seen = new Set<object>();
  let steps = 0;
  const MAX_STEPS = 50_000; // pathological-tree guard; never hit by banners

  const walk = (child: ReactNode, path: string): void => {
    if (child === null || child === undefined || typeof child === "boolean") return;
    if (++steps > MAX_STEPS) return;
    if (Array.isArray(child)) {
      child.forEach((c, i) => walk(c, `${path}[${i}]`));
      return;
    }
    if (typeof child === "object" && isValidElement(child as ReactNode)) {
      const el = child as ReactElement<{ style?: Record<string, unknown>; children?: ReactNode }>;
      const props = el.props ?? {};
      if (props.style && typeof props.style === "object" && !seen.has(props.style)) {
        seen.add(props.style);
        warnings.push(...lintStyleObject(props.style, { ...options, path: `${path}<${el.type}>.style` }));
      }
      if (props.children !== undefined) walk(props.children, `${path}<${el.type}>`);
    }
  };

  walk(node, options.path ?? "");
  return warnings;
}

// ---------------------------------------------------------------------------
// HTML-chunk lint — runs on the CAPTURED markup, catching what the tree walk
// cannot see (styles inside opaque components, dropped-declaration signals).
// ---------------------------------------------------------------------------

const BAD_VALUE_RE = /(?:^|[\s;,(":])(-?NaN|-?Infinity|undefined)(?:px|%|deg|ms|[\s;!;}") ]|$)/;

/** Unitless properties, kebab-cased — a `px` suffix on these is invalid CSS
 *  (the React kebab-key px-suffix bug surviving into markup). */
const UNITLESS_KEBAB: ReadonlySet<string> = new Set(
  [...UNITLESS_STYLE_PROPS].map((prop) => prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
);

const STYLE_ATTR_RE = /style="([^"]*)"/g;

export function lintHtmlChunk(html: string): LintWarning[] {
  const warnings: LintWarning[] = [];

  // An empty style attribute means every declaration was dropped upstream.
  if (/style=""/.test(html)) {
    warnings.push({
      code: "TM_EMPTY_STYLE",
      message: 'an element rendered style="" — every declaration on it was dropped before serialization.',
      hint: "Look for kebab-case style keys (TM_KEBAB_STYLE) or undefined style objects in the component that owns it.",
      severity: "warn",
    });
  }

  // The kebab px-suffix signature: `font-weight:700px` in the OUTPUT markup —
  // React px-suffixed a numeric value because its unitless table missed the
  // kebab key. takumi rejects these declarations outright (parse error).
  for (const match of html.matchAll(STYLE_ATTR_RE)) {
    for (const declaration of match[1].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon === -1) continue;
      const prop = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      if (UNITLESS_KEBAB.has(prop) && /px\s*$/i.test(value)) {
        warnings.push({
          code: "TM_KEBAB_STYLE",
          message: `markup declares "${prop}:${value}" — a px suffix on the unitless property ${prop} is invalid CSS; takumi rejects it.`,
          hint: `Find the style object with the kebab-case key "${prop}" and use the camelCase key "${camelHint(prop)}".`,
          severity: "warn",
        });
      }
    }
  }

  // Garbage values that survived serialization (NaN springs, undefined leaks).
  const match = BAD_VALUE_RE.exec(html);
  if (match) {
    warnings.push({
      code: "TM_NAN_STYLE",
      message: `markup contains the value "${match[1]}" — computed style math produced a non-finite or undefined value.`,
      hint: "Find the property computing this value; clamp springs/interpolations that can divide by zero.",
      severity: "warn",
    });
  }

  return warnings;
}

/** Lint every unique chunk. Deduplicated by code+message downstream. */
export function lintHtmlChunks(chunks: string[]): LintWarning[] {
  const warnings: LintWarning[] = [];
  for (const html of chunks) warnings.push(...lintHtmlChunk(html));
  return warnings;
}

// ---------------------------------------------------------------------------
// Timeline lint — the spring/duration trap (compile-time, deterministic)
// ---------------------------------------------------------------------------

export function lintTracks(tracks: TrackJSON[]): LintWarning[] {
  const warnings: LintWarning[] = [];
  const seen = new Set<string>();

  for (const track of tracks) {
    const transition = (track.transition ?? {}) as TransitionWithOptions;
    const springy = transition.type === "spring" || transition.type === "inertia";
    // The timeline API defaults transforms to springs when no type is given —
    // an explicit duration on those defaults is equally ignored.
    const defaultedSpring = transition.type === undefined && isTransformish(track.property);
    if ((springy || defaultedSpring) && (transition as { duration?: number }).duration !== undefined) {
      const key = `${track.target}|${track.property}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({
        code: "TM_SPRING_DURATION",
        message:
          `track ${track.target}.${track.property} mixes a spring transition with duration: ${String((transition as { duration?: number }).duration)}ms — ` +
          `springs are solved by physics (stiffness/damping) and the duration is ignored.`,
        hint: 'Pass { type: "tween", duration } for time-exact segments, or drop the duration and tune the spring.',
        severity: "warn",
      });
    }
  }

  return warnings;
}

function isTransformish(property: string): boolean {
  return ["x", "y", "scale", "scaleX", "scaleY", "rotate", "skew", "skewX", "skewY"].includes(property);
}

// ---------------------------------------------------------------------------
// Font lint — determinism doctrine
// ---------------------------------------------------------------------------

/** FontSpec (Google css2 pipeline) is inherently network-fetched. */
export function lintFontSpecs(specs: ReadonlyArray<unknown>): LintWarning[] {
  const warnings: LintWarning[] = [];
  if (specs.length > 0) {
    warnings.push({
      code: "TM_FONT_NETWORK",
      message:
        `${specs.length} Google Font spec(s) resolve over the network at render time — output stays byte-identical only while the remote font files do.`,
      hint: "For reproducible builds, download the TTF/OTF once and register via fontFiles (local path/buffer) instead.",
      severity: "info",
    });
  }
  return warnings;
}

/** FontFileResult: flag URL-sourced files (path/buffer sources are local). */
export function lintFontFiles(result: { families?: Array<{ from?: string }> } | null | undefined): LintWarning[] {
  if (!result?.families) return [];
  const urlCount = result.families.filter((f) => f.from === "url").length;
  if (urlCount === 0) return [];
  return [{
    code: "TM_FONT_NETWORK",
    message: `${urlCount} font file(s) were fetched from URLs — builds are only as reproducible as those URLs.`,
    hint: "Vendor the font files locally (path/buffer) for byte-deterministic builds.",
    severity: "info",
  }];
}

// ---------------------------------------------------------------------------
// Output lint — the size traps
// ---------------------------------------------------------------------------

export function lintGlowDither(chunksHtml: ReadonlyArray<string>, formats: ReadonlyArray<string>, dpr: number): LintWarning[] {
  if (!formats.includes("gif") || dpr > 1) return [];
  const glowChunks = chunksHtml.filter((html) => /filter\s*:\s*blur\(/i.test(html)).length;
  if (glowChunks === 0) return [];
  return [{
    code: "TM_GLOW_GIF_DITHER",
    message:
      `${glowChunks} chunk(s) use filter:blur() and the surface includes GIF at dpr 1 — palette dithering of soft gradients is the #1 GIF size trap (blurred glows compressed WORSE at 1x than 2x in benchmarks).`,
    hint: "Render glow-heavy surfaces as WebP, raise dpr to 2, or flatten the blur (solid colors + opacity).",
    severity: "info",
  }];
}

// ---------------------------------------------------------------------------
// Collection + formatting
// ---------------------------------------------------------------------------

const MAX_PER_CODE = 20;

/** Dedupe by code+message, cap floods per code (with a truncation notice). */
export function collectLintWarnings(warnings: Iterable<LintWarning>): LintWarning[] {
  const byKey = new Map<string, LintWarning>();
  const perCode = new Map<LintCode, number>();
  for (const w of warnings) {
    const key = `${w.code}|${w.message}`;
    if (byKey.has(key)) continue;
    const count = perCode.get(w.code) ?? 0;
    if (count >= MAX_PER_CODE) {
      continue;
    }
    perCode.set(w.code, count + 1);
    byKey.set(key, w);
  }
  const out = [...byKey.values()];
  for (const [code, count] of perCode) {
    if (count === MAX_PER_CODE) {
      out.push({
        code,
        message: `… more ${code} warnings suppressed (cap ${MAX_PER_CODE}).`,
        severity: "info",
      });
    }
  }
  return out;
}

/** CLI-friendly lines. */
export function formatLint(warnings: ReadonlyArray<LintWarning>): string[] {
  return warnings.map((w) => {
    const icon = w.severity === "warn" ? "⚠" : "·";
    const hint = w.hint ? `\n      ${w.hint}` : "";
    return `  ${icon} [${w.code}] ${w.message}${hint}`;
  });
}

/** The empty lint — shared default so report shapes stay uniform. */
export const NO_LINT: readonly LintWarning[] = [];
