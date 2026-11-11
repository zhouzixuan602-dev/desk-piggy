import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain, COMMANDS } from '../../web/src/brain.js';
import { CLIPS, WALK_UNITS_PER_SEC } from '../../web/src/clips.js';

/** Seeded RNG so every run takes the same decisions. */
const seeded = (seed = 1) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

/** Just enough animator for the brain: tracks the clip and fires onDone when a one-shot ends. */
class FakeAnimator {
  constructor() {
    this.name = 'idle';
    this.t = 0;
    this.onDone = null;
    this.ctx = { dir: 1, run: false, swing: 0 };
    this.pose = { y: 0 };
    this.lift = 0;
    this.extraLift = 0;
    this.history = ['idle'];
    this.look = null;
  }
  play(name, { onDone = null, restart = true } = {}) {
    assert.ok(CLIPS[name], `unknown clip ${name}`);
    if (!restart && this.name === name) {
      this.onDone = onDone;
      return;
    }
    this.name = name;
    this.t = 0;
    this.onDone = onDone;
    this.history.push(name);
  }
  lookAt(x, y, w) {
    this.look = { x, y, w };
  }
  update(dt) {
    this.t += dt;
    const clip = CLIPS[this.name];
    if (clip.duration && this.t >= clip.duration) {
      const done = this.onDone;
      this.onDone = null;
      if (done) done(this.name);
      if (this.name && CLIPS[this.name] === clip && this.t >= clip.duration) this.play('idle');
    }
  }
}

function setup({ seed = 7, width = 1440, height = 800 } = {}) {
  const animator = new FakeAnimator();
  const events = [];
  const said = [];
  const fx = {
    log: [],
    burst: (kind, n) => fx.log.push(['burst', kind, n]),
    setEmitter: (kind, on) => fx.log.push(['emitter', kind, on]),
    setAura: (level) => fx.log.push(['aura', level]),
  };
  const host = { positions: [], setPosition: (x, y) => host.positions.push([x, y]), emit: (type, data) => events.push({ type, ...data }) };
  const brain = new Brain({ animator, fx, host, say: (key, vars) => said.push({ key, vars }), rng: seeded(seed) });
  brain.setStage({ width, height, unit: 80 });
  brain.setPosition(700, 0);
  const run = (seconds, dt = 1 / 60) => {
    for (let t = 0; t < seconds; t += dt) {
      brain.update(dt);
      animator.update(dt);
    }
  };
  return { brain, animator, fx, host, events, said, run };
}

test('unknown commands are rejected, known ones accepted', () => {
  const { brain } = setup();
  assert.equal(brain.command('fly-to-the-moon'), false);
  for (const name of COMMANDS) assert.equal(setup().brain.command(name, { text: 'hi' }), true, name);
});

test('walks to a target at the speed the walk cycle implies, then idles', () => {
  const { brain, animator, run } = setup();
  brain.command('walk', { x: 1000 });
  assert.equal(brain.mode, 'walk');
  assert.equal(animator.ctx.dir, 1);
  run(1);
  assert.ok(Math.abs(brain.pos.x - (700 + WALK_UNITS_PER_SEC * 80)) < 3, `x=${brain.pos.x}`);
  brain.setConfig({ roam: false });
  brain.command('walk', { x: 1000 });
  run(6);
  assert.equal(brain.pos.x, 1000);
  assert.notEqual(brain.mode, 'walk');
});

test('never leaves the stage, whatever it is told', () => {
  const { brain, run } = setup({ width: 900 });
  brain.setConfig({ roam: false });
  brain.command('walk', { x: 99999 });
  run(20);
  assert.ok(brain.pos.x <= 900 - 80, `x=${brain.pos.x}`);
  brain.command('come', { x: -500 });
  run(20);
  assert.ok(brain.pos.x >= 80, `x=${brain.pos.x}`);
});

test('roams, rests and plays on its own but stays grounded', () => {
  const { brain, animator, run } = setup({ seed: 3 });
  const modes = new Set();
  for (let i = 0; i < 120; i++) {
    run(1);
    modes.add(brain.mode);
    assert.ok(brain.pos.x >= 80 && brain.pos.x <= 1440 - 80);
    assert.equal(brain.pos.y, 0);
  }
  assert.ok(modes.has('walk'), 'it should wander');
  assert.ok(new Set(animator.history).size >= 4, `only played ${[...new Set(animator.history)]}`);
});

test('dozes off when left alone, and a poke wakes it', () => {
  const { brain, fx, run } = setup({ seed: 11 });
  brain.setConfig({ roam: false });
  run(360, 1 / 20);
  assert.equal(brain.mode, 'sleep');
  assert.deepEqual(fx.log.filter((e) => e[0] === 'emitter' && e[1] === 'zed').pop(), ['emitter', 'zed', true]);
  brain.poke();
  assert.equal(brain.animatorClip ?? brain.a.name, 'wake');
  assert.deepEqual(fx.log.filter((e) => e[0] === 'emitter' && e[1] === 'zed').pop(), ['emitter', 'zed', false]);
  run(2);
  assert.equal(brain.mode, 'idle');
});

test('a poke gets hearts; four quick pokes start a dance', () => {
  const { brain, animator, fx, run } = setup();
  brain.poke();
  assert.equal(animator.name, 'happy');
  assert.ok(fx.log.some((e) => e[0] === 'burst' && e[1] === 'heart'));
  for (let i = 0; i < 3; i++) {
    run(0.2);
    brain.poke();
  }
  assert.equal(animator.name, 'dance');
});

test('drag, drop, fall and land', () => {
  const { brain, animator, host, run } = setup();
  brain.dragStart();
  assert.equal(animator.name, 'dragged');
  const sentBefore = host.positions.length;
  brain.dragMove(400, 350);
  run(0.2);
  assert.equal(host.positions.length, sentBefore, 'the host moves the window itself while dragging');
  brain.dragEnd(300, 0);
  assert.equal(brain.mode, 'fall');
  run(0.1);
  assert.ok(brain.pos.y < 350 && brain.pos.y > 0);
  run(2);
  assert.equal(brain.pos.y, 0);
  assert.ok(animator.history.includes('land'), 'a long fall ends with a thump');
  assert.ok(brain.pos.x > 400, 'it keeps some of the throw');
});

test('dropping it on the ground just puts it down', () => {
  const { brain, animator } = setup();
  brain.dragStart();
  brain.dragMove(500, 1);
  brain.dragEnd();
  assert.equal(brain.mode, 'idle');
  assert.equal(brain.pos.y, 0);
  assert.ok(!animator.history.includes('fall'));
});

test('assistant form: flies to the anchor, glows, and goes home afterwards', () => {
  const { brain, animator, fx, said, run } = setup();
  brain.setConfig({ roam: false });
  brain.setSiri(true, { x: 1100, y: 420 });
  assert.equal(brain.mode, 'siri');
  assert.equal(animator.name, 'siri');
  assert.ok(fx.log.some((e) => e[0] === 'aura' && e[1] === 1));
  assert.ok(said.some((s) => s.key === 'siri'));
  run(2);
  assert.ok(Math.abs(brain.pos.x - 1100) < 1 && Math.abs(brain.pos.y - 420) < 1, `${brain.pos.x},${brain.pos.y}`);
  // the anchor may move while the assistant is up (its panel grows)
  brain.setSiri(true, { x: 1000, y: 300 });
  run(2);
  assert.ok(Math.abs(brain.pos.x - 1000) < 1 && Math.abs(brain.pos.y - 300) < 1);
  brain.setSiri(false);
  assert.equal(brain.mode, 'return');
  run(3);
  assert.equal(brain.pos.y, 0);
  assert.equal(brain.pos.x, 700);
  assert.equal(brain.mode, 'idle');
  assert.deepEqual(fx.log.filter((e) => e[0] === 'aura').pop(), ['aura', 0]);
});

test('assistant form keeps the pig and its halo on screen', () => {
  const { brain, run } = setup({ width: 1440, height: 800 });
  brain.setSiri(true, { x: 5000, y: 5000 });
  run(3);
  // the halo is about 1.6 units wide and reaches about 3.1 units above the feet
  assert.ok(brain.pos.x <= 1440 - 80 * 1.6, `x=${brain.pos.x}`);
  assert.ok(brain.pos.y <= 800 - 80 * 3.1, `y=${brain.pos.y}`);
  brain.setSiri(true, { x: -50, y: -50 });
  run(3);
  assert.ok(brain.pos.x >= 80 * 1.6 && brain.pos.y >= 0);
});

test('without an anchor it simply hovers where it stands', () => {
  const { brain, run } = setup();
  brain.setSiri(true, null);
  run(2);
  assert.equal(brain.mode, 'siri');
  assert.ok(Math.abs(brain.pos.x - 700) < 1 && brain.pos.y === 0);
});

test('voice commands still work in assistant form; ones that walk away wait their turn', () => {
  const { brain, animator, run } = setup();
  brain.setConfig({ roam: false });
  brain.setSiri(true, { x: 1100, y: 400 });
  run(1.5);
  brain.command('dance');
  assert.equal(animator.name, 'dance');
  assert.ok(animator.lift > 0, 'keeps hovering while it dances');
  run(9);
  assert.equal(brain.mode, 'siri');
  assert.equal(animator.name, 'siri');

  brain.command('sleep');
  assert.notEqual(brain.mode, 'sleep');
  run(2);
  brain.setSiri(false);
  run(8);
  assert.equal(brain.mode, 'sleep', 'the queued nap happens once the assistant is gone');
  assert.equal(brain.pos.y, 0);
});

test('siriSync off ignores the assistant, but a manual toggle still works', () => {
  const { brain } = setup();
  brain.setConfig({ siriSync: false });
  brain.setSiri(true, { x: 1000, y: 300 });
  assert.equal(brain.siri.active, false);
  brain.setSiri(true, null, { manual: true });
  assert.equal(brain.siri.active, true);
});

test('hide and show', () => {
  const { brain, events, run } = setup();
  brain.command('hide');
  run(2);
  assert.equal(brain.mode, 'hidden');
  assert.ok(events.some((e) => e.type === 'hide'));
  brain.command('dance'); // asking for anything brings it back first
  assert.ok(events.some((e) => e.type === 'show'));
  run(1.2);
  assert.equal(brain.a.name, 'dance');
});

test('a dragged pig in assistant form stays where it is put', () => {
  const { brain, run } = setup();
  brain.setSiri(true, { x: 1100, y: 400 });
  run(1);
  brain.dragStart();
  brain.dragMove(600, 250);
  brain.dragEnd();
  run(1);
  assert.equal(brain.mode, 'siri');
  assert.ok(Math.abs(brain.pos.x - 600) < 1 && Math.abs(brain.pos.y - 250) < 1);
  brain.setSiri(false);
  run(3);
  assert.equal(brain.pos.y, 0);
});

test('looks at a nearby pointer and loses interest in a distant or stale one', () => {
  const { brain, animator, run } = setup();
  brain.setPointer(200, 100);
  run(1);
  assert.ok(animator.look.w > 0.9 && animator.look.x > 0.4 && animator.look.y > 0.2);
  brain.setPointer(2000, 0);
  run(1.5);
  assert.ok(animator.look.w < 0.1);
  brain.setPointer(100, 0);
  run(8); // not moving for a while
  assert.ok(animator.look.w < 0.1);
});
