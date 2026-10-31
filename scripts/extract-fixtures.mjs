// Extract golden fixture values from the REAL motion package (v14.6.0).
// These fixtures become the test oracle for takumi-motion's TypeScript port
// (and later the Rust port) of Motion's animation math.
import { spring, inertia, keyframes, cubicBezier, steps } from "motion";
import { writeFileSync } from "node:fs";

const out = { meta: { source: "motion@14.6.0", generatedAt: new Date().toISOString() }, spring: {}, inertia: {}, tween: {}, easing: {} };

// ---- spring fixtures ----
const springConfigs = {
  default: { keyframes: [0, 100] },
  stiff: { keyframes: [0, 100], stiffness: 170, damping: 20 },
  timeDefined: { keyframes: [0, 100], duration: 800, bounce: 0.3 },
  visualDuration: { keyframes: [0, 100], visualDuration: 0.3, bounce: 0.25 },
  overdamped: { keyframes: [0, 100], stiffness: 100, damping: 40 },
  undamped: { keyframes: [0, 100], stiffness: 80, damping: 0 },
  granularScale: { keyframes: [0, 2], stiffness: 300, damping: 22 },
  negativeBounce: { keyframes: [0, 100], duration: 500, bounce: -0.5 },
  withVelocity: { keyframes: [0, 100], stiffness: 120, damping: 14, velocity: 500 },
};

const grid = Array.from({ length: 41 }, (_, i) => i * 25); // 0..1000ms step 25
for (const [name, opts] of Object.entries(springConfigs)) {
  const gen = spring({ ...opts });
  out.spring[name] = {
    options: opts,
    calculatedDuration: gen.calculatedDuration,
    samples: grid.map((t) => ({ t, v: gen.next(t).value, done: gen.next(t).done, vel: gen.velocity(t) })),
    settle: (() => {
      let d = 0, s = gen.next(0);
      while (!s.done && d < 20000) { d += 50; s = gen.next(d); }
      return d >= 20000 ? null : d;
    })(),
  };
}

// ---- inertia fixture ----
const inertiaGen = inertia({ keyframes: [0], velocity: 3000, power: 0.8, timeConstant: 325, bounceStiffness: 500, bounceDamping: 10, min: -50, max: 160, restDelta: 0.5 });
out.inertia.decayWithBounce = {
  options: { keyframes: [0], velocity: 3000, power: 0.8, timeConstant: 325, bounceStiffness: 500, bounceDamping: 10, min: -50, max: 160 },
  samples: grid.map((t) => ({ t, v: inertiaGen.next(t).value, done: inertiaGen.next(t).done })),
};

// ---- tween (keyframes generator) fixtures ----
const tweenConfigs = {
  twoPoint: { keyframes: [0, 100], duration: 300, ease: [0.25, 0.1, 0.35, 1] },
  multi: { keyframes: [0, 120, 80, 100], duration: 800, ease: "easeInOut" },
  perSegmentEase: { keyframes: [0, 100, 40], duration: 600, ease: ["easeOut", "backOut"] },
  withTimes: { keyframes: [0, 100], duration: 500, ease: "circOut", times: [0, 0.7] },
};
for (const [name, opts] of Object.entries(tweenConfigs)) {
  const gen = keyframes({ ...opts });
  out.tween[name] = { options: opts, samples: grid.map((t) => ({ t, v: gen.next(t).value, done: gen.next(t).done })) };
}

// ---- easing fixtures ----
const pGrid = Array.from({ length: 21 }, (_, i) => i / 20);
const backOut = cubicBezier(0.33, 1.53, 0.69, 0.99);
const circIn = (p) => 1 - Math.sin(Math.acos(p));
const named = {
  linear: (p) => p,
  easeIn: cubicBezier(0.42, 0, 1, 1),
  easeOut: cubicBezier(0, 0, 0.58, 1),
  easeInOut: cubicBezier(0.42, 0, 0.58, 1),
  backOut,
  backIn: (p) => 1 - backOut(1 - p),
  backInOut: (p) => (p <= 0.5 ? (1 - backOut(1 - p * 2)) / 2 : (2 - (1 - backOut(1 - (2 - p * 2)))) / 2),
  circIn,
  circOut: (p) => 1 - circIn(1 - p),
  circInOut: (p) => (p <= 0.5 ? circIn(p * 2) / 2 : (2 - circIn(2 - p * 2)) / 2),
  anticipate: (p) => (p >= 1 ? 1 : (p *= 2) < 1 ? 0.5 * (1 - backOut(1 - p)) : 0.5 * (2 - Math.pow(2, -10 * (p - 1)))),
};
for (const [name, fn] of Object.entries(named)) {
  out.easing[name] = pGrid.map((p) => fn(p));
}
out.easing.stepsEnd = pGrid.map((p) => steps(5, "end")(p));
out.easing.stepsStart = pGrid.map((p) => steps(5, "start")(p));

const file = new URL("./fixtures.json", import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log("fixtures written:", file.pathname);
console.log("spring default settle:", out.spring.default.settle, "timeDefined settle:", out.spring.timeDefined.settle);
console.log("spring default @250ms:", JSON.stringify(out.spring.default.samples[10]));
console.log("withVelocity @250:", JSON.stringify(out.spring.withVelocity.samples[10]));
console.log("inertia @250:", JSON.stringify(out.inertia.decayWithBounce.samples[10]));
console.log("tween multi @250:", JSON.stringify(out.tween.multi.samples[10]));
