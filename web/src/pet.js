// Wires the pieces together: renderer + rig + animator + effects + brain,
// and exposes the small API that hosts (the macOS shell, the web demo) drive.

import * as THREE from 'three';
import { createStage3D } from './stage3d.js';
import { createPig, applyLook } from './pig.js';
import { normalizeLook } from './look.js';
import { createPuppet, parseModel, formatOf } from './custom-model.js';
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
 * @param {'direct'|'copy'} [o.present]  how frames reach the screen (see stage3d.js)
 */
export function createPet({ canvas, overlay, host, lang = 'en', name = '', look: initialLook = null, present = 'direct' }) {
  const stage = createStage3D(canvas, { present });
  const { root, rig } = createPig();
  stage.scene.add(root);
  let look = applyLook(rig, normalizeLook(initialLook));
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

  // The outline everything else is arranged around: half-width, mid height and top, in world units.
  const PIG_SHAPE = Object.freeze({ halfW: 1.0, mid: 1.02, top: 2.14 });
  let shape = PIG_SHAPE;

  let lastLift = 0;
  function reportHit(lift = 0) {
    lastLift = lift;
    const c = toPx(0, shape.mid + lift);
    const edge = toPx(shape.halfW, shape.mid + lift);
    const top = toPx(0, shape.top + lift);
    host.emit?.('hit', { cx: c.x, cy: c.y, rx: edge.x - c.x, ry: top.y - c.y, foot: toPx(0, 0).y, w: width, h: height });
  }

  // --- custom model ----------------------------------------------------------
  const wearPig = animator.apply;
  let puppet = null;
  let modelName = '';
  let loading = 0;

  function reshape() {
    shape = puppet
      ? { halfW: Math.max(0.45, puppet.size.width / 2 + 0.05), mid: puppet.size.height / 2, top: puppet.size.height + 0.08 }
      : PIG_SHAPE;
    reportHit(lastLift);
  }

  function dropModel() {
    if (puppet) {
      stage.scene.remove(puppet.root);
      puppet.dispose();
      puppet = null;
    }
    modelName = '';
    root.visible = true;
    animator.apply = wearPig;
    reshape();
  }

  /**
   * Wear a model file instead of the built-in pig, or pass null to go back.
   * `spec` is { url | buffer, name?, format?, adjust? }. Resolves to true on success; the
   * host is also told through a 'model' event, with the error message if it failed.
   */
  async function setModel(spec) {
    const ticket = ++loading;
    if (!spec) {
      dropModel();
      host.emit?.('model', { ok: true, kind: 'builtin' });
      return true;
    }
    try {
      const format = spec.format || formatOf(spec.name) || formatOf(spec.url);
      let buffer = spec.buffer;
      if (!buffer) {
        const response = await fetch(spec.url);
        if (!response.ok) throw new Error(`the file could not be read (${response.status})`);
        buffer = await response.arrayBuffer();
      }
      const parsed = await parseModel(buffer, format);
      if (ticket !== loading) return false; // a newer request overtook this one
      const next = createPuppet(parsed, spec.adjust, look.body);
      dropModel();
      puppet = next;
      modelName = String(spec.name || '').slice(0, 120);
      root.visible = false;
      stage.scene.add(puppet.root);
      animator.apply = (pose) => puppet.applyPose(pose);
      reshape();
      host.emit?.('model', { ok: true, kind: 'custom', name: modelName, triangles: puppet.triangles });
      return true;
    } catch (error) {
      if (ticket === loading) host.emit?.('model', { ok: false, error: String(error?.message || error) });
      return false;
    }
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
    puppet?.update(dt);
    fx.update(dt, pose.y);
    if (!draw) return;

    // The contact shadow only makes sense while the canvas' ground is the real ground.
    const airborne = brain.pos.y / brain.unit;
    stage.setShadow(0, pose.y + airborne * 0.6, pose.scale * shape.halfW, Math.max(0, 1 - airborne / 1.4) * Math.min(1, pose.scale));

    bubble.place(toPx(0, shape.top + 0.06 + pose.y).y + 4);
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
      // `look` may be partial, or a JSON string as the macOS shell stores it
      if (c.look != null) {
        look = applyLook(rig, normalizeLook(c.look, look));
        puppet?.setAdjust({}, look.body); // a painted model follows the body colour
      }
      const { roam, siriSync, chatty } = c;
      const patch = {};
      if (typeof roam === 'boolean') patch.roam = roam;
      if (typeof siriSync === 'boolean') patch.siriSync = siriSync;
      if (typeof chatty === 'boolean') patch.chatty = chatty;
      brain.setConfig(patch);
    },
    say: (text, ms) => bubble.say(text, ms),
    /** Wear a model file ({ url | buffer, name, format, adjust }) or null for the built-in pig. */
    model: (spec) => setModel(spec),
    /** Fine-tune the worn model: { scale, yaw, lift, zUp, tint }. Returns the settings in force. */
    modelAdjust(adjust) {
      if (!puppet) return null;
      const applied = puppet.setAdjust(adjust, look.body);
      reshape();
      return applied;
    },
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
      look: { ...look },
      present: stage.present,
      model: puppet ? { name: modelName, adjust: puppet.adjust, triangles: puppet.triangles, clips: puppet.clips } : null,
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
