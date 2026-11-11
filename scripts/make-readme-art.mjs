// Renders the images used in the README from the real pages.
//   node scripts/make-readme-art.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();

// 1. The demo desktop with the pig in assistant form.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, deviceScaleFactor: 2 });
  await page.goto(`${pathToFileURL(resolve(root, 'docs/index.html')).href}?lang=zh`);
  await page.waitForFunction(() => globalThis.piggy?.ready === true, null, { timeout: 30000 });
  await page.evaluate(() => piggy.config({ roam: false }));
  await page.waitForTimeout(3200); // let the hello wave finish
  await page.click('#btn-assistant');
  await page.waitForTimeout(2600);
  await page.mouse.move(700, 420);
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(root, 'docs/hero.png') });
  await page.close();
}

// 2. A strip of poses, straight from the page the macOS app loads.
{
  const html = readFileSync(resolve(root, 'macos/DeskPiggy/Resources/pet.html'), 'utf8');
  const poses = [
    ['挥手 · Wave', "piggy.command('wave')", 1.0],
    ['跳舞 · Dance', "piggy.command('dance')", 1.2],
    ['吃苹果 · Snack', "piggy.command('eat')", 1.15],
    ['打盹 · Nap', 'piggy._internals.brain.fallAsleep(60)', 4.2],
    ['被拎起来 · Picked up', 'piggy.dragStart(); piggy.dragMove(640, 260)', 0.7],
    ['助手形态 · Assistant form', 'piggy.siri(true, null)', 1.6],
  ];
  const shots = [];
  for (const [label, action, seconds] of poses) {
    const page = await browser.newPage({ viewport: { width: 300, height: 340 }, deviceScaleFactor: 2 });
    await page.addInitScript(() => {
      globalThis.webkit = { messageHandlers: { piggy: { postMessage() {} } } };
      let s = 2024;
      Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    });
    await page.setContent(html);
    await page.waitForFunction(() => globalThis.piggy?.ready === true, null, { timeout: 30000 });
    await page.evaluate(
      ([action, seconds]) => {
        piggy.pause(true);
        piggy.config({ lang: 'zh', roam: false, chatty: false });
        piggy.stage({ width: 1280, height: 720 });
        piggy.place(640, 0);
        piggy.step(1 / 60, 30);
        new Function(action)();
        piggy.step(1 / 60, Math.round(seconds * 60));
        piggy.say('', 0);
      },
      [action, seconds],
    );
    shots.push([label, (await page.screenshot({ omitBackground: true })).toString('base64')]);
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 286 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><meta charset="utf8"><style>
    body { margin: 0; display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; height: 286px; align-items: end;
      font: 600 13px/1.3 -apple-system, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif; color: #5b2638;
      background: radial-gradient(60% 120% at 12% 0%, #ffe4ec, transparent 70%), radial-gradient(60% 120% at 90% 10%, #e3f1ff, transparent 70%), #fbf3f6; }
    figure { margin: 0; text-align: center; }
    img { display: block; width: 200px; height: 227px; margin: 0 auto; }
    figcaption { padding: 6px 0 16px; }
    figure:last-child { background: linear-gradient(180deg, #2b2440, #3a3156); color: #f4e9ff; }
  </style>${shots.map(([label, b64]) => `<figure><img src="data:image/png;base64,${b64}"><figcaption>${label}</figcaption></figure>`).join('')}`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await page.screenshot({ path: resolve(root, 'docs/poses.png') });
  await page.close();
}

await browser.close();
console.log('✓ docs/hero.png, docs/poses.png');
