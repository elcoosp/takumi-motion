// takumi-motion — templates/countup.ts
// Count-up stats banner. Stats sit in HORIZONTAL columns (numbers side by
// side — never stacked, so tall stat counts can't overflow a short banner).
// CSS cannot animate text content, so each number is a stack of pre-formatted
// "digit layers" gated by single opacity tracks (the digit-layer trick).
// Loop: count up → hold → soft reset (numbers dissolve back to zero, bars
// drain, labels fade) — every track returns to its t=0 value (strict seam).
//
// v0.2: theme tokens, motion personality, Google Fonts, windowed glow
// (frozen through the hold → byte-identical GIF frames → hold collapse).

import { createTimeline } from "../timeline.js";
import { checkLoopSeam } from "../loop.js";
import { h } from "../jsx.js";
import type { ReactElementLike } from "../types.js";
import { ambientWindow } from "../personality.js";
import {
  clamp, root, themeGlow, loopPeriod, evenWindow, fitFontSize,
  resolveTemplateStyle, textStyles,
  type BannerResult, type TemplateStyleProps,
} from "./shared.js";

export interface CountUpStat {
  label: string;
  /** Final number counted up to. */
  value: number;
  /** Appended to every layer, e.g. "k", "%", "+". */
  suffix?: string;
  decimals?: number;
}

export interface CountUpProps extends TemplateStyleProps {
  /** Eyebrow heading above the stats. Static. */
  title?: string;
  stats: CountUpStat[];
  accent?: string;
  background?: string;
  /** Number of count steps (layers per stat). Default 6. */
  steps?: number;
  /** Count-up duration, ms. Default 1200. */
  countMs?: number;
  /** Delay before counting starts, ms. Default 450. */
  startMs?: number;
  /** Hold at full value, ms. Default 1800 (scaled by personality holdBias). */
  holdMs?: number;
  /** Custom number formatter. Default: en-US grouping. */
  format?: (value: number) => string;
}

const defaultFormat = (value: number, decimals: number): string =>
  decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString("en-US");

const GATE_MS = 60;      // layer crossfade span (short — holds must read as solid numbers)
const COL_GAP_MS = 140;  // stagger between stat columns
const RESET_MS = 340;    // soft reset at the loop seam
const TAIL_MS = 260;     // settled zero-state before restart

export async function countUpBanner(props: CountUpProps): Promise<BannerResult> {
  const width = props.width ?? 850;
  const height = props.height ?? 200;
  const fps = props.fps ?? 20;

  const style = await resolveTemplateStyle(props);
  const { theme, personality } = style;
  const accent = props.accent ?? theme.accent;
  const background = props.background ?? theme.bg;
  const steps = clamp(2, props.steps ?? 6, 24);
  const countMs = Math.max(300, props.countMs ?? 1200);
  const startMs = Math.max(0, props.startMs ?? 450);
  const holdMs = Math.max(300, (props.holdMs ?? 1800) * personality.holdBias);

  if (props.stats.length === 0) throw new Error("countUpBanner: at least one stat is required.");
  if (props.stats.length > 4) {
    throw new Error("countUpBanner: at most 4 stats fit a banner legibly.");
  }

  const statCount = props.stats.length;
  const padX = 56;
  const gap = 64;
  const colW = Math.floor((width - 2 * padX - (statCount - 1) * gap) / statCount);
  const labelH = clamp(10, Math.round(height * 0.052), 14);

  // Fitted number size: the FINAL (widest) string of each stat must fit its
  // column; all layers share one size so columns sit on a common baseline.
  const fmts = props.stats.map((s) => props.format ?? ((v: number) => defaultFormat(v, s.decimals ?? 0)));
  const finalStrings = props.stats.map((s, i) => fmts[i](s.value) + (s.suffix ?? ""));
  const numFontSize = Math.min(
    ...(await Promise.all(finalStrings.map((text) =>
      fitFontSize({
        text,
        maxWidth: colW,
        fontWeight: 800,
        max: clamp(20, Math.round(height * 0.26), 56),
        min: 18,
        ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
        renderer: style.renderer,
      })
    )))
  );
  const numberH = Math.round(numFontSize * 1.18);

  // Loop period.
  const countEnd = startMs + (statCount - 1) * COL_GAP_MS + countMs + GATE_MS;
  const resetStart = countEnd + holdMs;
  const resetEnd = resetStart + RESET_MS;
  const period = loopPeriod(resetEnd + TAIL_MS, fps);

  // Windowed glow: drifts while counting and resetting, frozen through the hold.
  const countWindow = evenWindow(0, countEnd, fps);
  const resetWindow = evenWindow(resetStart, resetEnd, fps, countWindow[1]);

  const tl = createTimeline({ fps });

  const glowEl = themeGlow("cu-glow", theme, {
    width: Math.round(width * 0.32),
    height: Math.round(height * 1.4),
    left: Math.round(width * 0.6),
    top: Math.round(-height * 0.2),
  });
  ambientWindow(tl, ".cu-glow", "drift", {
    periodMs: period,
    windows: [countWindow, resetWindow],
    intensity: personality.ambient,
    fps,
    label: "countUpBanner glow",
  });

  // Eyebrow title (static — visible from frame 0 to end, no seam footprint).
  let titleEl: ReactElementLike | null = null;
  if (props.title) {
    titleEl = h("div", {
      className: "cu-title",
      style: {
        ...textStyles(theme, clamp(11, Math.round(height * 0.06), 17), { faint: true, weight: 600 }),
        letterSpacing: Math.max(3, Math.round(height * 0.022)),
        marginBottom: Math.round(height * 0.055),
      },
      children: props.title,
    });
  }

  const stepMs = countMs / steps;
  const statEls = props.stats.map((stat, i) => {
    const fmt = fmts[i];
    const cs = startMs + i * COL_GAP_MS;
    const layerCount = steps + 1;

    for (let j = 0; j < layerCount; j++) {
      const selector = `.cu-num-${i}-${j}`;
      const appearAt = cs + j * stepMs;
      if (j === 0) {
        // Zero state: visible at t=0, yields as counting begins, returns at reset.
        tl.add(selector, { opacity: [1, 0, 0, 1] }, {
          at: 0, type: "tween", duration: period,
          times: [0, (appearAt + GATE_MS) / period, resetStart / period, resetEnd / period],
          ease: ["linear", "linear", "easeOut"],
        });
      } else if (j < steps) {
        const hideAt = cs + (j + 1) * stepMs;
        tl.add(selector, { opacity: [0, 1, 1, 0] }, {
          at: 0, type: "tween", duration: period,
          times: [appearAt / period, (appearAt + GATE_MS) / period, hideAt / period, (hideAt + GATE_MS) / period],
          ease: ["linear", "linear", "linear"],
        });
      } else {
        // Final layer: appears once, holds, dissolves at the reset.
        tl.add(selector, { opacity: [0, 1, 1, 0] }, {
          at: 0, type: "tween", duration: period,
          times: [appearAt / period, (appearAt + GATE_MS) / period, resetStart / period, resetEnd / period],
          ease: ["linear", "linear", "easeIn"],
        });
      }
    }

    // Accent underline: overshoot via the personality's overshoot easing
    // (single track keeps the strict seam honest — springs can't return in
    // the same track).
    tl.add(`.cu-fill-${i}`, { scaleX: [0, 1, 1, 0] }, {
      at: 0, type: "tween", duration: period,
      times: [cs / period, (cs + 280) / period, resetStart / period, resetEnd / period],
      ease: [personality.overshoot, "linear", "easeIn"],
    });

    // Label: fades in as its column starts counting, out at the reset.
    tl.add(`.cu-label-${i}`, { opacity: [0, 1, 1, 0] }, {
      at: 0, type: "tween", duration: period,
      times: [(cs + 60) / period, (cs + 320) / period, resetStart / period, resetEnd / period],
      ease: ["easeOut", "linear", "easeIn"],
    });

    const numberStyle = textStyles(theme, numFontSize, { weight: 800, lineHeight: 1.15 });
    const numberBox = h("div", {
      style: {
        position: "relative",
        height: numberH,
        width: colW,
      },
      children: Array.from({ length: layerCount }, (_, j) =>
        h("div", {
          className: `cu-num-${i}-${j}`,
          style: {
            ...numberStyle,
            position: "absolute",
            left: 0,
            top: 0,
            width: colW,
            textAlign: "center",
            whiteSpace: "pre",
          },
          children: fmt((stat.value * j) / steps) + (stat.suffix ?? ""),
        })
      ),
    });

    const barW = Math.round(colW * 0.62);
    return h("div", {
      style: {
        display: "flex", flexDirection: "column", alignItems: "center",
        ...(i < statCount - 1 ? { marginRight: gap } : {}),
      },
      children: [
        numberBox,
        h("div", {
          className: `cu-fill-${i}`,
          style: {
            width: barW,
            height: 3,
            backgroundColor: accent,
            borderRadius: 2,
            marginTop: Math.round(numberH * 0.16),
            transformOrigin: "center center",
            opacity: 0.85,
          },
        }),
        h("div", {
          className: `cu-label-${i}`,
          style: {
            ...textStyles(theme, labelH, { dim: true, weight: 500 }),
            letterSpacing: 1.6,
            marginTop: 9,
          },
          children: stat.label,
        }),
      ],
    });
  });

  const element = root({
    width,
    height,
    className: "cu-root",
    background,
    theme,
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    children: [glowEl, ...(titleEl ? [titleEl] : []), h("div", {
      style: { display: "flex", justifyContent: "center", alignItems: "flex-start" },
      children: statEls,
    })],
  });

  const timeline = tl.toJSON();
  const seam = checkLoopSeam(timeline);
  if (!seam.seamless) {
    throw new Error(`countUpBanner: internal loop check failed: ${seam.notes.join(" ")}`);
  }
  return {
    element,
    timeline,
    ...(props.font ? { fonts: [typeof props.font === "string" ? { name: props.font, weight: props.fontWeights ?? [400, 700] } : props.font] } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    theme: theme.name,
    motion: personality.name,
  };
}
