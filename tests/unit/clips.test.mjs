import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIPS, CLIP_NAMES, kf, ease, WALK_UNITS_PER_SEC } from '../../web/src/clips.js';
import { REST, CHANNELS } from '../../web/src/pig.js';

test('kf interpolates smoothly and clamps at both ends', () => {
  const keys = [[0, 0], [1, 10], [2, 4]];
  assert.equal(kf(-1, keys), 0);
  assert.equal(kf(0, keys), 0);
  assert.equal(kf(1, keys), 10);
  assert.equal(kf(5, keys), 4);
  assert.equal(kf(0.5, keys), 5);
  assert.ok(kf(0.25, keys) < 2.5, 'eases in');
  assert.equal(ease(0.5), 0.5);
});

test('every clip only drives known channels with finite values', () => {
  const ctxs = [{ dir: 1, run: false, swing: 0 }, { dir: -1, run: true, swing: 1 }, {}];
  for (const name of CLIP_NAMES) {
    const clip = CLIPS[name];
    const length = clip.duration ?? 12;
    assert.ok(clip.loop || clip.duration > 0, `${name}: one-shots need a duration`);
    for (const ctx of ctxs) {
      for (let t = 0; t <= length + 0.5; t += 1 / 30) {
        const pose = clip.fn(t, ctx);
        for (const [channel, value] of Object.entries(pose)) {
          assert.ok(CHANNELS.includes(channel), `${name}: unknown channel "${channel}"`);
          assert.ok(Number.isFinite(value), `${name}.${channel} at t=${t.toFixed(2)} is ${value}`);
        }
      }
    }
  }
});

test('one-shot clips end close to the rest pose (no pop when they hand back to idle)', () => {
  // these end somewhere else on purpose
  const exempt = new Set(['vanish', 'dance']);
  for (const name of CLIP_NAMES) {
    const clip = CLIPS[name];
    if (!clip.duration || exempt.has(name)) continue;
    const pose = { ...REST, ...clip.fn(clip.duration, { dir: 1 }) };
    for (const channel of ['y', 'squash', 'leanX', 'leanZ', 'armLz', 'armRz', 'scale']) {
      assert.ok(Math.abs(pose[channel] - REST[channel]) < 0.06, `${name}.${channel} ends at ${pose[channel]}`);
    }
  }
});

test('the pig never sinks through the floor or leaves the canvas', () => {
  for (const name of CLIP_NAMES) {
    const clip = CLIPS[name];
    for (let t = 0; t <= (clip.duration ?? 12); t += 1 / 60) {
      const y = clip.fn(t, { dir: 1 }).y ?? 0;
      assert.ok(y >= -0.12 && y <= 1.2, `${name}: y=${y} at t=${t.toFixed(2)}`);
    }
  }
});

test('walk faces the way it is going and keeps the face towards the viewer', () => {
  const right = CLIPS.walk.fn(0.3, { dir: 1 });
  const left = CLIPS.walk.fn(0.3, { dir: -1 });
  assert.ok(right.turn > 0.5 && left.turn < -0.5);
  assert.ok(right.headY < 0 && left.headY > 0);
  assert.ok(WALK_UNITS_PER_SEC > 0.5 && WALK_UNITS_PER_SEC < 1.5);
});
