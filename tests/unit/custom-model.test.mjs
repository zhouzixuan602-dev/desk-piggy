import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADJUST, FIT, fitModel, formatOf, normalizeAdjust, parseModel, createPuppet } from '../../web/src/custom-model.js';
import { REST } from '../../web/src/pig.js';
import { tinyGltf, tinyObj } from '../helpers/tiny-model.mjs';

// three's loaders report progress with a browser event type that Node does not have.
globalThis.ProgressEvent ??= class ProgressEvent {
  constructor(type, init = {}) {
    Object.assign(this, { type, ...init });
  }
};

const bytes = (text) => new TextEncoder().encode(text).buffer;
const boundsOf = (object) => {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('formatOf recognises the four formats and nothing else', () => {
  assert.equal(formatOf('Pig.GLB'), 'glb');
  assert.equal(formatOf('scene.gltf?v=3'), 'gltf');
  assert.equal(formatOf('deskpiggy-model://file/17.fbx'), 'fbx');
  assert.equal(formatOf('a.b.obj'), 'obj');
  assert.equal(formatOf('model.max'), null);
  assert.equal(formatOf('archive.rar.zip'), null);
  assert.equal(formatOf(''), null);
});

test('normalizeAdjust clamps, defaults and accepts JSON', () => {
  assert.deepEqual(normalizeAdjust(undefined), DEFAULT_ADJUST);
  assert.deepEqual(normalizeAdjust('{{{'), DEFAULT_ADJUST);
  const a = normalizeAdjust('{"scale":99,"yaw":-999,"lift":"x","zUp":true,"tint":1}');
  assert.equal(a.scale, 3);
  assert.equal(a.yaw, -180);
  assert.equal(a.lift, 0);
  assert.equal(a.zUp, true);
  assert.equal(a.tint, false);
  assert.equal(normalizeAdjust({ yaw: 30 }, a).scale, 3, 'partial updates keep the rest');
});

test('a model of any size ends up standing on the floor, centred, inside the fit box', () => {
  for (const dims of [[1, 2, 0.5], [400, 30, 90], [0.002, 0.001, 0.004], [5, 5, 5]]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dims));
    mesh.position.set(40, -7, 3); // wherever the author left it
    const group = new THREE.Group();
    group.add(mesh);
    const size = fitModel(group);
    const box = boundsOf(group);
    assert.ok(close(box.min.y, 0, 1e-5), `stands on y = 0 (${box.min.y})`);
    assert.ok(close((box.min.x + box.max.x) / 2, 0, 1e-5) && close((box.min.z + box.max.z) / 2, 0, 1e-5), 'centred');
    assert.ok(size.width <= FIT.width + 1e-6 && size.height <= FIT.height + 1e-6 && size.depth <= FIT.depth + 1e-6, JSON.stringify(size));
    const fills = [size.width / FIT.width, size.height / FIT.height, size.depth / FIT.depth];
    assert.ok(close(Math.max(...fills), 1, 1e-6), 'and is as large as the box allows');
  }
});

test('Z-up files are stood upright', () => {
  const tall = () => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 4))); // "height" along Z
    return group;
  };
  const asIs = fitModel(tall(), { zUp: false });
  const upright = fitModel(tall(), { zUp: true });
  assert.ok(asIs.depth > asIs.height);
  assert.ok(upright.height > upright.depth);
});

test('glTF and OBJ files parse into geometry', async () => {
  const gltf = await parseModel(bytes(tinyGltf()), 'gltf');
  const obj = await parseModel(bytes(tinyObj()), 'obj');
  for (const parsed of [gltf, obj]) {
    const size = boundsOf(parsed.object).getSize(new THREE.Vector3());
    assert.ok(close(size.x, 1, 1e-5) && close(size.y, 2, 1e-5) && close(size.z, 0.5, 1e-5), `${size.x},${size.y},${size.z}`);
  }
  await assert.rejects(parseModel(bytes('not a model'), 'gltf'));
  await assert.rejects(parseModel(bytes('whatever'), 'max'), /unsupported/);
});

test('a puppet takes the same poses as the pig, as whole-body motion', async () => {
  const puppet = createPuppet(await parseModel(bytes(tinyGltf()), 'gltf'), { scale: 1.5, yaw: 90, lift: 0.2 });
  assert.equal(puppet.triangles, 12);
  assert.ok(close(puppet.size.height, 2 * 1.5 + 0.2, 1e-5), `height ${puppet.size.height}`);

  puppet.applyPose({ ...REST });
  const rest = boundsOf(puppet.root);
  assert.ok(close(rest.min.y, 0.2, 1e-4), 'lifted by the adjustment');

  puppet.applyPose({ ...REST, y: 0.5, squash: -0.3, turn: 1, leanZ: 0.2, headZ: 0.2, scale: 1 });
  const moved = boundsOf(puppet.root);
  assert.ok(moved.min.y > 0.5, 'hops');
  assert.ok(moved.max.y - moved.min.y < rest.max.y - rest.min.y, 'squashes');

  puppet.applyPose({ ...REST, scale: 0.01 });
  assert.ok(boundsOf(puppet.root).getSize(new THREE.Vector3()).y < 0.1, 'pops out of existence');

  const before = puppet.size.width;
  puppet.setAdjust({ scale: 0.5 });
  assert.ok(puppet.size.width < before);
  assert.equal(puppet.adjust.yaw, 90, 'other settings are kept');
  puppet.setAdjust({ tint: true }, '#00ff00');
  puppet.dispose();
});
