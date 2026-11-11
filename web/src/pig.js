// The piggy itself: a procedurally modelled, fully rigged 3D character.
//
// Everything is built from deformed primitives at load time — there is no
// external model file. `createPig()` returns the scene graph plus a `rig`
// of named pivots that the animator drives through `applyPose()`.
//
// Units: the pig is ~2 units tall, stands on y = 0 and faces +z.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETTE = {
  skin: 0xffbcc8,
  snout: 0xff8da3,
  earInner: 0xff8aa0,
  hoof: 0xe8788f,
  line: 0xb2455e,
  eye: 0x2b1a20,
  blush: 0xff5f86,
  belly: 0xffdce2,
  scarf: 0x58cfb8,
  mouth: 0x8f2f48,
  tongue: 0xff7d93,
  apple: 0xf2484b,
  leaf: 0x6cc24a,
  stem: 0x8a5a3c,
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A unit sphere pushed around by `deform`, then scaled to the given radii. */
function blob(rx, ry, rz, deform, wSeg = 48, hSeg = 32) {
  let g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4); // weld the seam so normals come out smooth
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (deform) deform(v);
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Curl a geometry forward (+z) around the x axis, more towards its tip (+y). */
function bendForward(g, height, amount, power = 1.6) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    const t = Math.min(1, Math.max(0, y / height));
    const a = amount * Math.pow(t, power);
    const c = Math.cos(a);
    const s = Math.sin(a);
    p.setY(i, y * c - z * s);
    p.setZ(i, y * s + z * c);
  }
  g.computeVertexNormals();
  return g;
}

function softDotTexture(size = 128, inner = 0.15) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner * 0.5, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeMaterials() {
  const vinyl = (color, extra = {}) =>
    new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.58,
      metalness: 0,
      sheen: 0.9,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xfff1f4),
      clearcoat: 0.18,
      clearcoatRoughness: 0.55,
      ...extra,
    });
  return {
    skin: vinyl(PALETTE.skin),
    snout: vinyl(PALETTE.snout, { roughness: 0.5 }),
    earInner: vinyl(PALETTE.earInner, { sheen: 0.4 }),
    hoof: vinyl(PALETTE.hoof, { roughness: 0.45 }),
    belly: vinyl(PALETTE.belly, { sheen: 0.5 }),
    line: new THREE.MeshStandardMaterial({ color: PALETTE.line, roughness: 0.6 }),
    mouth: new THREE.MeshStandardMaterial({ color: PALETTE.mouth, roughness: 0.7 }),
    tongue: new THREE.MeshStandardMaterial({ color: PALETTE.tongue, roughness: 0.6 }),
    eye: new THREE.MeshPhysicalMaterial({
      color: PALETTE.eye,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    blush: new THREE.MeshBasicMaterial({
      color: PALETTE.blush,
      map: softDotTexture(),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
    }),
    scarf: new THREE.MeshPhysicalMaterial({
      color: PALETTE.scarf,
      roughness: 0.85,
      metalness: 0,
      sheen: 1,
      sheenRoughness: 0.7,
      sheenColor: new THREE.Color(0xd8fff5),
    }),
  };
}

const ray = new THREE.Raycaster();

/** Where a ray from `center` along `dir` leaves `mesh` (mesh must be un-parented). */
function surfaceAt(mesh, center, dir) {
  const d = dir.clone().normalize();
  const from = center.clone().addScaledVector(d, 10);
  ray.set(from, d.clone().negate());
  mesh.updateMatrixWorld(true);
  const hit = ray.intersectObject(mesh, false)[0];
  if (!hit) throw new Error('surfaceAt: ray missed');
  const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
  return { point: hit.point.clone(), normal };
}

const polar = (yawDeg, pitchDeg) => {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
};

function stick(obj, hit, lift = 0) {
  obj.position.copy(hit.point).addScaledVector(hit.normal, lift);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
  return obj;
}

function shade(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

// --- Parts -----------------------------------------------------------------

function buildHead(mat) {
  const head = new THREE.Group(); // pivot = neck
  head.name = 'head';

  const center = new THREE.Vector3(0, 0.52, 0.03);
  const skull = shade(
    new THREE.Mesh(
      blob(0.8, 0.68, 0.7, (v) => {
        // chubby cheeks: wider towards the jaw, slightly flat underneath
        const low = smoothstep(0.35, -0.75, v.y);
        v.x *= 1 + 0.085 * low;
        v.z *= 1 + 0.04 * low;
        if (v.y < 0) v.y *= 0.94;
      }, 64, 44),
      mat.skin,
    ),
  );
  skull.position.copy(center);
  head.add(skull);
  const at = (yaw, pitch) => surfaceAt(skull, center, polar(yaw, pitch));

  // Snout
  const snout = new THREE.Group();
  snout.name = 'snout';
  const snoutMesh = shade(
    new THREE.Mesh(
      blob(0.255, 0.185, 0.15, (v) => {
        // flatter front, like a soft button
        v.z = Math.sign(v.z) * Math.pow(Math.abs(v.z), 0.62);
      }, 40, 28),
      mat.snout,
    ),
  );
  snout.add(snoutMesh);
  for (const sx of [-1, 1]) {
    const nostril = new THREE.Mesh(blob(0.034, 0.05, 0.03, null, 16, 12), mat.line);
    nostril.position.set(sx * 0.082, 0.008, 0.132);
    nostril.rotation.z = sx * -0.12;
    snout.add(nostril);
  }
  stick(snout, at(0, -9), -0.045);
  snout.userData.baseY = snout.position.y;
  head.add(snout);

  // Eyes
  const eyes = [];
  for (const sx of [-1, 1]) {
    const hit = at(sx * 27.5, 5.5);
    const socket = stick(new THREE.Group(), hit, -0.012);
    socket.name = sx < 0 ? 'eyeR' : 'eyeL';

    const open = new THREE.Group();
    const ball = new THREE.Mesh(blob(0.078, 0.098, 0.05, null, 24, 18), mat.eye);
    const glintA = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), mat.glint);
    glintA.position.set(-0.022, 0.034, 0.038);
    const glintB = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), mat.glint);
    glintB.position.set(0.026, -0.03, 0.04);
    open.add(ball, glintA, glintB);

    const arcGeo = new THREE.TorusGeometry(0.068, 0.017, 8, 24, Math.PI);
    const happy = new THREE.Mesh(arcGeo, mat.eye); // "^" arch
    happy.position.set(0, -0.03, 0.02);
    const asleep = new THREE.Mesh(arcGeo, mat.eye); // "u" curve
    asleep.rotation.z = Math.PI;
    asleep.position.set(0, 0.02, 0.02);
    happy.visible = asleep.visible = false;

    socket.add(open, happy, asleep);
    head.add(socket);

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(socket.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(socket.quaternion);
    eyes.push({ socket, open, happy, asleep, base: socket.position.clone(), right, up });
  }

  // Blush
  const blush = [];
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), mat.blush);
    stick(b, at(sx * 43, -13), 0.012);
    b.scale.set(1.15, 0.8, 1);
    b.renderOrder = 2;
    head.add(b);
    blush.push(b);
  }

  // Mouth: a small smile that can open
  const mouth = stick(new THREE.Group(), at(0, -30), 0.004);
  mouth.name = 'mouth';
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.013, 8, 20, Math.PI), mat.line);
  smile.rotation.z = Math.PI;
  smile.position.y = 0.035;
  const gape = new THREE.Group();
  const hole = new THREE.Mesh(blob(0.06, 0.07, 0.03, null, 20, 14), mat.mouth);
  const tongue = new THREE.Mesh(blob(0.04, 0.035, 0.02, null, 16, 12), mat.tongue);
  tongue.position.set(0, -0.032, 0.014);
  gape.add(hole, tongue);
  gape.scale.setScalar(0.001);
  mouth.add(smile, gape);
  head.add(mouth);

  // Ears: soft triangles that flop forward at the tip
  const ears = [];
  const EAR_H = 0.5;
  for (const sx of [-1, 1]) {
    const hit = surfaceAt(skull, center, new THREE.Vector3(sx * 0.63, 0.78, -0.03));
    const pivot = new THREE.Group();
    pivot.name = sx < 0 ? 'earR' : 'earL';
    pivot.position.copy(hit.point).addScaledVector(hit.normal, -0.07);

    const yAxis = hit.normal.clone().multiplyScalar(0.5).add(new THREE.Vector3(sx * 0.42, 0.7, 0)).normalize();
    const fwd = new THREE.Vector3(sx * 0.3, 0, 1).normalize();
    const zAxis = fwd.addScaledVector(yAxis, -fwd.dot(yAxis)).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));

    const taper = (v) => {
      const t = (v.y + 1) / 2; // 0 base .. 1 tip
      v.x *= 1 - 0.66 * Math.pow(t, 1.5);
      v.z *= 1 - 0.45 * t;
    };
    const outerGeo = blob(0.25, EAR_H / 2, 0.06, taper, 28, 22);
    outerGeo.translate(0, EAR_H / 2 - 0.02, 0);
    bendForward(outerGeo, EAR_H, 0.8, 2.2);
    const innerGeo = blob(0.165, EAR_H * 0.36, 0.03, taper, 24, 18);
    innerGeo.translate(0, EAR_H * 0.36 + 0.035, 0.038);
    bendForward(innerGeo, EAR_H, 0.8, 2.2);

    const flap = new THREE.Group(); // the animated part
    flap.add(shade(new THREE.Mesh(outerGeo, mat.skin)), new THREE.Mesh(innerGeo, mat.earInner));
    pivot.add(flap);
    head.add(pivot);
    ears.push(flap);
  }

  return { head, skull, snout, eyes, blush, mouth: { smile, gape }, ears, center };
}

function buildLimb(mat, radius, length, hoofRatio) {
  // A stubby capsule hanging from its pivot, with a darker hoof at the tip.
  const pivot = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(radius, length, 8, 20);
  geo.translate(0, -length / 2, 0);
  const limb = shade(new THREE.Mesh(geo, mat.skin));
  const capStart = Math.PI * (1 - hoofRatio);
  const hoofGeo = new THREE.SphereGeometry(radius * 1.035, 20, 12, 0, Math.PI * 2, capStart, Math.PI - capStart);
  const hoof = shade(new THREE.Mesh(hoofGeo, mat.hoof));
  hoof.position.y = -length;
  pivot.add(limb, hoof);
  return pivot;
}

function buildTail(mat) {
  // A springy curl. The loop lies in the y-z plane so it reads from the side.
  const pivot = new THREE.Group();
  pivot.name = 'tail';
  const pts = [];
  const turns = 1.45;
  const r = 0.085;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const a = t * turns * Math.PI * 2;
    const grow = 0.55 + 0.45 * Math.min(1, t * 2.5);
    pts.push(new THREE.Vector3((t - 0.3) * 0.13, Math.sin(a) * r * grow + t * 0.04, -(1 - Math.cos(a)) * r * grow - t * 0.03));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = shade(new THREE.Mesh(new THREE.TubeGeometry(curve, 72, 0.031, 10, false), mat.skin));
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.031, 10, 8), mat.skin);
  tip.position.copy(pts[pts.length - 1]);
  pivot.add(tube, tip);
  return pivot;
}

function buildScarf(mat) {
  const scarf = new THREE.Group();
  scarf.name = 'scarf';
  const band = shade(new THREE.Mesh(new THREE.TorusGeometry(0.455, 0.105, 14, 48), mat.scarf));
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 0.92, 0.78); // z here is world-y after the rotation: a soft, flat band
  scarf.add(band);

  const knotAngle = THREE.MathUtils.degToRad(-34);
  const knot = new THREE.Group();
  knot.position.set(Math.sin(knotAngle) * 0.5, -0.03, Math.cos(knotAngle) * 0.46);
  knot.rotation.y = knotAngle;
  const ball = shade(new THREE.Mesh(blob(0.105, 0.095, 0.085, null, 20, 14), mat.scarf));
  knot.add(ball);
  const tails = [];
  [[-0.5, 0.21], [0.28, 0.17]].forEach(([lean, len]) => {
    const tailPivot = new THREE.Group();
    const geo = new THREE.CapsuleGeometry(0.075, len, 6, 14);
    geo.translate(0, -len / 2 - 0.05, 0);
    const m = shade(new THREE.Mesh(geo, mat.scarf));
    m.scale.z = 0.42;
    tailPivot.add(m);
    tailPivot.rotation.z = lean;
    tailPivot.position.z = 0.03;
    tailPivot.userData.lean = lean;
    knot.add(tailPivot);
    tails.push(tailPivot);
  });
  scarf.add(knot);
  return { scarf, tails };
}

function buildApple() {
  const apple = new THREE.Group();
  apple.name = 'apple';
  const flesh = new THREE.MeshPhysicalMaterial({ color: PALETTE.apple, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 });
  const fruit = shade(
    new THREE.Mesh(
      blob(0.165, 0.152, 0.165, (v) => {
        // dimples at the stem and the base
        const r = Math.hypot(v.x, v.z);
        if (v.y > 0) v.y -= 0.2 * Math.exp(-r * r * 9);
        else v.y += 0.12 * Math.exp(-r * r * 12);
      }, 28, 20),
      flesh,
    ),
  );
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.07, 8), new THREE.MeshStandardMaterial({ color: PALETTE.stem, roughness: 0.8 }));
  stem.position.y = 0.15;
  stem.rotation.z = 0.2;
  const leaf = new THREE.Mesh(blob(0.05, 0.012, 0.026, null, 16, 10), new THREE.MeshStandardMaterial({ color: PALETTE.leaf, roughness: 0.6 }));
  leaf.position.set(0.05, 0.168, 0);
  leaf.rotation.z = 0.5;
  apple.add(fruit, stem, leaf);
  apple.visible = false;
  return apple;
}

// --- Assembly --------------------------------------------------------------

export function createPig() {
  const mat = makeMaterials();

  const root = new THREE.Group(); // stage placement (hop height etc.)
  root.name = 'pig';
  const sway = new THREE.Group(); // lean / turn / squash around the feet
  sway.name = 'sway';
  root.add(sway);

  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.y = 0.3;
  sway.add(torso);

  // Body: a little pear, widest near the hips. Local to torso (torso origin at y = 0.3).
  const body = shade(
    new THREE.Mesh(
      blob(0.52, 0.48, 0.47, (v) => {
        const low = smoothstep(0.6, -0.6, v.y);
        v.x *= 0.9 + 0.12 * low;
        v.z *= 0.92 + 0.1 * low;
      }),
      mat.skin,
    ),
  );
  body.position.y = 0.22;
  torso.add(body);

  const belly = new THREE.Mesh(blob(0.3, 0.27, 0.12, null, 28, 20), mat.belly);
  belly.position.set(0, 0.13, 0.385);
  belly.rotation.x = -0.12;
  belly.receiveShadow = true;
  torso.add(belly);

  const tail = buildTail(mat);
  tail.position.set(0, 0.2, -0.46);
  torso.add(tail);

  const { scarf, tails: scarfTails } = buildScarf(mat);
  scarf.position.set(0, 0.385, 0.02);
  scarf.rotation.x = 0.1;
  torso.add(scarf);

  const arms = [];
  for (const sx of [1, -1]) {
    const arm = buildLimb(mat, 0.106, 0.25, 0.4);
    arm.name = sx > 0 ? 'armL' : 'armR';
    arm.position.set(sx * 0.44, 0.31, 0.12);
    arm.userData.side = sx;
    torso.add(arm);
    arms.push(arm);
  }

  const legs = [];
  for (const sx of [1, -1]) {
    const leg = buildLimb(mat, 0.15, 0.14, 0.5);
    leg.name = sx > 0 ? 'legL' : 'legR';
    leg.position.set(sx * 0.215, 0.29, 0.02);
    leg.userData.side = sx;
    sway.add(leg);
    legs.push(leg);
  }

  const face = buildHead(mat);
  face.head.position.set(0, 0.4, 0);
  torso.add(face.head);

  const apple = buildApple();
  apple.position.set(0, 0.24, 0.66);
  torso.add(apple);

  const rig = {
    root,
    sway,
    torso,
    head: face.head,
    armL: arms[0],
    armR: arms[1],
    legL: legs[0],
    legR: legs[1],
    earL: face.ears[1],
    earR: face.ears[0],
    tail,
    scarfTails,
    eyes: face.eyes,
    blush: face.blush,
    mouth: face.mouth,
    snout: face.snout,
    apple,
    materials: mat,
  };
  applyPose(rig, REST);
  return { root, rig, materials: mat };
}

// --- Pose ------------------------------------------------------------------

/** Every animatable channel and its resting value. Angles in radians. */
export const REST = Object.freeze({
  y: 0, // lift off the ground (world units)
  squash: 0, // >0 stretches tall, <0 squashes flat (volume preserving)
  turn: 0, // whole body yaw; +1.57 faces screen-right
  leanX: 0, // pitch forward(+) / back(-), pivot at the feet
  leanZ: 0, // roll, + leans to screen-left... (rotation about +z)
  torsoX: 0, // extra bow of the torso + head
  torsoY: 0,
  headX: 0, // nod, + looks down
  headY: 0, // + looks to screen-right
  headZ: 0, // tilt
  armLx: 0, // swing forward(+)
  armLz: 0, // raise sideways(+), 0 hangs
  armRx: 0,
  armRz: 0,
  legLx: 0, // swing forward(+)
  legRx: 0,
  legSplay: 0, // feet apart
  earL: 0, // + droops forward, - perks up
  earR: 0,
  earSpread: 0,
  tail: 0, // wag
  eyeOpen: 1, // 0 closed .. 1 open (.. 1.25 wide)
  eyeHappy: 0, // > 0.5 swaps to "^ ^"
  eyeSleep: 0, // > 0.5 swaps to "u u"
  lookX: 0, // -1..1 pupils drift
  lookY: 0,
  mouthOpen: 0,
  blush: 0.5,
  snoutY: 0, // sniff wiggle
  scarf: 0, // scarf tails sway
  scale: 1, // whole-pig scale (pop in / out)
  apple: 0, // snack prop size, 0 = hidden
});

export const CHANNELS = Object.freeze(Object.keys(REST));

const HANG = 0.42; // how far the arms rest away from the body

export function applyPose(rig, p) {
  const { root, sway, torso, head } = rig;
  root.position.y = p.y;
  root.scale.setScalar(Math.max(0.001, p.scale));

  const sy = Math.max(0.4, 1 + p.squash);
  const sxz = 1 / Math.sqrt(sy);
  sway.scale.set(sxz, sy, sxz);
  sway.rotation.set(p.leanX, p.turn, p.leanZ, 'YXZ');

  torso.rotation.set(p.torsoX, p.torsoY, 0);
  head.rotation.set(p.headX, p.headY, p.headZ, 'YXZ');

  rig.armL.rotation.set(-p.armLx, 0, HANG + p.armLz, 'ZXY');
  rig.armR.rotation.set(-p.armRx, 0, -(HANG + p.armRz), 'ZXY');
  rig.legL.rotation.set(-p.legLx, 0, p.legSplay);
  rig.legR.rotation.set(-p.legRx, 0, -p.legSplay);

  rig.earL.rotation.set(p.earL, 0, -p.earSpread);
  rig.earR.rotation.set(p.earR, 0, p.earSpread);
  rig.tail.rotation.set(0, p.tail, p.tail * 0.5);
  for (const t of rig.scarfTails) t.rotation.z = t.userData.lean + p.scarf;

  const happy = p.eyeHappy > 0.5;
  const asleep = !happy && p.eyeSleep > 0.5;
  for (const e of rig.eyes) {
    e.open.visible = !happy && !asleep;
    e.happy.visible = happy;
    e.asleep.visible = asleep;
    e.open.scale.set(1 + (1 - Math.min(1, p.eyeOpen)) * 0.12, Math.max(0.06, p.eyeOpen), 1);
    e.socket.position
      .copy(e.base)
      .addScaledVector(e.right, p.lookX * 0.03)
      .addScaledVector(e.up, p.lookY * 0.022);
  }

  const open = Math.max(0, p.mouthOpen);
  rig.mouth.smile.visible = open < 0.25;
  rig.mouth.gape.visible = open >= 0.02;
  rig.mouth.gape.scale.set(0.55 + open * 0.45, Math.max(0.05, open), 1);

  rig.materials.blush.opacity = THREE.MathUtils.clamp(p.blush, 0, 1);
  rig.snout.position.y = rig.snout.userData.baseY + p.snoutY * 0.02;

  rig.apple.visible = p.apple > 0.02;
  rig.apple.scale.setScalar(Math.max(0.001, p.apple));
}
