// Wires the pieces together: renderer + rig + animator + effects + brain,
// and exposes the small API that hosts (the macOS shell, the web demo) drive.

import * as THREE from 'three';
import { createStage3D } from './stage3d.js';
import { createPig } from './pig.js';
import { Animator } from './animator.js';
import { createFx } from './fx.js';
import { createBubble } from './bubble.js';
import { Brain, COMMANDS } from './brain.js';
import { CLIP_NAMES } from './clips.js';
import { line, pickLang, STRINGS } from './i18n.js';

export const VERSION = '0.1.0';

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas  transparent canvas the pig is drawn on
 * @param {HTMLElement} o.overlay       positioned parent for the speech bubble
 * @param {{setPosition(x:number,y:number):void, emit?(type:string,data?:object):void}} o.host
 */
export function createPet({ canvas, overlay, host, lang = 'en', name = '' }) {
  const stage = createStage3D(canvas);
  const { root, rig } = createPig();
  stage.scene.add(root);
  const fx = createFx(stage.scene);
  const animator = new Animator(rig);
  const bubble = createBubble(overlay);

  const settings = { lang: pickLang(lang), name };
  const brain = new Brain({
    animator,
    fx,
    host,
    say: (key, vars) => bubble.say(line(settings.lang, key, { name: settings.name || STRINGS[settings.lang].name, ...vars })),
  });

  // --- layout ---------------------------------------------------------------
  const probe = new THREE.Vector3();
  let width = 0;
  let height = 0;
  /** Canvas-space position (px, origin bottom-left) of a world point on the z = 0 plane. */
  function toPx(x, y) {
    probe.set(x, y, 0).project(stage.camera);
    return { x: (probe.x * 0.5 + 0.5) * width, y: (probe.y * 0.5 + 0.5) * height };
  }

  let lastLift = 0;
  function reportHit(lift = 0) {
    lastLift = lift;
    const c = toPx(0, 1.02 + lift);
    const edge = toPx(1.0, 1.02 + lift);
    const top = toPx(0, 2.14 + lift);
    host.emit?.('hit', { cx: c.x, cy: c.y, rx: edge.x - c.x, ry: top.y - c.y, foot: toPx(0, 0).y, w: width, h: height });
  }

  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    width = w;
    height = h;
    stage.resize(w, h);
    brain.setStage({ unit: stage.pxPerUnit(h) });
    reportHit(lastLift);
  }
  layout();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
  ro?.observe(canvas);

  // --- frame loop -----------------------------------------------------------
  let last = performance.now();
  let raf = 0;
  let frames = 0;
  let paused = false;

  function tick(dt, draw = true) {
    brain.update(dt);
    const pose = animator.update(dt);
    fx.update(dt, pose.y);
    if (!draw) return;

    // The contact shadow only makes sense while the canvas' ground is the real ground.
    const airborne = brain.pos.y / brain.unit;
    stage.setShadow(0, pose.y + airborne * 0.6, pose.scale, Math.max(0, 1 - airborne / 1.4) * Math.min(1, pose.scale));

    bubble.place(toPx(0, 2.2 + pose.y).y + 4);
    if (Math.abs(pose.y - lastLift) > 0.08) reportHit(pose.y);
    stage.render();
    frames++;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (paused) return;
    const elapsed = (now - last) / 1000;
    // Idle and asleep the pig barely moves: render less often and save the battery.
    const calm = (brain.mode === 'idle' || brain.mode === 'sit' || brain.mode === 'sleep' || brain.mode === 'hidden') && !fx.busy;
    const fps = brain.mode === 'hidden' ? 4 : calm ? animator.fps : 60;
    if (elapsed < 1 / fps - 0.003) return;
    last = now;
    tick(Math.min(elapsed, 0.1));
  }
  raf = requestAnimationFrame(frame);

  // --- public API -----------------------------------------------------------
  const api = {
    ready: true,
    version: VERSION,
    commands: COMMANDS,
    clips: CLIP_NAMES,
    command: (cmd, args) => brain.command(String(cmd), args || {}),
    poke: () => brain.poke(),
    dragStart: () => brain.dragStart(),
    dragMove: (x, y) => brain.dragMove(x, y),
    dragEnd: (vx, vy) => brain.dragEnd(vx, vy),
    /** Assistant form on/off. `anchor` = {x, y} in stage points, or null to hover in place. */
    siri: (active, anchor = null, opts = {}) => brain.setSiri(!!active, anchor, opts),
    pointer: (dx, dy) => brain.setPointer(dx, dy),
    stage: (s) => brain.setStage(s || {}),
    place: (x, y = 0) => brain.setPosition(x, y),
    config(c = {}) {
      if (c.lang) settings.lang = pickLang(c.lang);
      if (typeof c.name === 'string') settings.name = c.name.trim().slice(0, 24);
      const { roam, siriSync, chatty } = c;
      const patch = {};
      if (typeof roam === 'boolean') patch.roam = roam;
      if (typeof siriSync === 'boolean') patch.siriSync = siriSync;
      if (typeof chatty === 'boolean') patch.chatty = chatty;
      brain.setConfig(patch);
    },
    say: (text, ms) => bubble.say(text, ms),
    state: () => ({
      mode: brain.mode,
      clip: animator.name,
      x: brain.pos.x,
      y: brain.pos.y,
      siri: brain.siri.active,
      bubble: bubble.text,
      particles: fx.count,
      aura: fx.auraLevel,
      frames,
      lang: settings.lang,
      name: settings.name || STRINGS[settings.lang].name,
    }),
    pause(on = true) {
      paused = on;
      last = performance.now();
    },
    /** Deterministic stepping for tests and screenshots; only the last step is drawn. */
    step(seconds = 1 / 60, steps = 1) {
      for (let i = 0; i < steps; i++) tick(seconds, i === steps - 1);
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      stage.renderer.dispose();
    },
    _internals: { brain, animator, fx, stage, rig },
  };
  return api;
}
