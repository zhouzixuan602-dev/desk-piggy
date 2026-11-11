// Animation clips. Each clip is a pure function of time that returns the
// channels it cares about (see REST in pig.js); everything else rests.
// No three.js in here, so clips can be unit-tested in plain Node.

const { sin, cos, abs, PI, max, min, exp, floor } = Math;
const TAU = PI * 2;

export const clamp = (x, a = 0, b = 1) => min(b, max(a, x));
export const ease = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
const bump = (t, center, width) => exp(-(((t - center) / width) ** 2));
const mod = (a, n) => ((a % n) + n) % n;

/** Smoothly interpolated keyframes: [[time, value], ...] sorted by time. */
export function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

/** Ballistic hop between t0 and t1 reaching `height`. */
const arc = (t, t0, t1, height) => {
  if (t <= t0 || t >= t1) return 0;
  const u = (t - t0) / (t1 - t0);
  return 4 * height * u * (1 - u);
};

// A relaxed sitting pose shared by a few clips.
const SIT = { y: -0.07, squash: -0.06, legLx: 1.42, legRx: 1.42, legSplay: 0.42, leanX: -0.04 };

/** World units travelled per second by the `walk` clip at speed 1 (keeps feet from sliding). */
export const WALK_UNITS_PER_SEC = 0.95;
export const RUN_FACTOR = 2.1;

export const CLIPS = {
  idle: {
    loop: true,
    fps: 30,
    look: true,
    fn(t) {
      const breath = sin(t * 2.1);
      const fidget = 0.5 + 0.5 * sin(t * 0.37);
      return {
        squash: breath * 0.013,
        headZ: sin(t * 0.7) * 0.03,
        headX: sin(t * 0.9 + 1) * 0.015,
        armLz: breath * 0.025,
        armRz: breath * 0.025,
        tail: sin(t * 3.1) * 0.3 * fidget,
        earL: bump(mod(t, 5.3), 0.5, 0.1) * -0.4,
        earR: bump(mod(t + 1.7, 6.1), 0.5, 0.1) * -0.4,
        scarf: sin(t * 1.3) * 0.03,
      };
    },
  },

  walk: {
    loop: true,
    fps: 60,
    fn(t, c) {
      const fast = c.run ? 1 : 0;
      const p = t * TAU * (1.55 + fast * 0.75);
      const d = c.dir || 1;
      const s = sin(p);
      return {
        turn: d * (0.95 + fast * 0.2),
        headY: -d * (0.45 + fast * 0.1),
        y: abs(s) * (0.05 + fast * 0.05),
        leanX: 0.05 + fast * 0.12,
        leanZ: s * 0.075,
        squash: -abs(cos(p)) * 0.025,
        legLx: s * (0.56 + fast * 0.2),
        legRx: -s * (0.56 + fast * 0.2),
        armLx: -s * (0.5 + fast * 0.4),
        armRx: s * (0.5 + fast * 0.4),
        armLz: fast * 0.25,
        armRz: fast * 0.25,
        tail: sin(p * 2) * 0.35,
        scarf: s * 0.12,
        mouthOpen: fast * 0.35,
        eyeHappy: 0,
      };
    },
  },

  hop: {
    duration: 1.0,
    fn(t) {
      const armUp = kf(t, [[0, 0], [0.14, -0.25], [0.3, 1.25], [0.62, 1.05], [0.82, 0.1], [1, 0]]);
      const tuck = kf(t, [[0, 0], [0.2, 0], [0.34, 0.45], [0.6, 0.3], [0.74, 0], [1, 0]]);
      return {
        y: arc(t, 0.2, 0.72, 0.82),
        squash: kf(t, [[0, 0], [0.14, -0.2], [0.25, 0.17], [0.46, 0.03], [0.68, 0.1], [0.77, -0.22], [0.89, 0.05], [1, 0]]),
        armLz: armUp,
        armRz: armUp,
        legLx: tuck,
        legRx: tuck,
        legSplay: tuck * 0.4,
        eyeOpen: 1.15,
        mouthOpen: kf(t, [[0, 0], [0.2, 0], [0.32, 0.55], [0.66, 0.5], [0.8, 0], [1, 0]]),
        blush: 0.65,
      };
    },
  },

  happy: {
    duration: 1.25,
    fn(t) {
      const h = arc(t, 0.08, 0.42, 0.3) + arc(t, 0.48, 0.82, 0.22);
      const wig = sin(t * 26) * 0.5 + 0.5;
      const on = kf(t, [[0, 0], [0.1, 1], [1.0, 1], [1.25, 0]]);
      return {
        y: h,
        squash: kf(t, [[0, 0], [0.07, -0.12], [0.2, 0.09], [0.44, -0.12], [0.6, 0.07], [0.85, -0.09], [1.0, 0.02], [1.25, 0]]),
        headZ: sin(t * 9) * 0.1,
        armLz: on * (0.8 + wig * 0.45),
        armRz: on * (0.8 + (1 - wig) * 0.45),
        armLx: on * 0.35,
        armRx: on * 0.35,
        eyeHappy: t < 1.08 ? 1 : 0,
        mouthOpen: t < 1.05 ? 0.5 : 0,
        blush: 0.95,
        tail: sin(t * 24) * 0.7,
        earL: -0.2,
        earR: -0.2,
      };
    },
  },

  wave: {
    duration: 2.5,
    look: true,
    fn(t) {
      const on = kf(t, [[0, 0], [0.28, 1], [2.1, 1], [2.5, 0]]);
      return {
        // the head is wider than the shoulders, so wave out to the side and a little forward
        turn: on * 0.22,
        headY: on * -0.2,
        armRz: on * (1.2 + sin(t * 13) * 0.38),
        armRx: on * 0.55,
        armLz: on * 0.12,
        headZ: on * 0.17,
        leanZ: on * -0.07,
        y: on * abs(sin(t * 6.5)) * 0.035,
        eyeHappy: t > 0.2 && t < 2.15 ? 1 : 0,
        mouthOpen: on * 0.45,
        blush: 0.5 + on * 0.3,
        tail: sin(t * 14) * 0.5 * on,
      };
    },
  },

  dance: {
    duration: 8,
    fps: 60,
    fn(t) {
      const b = t / 0.5; // beats at 120 BPM
      const bar = floor(b / 4) % 4;
      const s = sin(b * PI);
      const bounce = abs(sin(b * PI));
      const base = {
        y: bounce * 0.17,
        squash: -0.07 * (1 - bounce) + 0.035 * bounce,
        eyeHappy: 1,
        mouthOpen: 0.3 + 0.2 * bounce,
        blush: 0.8,
        tail: sin(b * TAU) * 0.6,
        scarf: s * 0.18,
      };
      if (bar === 0) {
        // side-to-side sway, arms in the air
        return { ...base, leanZ: s * 0.17, headZ: -s * 0.15, armLz: 1.05 + s * 0.45, armRz: 1.05 - s * 0.45, armLx: 0.4, armRx: 0.4, legLx: max(0, s) * 0.45, legRx: max(0, -s) * 0.45 };
      }
      if (bar === 1) {
        // the twist
        return { ...base, turn: s * 0.6, headY: -s * 0.35, armLz: 0.9, armRz: 0.9, armLx: s * 0.9, armRx: -s * 0.9, leanZ: s * 0.06 };
      }
      if (bar === 2) {
        // point left, point right
        const side = sin(b * PI * 0.5) > 0 ? 1 : -1;
        return { ...base, leanZ: side * 0.14, headZ: side * 0.12, armLz: side > 0 ? 0.1 : 1.5, armRz: side > 0 ? 1.5 : 0.1, armLx: side > 0 ? 0 : 0.5, armRx: side > 0 ? 0.5 : 0, legSplay: 0.12 };
      }
      // big finish: a full spin with arms out
      const spin = ease((b % 4) / 3.2) * TAU;
      return { ...base, turn: spin, armLz: 1.25, armRz: 1.25, y: bounce * 0.24, legSplay: 0.1 };
    },
  },

  sit: {
    loop: true,
    fps: 30,
    look: true,
    fn(t) {
      const breath = sin(t * 2);
      return {
        ...SIT,
        squash: SIT.squash + breath * 0.012,
        headZ: sin(t * 0.6) * 0.05,
        armLx: 0.35,
        armRx: 0.35,
        tail: sin(t * 2.4) * 0.4,
        earL: bump(mod(t, 4.7), 0.5, 0.1) * -0.35,
        earR: bump(mod(t + 2, 5.9), 0.5, 0.1) * -0.35,
      };
    },
  },

  sleep: {
    loop: true,
    fps: 20,
    stiffness: 5,
    fn(t) {
      const breath = sin(t * 1.25);
      return {
        ...SIT,
        squash: SIT.squash - 0.03 + breath * 0.022,
        leanX: 0.03,
        headX: 0.15 + breath * 0.025,
        headZ: 0.12,
        armLx: 0.5,
        armRx: 0.5,
        earL: 0.55,
        earR: 0.6,
        eyeSleep: 1,
        mouthOpen: max(0, breath) * 0.22,
        blush: 0.42,
        tail: 0,
      };
    },
  },

  yawn: {
    duration: 2.2,
    fn(t) {
      const on = kf(t, [[0, 0], [0.5, 1], [1.5, 1], [2.2, 0]]);
      return {
        squash: on * 0.05,
        headX: on * -0.28,
        armLz: on * 1.45,
        armRz: on * 1.3,
        armLx: on * 0.3,
        armRx: on * 0.3,
        eyeSleep: on > 0.35 ? 1 : 0,
        mouthOpen: on * 1,
        earL: on * 0.3,
        earR: on * 0.3,
      };
    },
  },

  wake: {
    duration: 1.1,
    fn(t) {
      return {
        y: arc(t, 0.1, 0.5, 0.35),
        squash: kf(t, [[0, -0.1], [0.12, 0.14], [0.5, -0.14], [0.7, 0.04], [1.1, 0]]),
        eyeOpen: 1.25,
        earL: -0.5,
        earR: -0.5,
        armLz: kf(t, [[0, 0], [0.2, 1.2], [0.7, 0.2], [1.1, 0]]),
        armRz: kf(t, [[0, 0], [0.2, 1.2], [0.7, 0.2], [1.1, 0]]),
        mouthOpen: kf(t, [[0, 0.5], [0.6, 0.4], [0.9, 0]]),
      };
    },
  },

  sniff: {
    duration: 2.0,
    fn(t) {
      const on = kf(t, [[0, 0], [0.3, 1], [1.6, 1], [2, 0]]);
      return {
        leanX: on * 0.1,
        headX: on * 0.1,
        headY: on * sin(t * 3.2) * 0.3,
        snoutY: on * sin(t * 30),
        earL: on * -0.25,
        earR: on * -0.25,
        tail: sin(t * 6) * 0.3,
      };
    },
  },

  nod: {
    duration: 1.1,
    look: true,
    fn(t) {
      const on = kf(t, [[0, 0], [0.15, 1], [0.9, 1], [1.1, 0]]);
      return { headX: on * (0.12 + sin(t * 13 - 1) * 0.16), eyeHappy: on > 0.5 ? 1 : 0, blush: 0.6 };
    },
  },

  eat: {
    duration: 3.6,
    fn(t) {
      const hold = kf(t, [[0, 0], [0.3, 1], [3.0, 1], [3.4, 0]]);
      const munch = t > 0.5 && t < 3.0 ? sin((t - 0.5) * 15) : 0;
      return {
        armLx: hold * 1.25,
        armRx: hold * 1.25,
        armLz: hold * -0.5,
        armRz: hold * -0.5,
        headX: hold * (0.2 + max(0, munch) * 0.08),
        mouthOpen: hold * max(0, munch) * 0.75,
        squash: munch * 0.012,
        eyeHappy: t > 0.9 && t < 3.3 ? 1 : 0,
        blush: 0.5 + hold * 0.35,
        tail: sin(t * 10) * 0.5,
        apple: kf(t, [[0, 0], [0.25, 1], [0.9, 1], [1.5, 0.72], [2.1, 0.45], [2.7, 0.2], [3.0, 0]]),
      };
    },
  },

  // Held by the scruff: dangle and kick.
  dragged: {
    loop: true,
    fps: 60,
    stiffness: 30,
    fn(t, c) {
      const swing = clamp(c.swing || 0, -1, 1);
      return {
        squash: 0.09,
        leanZ: swing * 0.5,
        headZ: -swing * 0.2,
        armLz: -0.15 - swing * 0.3,
        armRz: -0.15 + swing * 0.3,
        armLx: 0.2,
        armRx: 0.2,
        legLx: 0.15 + sin(t * 10) * 0.3,
        legRx: 0.15 - sin(t * 10) * 0.3,
        legSplay: 0.1,
        eyeOpen: 1.25,
        mouthOpen: 0.45,
        earL: -0.3,
        earR: -0.3,
        tail: sin(t * 16) * 0.6,
        scarf: -swing * 0.6,
      };
    },
  },

  fall: {
    loop: true,
    fps: 60,
    stiffness: 30,
    fn(t) {
      return {
        squash: 0.13,
        armLz: 1.4 + sin(t * 22) * 0.25,
        armRz: 1.4 - sin(t * 22) * 0.25,
        legLx: sin(t * 18) * 0.35,
        legRx: -sin(t * 18) * 0.35,
        legSplay: 0.22,
        eyeOpen: 1.25,
        mouthOpen: 0.8,
        earL: -0.75,
        earR: -0.75,
        scarf: 0.3,
      };
    },
  },

  land: {
    duration: 0.9,
    stiffness: 34,
    fn(t) {
      return {
        squash: kf(t, [[0, -0.34], [0.14, 0.13], [0.3, -0.1], [0.46, 0.04], [0.62, -0.02], [0.9, 0]]),
        armLz: kf(t, [[0, 1.2], [0.3, 0.3], [0.9, 0]]),
        armRz: kf(t, [[0, 1.2], [0.3, 0.3], [0.9, 0]]),
        legSplay: kf(t, [[0, 0.3], [0.4, 0], [0.9, 0]]),
        eyeOpen: t < 0.32 ? 0.08 : 1,
        earL: kf(t, [[0, 0.7], [0.3, -0.2], [0.9, 0]]),
        earR: kf(t, [[0, 0.7], [0.3, -0.2], [0.9, 0]]),
        mouthOpen: t < 0.3 ? 0.3 : 0,
      };
    },
  },

  // Assistant form: hovering, ears pricked, listening.
  siri: {
    loop: true,
    fps: 60,
    look: true,
    stiffness: 12,
    fn(t) {
      const bob = sin(t * 2.2);
      const nod = bump(mod(t, 4.6), 3.6, 0.22);
      return {
        y: 0.3 + bob * 0.06,
        squash: 0.03 + bob * 0.012,
        leanX: -0.03,
        headZ: sin(t * 0.85) * 0.11,
        headX: -0.05 + nod * 0.16,
        earL: -0.42 + bump(mod(t, 2.9), 0.4, 0.08) * -0.25,
        earR: -0.42 + bump(mod(t + 1.3, 3.7), 0.4, 0.08) * -0.25,
        earSpread: 0.08,
        armLz: 0.5 + sin(t * 2.2 + 1) * 0.12,
        armRz: 0.5 + sin(t * 2.2 + 1.6) * 0.12,
        legLx: 0.28 + bob * 0.09,
        legRx: 0.28 - bob * 0.09,
        legSplay: 0.1,
        eyeOpen: 1.12,
        blush: 0.68,
        tail: sin(t * 4) * 0.45,
        scarf: bob * 0.14,
      };
    },
  },

  // Pop in / out of existence (used by show / hide).
  appear: {
    duration: 0.7,
    fn(t) {
      return {
        scale: kf(t, [[0, 0.01], [0.28, 1.14], [0.45, 0.95], [0.7, 1]]),
        squash: kf(t, [[0, 0.3], [0.28, 0.1], [0.45, -0.08], [0.7, 0]]),
        eyeHappy: t < 0.6 ? 1 : 0,
        armLz: kf(t, [[0, 1.2], [0.45, 1.2], [0.7, 0]]),
        armRz: kf(t, [[0, 1.2], [0.45, 1.2], [0.7, 0]]),
      };
    },
  },

  vanish: {
    duration: 1.5,
    fn(t) {
      const waveOn = kf(t, [[0, 0], [0.2, 1], [0.95, 1], [1.1, 0]]);
      return {
        armRz: waveOn * (1.2 + sin(t * 14) * 0.38),
        armRx: waveOn * 0.55,
        headZ: waveOn * 0.15,
        eyeHappy: 1,
        scale: kf(t, [[0, 1], [1.05, 1], [1.2, 1.12], [1.5, 0.01]]),
        squash: kf(t, [[0, 0], [1.05, 0], [1.2, -0.1], [1.5, 0.4]]),
      };
    },
  },
};

export const CLIP_NAMES = Object.freeze(Object.keys(CLIPS));
