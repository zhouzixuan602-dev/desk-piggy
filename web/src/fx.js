// Particles (hearts, Zzz, notes, sparkles…) and the glowing aura the pig
// wears in assistant form. All glyphs are drawn with canvas paths, so nothing
// depends on which fonts happen to be installed.

import * as THREE from 'three';

function glyph(draw, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.lineJoin = ctx.lineCap = 'round';
  draw(ctx, (size / 2) * 0.78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Stroke a white halo behind the shape so it reads on any wallpaper, then fill. */
function ink(ctx, k, fill, path) {
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = k * 0.22;
  path();
  ctx.stroke();
  ctx.fillStyle = fill;
  path();
  ctx.fill();
}

const GLYPHS = {
  heart(ctx, k) {
    const g = ctx.createLinearGradient(0, -k, 0, k);
    g.addColorStop(0, '#ff8fb0');
    g.addColorStop(1, '#ff4d7e');
    ink(ctx, k, g, () => {
      ctx.beginPath();
      ctx.moveTo(0, k * 0.82);
      ctx.bezierCurveTo(-k * 1.3, -k * 0.05, -k * 0.62, -k * 1.0, 0, -k * 0.36);
      ctx.bezierCurveTo(k * 0.62, -k * 1.0, k * 1.3, -k * 0.05, 0, k * 0.82);
      ctx.closePath();
    });
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(-k * 0.38, -k * 0.34, k * 0.16, k * 0.1, -0.6, 0, Math.PI * 2);
    ctx.fill();
  },
  star(ctx, k) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, k);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#ffd84d');
    ink(ctx, k * 0.6, g, () => {
      ctx.beginPath();
      ctx.moveTo(0, -k);
      ctx.quadraticCurveTo(k * 0.14, -k * 0.14, k, 0);
      ctx.quadraticCurveTo(k * 0.14, k * 0.14, 0, k);
      ctx.quadraticCurveTo(-k * 0.14, k * 0.14, -k, 0);
      ctx.quadraticCurveTo(-k * 0.14, -k * 0.14, 0, -k);
      ctx.closePath();
    });
  },
  note(ctx, k) {
    const path = () => {
      ctx.beginPath();
      ctx.ellipse(-k * 0.28, k * 0.52, k * 0.36, k * 0.27, -0.35, 0, Math.PI * 2);
      ctx.moveTo(k * 0.04, k * 0.44);
      ctx.lineTo(k * 0.04, -k * 0.78);
      ctx.quadraticCurveTo(k * 0.62, -k * 0.62, k * 0.56, -k * 0.08);
      ctx.quadraticCurveTo(k * 0.42, -k * 0.44, k * 0.04, -k * 0.44);
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = k * 0.36;
    path();
    ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle = '#8a63ff';
    ctx.lineWidth = k * 0.15;
    path();
    ctx.stroke();
    ctx.fill();
  },
  zed(ctx, k) {
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-k * 0.55, -k * 0.62);
      ctx.lineTo(k * 0.55, -k * 0.62);
      ctx.lineTo(-k * 0.55, k * 0.62);
      ctx.lineTo(k * 0.55, k * 0.62);
    };
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = k * 0.5;
    path();
    ctx.stroke();
    ctx.strokeStyle = '#6f9bff';
    ctx.lineWidth = k * 0.26;
    path();
    ctx.stroke();
  },
  bang(ctx, k) {
    ink(ctx, k, '#ff7a45', () => {
      ctx.beginPath();
      ctx.roundRect(-k * 0.17, -k * 0.9, k * 0.34, k * 1.1, k * 0.16);
      ctx.moveTo(k * 0.2, k * 0.66);
      ctx.arc(0, k * 0.66, k * 0.2, 0, Math.PI * 2);
    });
  },
  crumb(ctx, k) {
    ink(ctx, k * 0.5, '#f6564f', () => {
      ctx.beginPath();
      ctx.arc(0, 0, k * 0.45, 0, Math.PI * 2);
    });
  },
  spark(ctx, k) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, k);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -k);
    ctx.quadraticCurveTo(k * 0.1, -k * 0.1, k, 0);
    ctx.quadraticCurveTo(k * 0.1, k * 0.1, 0, k);
    ctx.quadraticCurveTo(-k * 0.1, k * 0.1, -k, 0);
    ctx.quadraticCurveTo(-k * 0.1, -k * 0.1, 0, -k);
    ctx.fill();
  },
};

// size/life/velocity are [min, max]; world units and seconds.
const KINDS = {
  heart: { size: [0.26, 0.38], life: [1.0, 1.5], vx: [-0.55, 0.55], vy: [0.9, 1.5], gravity: -0.1, drag: 1.1, spin: [-0.5, 0.5], sway: 0.35 },
  star: { size: [0.16, 0.3], life: [0.5, 0.9], vx: [-1.6, 1.6], vy: [0.4, 1.8], gravity: 3.2, drag: 1.4, spin: [-4, 4], sway: 0 },
  note: { size: [0.3, 0.4], life: [1.2, 1.7], vx: [-0.7, 0.7], vy: [0.7, 1.1], gravity: 0, drag: 0.7, spin: [-0.4, 0.4], sway: 0.6 },
  zed: { size: [0.2, 0.3], life: [2.0, 2.6], vx: [0.18, 0.34], vy: [0.42, 0.58], gravity: 0, drag: 0, spin: [0.05, 0.25], sway: 0.25, grow: 0.9 },
  bang: { size: [0.42, 0.46], life: [0.7, 0.8], vx: [0, 0], vy: [0.5, 0.6], gravity: 0, drag: 3, spin: [0, 0], sway: 0 },
  crumb: { size: [0.06, 0.1], life: [0.5, 0.8], vx: [-0.8, 0.8], vy: [0.2, 1.1], gravity: 5, drag: 0.5, spin: [-6, 6], sway: 0 },
  spark: { size: [0.12, 0.3], life: [0.5, 1.0], vx: [-0.25, 0.25], vy: [-0.1, 0.4], gravity: 0, drag: 1, spin: [-2, 2], sway: 0, tint: true },
};

const AURA_COLORS = ['#ff5fa2', '#b16bff', '#4d9dff', '#3fe3d7', '#ffc04d'];

const AURA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const AURA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uLevel;
uniform vec3 uColors[5];

vec3 ramp(float t) {
  t = fract(t) * 5.0;
  float i = floor(t);
  float f = smoothstep(0.0, 1.0, fract(t));
  vec3 a = uColors[int(mod(i, 5.0))];
  vec3 b = uColors[int(mod(i + 1.0, 5.0))];
  return mix(a, b, f);
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);
  float breathe = 0.012 * sin(uTime * 2.2);
  float wobble = 0.014 * sin(a * 3.0 + uTime * 2.1) + 0.009 * sin(a * 5.0 - uTime * 2.9);
  float R = 0.70 * (0.55 + 0.45 * uLevel) + breathe + wobble;
  float d = abs(r - R);
  float core = smoothstep(0.03, 0.006, d);
  float glow = exp(-d * d / 0.010) * 0.5;
  float inner = (1.0 - smoothstep(0.0, R, r)) * 0.10;
  vec3 col = ramp(a / 6.28318 + uTime * 0.11);
  col = mix(col, vec3(1.0), core * 0.35);
  float alpha = clamp(core * 0.95 + glow + inner, 0.0, 1.0) * uLevel;
  gl_FragColor = vec4(col * alpha, alpha); // premultiplied
}`;

export function createFx(scene, { rng = Math.random } = {}) {
  const textures = {};
  for (const [name, draw] of Object.entries(GLYPHS)) textures[name] = glyph(draw);

  const rand = ([a, b]) => a + (b - a) * rng();
  const live = [];
  const pool = [];
  const tintColor = new THREE.Color();

  function spawn(kind, origin, spread = 0.3) {
    const spec = KINDS[kind];
    let sprite = pool.pop();
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
      sprite.renderOrder = 10;
    }
    sprite.material.map = textures[kind];
    sprite.material.color.set(0xffffff);
    if (spec.tint) sprite.material.color.copy(tintColor.set(AURA_COLORS[Math.floor(rng() * AURA_COLORS.length)]).lerp(new THREE.Color(0xffffff), 0.45));
    sprite.material.opacity = 0;
    sprite.material.rotation = 0;
    sprite.position.set(origin.x + (rng() - 0.5) * spread * 2, origin.y + (rng() - 0.5) * spread, origin.z ?? 1.2);
    scene.add(sprite);
    live.push({
      sprite,
      spec,
      age: 0,
      life: rand(spec.life),
      size: rand(spec.size),
      vx: rand(spec.vx),
      vy: rand(spec.vy),
      spin: rand(spec.spin),
      phase: rng() * 6.28,
    });
  }

  function burst(kind, count, origin, spread) {
    for (let i = 0; i < count; i++) spawn(kind, origin, spread);
  }

  // Continuous emitters, toggled by the brain.
  const emitters = {
    zed: { on: false, every: 1.25, acc: 0.6, origin: { x: 0.55, y: 1.75 }, spread: 0.05 },
    note: { on: false, every: 0.5, acc: 0, origin: { x: 0, y: 2.0 }, spread: 0.9 },
    spark: { on: false, every: 0.11, acc: 0, origin: { x: 0, y: 1.1 }, spread: 1.3 },
  };

  // Aura
  const aura = new THREE.Mesh(
    new THREE.PlaneGeometry(4.3, 4.3),
    new THREE.ShaderMaterial({
      vertexShader: AURA_VERT,
      fragmentShader: AURA_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uColors: { value: AURA_COLORS.map((c) => new THREE.Color(c).convertLinearToSRGB()) },
      },
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
    }),
  );
  aura.position.set(0, 1.08, -1.1);
  aura.renderOrder = -2;
  aura.visible = false;
  scene.add(aura);
  let auraTarget = 0;
  let time = 0;

  function update(dt, pigY = 0) {
    time += dt;

    for (const [kind, e] of Object.entries(emitters)) {
      if (!e.on) continue;
      e.acc += dt;
      while (e.acc >= e.every) {
        e.acc -= e.every;
        spawn(kind, { x: e.origin.x, y: e.origin.y + pigY }, e.spread);
      }
    }

    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) {
        scene.remove(p.sprite);
        pool.push(p.sprite);
        live.splice(i, 1);
        continue;
      }
      const { spec, sprite } = p;
      p.vy -= spec.gravity * dt;
      const drag = Math.exp(-spec.drag * dt);
      p.vx *= drag;
      p.vy *= spec.gravity ? 1 : drag;
      sprite.position.x += (p.vx + Math.sin(time * 3 + p.phase) * spec.sway) * dt;
      sprite.position.y += p.vy * dt;
      const pop = Math.min(1, u / 0.14);
      const size = p.size * (0.3 + 0.7 * pop * (2 - pop)) * (1 + (spec.grow || 0) * u);
      sprite.scale.set(size, size, 1);
      sprite.material.opacity = Math.min(1, u / 0.1) * Math.min(1, (1 - u) / 0.3);
      sprite.material.rotation = p.spin * p.age + Math.sin(time * 2 + p.phase) * 0.15;
    }

    const u = aura.material.uniforms;
    u.uLevel.value += (auraTarget - u.uLevel.value) * (1 - Math.exp(-dt * 5));
    u.uTime.value = time;
    aura.visible = u.uLevel.value > 0.01;
    aura.position.y = 1.08 + pigY;
  }

  return {
    burst,
    update,
    setEmitter(kind, on) {
      const e = emitters[kind];
      if (e.on !== on) e.acc = e.every * 0.6;
      e.on = on;
    },
    setAura(level) {
      auraTarget = level;
    },
    get auraLevel() {
      return aura.material.uniforms.uLevel.value;
    },
    get count() {
      return live.length;
    },
    /** True while something is still animating (keeps the frame rate up). */
    get busy() {
      return live.length > 0 || aura.visible;
    },
  };
}
