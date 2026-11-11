// Renderer, camera, lights and the soft contact shadow.
//
// The visible canvas is a plain, transparent 2D canvas. WebGL draws into a canvas that
// is never attached to the page, and every finished frame is copied across. That costs
// one small copy per frame, but it means the pig is shown through the same path as any
// 2D drawing. WebGL layers themselves are not always put on screen: in virtual machines
// (including the macOS CI runners) the page renders correctly, snapshots contain the
// pig, and yet the canvas stays invisible in the window.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** How the camera frames the pig. `extent` is the world height visible at z = 0. */
export const VIEW = Object.freeze({ fov: 24, lookY: 1.72, extent: 4.3, pitchDeg: 7 });

function shadowTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export function createStage3D(canvas) {
  const surface = document.createElement('canvas'); // off-screen WebGL target
  const screen = canvas.getContext('2d');
  const renderer = new THREE.WebGLRenderer({
    canvas: surface,
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(VIEW.fov, 1, 0.5, 60);
  const dist = VIEW.extent / (2 * Math.tan(THREE.MathUtils.degToRad(VIEW.fov / 2)));
  const pitch = THREE.MathUtils.degToRad(VIEW.pitchDeg);
  camera.position.set(0, VIEW.lookY + Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  camera.lookAt(0, VIEW.lookY, 0);
  camera.updateMatrixWorld(true); // so points can be projected before the first frame

  scene.add(new THREE.HemisphereLight(0xffffff, 0xffd3dc, 0.5));

  const key = new THREE.DirectionalLight(0xfff3e8, 2.3);
  key.position.set(2.4, 5.2, 4.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2.4, right: 2.4, top: 4.2, bottom: -1.2, near: 1, far: 16 });
  key.shadow.radius = 5;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.035;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xffe3ec, 0.55);
  fill.position.set(-3.5, 1.6, 3);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xdde8ff, 1.3);
  rim.position.set(-2.8, 2.6, -3.6);
  scene.add(rim);

  // Fake contact shadow: cheap, soft, and it reads well on any wallpaper.
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      color: 0x2a0f1c,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.004;
  shadow.renderOrder = -1;
  scene.add(shadow);

  let width = 0;
  let height = 0;
  function resize(w, h, dpr = Math.min(globalThis.devicePixelRatio || 1, 2)) {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === width && h === height && renderer.getPixelRatio() === dpr) return;
    width = w;
    height = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    canvas.width = surface.width;
    canvas.height = surface.height;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /** Shrink and fade the contact shadow as the pig leaves the ground. */
  function setShadow(x, lift, spread = 1, strength = 1) {
    const k = 1 / (1 + Math.max(0, lift) * 0.9);
    shadow.position.x = x;
    shadow.scale.set(1.75 * spread * (0.55 + 0.45 * k), 0.95 * spread * (0.55 + 0.45 * k), 1);
    shadow.material.opacity = 0.3 * k * strength;
  }
  setShadow(0, 0);

  function render() {
    renderer.render(scene, camera);
    // Copy while the frame is still in the drawing buffer (it is discarded after this task).
    screen.clearRect(0, 0, canvas.width, canvas.height);
    if (surface.width && surface.height) screen.drawImage(surface, 0, 0);
  }

  /** Pixels per world unit at z = 0 for a canvas `h` CSS pixels tall. */
  const pxPerUnit = (h = height) => h / VIEW.extent;

  return { renderer, scene, camera, resize, render, setShadow, pxPerUnit, shadow };
}
