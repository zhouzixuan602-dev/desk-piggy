// Drives the rig: samples the current clip, layers blinking / look-at /
// springy secondary motion on top, and eases every channel towards its target
// so that any clip can interrupt any other without a pop.

import { REST, CHANNELS, applyPose } from './pig.js';
import { CLIPS, clamp } from './clips.js';

const TAU = Math.PI * 2;

/** Damped spring for follow-through (ears, tail, scarf). */
class Spring {
  constructor(stiffness = 120, damping = 9) {
    this.k = stiffness;
    this.c = damping;
    this.x = 0;
    this.v = 0;
  }
  step(target, dt) {
    const a = (target - this.x) * this.k - this.v * this.c;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export class Animator {
  constructor(rig, { rng = Math.random } = {}) {
    this.rig = rig;
    this.rng = rng;
    this.pose = { ...REST };
    this.out = { ...REST };
    this.name = 'idle';
    this.clip = CLIPS.idle;
    this.t = 0;
    this.onDone = null;
    /** Shared with clips: walking direction, drag swing, where to look. */
    this.ctx = { dir: 1, run: false, swing: 0 };
    this.look = { x: 0, y: 0, weight: 0 };
    this.blink = { next: 1.5 + rng() * 2, t: -1, double: false };
    this.springs = { earL: new Spring(), earR: new Spring(140, 8), tail: new Spring(90, 7), scarf: new Spring(60, 6) };
    this.prev = { y: 0, turn: 0 };
    this.extraLift = 0; // stage-level vertical speed (falling / flying), fed by the brain
    this.extraSide = 0;
    this.lift = 0; // extra height added to every clip (acting while hovering)
  }

  get fps() {
    return this.clip.fps || 60;
  }

  /** Start a clip. One-shots call `onDone` (or fall back to idle) when finished. */
  play(name, { onDone = null, restart = true } = {}) {
    const clip = CLIPS[name];
    if (!clip) throw new Error(`unknown clip: ${name}`);
    if (!restart && this.name === name) {
      this.onDone = onDone;
      return;
    }
    // keep spins from unwinding the long way round
    this.pose.turn = ((this.pose.turn + Math.PI) % TAU + TAU) % TAU - Math.PI;
    this.prev.turn = this.pose.turn;
    this.name = name;
    this.clip = clip;
    this.t = 0;
    this.onDone = onDone;
  }

  /** Point of interest in pig-centred units: x right, y up, roughly -1..1. */
  lookAt(x, y, weight = 1) {
    this.look.x = clamp(x, -1, 1);
    this.look.y = clamp(y, -1, 1);
    this.look.weight = weight;
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    let clip = this.clip;

    if (clip.duration && this.t >= clip.duration) {
      const done = this.onDone;
      this.onDone = null;
      if (done) done(this.name);
      if (this.clip === clip && this.t >= clip.duration) this.play('idle');
      clip = this.clip;
    }

    const target = { ...REST, ...clip.fn(this.t, this.ctx) };
    target.y += this.lift;

    // Look-at layer
    if (clip.look && this.look.weight > 0) {
      const w = this.look.weight;
      target.headY += this.look.x * 0.5 * w;
      target.headX += -this.look.y * 0.26 * w;
      target.lookX += this.look.x * w;
      target.lookY += this.look.y * w;
    }

    // Ease every channel towards its target
    const k = 1 - Math.exp(-dt * (clip.stiffness || 20));
    const pose = this.pose;
    for (const ch of CHANNELS) pose[ch] += (target[ch] - pose[ch]) * k;
    // eye shapes are switches, not blends
    pose.eyeHappy = target.eyeHappy;
    pose.eyeSleep = target.eyeSleep;

    const out = Object.assign(this.out, pose);

    // Blink layer
    const b = this.blink;
    if (b.t >= 0) {
      b.t += dt;
      const u = b.t / 0.15;
      if (u >= 1) {
        b.t = -1;
        b.next = b.double ? 0.12 : 2.2 + this.rng() * 3.6;
        b.double = !b.double && this.rng() < 0.18;
      } else {
        out.eyeOpen *= Math.abs(u * 2 - 1);
      }
    } else {
      b.next -= dt;
      if (b.next <= 0 && target.eyeHappy < 0.5 && target.eyeSleep < 0.5) b.t = 0;
    }

    // Secondary motion: ears, tail and scarf lag behind the body
    const vy = (pose.y - this.prev.y) / dt + this.extraLift;
    const vturn = (pose.turn - this.prev.turn) / dt + this.extraSide;
    this.prev.y = pose.y;
    this.prev.turn = pose.turn;
    const s = this.springs;
    out.earL += s.earL.step(clamp(vy * 0.13, -0.8, 0.8), dt);
    out.earR += s.earR.step(clamp(vy * 0.13, -0.8, 0.8), dt);
    out.tail += s.tail.step(clamp(-vturn * 0.12, -0.8, 0.8), dt);
    out.scarf += s.scarf.step(clamp(-vturn * 0.05 + vy * 0.08, -0.7, 0.7), dt);

    applyPose(this.rig, out);
    return out;
  }
}
