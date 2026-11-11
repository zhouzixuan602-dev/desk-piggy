import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOOK, EYE_STYLES, normalizeLook, derivePalette, mix, shade, sameLook } from '../../web/src/look.js';

const HEX = /^#[0-9a-f]{6}$/;

test('normalizeLook fills in defaults and accepts JSON strings', () => {
  assert.deepEqual(normalizeLook(undefined), DEFAULT_LOOK);
  assert.deepEqual(normalizeLook('not json'), DEFAULT_LOOK);
  assert.deepEqual(normalizeLook(42), DEFAULT_LOOK);
  const look = normalizeLook('{"eyes":"dot","body":"#ABCDEF","showScarf":false}');
  assert.equal(look.eyes, 'dot');
  assert.equal(look.body, '#abcdef');
  assert.equal(look.showScarf, false);
  assert.equal(look.snout, DEFAULT_LOOK.snout);
});

test('normalizeLook ignores anything that is not a valid value', () => {
  const look = normalizeLook({
    eyes: 'laser',
    body: 'red',
    snout: '#12345',
    scarf: 'javascript:alert(1)',
    showBelly: 'yes',
    showBlush: 0,
    extra: '<script>',
  });
  assert.deepEqual(look, DEFAULT_LOOK);
  assert.ok(!('extra' in look));
});

test('partial updates are applied on top of the current look', () => {
  const current = normalizeLook({ eyes: 'button', scarf: '#112233' });
  const next = normalizeLook({ showBlush: false }, current);
  assert.equal(next.eyes, 'button');
  assert.equal(next.scarf, '#112233');
  assert.equal(next.showBlush, false);
  assert.ok(sameLook(current, normalizeLook({}, current)));
  assert.ok(!sameLook(current, next));
});

test('colour helpers', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#ff0000', '#0000ff', 0), '#ff0000');
  assert.equal(shade('#808080', 0.5), '#404040');
  assert.equal(shade('#ffffff', 2), '#ffffff', 'clamps instead of overflowing');
  assert.match(shade('#3366cc', 0.6, 1.5), HEX);
});

test('the derived palette is always valid, whatever colours are picked', () => {
  const picks = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffbcc8', '#123456'];
  for (const body of picks) {
    for (const snout of picks) {
      const palette = derivePalette({ body, snout, scarf: '#58cfb8' });
      for (const [name, value] of Object.entries(palette)) assert.match(value, HEX, `${name} for ${body}/${snout}`);
    }
  }
});

test('the default palette is the pink pig with a mint scarf', () => {
  const p = derivePalette(DEFAULT_LOOK);
  assert.equal(p.skin, '#ffbcc8');
  assert.equal(p.scarf, '#58cfb8');
  // derived shades stay in the same family: the hoof and line are darker than the snout
  const brightness = (hex) => [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
  assert.ok(brightness(p.hoof) < brightness(p.snout));
  assert.ok(brightness(p.line) < brightness(p.hoof));
  assert.ok(brightness(p.belly) > brightness(p.skin));
  assert.deepEqual([...EYE_STYLES], ['sparkle', 'button', 'dot']);
});
