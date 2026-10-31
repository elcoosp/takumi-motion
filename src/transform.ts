// takumi-motion — transform.ts
// Motion's independent-transform semantics ported for a static renderer:
// fixed property order, unit suffixes, and the composed `transform` string
// (mirrors motion-dom render/html/utils/build-transform.ts + keys-transform.ts).

export const transformPropOrder = [
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
  "skew",
  "skewX",
  "skewY",
] as const;

export type TransformProp = (typeof transformPropOrder)[number];

export const isTransformProp = (key: string): key is TransformProp =>
  (transformPropOrder as readonly string[]).includes(key);

const units: Record<TransformProp, string> = {
  x: "px",
  y: "px",
  scale: "",
  scaleX: "",
  scaleY: "",
  rotate: "deg",
  skew: "deg",
  skewX: "deg",
  skewY: "deg",
};

const defaults: Record<TransformProp, number> = {
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  skew: 0,
  skewX: 0,
  skewY: 0,
};

const cssFunctionName: Record<TransformProp, string> = {
  x: "translateX",
  y: "translateY",
  scale: "scale",
  scaleX: "scaleX",
  scaleY: "scaleY",
  rotate: "rotate",
  skew: "skew",
  skewX: "skewX",
  skewY: "skewY",
};

/** CSS property names for numeric animatable props (Motion numberValueTypes semantics). */
export function valueToCss(prop: string, value: number | string): string {
  if (typeof value === "string") return value;
  switch (prop) {
    case "x":
    case "y":
    case "width":
    case "height":
    case "letterSpacing":
      return `${value}px`;
    case "rotate":
    case "skew":
    case "skewX":
    case "skewY":
      return `${value}deg`;
    case "fontWeight":
      return `${value}`;
    case "opacity":
    case "scale":
    case "scaleX":
    case "scaleY":
      return `${value}`;
    default:
      return `${value}`;
  }
}

export const cssPropertyFor = (prop: string): string =>
  isTransformProp(prop) ? "transform" : prop;

/**
 * Build a single transform string from independent values, in Motion's fixed
 * order, emitting only non-default animated props.
 */
export function buildTransform(values: Partial<Record<TransformProp, number | string>>): string {
  let transform = "";
  let hasAny = false;

  for (const key of transformPropOrder) {
    const value = values[key];
    if (value === undefined) continue;
    const num = typeof value === "number" ? value : parseFloat(value);
    if (Number.isNaN(num)) continue;
    if (num === defaults[key]) continue; // skip defaults like build-transform.ts
    transform += `${cssFunctionName[key]}(${typeof value === "number" ? num + units[key] : value}) `;
    hasAny = true;
  }

  return hasAny ? transform.trim() : "none";
}

/** Round to 4 decimals with compact formatting, for CSS emission. */
export function roundToCss(n: number): string {
  const r = Number(n.toFixed(4));
  const s = Number.isInteger(r) ? String(r) : String(r);
  return s === "-0" ? "0" : s;
}

/**
 * For animation keyframes we cannot skip defaults (a keyframe must state every
 * animated function at every offset so Takumi's list interpolation aligns).
 * This variant emits every animated function explicitly.
 */
export function buildTransformKeyframe(animatedProps: TransformProp[], values: Partial<Record<TransformProp, number | string>>): string {
  const parts: string[] = [];
  for (const key of transformPropOrder) {
    if (!animatedProps.includes(key)) continue;
    const value = values[key] ?? defaults[key];
    const num = typeof value === "number" ? value : parseFloat(value);
    parts.push(`${cssFunctionName[key]}(${typeof value === "number" ? roundToCss(num) + units[key] : value})`);
  }
  return parts.join(" ") || "none";
}
