// takumi-motion — spring.ts
// Verbatim-faithful port of Motion v14.6.0's analytic spring solver
// (packages/motion-dom/src/animation/generators/spring.ts).
// Closed-form math on f64 — deterministic, and the exact port target for the
// Rust-native clock in the RFC's Phase 1.

export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
  /** ms at the generator layer. */
  duration?: number;
  bounce?: number;
  /** seconds */
  visualDuration?: number;
  velocity?: number;
  restSpeed?: number;
  restDelta?: number;
  keyframes: number[];
}

const springDefaults = {
  stiffness: 100,
  damping: 10,
  mass: 1.0,
  duration: 800, // ms
  bounce: 0.3,
  visualDuration: 0.3, // seconds
  restSpeed: { granular: 0.01, default: 2 },
  restDelta: { granular: 0.005, default: 0.5 },
  minDuration: 0.01, // seconds
  maxDuration: 10.0, // seconds
  minDamping: 0.05,
};

const clamp = (min: number, max: number, value: number) =>
  value > max ? max : value < min ? min : value;

const millisecondsToSeconds = (ms: number) => ms / 1000;
const secondsToMilliseconds = (s: number) => s * 1000;

const bounceToDampingRatio = (bounce: number) =>
  bounce < 0
    ? 1 / Math.max(1 + bounce, springDefaults.minDamping)
    : Math.max(1 - bounce, springDefaults.minDamping);

function overdampedFreqScale(dampingRatio: number, criticalFreqTime: number) {
  if (!(dampingRatio > 1)) return 1;

  const root = Math.sqrt(dampingRatio * dampingRatio - 1);
  const slow = dampingRatio - root;
  const fast = dampingRatio + root;
  const target = 2 * root * Math.exp(-criticalFreqTime) * (1 + criticalFreqTime);

  return (
    approximateRoot(
      (freqTime) =>
        fast * Math.exp(-slow * freqTime) -
        slow * Math.exp(-fast * freqTime) -
        target,
      (freqTime) => Math.exp(-fast * freqTime) - Math.exp(-slow * freqTime),
      criticalFreqTime
    ) / criticalFreqTime
  );
}

function calcAngularFreq(undampedFreq: number, dampingRatio: number) {
  return undampedFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
}

const rootIterations = 12;
function approximateRoot(
  envelope: (num: number) => number,
  derivative: (num: number) => number,
  initialGuess: number
): number {
  let result = initialGuess;
  for (let i = 1; i < rootIterations; i++) {
    result = result - envelope(result) / derivative(result);
  }
  return result;
}

const safeMin = 0.001;

/**
 * Duration/bounce → physics fitting (ported from Framer).
 * Assumes zero initial velocity and default mass.
 */
function findSpring({ duration = springDefaults.duration, bounce = springDefaults.bounce }: SpringOptions) {
  let envelope: (num: number) => number;
  let derivative: (num: number) => number;

  const dampingRatio = bounceToDampingRatio(bounce);

  duration = clamp(
    springDefaults.minDuration,
    springDefaults.maxDuration,
    millisecondsToSeconds(duration)
  );

  if (dampingRatio < 1) {
    // Underdamped
    envelope = (undampedFreq) => {
      const exponentialDecay = undampedFreq * dampingRatio;
      const delta = exponentialDecay * duration;
      const b = calcAngularFreq(undampedFreq, dampingRatio);
      const c = Math.exp(-delta);
      return safeMin - (exponentialDecay / b) * c;
    };

    derivative = (undampedFreq) => {
      const exponentialDecay = undampedFreq * dampingRatio;
      const delta = exponentialDecay * duration;
      const e =
        dampingRatio * dampingRatio * undampedFreq * undampedFreq * duration;
      const f = Math.exp(-delta);
      const g = calcAngularFreq(undampedFreq * undampedFreq, dampingRatio);
      const factor = -envelope(undampedFreq) + safeMin > 0 ? -1 : 1;
      return (factor * -e * f) / g;
    };
  } else {
    // Critically damped (overdamped springs reuse this root, scaled below)
    envelope = (undampedFreq) => {
      const a = Math.exp(-undampedFreq * duration);
      const b = undampedFreq * duration + 1;
      return -safeMin + a * b;
    };

    derivative = (undampedFreq) => {
      const a = Math.exp(-undampedFreq * duration);
      const b = -undampedFreq * (duration * duration);
      return a * b;
    };
  }

  const initialGuess = 5 / duration;
  const criticalFreq = approximateRoot(envelope, derivative, initialGuess);
  const undampedFreq =
    criticalFreq * overdampedFreqScale(dampingRatio, criticalFreq * duration);
  const stiffness = undampedFreq * undampedFreq;

  return {
    stiffness,
    damping: dampingRatio * 2 * Math.sqrt(stiffness),
    duration: secondsToMilliseconds(duration),
  };
}

const isValidPhysics = (value: number | undefined, canBeZero?: boolean) =>
  (canBeZero ? (value as number) >= 0 : (value as number) > 0) && (value as number) < Infinity;

function resolvePhysics(value: number | undefined, canBeZero?: boolean) {
  if (isValidPhysics(value, canBeZero)) return value;
  return undefined;
}

function getSpringOptions(options: SpringOptions) {
  const validStiffness = resolvePhysics(options.stiffness);
  const validDamping = resolvePhysics(options.damping, true);
  const validMass = resolvePhysics(options.mass);

  const springOptions = {
    ...options,
    stiffness: validStiffness ?? springDefaults.stiffness,
    damping: validDamping ?? springDefaults.damping,
    mass: validMass ?? springDefaults.mass,
    isResolvedFromDuration: false,
    // stiffness/damping/mass override duration/bounce
    isTimeDefined:
      (validStiffness ?? validDamping ?? validMass) === undefined &&
      (options.duration !== undefined || options.bounce !== undefined),
  };

  if (springOptions.isTimeDefined) {
    if (options.visualDuration) {
      const dampingRatio = bounceToDampingRatio(options.bounce || 0);
      const root =
        ((2 * Math.PI) / (options.visualDuration * 1.2)) *
        overdampedFreqScale(dampingRatio, (2 * Math.PI) / 1.2);
      springOptions.stiffness = root * root;
      springOptions.damping = 2 * dampingRatio * Math.sqrt(springOptions.stiffness);
    } else {
      Object.assign(springOptions, findSpring(springOptions));
      springOptions.isResolvedFromDuration = true;
    }

    if (!isValidPhysics(springOptions.stiffness) || !isValidPhysics(springOptions.damping, true)) {
      springOptions.stiffness = springDefaults.stiffness;
      springOptions.damping = springDefaults.damping;
    }
  }

  return springOptions;
}

export interface SpringGenerator {
  calculatedDuration: number | null;
  /** Aim the spring at a new target from current position and velocity. */
  retarget(keyframes: number[], newVelocity: number): void;
  /** Analytical velocity in units/ms. */
  velocity(t: number): number;
  next(t: number): { done: boolean; value: number };
}

export function springGenerator(options: SpringOptions): SpringGenerator {
  const origin = options.keyframes[0];
  const target = options.keyframes[options.keyframes.length - 1];

  const {
    stiffness,
    damping,
    mass,
    duration,
    isResolvedFromDuration,
    isTimeDefined,
  } = getSpringOptions({ ...options });

  // Time-defined springs ignore inherited velocity.
  const inheritVelocity = (velocity: number) =>
    isTimeDefined ? 0 : -millisecondsToSeconds(velocity);

  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const undampedAngularFreq = millisecondsToSeconds(Math.sqrt(stiffness / mass));
  const decay = dampingRatio * undampedAngularFreq;

  const s = {
    target,
    delta: target - origin,
    velocity: inheritVelocity(options.velocity || 0) || 0,
    restSpeed: 0,
    restDelta: 0,
  };

  const setRestThresholds = () => {
    const isGranularScale = Math.abs(s.delta) < 5;
    s.restSpeed =
      options.restSpeed ||
      (isGranularScale ? springDefaults.restSpeed.granular : springDefaults.restSpeed.default);
    s.restDelta =
      options.restDelta ||
      (isGranularScale ? springDefaults.restDelta.granular : springDefaults.restDelta.default);
  };
  setRestThresholds();

  let resolveSpring: (t: number) => number;
  let resolveVelocity: (t: number) => number;
  let update: () => void;

  if (dampingRatio < 1) {
    const angularFreq = calcAngularFreq(undampedAngularFreq, dampingRatio);
    const c = { A: 0, sinC: 0, cosC: 0 };

    update = () => {
      c.A = (s.velocity + decay * s.delta) / angularFreq;
      c.sinC = decay * c.A + s.delta * angularFreq;
      c.cosC = decay * s.delta - c.A * angularFreq;
    };

    resolveSpring = (t: number) => {
      const env = Math.exp(-decay * t);
      const sin = Math.sin(angularFreq * t);
      const cos = Math.cos(angularFreq * t);
      return s.target - env * (c.A * sin + s.delta * cos);
    };

    resolveVelocity = (t: number) => {
      const env = Math.exp(-decay * t);
      const sin = Math.sin(angularFreq * t);
      const cos = Math.cos(angularFreq * t);
      return env * (c.sinC * sin + c.cosC * cos);
    };
  } else if (dampingRatio === 1) {
    // Critically damped
    resolveSpring = (t: number) =>
      s.target -
      Math.exp(-undampedAngularFreq * t) *
        (s.delta + (s.velocity + undampedAngularFreq * s.delta) * t);

    const c = { C: 0 };
    update = () => {
      c.C = s.velocity + undampedAngularFreq * s.delta;
    };
    resolveVelocity = (t: number) =>
      Math.exp(-undampedAngularFreq * t) *
      (undampedAngularFreq * c.C * t - s.velocity);
  } else {
    // Overdamped: sum of a slow and a fast decaying exponential
    const dampedAngularFreq =
      undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
    const slow = decay - dampedAngularFreq;
    const fast = decay + dampedAngularFreq;

    // Non-physical limit kept for drag-spring parity (see motion #1207)
    const limit =
      dampedAngularFreq < 1 || isTimeDefined ? Infinity : 300 / dampedAngularFreq;
    const decayAt = (rate: number, t: number) =>
      Math.exp(t > limit ? (decay - rate) * limit - decay * t : -rate * t);

    const c = { S: 0, F: 0 };
    update = () => {
      const P = (s.velocity + decay * s.delta) / dampedAngularFreq;
      c.S = (s.delta + P) / 2;
      c.F = (s.delta - P) / 2;
    };

    resolveSpring = (t: number) =>
      s.target - c.S * decayAt(slow, t) - c.F * decayAt(fast, t);

    resolveVelocity = (t: number) =>
      slow * c.S * decayAt(slow, t) + fast * c.F * decayAt(fast, t);
  }

  update();

  const calculatedDuration = isResolvedFromDuration ? duration || null : null;

  const generator: SpringGenerator = {
    calculatedDuration,
    retarget: (keyframes: number[], newVelocity: number) => {
      s.target = keyframes[keyframes.length - 1];
      s.delta = s.target - keyframes[0];
      s.velocity = inheritVelocity(newVelocity);
      if (!(options.restSpeed && options.restDelta)) setRestThresholds();
      generator.calculatedDuration = calculatedDuration;
      update();
    },
    velocity: (t: number) => secondsToMilliseconds(resolveVelocity(t)),
    next: (t: number) => {
      const current = resolveSpring(t);

      let done: boolean;
      if (!isResolvedFromDuration) {
        const currentVelocity = secondsToMilliseconds(resolveVelocity(t));
        done =
          Math.abs(currentVelocity) <= s.restSpeed &&
          Math.abs(s.target - current) <= s.restDelta;
      } else {
        done = t >= (duration as number);
      }

      return { done, value: done ? s.target : current };
    },
  };

  return generator;
}

/** Practical max duration for generator scans (prevents infinite loops). */
export const maxGeneratorDuration = 20_000;

/**
 * Scan a generator for its settle duration — port of calcGeneratorDuration.
 * Physics springs quantize to the 50 ms time step, exactly like Motion.
 */
export function calcGeneratorDuration(
  generator: { next: (t: number) => { done: boolean; value: unknown } },
  timeStep = 50,
  maxDuration = maxGeneratorDuration
): number {
  let duration = 0;
  let state = generator.next(duration);

  while (!state.done && duration < maxDuration) {
    duration += timeStep;
    state = generator.next(duration);
  }

  return duration >= maxDuration ? Infinity : duration;
}

export { springDefaults };
