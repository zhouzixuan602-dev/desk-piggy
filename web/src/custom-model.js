// Bring-your-own model: load a GLB / glTF / FBX / OBJ file and wear it instead of the
// built-in pig.
//
// A foreign model has no rig the animator knows about, so it is treated as a puppet: the
// whole body hops, squashes, leans, turns and scales. Limb and face channels are folded
// into small body movements, which keeps every clip readable (a "wave" becomes a tilt and
// a bounce). If the file brings its own animation clips, the first one plays on a loop.
//
// The file is only ever read into memory here. Nothing is uploaded or stored by this
// module; where the bytes come from is the host's business.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

export const MODEL_FORMATS = Object.freeze(['glb', 'gltf', 'fbx', 'obj']);

/** The space a model is fitted into, in world units (the built-in pig is about 1.9 × 2.1). */
export const FIT = Object.freeze({ width: 1.9, height: 2.0, depth: 1.9 });

export const DEFAULT_ADJUST = Object.freeze({
  scale: 1, // multiplier on top of the automatic fit
  yaw: 0, // degrees; turn the model to face the viewer
  lift: 0, // world units up (+) or down (-)
  zUp: false, // the file was authored with Z pointing up
  tint: false, // paint everything in the pig's body colour
});

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function normalizeAdjust(input, base = DEFAULT_ADJUST) {
  let source = input;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  const adjust = { ...DEFAULT_ADJUST, ...base };
  if (!source || typeof source !== 'object') return adjust;
  if (Number.isFinite(source.scale)) adjust.scale = clamp(source.scale, 0.3, 3);
  if (Number.isFinite(source.yaw)) adjust.yaw = clamp(source.yaw, -180, 180);
  if (Number.isFinite(source.lift)) adjust.lift = clamp(source.lift, -1, 1.5);
  if (typeof source.zUp === 'boolean') adjust.zUp = source.zUp;
  if (typeof source.tint === 'boolean') adjust.tint = source.tint;
  return adjust;
}

export const formatOf = (name = '') => {
  const ext = String(name).toLowerCase().split(/[?#]/)[0].split('.').pop();
  return MODEL_FORMATS.includes(ext) ? ext : null;
};

/** Parse the bytes of a model file. Resolves to the scene object and any animation clips. */
export async function parseModel(buffer, format) {
  if (!MODEL_FORMATS.includes(format)) throw new Error(`unsupported model format: ${format}`);
  if (format === 'glb' || format === 'gltf') {
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    return { object: gltf.scene, clips: gltf.animations || [] };
  }
  if (format === 'fbx') {
    const object = new FBXLoader().parse(buffer, '');
    return { object, clips: object.animations || [] };
  }
  const object = new OBJLoader().parse(new TextDecoder().decode(buffer));
  return { object, clips: [] };
}

/**
 * Scale and place `object` so it stands on y = 0, centred, inside FIT.
 * Returns the fitted size, which the caller uses for the hit shape and the shadow.
 */
export function fitModel(object, { zUp = false } = {}) {
  object.position.set(0, 0, 0);
  object.scale.set(1, 1, 1);
  object.rotation.set(zUp ? -Math.PI / 2 : 0, 0, 0);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) throw new Error('the model has no geometry');
  const size = box.getSize(new THREE.Vector3());
  const k = Math.min(FIT.width / Math.max(size.x, 1e-9), FIT.height / Math.max(size.y, 1e-9), FIT.depth / Math.max(size.z, 1e-9));
  if (!Number.isFinite(k) || k <= 0) throw new Error('the model has no size');
  object.scale.setScalar(k);
  object.updateMatrixWorld(true);
  box.setFromObject(object);
  const centre = box.getCenter(new THREE.Vector3());
  object.position.set(-centre.x, -box.min.y, -centre.z);
  object.updateMatrixWorld(true);
  return { width: size.x * k, height: size.y * k, depth: size.z * k };
}

function countTriangles(object) {
  let triangles = 0;
  object.traverse((node) => {
    const g = node.isMesh && node.geometry;
    if (g) triangles += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3;
  });
  return Math.round(triangles);
}

/**
 * Wrap a parsed model in the pivots the animator needs.
 * @returns a puppet: { root, size, triangles, setAdjust(adjust, tintColor), update(dt), applyPose(pose), dispose() }
 */
export function createPuppet({ object, clips = [] }, adjustInput, tintColor = '#ffbcc8') {
  const root = new THREE.Group(); // hop height and pop-in scale
  root.name = 'custom-model';
  const sway = new THREE.Group(); // lean / turn / squash, pivoting at the feet
  const trim = new THREE.Group(); // the user's own adjustments
  root.add(sway);
  sway.add(trim);
  trim.add(object);

  const originals = new Map();
  object.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = false; // skinned or oddly-bounded meshes must not blink out
    originals.set(node, node.material);
  });
  const paint = new THREE.MeshPhysicalMaterial({ color: tintColor, roughness: 0.58, sheen: 0.9, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xfff1f4), clearcoat: 0.18, clearcoatRoughness: 0.55 });

  const mixer = clips.length ? new THREE.AnimationMixer(object) : null;
  if (mixer) mixer.clipAction(clips[0]).play();

  let adjust = normalizeAdjust(adjustInput);
  let fitted = fitModel(object, adjust);
  const puppet = {
    root,
    triangles: countTriangles(object),
    clips: clips.length,
    size: { width: 0, height: 0 },

    setAdjust(next, colour) {
      const wanted = normalizeAdjust(next, adjust);
      if (wanted.zUp !== adjust.zUp) fitted = fitModel(object, wanted);
      adjust = wanted;
      trim.scale.setScalar(adjust.scale);
      trim.rotation.y = THREE.MathUtils.degToRad(adjust.yaw);
      trim.position.y = adjust.lift;
      if (colour) paint.color.set(colour);
      for (const [mesh, material] of originals) mesh.material = adjust.tint ? paint : material;
      // What the hit shape, bubble and shadow should assume. A yawed model can be as wide
      // as it is deep, so take the larger of the two.
      puppet.size = {
        width: Math.max(fitted.width, fitted.depth) * adjust.scale,
        height: Math.max(0.4, fitted.height * adjust.scale + Math.max(0, adjust.lift)),
      };
      return { ...adjust };
    },
    get adjust() {
      return { ...adjust };
    },

    update(dt) {
      mixer?.update(dt);
    },

    /** The same pose object the built-in pig takes; only whole-body channels are used. */
    applyPose(p) {
      root.position.y = p.y;
      root.scale.setScalar(Math.max(0.001, p.scale));
      const sy = Math.max(0.4, 1 + p.squash);
      const sxz = 1 / Math.sqrt(sy);
      sway.scale.set(sxz, sy, sxz);
      sway.rotation.set(
        p.leanX + p.torsoX * 0.5 + p.headX * 0.35,
        p.turn + p.torsoY * 0.5 + p.headY * 0.3,
        p.leanZ + p.headZ * 0.5,
        'YXZ',
      );
    },

    dispose() {
      mixer?.stopAllAction();
      paint.dispose();
      object.traverse((node) => {
        if (!node.isMesh) return;
        node.geometry?.dispose();
        for (const material of [].concat(originals.get(node) || [])) {
          for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
          material.dispose?.();
        }
      });
      originals.clear();
    },
  };
  puppet.setAdjust(adjust, tintColor);
  return puppet;
}
