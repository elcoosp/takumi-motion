// takumi-motion — react/path.ts (v0.8, Bet B)
// Motion-path math: parse an SVG path subset, flatten it to an arc-length
// table ONCE (memoized by the `d` string), and answer "where am I at t" in
// O(log n). Pure, deterministic, no React.
//
// Why bake instead of upstream offset-path: takumi renders each frame from a
// full node tree, so per-frame translate/rotate tracks compose with every
// other motion primitive (Animated, Keyframes, Camera) through ONE pipeline —
// no reliance on the upstream CSS offset-path subset, same byte-determinism
// guarantees, and the arc-length table gives constant-speed travel that
// offset-distance percentages don't.
//
// Supported commands: M m L l H h V v C c S s Q q T t Z z (absolute +
// relative). Arc-to (A) throws with a clear message — motion paths are
// straight/curved travel, not elliptical arcs.

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Segment =
  | { cmd: "M" | "L"; x: number; y: number }
  | { cmd: "H"; x: number }
  | { cmd: "V"; y: number }
  | { cmd: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { cmd: "Q"; x1: number; y1: number; x: number; y: number }
  | { cmd: "Z" };
// Note: S/s and T/t are absolutized to C/Q at parse time (reflected-control
// points), so they never appear here — the flattener only sees the above.

const NUMBER_RE = /[+-]?(\d*\.\d+|\d+\.?)([eE][+-]?\d+)?/y;

function tokenize(d: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let i = 0;
  while (i < d.length) {
    const ch = d[i];
    if (/[A-Za-z]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    NUMBER_RE.lastIndex = i;
    const m = NUMBER_RE.exec(d);
    if (!m || m.index !== i) {
      throw new Error(`pathPointAt: cannot parse path data at index ${i} ("${d.slice(i, i + 8)}…").`);
    }
    tokens.push(parseFloat(m[0]));
    i = NUMBER_RE.lastIndex;
  }
  return tokens;
}

/** Absolute-ized segments. One continuous subpath — a second M throws. */
export function parsePathSegments(d: string): Segment[] {
  const tokens = tokenize(d);
  const segments: Segment[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let started = false;
  let prevCubic: { x: number; y: number } | null = null;
  let prevQuad: { x: number; y: number } | null = null;

  const num = (): number => {
    const t = tokens.shift();
    if (typeof t !== "number") throw new Error("pathPointAt: expected a number in path data.");
    return t;
  };
  const command = (): string => {
    const t = tokens.shift();
    if (typeof t !== "string") throw new Error("pathPointAt: expected a command letter in path data.");
    return t;
  };

  while (tokens.length > 0) {
    const cmd = command();
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const rx = (): number => (rel ? cx + num() : num());
    const ry = (): number => (rel ? cy + num() : num());

    switch (C) {
      case "M": {
        const x = rx();
        const y = ry();
        if (started) {
          throw new Error(
            "pathPointAt: the path has more than one subpath (a second M/m) — motion paths must be one continuous line. Split them into separate paths.",
          );
        }
        started = true;
        sx = x;
        sy = y;
        cx = x;
        cy = y;
        segments.push({ cmd: "M", x, y });
        break;
      }
      case "L": {
        const x = rx();
        const y = ry();
        segments.push({ cmd: "L", x, y });
        cx = x;
        cy = y;
        prevQuad = prevCubic = null;
        break;
      }
      case "H": {
        const x = rx();
        segments.push({ cmd: "H", x });
        cx = x;
        prevQuad = prevCubic = null;
        break;
      }
      case "V": {
        const y = ry();
        segments.push({ cmd: "V", y });
        cy = y;
        prevQuad = prevCubic = null;
        break;
      }
      case "C": {
        const x1 = rx();
        const y1 = ry();
        const x2 = rx();
        const y2 = ry();
        const x = rx();
        const y = ry();
        segments.push({ cmd: "C", x1, y1, x2, y2, x, y });
        cx = x;
        cy = y;
        prevCubic = { x: x2, y: y2 };
        prevQuad = null;
        break;
      }
      case "S": {
        const x1: number = prevCubic ? 2 * cx - prevCubic.x : cx;
        const y1: number = prevCubic ? 2 * cy - prevCubic.y : cy;
        const x2 = rx();
        const y2 = ry();
        const x = rx();
        const y = ry();
        segments.push({ cmd: "C", x1, y1, x2, y2, x, y });
        cx = x;
        cy = y;
        prevCubic = { x: x2, y: y2 };
        prevQuad = null;
        break;
      }
      case "Q": {
        const x1 = rx();
        const y1 = ry();
        const x = rx();
        const y = ry();
        segments.push({ cmd: "Q", x1, y1, x, y });
        cx = x;
        cy = y;
        prevQuad = { x: x1, y: y1 };
        prevCubic = null;
        break;
      }
      case "T": {
        const x1: number = prevQuad ? 2 * cx - prevQuad.x : cx;
        const y1: number = prevQuad ? 2 * cy - prevQuad.y : cy;
        const x = rx();
        const y = ry();
        segments.push({ cmd: "Q", x1, y1, x, y });
        cx = x;
        cy = y;
        prevQuad = { x: x1, y: y1 };
        prevCubic = null;
        break;
      }
      case "Z": {
        segments.push({ cmd: "Z" });
        cx = sx;
        cy = sy;
        prevQuad = prevCubic = null;
        break;
      }
      case "A": {
        throw new Error(
          "pathPointAt: arc commands (A/a) are not supported — flatten arcs to cubics in your authoring tool, or describe the travel with C curves.",
        );
      }
      default:
        throw new Error(`pathPointAt: unsupported path command "${cmd}".`);
    }
  }

  if (!started) throw new Error("pathPointAt: path data must start with M/m.");
  return segments;
}

// ---------------------------------------------------------------------------
// Flattening + arc-length table
// ---------------------------------------------------------------------------

const CURVE_STEPS = 32;

interface FlattenTable {
  xs: Float64Array;
  ys: Float64Array;
  cumulative: Float64Array;
  length: number;
}

function cubicPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function quadPoint(p0: number, p1: number, p2: number, t: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function flatten(segments: Segment[]): FlattenTable {
  const xs: number[] = [];
  const ys: number[] = [];
  let cx = 0;
  let cy = 0;

  for (const seg of segments) {
    switch (seg.cmd) {
      case "M":
        cx = seg.x;
        cy = seg.y;
        xs.push(cx);
        ys.push(cy);
        break;
      case "L":
        cx = seg.x;
        cy = seg.y;
        xs.push(cx);
        ys.push(cy);
        break;
      case "H":
        cx = seg.x;
        xs.push(cx);
        ys.push(cy);
        break;
      case "V":
        cy = seg.y;
        xs.push(cx);
        ys.push(cy);
        break;
      case "C": {
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          xs.push(cubicPoint(cx, seg.x1, seg.x2, seg.x, t));
          ys.push(cubicPoint(cy, seg.y1, seg.y2, seg.y, t));
        }
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case "Q": {
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          xs.push(quadPoint(cx, seg.x1, seg.x, t));
          ys.push(quadPoint(cy, seg.y1, seg.y, t));
        }
        cx = seg.x;
        cy = seg.y;
        break;
      }
      case "Z":
        xs.push(xs[0]);
        ys.push(ys[0]);
        cx = xs[0];
        cy = ys[0];
        break;
    }
  }

  const n = xs.length;
  const cumulative = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const dx = xs[i] - xs[i - 1];
    const dy = ys[i] - ys[i - 1];
    acc += Math.sqrt(dx * dx + dy * dy);
    cumulative[i] = acc;
  }
  return {
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    cumulative,
    length: acc,
  };
}

// d-string → table. Bounded Map (strings aren't WeakMap keys); banners use a
// handful of paths, so the cap is generous but finite.
const flattenCache = new Map<string, FlattenTable>();
const FLATTEN_CACHE_CAP = 128;

function tableFor(d: string): FlattenTable {
  const hit = flattenCache.get(d);
  if (hit) return hit;
  const table = flatten(parsePathSegments(d));
  if (flattenCache.size >= FLATTEN_CACHE_CAP) {
    const oldest = flattenCache.keys().next().value;
    if (oldest !== undefined) flattenCache.delete(oldest);
  }
  flattenCache.set(d, table);
  return table;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PathPoint {
  x: number;
  y: number;
  /** Tangent direction in degrees (0 = →, 90 = ↓) — rotate:"auto" consumes this. */
  angle: number;
}

/** Total arc length of the path (px units of the authored coordinate space). */
export function pathLength(d: string): number {
  return tableFor(d).length;
}

/**
 * Point + tangent at arc-length parameter `t` ∈ [0, 1]. t=0 is the path
 * start; t=1 the end; values clamp outside. Constant speed BY CONSTRUCTION:
 * t is mapped through the cumulative arc-length table, so equal t-steps
 * travel equal distances (the thing offset-distance percentages can't do).
 */
export function pathPointAt(d: string, t: number): PathPoint {
  if (!Number.isFinite(t)) {
    throw new Error(`pathPointAt: t must be finite, got ${t}.`);
  }
  const table = tableFor(d);
  const n = table.xs.length;
  if (n < 2) return { x: table.xs[0], y: table.ys[0], angle: 0 };

  const clamped = Math.min(1, Math.max(0, t));
  const target = clamped * table.length;

  // Binary search the cumulative table.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (table.cumulative[mid] <= target) lo = mid;
    else hi = mid;
  }

  const segLen = table.cumulative[hi] - table.cumulative[lo];
  const frac = segLen === 0 ? 0 : (target - table.cumulative[lo]) / segLen;
  const x = table.xs[lo] + (table.xs[hi] - table.xs[lo]) * frac;
  const y = table.ys[lo] + (table.ys[hi] - table.ys[lo]) * frac;

  // Tangent from a lookahead that is stable at both ends.
  const probeIndex = Math.min(n - 1, hi + 1);
  const backIndex = Math.max(0, lo - 1);
  const ax = table.xs[probeIndex] - table.xs[backIndex];
  const ay = table.ys[probeIndex] - table.ys[backIndex];
  const angle = Math.atan2(ay, ax) * (180 / Math.PI);

  return { x: Math.round(x * 1e4) / 1e4, y: Math.round(y * 1e4) / 1e4, angle: Math.round(angle * 1e4) / 1e4 };
}
