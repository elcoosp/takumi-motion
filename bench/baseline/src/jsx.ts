// takumi-motion — jsx.ts
// Minimal hyperscript helper for building Takumi node trees without a React
// runtime. Produces the same React-element-shaped plain objects that
// `fromJsx` (@takumi-rs/helpers) consumes, so templates and user banners can
// be authored with plain function calls in .ts files (no TSX compiler needed)
// or mixed with real JSX.

import type { ReactElementLike } from "./types.js";

const REACT_ELEMENT = Symbol.for("react.element");

/** A hyperscript-built element (React-shaped, consumable by fromJsx). */
export type VNode = ReactElementLike;

export type VNodeChildren = string | number | VNode | null | undefined | Array<VNodeChildren>;

export interface VNodeProps {
  style?: Record<string, string | number | undefined>;
  className?: string;
  children?: VNodeChildren;
  [key: string]: unknown;
}

/** Style object shape used across templates and orchestration primitives. */
export type VNodeStyle = NonNullable<VNodeProps["style"]>;

/** Hyperscript: `h("div", { style: {...}, className: "x" }, childA, childB)` */
export function h(type: string, props: VNodeProps = {}, ...children: VNodeChildren[]): ReactElementLike {
  const flat = flatten(children);
  const p: Record<string, unknown> = { ...props };
  if (flat.length === 1) p.children = flat[0];
  else if (flat.length > 1) p.children = flat;
  return {
    $$typeof: REACT_ELEMENT,
    type,
    props: p,
  };
}

function flatten(children: VNodeChildren[]): Array<string | number | VNode> {
  const out: Array<string | number | VNode> = [];
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (Array.isArray(child)) out.push(...flatten(child));
    else out.push(child);
  }
  return out;
}

/** Deep-clone a node tree (props and style objects included). */
export function cloneNode(node: ReactElementLike): ReactElementLike {
  const props = { ...node.props };
  if (props.style && typeof props.style === "object") {
    props.style = { ...(props.style as Record<string, unknown>) } as never;
  }
  if (props.children !== undefined) {
    props.children = deepCloneChildren(props.children as VNodeChildren);
  }
  return { ...node, props };
}

function deepCloneChildren(children: VNodeChildren): VNodeChildren {
  if (Array.isArray(children)) return children.map(deepCloneChildren);
  if (children && typeof children === "object" && "props" in (children as object)) {
    return cloneNode(children as ReactElementLike);
  }
  return children;
}
