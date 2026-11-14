// End-to-end smoke test: load both built pages in headless Chromium, drive the
// pig through every command, and fail on any page error or an empty canvas.
//   node tests/render/smoke.mjs [--shots <dir>]

import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { tinyGltf, tinyObj, dataUrl } from '../helpers/tiny-model.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shotsAt = process.argv.indexOf('--shots');
const shotDir = shotsAt > 0 ? resolve(process.argv[shotsAt + 1]) : null;
if (shotDir) mkdirSync(shotDir, { recursive: true });

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failed++;
};

const browser = await chromium.launch();

async function open(file, { width, height, init }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  if (init) await page.addInitScript(init);
  await page.goto(pathToFileURL(resolve(root, file)).href);
  await page.waitForFunction(() => globalThis.piggy?.ready === true, null, { timeout: 30000 });
  return { page, errors };
}

/** Fraction of canvas pixels that are not fully transparent. */
const coverage = (page) =>
  page.evaluate(() => {
    const src = document.getElementById('pet');
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    piggy.step(1 / 60, 1); // draw, then read back in the same task
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n / (d.length / 4);
  });

// --- 1. the page the macOS app loads -------------------------------------------
{
  const { page, errors } = await open('macos/DeskPiggy/Resources/pet.html', {
    width: 300,
    height: 340,
    init: () => {
      globalThis.__msgs = [];
      globalThis.webkit = { messageHandlers: { piggy: { postMessage: (m) => globalThis.__msgs.push(m) } } };
    },
  });
  const types = await page.evaluate(() => [...new Set(__msgs.map((m) => m.type))]);
  check(types.includes('ready'), 'pet.html posts "ready" to the native bridge', types.join(', '));
  check(types.includes('hit'), 'pet.html reports its hit shape');
  const hit = await page.evaluate(() => __msgs.filter((m) => m.type === 'hit').pop());
  check(hit && hit.rx > 40 && hit.ry > 50 && hit.foot > 10 && hit.foot < 80, 'hit shape is plausible', JSON.stringify(hit));

  await page.evaluate(() => {
    piggy.pause(true);
    piggy.stage({ width: 1440, height: 800 });
    piggy.place(700, 0);
    piggy.config({ roam: false }); // no wandering off while we test
  });
  const transparent = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(/rgba\(0, 0, 0, 0\)|transparent/.test(transparent), 'page background is transparent', transparent);

  const cov = await coverage(page);
  check(cov > 0.05 && cov < 0.6, 'pig is drawn on a transparent canvas', `${(cov * 100).toFixed(1)}% of pixels`);
  check((await page.evaluate(() => piggy.state().present)) === 'direct', 'frames go straight to the screen by default');
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'pet.png'), omitBackground: true });

  const commands = await page.evaluate(() => piggy.commands);
  for (const cmd of commands) {
    const res = await page.evaluate((cmd) => {
      const ok = piggy.command(cmd, cmd === 'say' ? { text: 'hi' } : {});
      piggy.step(1 / 60, 240);
      return { ok, state: piggy.state() };
    }, cmd);
    check(res.ok === true && Number.isFinite(res.state.x) && Number.isFinite(res.state.y), `command "${cmd}"`, `${res.state.mode}/${res.state.clip}`);
    await page.evaluate(() => {
      // settle back to a known state between commands
      if (piggy.state().mode === 'hidden') piggy.command('show');
      piggy.command('wake');
      piggy.step(1 / 60, 600);
      piggy.command('stand');
      piggy.step(1 / 60, 60);
    });
  }
  check((await page.evaluate(() => piggy.command('nope'))) === false, 'unknown commands are rejected');

  // assistant form: fly to an anchor, hover, come home
  const siri = await page.evaluate(() => {
    const before = piggy.state();
    piggy.siri(true, { x: 1200, y: 420 });
    piggy.step(1 / 60, 180);
    const during = piggy.state();
    piggy.siri(false);
    piggy.step(1 / 60, 240);
    return { before, during, after: piggy.state() };
  });
  check(siri.during.siri && siri.during.mode === 'siri' && Math.abs(siri.during.x - 1200) < 3 && Math.abs(siri.during.y - 420) < 3 && siri.during.aura > 0.9, 'assistant form flies to its anchor and glows', `${siri.during.x.toFixed(0)},${siri.during.y.toFixed(0)}`);
  check(!siri.after.siri && siri.after.y === 0 && Math.abs(siri.after.x - siri.before.x) < 1 && siri.after.aura < 0.05, 'and returns home afterwards', `${siri.after.mode} at ${siri.after.x.toFixed(0)}`);

  // drag, drop, fall
  const drop = await page.evaluate(() => {
    piggy.dragStart();
    piggy.dragMove(500, 300);
    piggy.step(1 / 60, 10);
    const held = piggy.state();
    piggy.dragEnd(0, 0);
    piggy.step(1 / 60, 5);
    const falling = piggy.state();
    piggy.step(1 / 60, 200);
    return { held, falling, landed: piggy.state() };
  });
  check(drop.held.mode === 'drag' && drop.falling.mode === 'fall' && drop.falling.y < 300 && drop.landed.y === 0, 'drag, drop and land', `${drop.held.mode} → ${drop.falling.mode} → ${drop.landed.mode}`);

  // appearance: the shell hands over the saved look as a JSON string
  const dressed = await page.evaluate(() => {
    piggy.config({ look: '{"eyes":"dot","body":"#cfe6ff","showScarf":false}' });
    const a = piggy.state().look;
    piggy.config({ look: { eyes: 'laser', snout: 'nope', showBlush: false } }); // junk is ignored, valid parts apply
    const b = piggy.state().look;
    piggy.config({ look: 'not json at all' });
    const c = piggy.state().look;
    piggy.step(1 / 60, 2);
    const r = piggy._internals.rig;
    return { a, b, c, scarfShown: r.scarf.visible, dotShown: r.eyes[0].styles.dot.visible, sparkleShown: r.eyes[0].styles.sparkle.visible, skin: '#' + r.materials.skin.color.getHexString() };
  });
  check(dressed.a.eyes === 'dot' && dressed.a.body === '#cfe6ff' && dressed.a.showScarf === false, 'a saved look is applied', JSON.stringify(dressed.a));
  check(dressed.b.eyes === 'dot' && dressed.b.snout === dressed.a.snout && dressed.b.showBlush === false, 'invalid look values are ignored, valid ones apply');
  check(JSON.stringify(dressed.c) === JSON.stringify(dressed.b), 'a corrupt look string changes nothing');
  check(!dressed.scarfShown && dressed.dotShown && !dressed.sparkleShown && dressed.skin === '#cfe6ff', 'the model itself is re-dressed', dressed.skin);
  await page.evaluate(() => piggy.config({ look: { eyes: 'sparkle', body: '#ffbcc8', showScarf: true, showBlush: true } }));

  // wearing your own model
  const worn = await page.evaluate(async ([gltf, obj]) => {
    const before = __msgs.length;
    const ok = await piggy.model({ url: gltf, name: 'box.gltf', adjust: { yaw: 30 } });
    piggy.step(1 / 60, 2);
    const state = piggy.state();
    const hit = __msgs.filter((m) => m.type === 'hit').pop();
    piggy.command('dance');
    piggy.step(1 / 60, 120);
    const dancing = piggy.state();
    piggy.command('stand');
    piggy.step(1 / 60, 60);
    const adjusted = piggy.modelAdjust({ scale: 0.5, tint: true });
    const objOk = await piggy.model({ url: obj, name: 'box.obj' });
    const objState = piggy.state().model;
    const bad = await piggy.model({ url: 'data:text/plain;base64,bm90IGEgbW9kZWw=', name: 'broken.glb' });
    const afterBad = piggy.state().model;
    const wrongType = await piggy.model({ url: gltf, name: 'scene.max' });
    const events = __msgs.slice(before).filter((m) => m.type === 'model');
    return { ok, state, hit, dancing, adjusted, objOk, objState, bad, afterBad, wrongType, events };
  }, [dataUrl(tinyGltf()), dataUrl(tinyObj())]);
  check(worn.ok && worn.state.model?.name === 'box.gltf' && worn.state.model.triangles === 12 && worn.state.model.adjust.yaw === 30, 'a model file can be worn instead of the pig', JSON.stringify(worn.state.model));
  check(worn.hit.ry > 30 && worn.hit.rx > 20 && worn.hit.rx < worn.hit.ry, 'the hit shape follows the model (a tall box)', `${worn.hit.rx.toFixed(0)} × ${worn.hit.ry.toFixed(0)}`);
  check(worn.dancing.clip === 'dance' && worn.dancing.model, 'the worn model still performs');
  check(worn.adjusted?.scale === 0.5 && worn.adjusted.tint === true && worn.adjusted.yaw === 30, 'it can be resized and painted', JSON.stringify(worn.adjusted));
  check(worn.objOk && worn.objState.name === 'box.obj', 'OBJ files load too');
  check(worn.bad === false && worn.afterBad?.name === 'box.obj' && worn.wrongType === false, 'a broken or unsupported file changes nothing');
  check(worn.events.filter((e) => e.ok === false && e.error).length === 2 && worn.events.filter((e) => e.ok).length === 2, 'the host is told about every success and failure', worn.events.map((e) => (e.ok ? 'ok' : 'failed')).join(', '));
  const boxCov = await coverage(page);
  check(boxCov > 0.02, 'the model is drawn', `${(boxCov * 100).toFixed(1)}% of pixels`);
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'custom-model.png'), omitBackground: true });
  const restored = await page.evaluate(async () => {
    await piggy.model(null);
    piggy.step(1 / 60, 2);
    return { model: piggy.state().model, pigVisible: piggy._internals.rig.root.visible, hit: __msgs.filter((m) => m.type === 'hit').pop() };
  });
  check(restored.model === null && restored.pigVisible && Math.abs(restored.hit.rx - hit.rx) < 1, 'and the built-in pig comes back');

  const pos = await page.evaluate(() => __msgs.filter((m) => m.type === 'pos').length);
  check(pos > 20, 'position updates are sent to the host', `${pos} messages`);
  check(errors.length === 0, 'pet.html: no page errors', errors.slice(0, 3).join(' | '));
  await page.close();
}

// --- 1b. the compatibility path: WebGL off-screen, frames copied to a 2D canvas -------
{
  const { page, errors } = await open('macos/DeskPiggy/Resources/pet.html', {
    width: 300,
    height: 340,
    init: () => {
      globalThis.__DESKPIGGY_PRESENT = 'copy';
      globalThis.webkit = { messageHandlers: { piggy: { postMessage() {} } } };
    },
  });
  await page.evaluate(() => {
    piggy.pause(true);
    piggy.config({ roam: false });
    piggy.stage({ width: 1440, height: 800 });
    piggy.place(700, 0);
  });
  const kind = await page.evaluate(() => ({ present: piggy.state().present, is2d: !!document.getElementById('pet').getContext('2d') }));
  check(kind.present === 'copy' && kind.is2d, 'copy presentation: the visible canvas is a 2D canvas', JSON.stringify(kind));
  const cov = await coverage(page);
  check(cov > 0.05 && cov < 0.6, 'copy presentation: the pig is drawn', `${(cov * 100).toFixed(1)}% of pixels`);
  await page.evaluate(() => {
    piggy.siri(true, null);
    piggy.step(1 / 60, 120);
  });
  const glow = await coverage(page);
  check(glow > cov, 'copy presentation: the halo is drawn too', `${(glow * 100).toFixed(1)}% of pixels`);
  check(errors.length === 0, 'copy presentation: no page errors', errors.slice(0, 3).join(' | '));
  await page.close();
}

// --- 2. the same page as the app's Appearance window --------------------------------
{
  const { page, errors } = await open('macos/DeskPiggy/Resources/pet.html', {
    width: 600,
    height: 380,
    init: () => {
      globalThis.__DESKPIGGY_MODE = 'look';
      globalThis.__msgs = [];
      globalThis.webkit = { messageHandlers: { piggy: { postMessage: (m) => globalThis.__msgs.push(m) } } };
    },
  });
  check(await page.evaluate(() => __msgs.some((m) => m.type === 'lookReady') && piggyLook.ready === true), 'appearance window: announces itself to the shell');
  check(await page.evaluate(() => !__msgs.some((m) => m.type === 'pos' || m.type === 'ready')), 'appearance window: does not pose as the desktop pig');

  await page.evaluate(() => piggyLook.set('{"eyes":"button","scarf":"#6fa8ff","showBelly":false}', 'zh-Hans'));
  const shown = await page.evaluate(() => ({
    eyes: document.querySelector('input[name="lp-eyes"]:checked')?.value,
    scarf: document.getElementById('lp-scarf').value,
    belly: document.getElementById('lp-showBelly').checked,
    legend: document.querySelector('.lp-seg').closest('fieldset').querySelector('legend').textContent,
    look: piggy.state().look,
    posted: __msgs.filter((m) => m.type === 'look').length,
  }));
  check(shown.eyes === 'button' && shown.scarf === '#6fa8ff' && shown.belly === false && shown.look.eyes === 'button', 'appearance window: shows the look the shell hands it', JSON.stringify(shown.look));
  check(shown.legend === '眼睛' && shown.posted === 0, 'appearance window: follows the language and does not echo the look back', shown.legend);

  await page.click('label[for="lp-eyes-dot"]');
  await page.locator('.lp-colors').first().locator('.lp-swatch').nth(2).click(); // third body swatch
  await page.uncheck('#lp-showScarf');
  const edited = await page.evaluate(() => ({ last: __msgs.filter((m) => m.type === 'look').pop()?.look, count: __msgs.filter((m) => m.type === 'look').length, look: piggy.state().look }));
  check(edited.count === 3 && edited.last.eyes === 'dot' && edited.last.showScarf === false && edited.last.body === '#fff0d6', 'appearance window: every change is sent to the shell', JSON.stringify(edited.last));
  check(JSON.stringify(edited.last) === JSON.stringify(edited.look), 'appearance window: the preview matches what was sent');
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'look-window.png') });

  // the model section: the shell picks the file, the page shows and tunes it
  check(await page.evaluate(() => document.querySelector('.lp-model-name').textContent === '内置小猪' && getComputedStyle(document.getElementById('lp-model-scale').parentElement).display === 'none'), 'appearance window: starts on the built-in pig with the model controls hidden');
  await page.click('#lp-model-choose');
  check(await page.evaluate(() => __msgs.filter((m) => m.type === 'pickModel').length === 1), 'appearance window: asks the shell to choose a file');
  await page.evaluate((url) => piggyLook.model({ url, name: 'my-model.gltf', format: 'gltf', adjust: { scale: 1.2 } }), dataUrl(tinyGltf()));
  const modelShown = await page.evaluate(() => ({
    name: document.querySelector('.lp-model-name').textContent,
    scale: document.getElementById('lp-model-scale').value,
    eyesHidden: getComputedStyle(document.querySelector('.lp-seg').parentElement).display === 'none',
    bodyShown: getComputedStyle(document.getElementById('lp-body').closest('fieldset')).display !== 'none',
    worn: piggy.state().model?.name,
  }));
  check(modelShown.name === 'my-model.gltf' && modelShown.scale === '1.2' && modelShown.eyesHidden && modelShown.bodyShown && modelShown.worn === 'my-model.gltf', 'appearance window: shows the worn model and only the controls that apply', JSON.stringify(modelShown));
  await page.evaluate(() => {
    const yaw = document.getElementById('lp-model-yaw');
    yaw.value = '90';
    yaw.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.check('#lp-model-tint');
  const tuned = await page.evaluate(() => ({ last: __msgs.filter((m) => m.type === 'modelAdjust').pop()?.adjust, applied: piggy.state().model.adjust }));
  check(tuned.last?.yaw === 90 && tuned.last.tint === true && tuned.last.scale === 1.2 && JSON.stringify(tuned.last) === JSON.stringify(tuned.applied), 'appearance window: adjustments are applied and sent to the shell', JSON.stringify(tuned.last));
  if (shotDir) await page.screenshot({ path: resolve(shotDir, 'look-window-model.png') });
  await page.evaluate(() => piggyLook.model({ url: 'data:text/plain,nope', name: 'broken.glb', format: 'glb' }));
  check(await page.evaluate(() => document.querySelector('.lp-note').classList.contains('bad') && piggy.state().model?.name === 'my-model.gltf'), 'appearance window: a file that fails to load says so and keeps the current model');
  await page.click('#lp-model-back');
  check(await page.evaluate(() => __msgs.filter((m) => m.type === 'clearModel').length === 1), 'appearance window: asks the shell to go back to the built-in pig');
  await page.evaluate(() => piggyLook.model(null));
  check(await page.evaluate(() => piggy.state().model === null && document.querySelector('.lp-model-name').textContent === '内置小猪'), 'appearance window: back on the built-in pig');

  await page.click('#lp-reset');
  const reset = await page.evaluate(() => piggy.state().look);
  check(reset.eyes === 'sparkle' && reset.showScarf === true && reset.body === '#ffbcc8', 'appearance window: reset restores the default look');
  check(errors.length === 0, 'appearance window: no page errors', errors.slice(0, 3).join(' | '));
  await page.close();
}

// --- 3. the web demo -----------------------------------------------------------
for (const [name, viewport] of [['desktop', { width: 1280, height: 760 }], ['phone', { width: 390, height: 800 }]]) {
  const { page, errors } = await open('docs/index.html', viewport);
  await page.waitForTimeout(1200);
  const box = await page.evaluate(() => {
    const r = document.getElementById('pet-box').getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth };
  });
  check(box.left >= -40 && box.right <= box.vw + 40 && box.top > 0 && box.bottom <= box.vh, `demo (${name}): the pig is on screen`, JSON.stringify(box));
  check(box.sw <= box.vw, `demo (${name}): no horizontal overflow`);
  await page.click('[data-cmd="dance"]');
  await page.waitForTimeout(500);
  check((await page.evaluate(() => piggy.state().clip)) === 'dance', `demo (${name}): buttons drive the pig`);
  if (shotDir) await page.screenshot({ path: resolve(shotDir, `demo-${name}.png`) });
  await page.click('#btn-assistant');
  await page.waitForTimeout(1800);
  const s = await page.evaluate(() => piggy.state());
  check(s.siri && s.y > 50, `demo (${name}): assistant mode lifts the pig up to the panel`, `y=${s.y.toFixed(0)}`);
  if (shotDir) await page.screenshot({ path: resolve(shotDir, `demo-${name}-assistant.png`) });
  // appearance controls, and the choice surviving a reload
  await page.click('#btn-assistant');
  await page.click('#look summary');
  await page.click('label[for="lp-eyes-button"]');
  await page.uncheck('#lp-showBelly');
  const picked = await page.evaluate(() => piggy.state().look);
  check(picked.eyes === 'button' && picked.showBelly === false, `demo (${name}): appearance controls change the pig`, JSON.stringify(picked));
  await page.reload();
  await page.waitForFunction(() => globalThis.piggy?.ready === true, null, { timeout: 30000 });
  const kept = await page.evaluate(() => piggy.state().look);
  check(kept.eyes === 'button' && kept.showBelly === false, `demo (${name}): the chosen look is remembered`);
  // a model file chosen in the browser is read locally
  await page.click('#look summary');
  await page.setInputFiles('#lp-model-file', { name: 'my-box.gltf', mimeType: 'model/gltf+json', buffer: Buffer.from(tinyGltf()) });
  await page.waitForFunction(() => piggy.state().model?.name === 'my-box.gltf', null, { timeout: 15000 });
  check(await page.evaluate(() => document.querySelector('.lp-model-name').textContent === 'my-box.gltf'), `demo (${name}): a local model file can be worn`);
  await page.setInputFiles('#lp-model-file', { name: 'scene.max', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
  check(await page.evaluate(() => document.querySelector('.lp-note').classList.contains('bad') && piggy.state().model?.name === 'my-box.gltf'), `demo (${name}): an unsupported file type is refused with a message`);
  await page.click('#lp-model-back');
  await page.waitForFunction(() => piggy.state().model === null, null, { timeout: 5000 });
  check(true, `demo (${name}): and taken off again`);
  check(errors.length === 0, `demo (${name}): no page errors`, errors.slice(0, 3).join(' | '));
  await page.close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
