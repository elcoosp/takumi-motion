// takumi-motion — style.ts (v0.6)
// Type-level + runtime style safety for the takumi CSS subset.
//
// takumi renders a SUBSET of CSS (its stylo-derived property set — flex/grid,
// backgrounds, filters, shadows, transforms, text typography). React's
// CSSProperties type accepts ALL of CSS, so unsupported or mis-cased keys
// compile fine and then fail at render time — sometimes silently, sometimes
// as a Rust-side parse error (e.g. the React px-suffix bug: a kebab-case
// numeric key like "font-weight": 700 serializes to `font-weight:700px`,
// which takumi REJECTS outright).
//
// TakumiStyle is the curated, takumi-verified property map. Author components
// against it and typos/unsupported properties become TYPE errors instead of
// render-time surprises. SUPPORTED_STYLE_PROPS is the same list as runtime
// data — the authoring lint (lint.ts) checks against it in strict mode, and
// consumers may extend the set for their own pipelines.

// ---------------------------------------------------------------------------
// The allowlist (camelCase) — single source of truth for type + lint
// ---------------------------------------------------------------------------

/** Per-property value type classification. Unitless properties accept bare
 *  numbers (React passes them through unsuffixed); everything else gets a
 *  px suffix on numbers, which is only meaningful for lengths. */
const UNITLESS = new Set<string>([
  "animationIterationCount", "aspectRatio", "columnCount", "flex",
  "flexGrow", "flexPositive", "flexShrink", "flexNegative", "flexOrder",
  "fontWeight", "lineClamp", "lineHeight", "opacity", "order",
  "scale", "tabSize", "zIndex", "zoom",
]);

/**
 * Style properties verified against takumi's property set (takumi-core
 * style/properties) plus everything this library itself renders with.
 * camelCase keys, React-style values.
 */
export const SUPPORTED_STYLE_PROPS: ReadonlySet<string> = new Set([
  // Layout
  "display", "position", "top", "right", "bottom", "left", "inset",
  "zIndex", "order", "overflow", "overflowX", "overflowY", "visibility",
  "pointerEvents", "boxSizing", "aspectRatio", "isolation", "float", "clear",
  // Flex
  "flexDirection", "flexWrap", "flexFlow", "flex", "flexGrow", "flexShrink",
  "flexBasis", "flexPositive", "flexNegative", "flexOrder",
  "alignItems", "alignSelf", "alignContent", "justifyContent",
  "justifyItems", "justifySelf", "gap", "rowGap", "columnGap",
  // Grid
  "gridTemplateColumns", "gridTemplateRows", "gridTemplateAreas",
  "gridAutoColumns", "gridAutoRows", "gridAutoFlow", "gridColumn", "gridRow",
  "gridColumnStart", "gridColumnEnd", "gridRowStart", "gridRowEnd", "gridArea", "columnCount",
  // Sizing
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  // Spacing
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "marginInline", "marginBlock",
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "paddingInline", "paddingBlock",
  // Background & borders
  "background", "backgroundColor", "backgroundImage", "backgroundSize",
  "backgroundPosition", "backgroundRepeat", "backgroundClip", "backgroundOrigin",
  "border", "borderWidth", "borderStyle", "borderColor",
  "borderTop", "borderRight", "borderBottom", "borderLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "borderRadius", "borderTopLeftRadius", "borderTopRightRadius",
  "borderBottomLeftRadius", "borderBottomRightRadius",
  "outline", "outlineWidth", "outlineStyle", "outlineColor",
  // Typography
  "color", "fontFamily", "fontSize", "fontWeight", "fontStyle",
  "fontStretch", "fontKerning", "fontVariant", "fontVariationSettings",
  "fontFeatureSettings", "fontVariantNumeric", "lineHeight", "letterSpacing", "textAlign",
  "textAlignLast", "textDecoration", "textDecorationLine", "textDecorationColor",
  "textDecorationStyle", "textTransform",
  "textShadow", "textOverflow", "whiteSpace", "wordBreak", "overflowWrap",
  "wordSpacing", "lineBreak", "lineClamp", "hyphens", "tabSize", "content",
  // Visual effects
  "opacity", "filter", "backdropFilter", "boxShadow", "mixBlendMode",
  "clipPath", "transform", "transformOrigin", "transformStyle",
  "translate", "rotate", "scale",
  // Misc
  "cursor", "zoom", "listStyle", "listStyleType", "listStylePosition", "objectFit",
  "objectPosition", "transition", "animation", "animationName", "animationDuration",
  "animationTimingFunction", "animationDelay", "animationIterationCount",
  "animationDirection", "animationFillMode", "animationPlayState",
  "contain", "imageRendering",
]);

export { UNITLESS as UNITLESS_STYLE_PROPS };

// ---------------------------------------------------------------------------
// The type
// ---------------------------------------------------------------------------

/** CSS value shapes takumi accepts: numbers (px-suffixed per React rules,
 *  unsuffixed for unitless properties), strings, or `var(--…)` references. */
export type TakumiStyleValue = number | string;

/** Explicit property-name union mirroring SUPPORTED_STYLE_PROPS (tests assert
 *  the two stay in sync — see tests/v06.test.ts). */
type SupportedProp =
  | "display" | "position" | "top" | "right" | "bottom" | "left" | "inset"
  | "zIndex" | "order" | "overflow" | "overflowX" | "overflowY" | "visibility"
  | "pointerEvents" | "boxSizing" | "aspectRatio" | "isolation" | "float" | "clear"
  | "flexDirection" | "flexWrap" | "flexFlow" | "flex" | "flexGrow" | "flexShrink"
  | "flexBasis" | "flexPositive" | "flexNegative" | "flexOrder"
  | "alignItems" | "alignSelf" | "alignContent" | "justifyContent"
  | "justifyItems" | "justifySelf" | "gap" | "rowGap" | "columnGap"
  | "gridTemplateColumns" | "gridTemplateRows" | "gridTemplateAreas"
  | "gridAutoColumns" | "gridAutoRows" | "gridAutoFlow" | "gridColumn" | "gridRow"
  | "gridColumnStart" | "gridColumnEnd" | "gridRowStart" | "gridRowEnd" | "gridArea" | "columnCount"
  | "width" | "height" | "minWidth" | "minHeight" | "maxWidth" | "maxHeight"
  | "margin" | "marginTop" | "marginRight" | "marginBottom" | "marginLeft"
  | "marginInline" | "marginBlock"
  | "padding" | "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft"
  | "paddingInline" | "paddingBlock"
  | "background" | "backgroundColor" | "backgroundImage" | "backgroundSize"
  | "backgroundPosition" | "backgroundRepeat" | "backgroundClip" | "backgroundOrigin"
  | "border" | "borderWidth" | "borderStyle" | "borderColor"
  | "borderTop" | "borderRight" | "borderBottom" | "borderLeft"
  | "borderTopWidth" | "borderRightWidth" | "borderBottomWidth" | "borderLeftWidth"
  | "borderRadius" | "borderTopLeftRadius" | "borderTopRightRadius"
  | "borderBottomLeftRadius" | "borderBottomRightRadius"
  | "outline" | "outlineWidth" | "outlineStyle" | "outlineColor"
  | "color" | "fontFamily" | "fontSize" | "fontWeight" | "fontStyle"
  | "fontStretch" | "fontKerning" | "fontVariant" | "fontVariationSettings"
  | "fontFeatureSettings" | "lineHeight" | "letterSpacing" | "textAlign"
  | "textAlignLast" | "textDecoration" | "textDecorationLine" | "textDecorationColor"
  | "textDecorationStyle" | "textTransform"
  | "textShadow" | "textOverflow" | "whiteSpace" | "wordBreak" | "overflowWrap"
  | "wordSpacing" | "lineBreak" | "lineClamp" | "hyphens" | "tabSize" | "content"
  | "opacity" | "filter" | "backdropFilter" | "boxShadow" | "mixBlendMode"
  | "clipPath" | "transform" | "transformOrigin" | "transformStyle"
  | "translate" | "rotate" | "scale"
  | "cursor" | "zoom" | "listStyle" | "listStyleType" | "listStylePosition" | "objectFit"
  | "objectPosition" | "transition" | "animation" | "animationName" | "animationDuration"
  | "animationTimingFunction" | "animationDelay" | "animationIterationCount"
  | "animationDirection" | "animationFillMode" | "animationPlayState"
  | "contain" | "imageRendering";

/**
 * The takumi-verified inline style map. Author with `satisfies TakumiStyle`
 * and unsupported/mis-cased keys become TYPE errors:
 *
 * ```tsx
 * const style = { fontSize: 32, fontWeight: 700 } satisfies TakumiStyle;
 * ```
 *
 * CSS custom properties are allowed through the explicit `--*` key form.
 */
export type TakumiStyle = {
  [K in SupportedProp]?: TakumiStyleValue;
} & { [custom: `--${string}`]: string | number };

/** A style value or whole style object accepted by authoring components. */
export type StyleInput = TakumiStyle;
