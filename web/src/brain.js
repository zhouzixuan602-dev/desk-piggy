// The pig's mind: an autonomous behaviour loop plus reactions to the outside
// world (pokes, drags, voice commands, the assistant showing up).
//
// The brain works in "stage" coordinates — points along the desktop, with
// x across the screen and y up from the ground the pig walks on — and never
// touches the renderer directly, so it runs (and is tested) headless.

import { WALK_UNITS_PER_SEC, RUN_FACTOR, clamp } from './clips.js';

const GRAVITY = 2600; // pt / s²
const HOVER_LIFT = 0.3; // world units the assistant form floats above its anchor

/** Things the pig does on the spot and then carries on. */
const ACTS = new Set(['hop', 'happy', 'wave', 'dance', 'eat', 'nod', 'sniff', 'yawn']);
/** Commands that change where the pig is or what it settles into. */
const SETTLERS = new Set(['sit', 'sleep', 'come', 'walk', 'hide', 'stand']);

export const COMMANDS = Object.freeze([...ACTS, ...SETTLERS, 'wake', 'show', 'say', 'toggle']);

export class Brain {
  constructor({ animator, fx, host, say = () => {}, rng = Math.random }) {
    this.a = animator;
    this.fx = fx;
    this.host = host;
    this.sayLine = say;
    this.rng = rng;

    this.mode = 'idle';
    this.stage = { width: 1280, height: 800 };
    this.unit = 79; // points per world unit
    this.pos = { x: 640, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.sent = { x: Infinity, y: Infinity };
    this.target = null;
    this.timer = 2.5;
    this.idleFor = 0; // seconds since anyone interacted
    this.sleepAfter = 200;
    this.config = { roam: true, siriSync: true, chatty: true };
    this.siri = { active: false, manual: false, anchor: null, home: null };
    this.queued = null;
    this.pointer = { dx: 0, dy: 0, age: 99, x: 0, y: 0, w: 0 };
    this.drag = { lastX: 0, swing: 0 };
    this.pokes = [];
    this.clock = 0;
    this.lastSaid = -99;
  }

  // --- helpers -------------------------------------------------------------

  get margin() {
    return this.unit * 1.05;
  }
  get head() {
    return { x: 0, y: 1.95 };
  }
  rand(a, b) {
    return a + (b - a) * this.rng();
  }
  clampX(x) {
    const m = Math.min(this.margin, this.stage.width / 2);
    return clamp(x, m, this.stage.width - m);
  }
  /** Keep the hovering pig (and its halo) fully on screen. */
  clampHover(point) {
    const side = Math.min(this.unit * 1.65, this.stage.width / 2);
    const top = Math.max(0, this.stage.height - this.unit * 3.15);
    return { x: clamp(point.x, side, this.stage.width - side), y: clamp(point.y, 0, top) };
  }

  say(key, { force = false, vars } = {}) {
    if (!force && (!this.config.chatty || this.clock - this.lastSaid < 5)) return;
    this.lastSaid = this.clock;
    this.sayLine(key, vars);
  }

  interact() {
    this.idleFor = 0;
    this.sleepAfter = this.rand(150, 300);
  }

  setMode(mode) {
    if (this.mode === 'sleep' && mode !== 'sleep') this.fx.setEmitter('zed', false);
    if (this.mode === 'siri' && mode !== 'siri') this.fx.setEmitter('spark', false);
    this.mode = mode;
    this.a.extraLift = 0;
    this.host.emit?.('mode', { mode });
  }

  goIdle(pause = this.rand(2, 5)) {
    this.setMode('idle');
    this.timer = pause;
    this.a.lift = 0;
    this.a.play('idle', { restart: false });
  }

  /** Play a one-shot clip, then continue with `then` (default: back to idle / hovering). */
  act(name, then) {
    this.setMode('act');
    this.fx.setEmitter('note', name === 'dance');
    this.a.lift = this.siri.active ? HOVER_LIFT : 0;
    this.a.play(name, {
      onDone: () => {
        this.fx.setEmitter('note', false);
        if (then) then();
        else this.afterSettle();
      },
    });
  }

  hover() {
    this.setMode('siri');
    this.a.lift = 0;
    this.a.play('siri', { restart: false });
  }

  // --- world ---------------------------------------------------------------

  setStage({ width, height, unit }) {
    if (width > 0) this.stage.width = width;
    if (height > 0) this.stage.height = height;
    if (unit > 0) this.unit = unit;
    this.pos.x = this.clampX(this.pos.x);
    if (this.target != null) this.target = this.clampX(this.target);
  }

  /** The host moved us (first placement, screen change). */
  setPosition(x, y = 0) {
    this.pos.x = this.clampX(x);
    this.pos.y = Math.max(0, y);
    if (this.pos.y > 2 && (this.mode === 'idle' || this.mode === 'walk' || this.mode === 'sit' || this.mode === 'sleep')) this.startFall(0, 0);
  }

  setConfig(partial) {
    Object.assign(this.config, partial);
    if (!this.config.roam && this.mode === 'walk' && !this.a.ctx.run) this.goIdle();
    if (!this.config.siriSync && this.siri.active && !this.siri.manual) this.setSiri(false);
  }

  /** Pointer position relative to the pig's head, in points (+y is up). */
  setPointer(dx, dy) {
    const p = this.pointer;
    if (Math.abs(dx - p.dx) + Math.abs(dy - p.dy) > 1.5) p.age = 0;
    p.dx = dx;
    p.dy = dy;
  }

  // --- interactions --------------------------------------------------------

  poke() {
    this.interact();
    if (this.mode === 'hidden' || this.mode === 'drag' || this.mode === 'fall') return;
    this.pokes = this.pokes.filter((t) => this.clock - t < 2.5);
    this.pokes.push(this.clock);

    if (this.mode === 'sleep') return this.wake();
    if (this.pokes.length >= 4 && !this.siri.active) {
      this.pokes.length = 0;
      this.say('dance', { force: true });
      return this.act('dance');
    }
    this.fx.burst('heart', 3 + Math.floor(this.rng() * 3), this.fxAt(0, 1.75), 0.55);
    this.say('poke');
    this.act(this.siri.active ? 'nod' : 'happy');
  }

  wake() {
    this.interact();
    if (this.mode !== 'sleep') return;
    this.fx.burst('bang', 1, this.fxAt(0.75, 2.05), 0);
    this.say('wake', { force: true });
    this.act('wake');
  }

  dragStart() {
    this.interact();
    if (this.mode === 'hidden') return;
    const wasAsleep = this.mode === 'sleep';
    this.fx.setEmitter('note', false);
    this.setMode('drag');
    this.a.lift = 0;
    this.drag.lastX = this.pos.x;
    this.drag.swing = 0;
    this.a.play('dragged');
    if (wasAsleep) this.fx.burst('bang', 1, this.fxAt(0.75, 2.05), 0);
    this.say('drag');
  }

  dragMove(x, y) {
    if (this.mode !== 'drag') return;
    this.pos.x = x;
    this.pos.y = y;
  }

  dragEnd(vx = 0, vy = 0) {
    if (this.mode !== 'drag') return;
    this.interact();
    this.a.ctx.swing = 0;
    this.pos.x = this.clampX(this.pos.x);
    if (this.siri.active) {
      // stay where we were put, still in assistant form
      this.siri.anchor = this.clampHover(this.pos);
      return this.hover();
    }
    this.siri.home = null;
    if (this.pos.y > 3) return this.startFall(clamp(vx * 0.6, -900, 900), clamp(vy * 0.6, -600, 1200));
    this.pos.y = 0;
    this.goIdle(1.5);
  }

  startFall(vx, vy) {
    this.setMode('fall');
    this.vel.x = vx;
    this.vel.y = vy;
    this.a.lift = 0;
    this.a.play('fall');
  }

  /** The assistant appeared / went away. `anchor` is where to hover, in stage points. */
  setSiri(active, anchor = null, { manual = false } = {}) {
    if (active && !this.config.siriSync && !manual) return;
    if (active) {
      const fresh = !this.siri.active;
      if (fresh) {
        this.interact();
        if (this.mode === 'hidden') this.host.emit?.('show');
        this.siri.active = true;
        this.siri.manual = manual;
        this.siri.home = { x: this.pos.x, y: 0 };
        this.fx.setEmitter('note', false);
        this.fx.setAura(1);
        this.fx.burst('spark', 16, this.fxAt(0, 1.1), 1.2);
        this.say('siri', { force: true });
        if (this.mode !== 'drag') {
          this.hover();
          this.a.play('siri');
        }
      }
      if (anchor) this.siri.anchor = this.clampHover(anchor);
      else if (fresh) this.siri.anchor = this.clampHover(this.pos);
      return;
    }
    if (!this.siri.active) return;
    this.siri.active = false;
    this.siri.manual = false;
    this.siri.anchor = null;
    this.fx.setAura(0);
    this.fx.setEmitter('spark', false);
    if (this.mode === 'drag') return;
    this.setMode('return');
    this.a.lift = 0;
    this.a.play('siri', { restart: false });
  }

  /** Voice / menu / URL commands. Returns false for unknown names. */
  command(name, args = {}) {
    if (!COMMANDS.includes(name)) return false;
    this.interact();

    if (name === 'say') {
      this.say('custom', { force: true, vars: { text: String(args.text ?? '') } });
      return true;
    }
    if (name === 'toggle') return this.command(this.mode === 'hidden' ? 'show' : 'hide');
    if (name === 'show') {
      if (this.mode !== 'hidden') return true;
      this.host.emit?.('show');
      this.fx.burst('spark', 12, this.fxAt(0, 1.1), 1.1);
      this.say('back', { force: true });
      this.act('appear');
      return true;
    }
    if (this.mode === 'hidden') {
      if (name === 'hide') return true;
      this.command('show');
      this.queued = { name, args };
      return true;
    }
    if (this.mode === 'drag' || this.mode === 'fall' || this.mode === 'return') {
      this.queued = { name, args };
      return true;
    }
    if (this.mode === 'sleep' && name !== 'sleep') {
      this.fx.setEmitter('zed', false);
      if (name === 'wake' || name === 'stand') {
        this.wake();
        return true;
      }
    }
    if (name === 'wake') return true;

    // While in assistant form, anything that moves us away waits until it leaves.
    if (this.siri.active && SETTLERS.has(name)) {
      this.queued = { name, args };
      this.act('nod');
      return true;
    }

    switch (name) {
      case 'dance':
        this.say('dance', { force: true });
        this.act('dance');
        break;
      case 'wave':
        this.say('hello', { force: true });
        this.act('wave');
        break;
      case 'eat':
        this.say('eat', { force: true });
        this.act('eat', () => {
          this.fx.burst('heart', 3, this.fxAt(0, 1.75), 0.5);
          this.say('eatDone', { force: true });
          this.act('happy');
        });
        break;
      case 'hop':
      case 'happy':
      case 'nod':
      case 'sniff':
      case 'yawn':
        this.act(name);
        break;
      case 'sit':
        this.setMode('sit');
        this.timer = args.seconds ?? this.rand(20, 40);
        this.a.play('sit');
        break;
      case 'stand':
        this.goIdle();
        break;
      case 'sleep':
        if (this.mode === 'sleep') break;
        this.say('sleep', { force: true });
        this.act('yawn', () => this.fallAsleep(args.seconds));
        break;
      case 'come': {
        const x = Number.isFinite(args.x) ? args.x : this.pointer.age < 30 ? this.pos.x + this.pointer.dx : this.stage.width / 2;
        this.say('come', { force: true });
        this.walkTo(x, true);
        break;
      }
      case 'walk':
        this.walkTo(Number.isFinite(args.x) ? args.x : this.pickSpot(), false);
        break;
      case 'hide':
        this.say('bye', { force: true });
        this.setMode('act');
        this.a.play('vanish', {
          onDone: () => {
            this.setMode('hidden');
            this.host.emit?.('hide');
          },
        });
        break;
    }
    return true;
  }

  fallAsleep(seconds) {
    this.setMode('sleep');
    this.timer = seconds ?? this.rand(120, 300);
    this.a.play('sleep');
    this.fx.setEmitter('zed', true);
  }

  walkTo(x, run = false) {
    const tx = this.clampX(x);
    if (Math.abs(tx - this.pos.x) < 4) return this.goIdle();
    this.target = tx;
    this.setMode('walk');
    this.a.ctx.dir = tx > this.pos.x ? 1 : -1;
    this.a.ctx.run = run;
    this.a.play('walk', { restart: false });
  }

  pickSpot() {
    const span = this.stage.width - this.margin * 2;
    const dist = Math.max(this.unit * 1.5, span * this.rand(0.12, 0.42));
    let dir = this.rng() < 0.5 ? -1 : 1;
    // prefer the roomier side when close to an edge
    if (this.pos.x - dist < this.margin) dir = 1;
    else if (this.pos.x + dist > this.stage.width - this.margin) dir = -1;
    return this.clampX(this.pos.x + dir * dist);
  }

  think() {
    if (this.idleFor > this.sleepAfter) {
      return this.act('yawn', () => this.fallAsleep());
    }
    const r = this.rng();
    if (this.config.roam && r < 0.52) return this.walkTo(this.pickSpot());
    if (r < 0.62) return this.act('hop');
    if (r < 0.74) {
      this.setMode('sit');
      this.timer = this.rand(6, 14);
      return this.a.play('sit');
    }
    if (r < 0.86) return this.act('sniff');
    if (r < 0.92 && this.pointer.age < 4 && Math.hypot(this.pointer.dx, this.pointer.dy) < 420) {
      this.say('hello');
      return this.act('wave');
    }
    this.timer = this.rand(2, 6);
  }

  /** Particle origin in world units, relative to the pig. */
  fxAt(x, y) {
    return { x, y: y + (this.a.pose?.y || 0) };
  }

  // --- tick ----------------------------------------------------------------

  update(dt) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    this.idleFor += dt;
    const p = this.pos;

    switch (this.mode) {
      case 'idle':
        this.timer -= dt;
        if (this.timer <= 0) this.think();
        break;

      case 'walk': {
        const speed = WALK_UNITS_PER_SEC * this.unit * (this.a.ctx.run ? RUN_FACTOR : 1);
        const step = speed * dt;
        const left = this.target - p.x;
        if (Math.abs(left) <= step) {
          p.x = this.target;
          this.target = null;
          const ran = this.a.ctx.run;
          this.a.ctx.run = false;
          if (ran) this.act('happy');
          else this.goIdle();
        } else {
          p.x += Math.sign(left) * step;
        }
        break;
      }

      case 'sit':
        this.timer -= dt;
        if (this.timer <= 0) this.goIdle();
        break;

      case 'sleep':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.idleFor = 0;
          this.act('wake');
        }
        break;

      case 'drag': {
        const vx = (p.x - this.drag.lastX) / dt;
        this.drag.lastX = p.x;
        this.drag.swing += (clamp(vx / 650, -1, 1) - this.drag.swing) * (1 - Math.exp(-dt * 9));
        this.a.ctx.swing = this.drag.swing;
        break;
      }

      case 'fall': {
        this.vel.y -= GRAVITY * dt;
        this.vel.x *= Math.exp(-dt * 0.8);
        p.x += this.vel.x * dt;
        p.y += this.vel.y * dt;
        const lo = Math.min(this.margin, this.stage.width / 2);
        const hi = this.stage.width - lo;
        if (p.x < lo) {
          p.x = lo;
          this.vel.x = Math.abs(this.vel.x) * 0.5;
        } else if (p.x > hi) {
          p.x = hi;
          this.vel.x = -Math.abs(this.vel.x) * 0.5;
        }
        this.a.extraLift = this.vel.y / this.unit;
        if (p.y <= 0) {
          const impact = -this.vel.y;
          p.y = 0;
          this.vel.x = this.vel.y = 0;
          this.a.extraLift = 0;
          if (impact > 420) {
            this.fx.burst('star', 7, this.fxAt(0, 0.25), 0.7);
            this.say('land');
            this.act('land', () => this.afterSettle());
          } else {
            this.afterSettle();
          }
        }
        break;
      }

      case 'siri': {
        const a = this.siri.anchor;
        if (a) {
          const k = 1 - Math.exp(-dt * 5.5);
          const dx = (a.x - p.x) * k;
          const dy = (a.y - p.y) * k;
          p.x += dx;
          p.y += dy;
          this.a.extraLift = dy / dt / this.unit;
          this.fx.setEmitter('spark', Math.hypot(a.x - p.x, a.y - p.y) > 24);
        }
        break;
      }

      case 'return': {
        const home = this.siri.home || { x: p.x, y: 0 };
        const k = 1 - Math.exp(-dt * 5);
        p.x += (home.x - p.x) * k;
        const dy = (0 - p.y) * k;
        p.y += dy;
        this.a.extraLift = dy / dt / this.unit;
        if (Math.abs(home.x - p.x) < 2 && p.y < 2) {
          p.x = home.x;
          p.y = 0;
          this.siri.home = null;
          this.afterSettle();
        }
        break;
      }

      default:
        break;
    }

    this.updateGaze(dt);

    if (this.mode !== 'drag' && (Math.abs(p.x - this.sent.x) > 0.2 || Math.abs(p.y - this.sent.y) > 0.2)) {
      this.sent.x = p.x;
      this.sent.y = p.y;
      this.host.setPosition(p.x, p.y);
    }
  }

  afterSettle() {
    // anything queued waits until the assistant has gone
    if (this.siri.active) return this.hover();
    const q = this.queued;
    this.queued = null;
    this.goIdle(q ? 0.2 : this.rand(1.5, 3));
    if (q) this.command(q.name, q.args);
  }

  updateGaze(dt) {
    const g = this.pointer;
    g.age += dt;
    const dist = Math.hypot(g.dx, g.dy);
    const near = 1 - clamp((dist - 520) / 280);
    const fresh = g.age < 6 ? 1 : 0;
    const k = 1 - Math.exp(-dt * 7);
    g.w += (near * fresh - g.w) * k;
    g.x += (clamp(g.dx / 300, -1, 1) - g.x) * k;
    g.y += (clamp(g.dy / 300, -1, 1) - g.y) * k;
    this.a.lookAt(g.x, g.y, g.w);
  }
}
