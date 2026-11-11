// Renders the app icon from the live 3D model, so the icon always matches the pig.
//   node scripts/make-icon.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const iconset = resolve(root, 'macos/DeskPiggy/Assets.xcassets/AppIcon.appiconset');
mkdirSync(iconset, { recursive: true });

const bundle = await build({ entryPoints: [resolve(root, 'web/src/dev-entry.js')], bundle: true, format: 'iife', write: false, logLevel: 'warning' });
const js = bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script');

// macOS icon grid: an 824 px rounded square on a 1024 px canvas.
const html = `<!doctype html><meta charset="utf8">
<style>
  html, body { margin: 0; background: transparent; }
  .tile { position: absolute; left: 100px; top: 100px; width: 824px; height: 824px; border-radius: 186px;
    background: radial-gradient(120% 90% at 30% 12%, #ffffff 0%, rgba(255,255,255,0) 55%), linear-gradient(160deg, #bfe6ff 0%, #cdd3ff 55%, #e7c9ff 100%);
    box-shadow: 0 22px 44px rgba(60, 40, 110, .30), inset 0 0 0 2px rgba(255,255,255,.35); }
  canvas { position: absolute; left: 100px; top: 100px; width: 824px; height: 824px; border-radius: 186px; }
</style>
<div class="tile"></div><canvas id="c"></canvas><script>${js}</script>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
await page.setContent(html);
await page.waitForFunction(() => window.__dev, null, { timeout: 30000 });
await page.evaluate(() => {
  const { stage, pose, THREE } = window.__dev;
  stage.resize(824, 824, 2);
  stage.camera.fov = 22;
  stage.camera.position.set(0, 1.46, 7.9);
  stage.camera.lookAt(new THREE.Vector3(0, 0.98, 0));
  stage.camera.updateProjectionMatrix();
  pose({ headZ: 0.07, headY: 0.12, armRz: 1.15, armRx: 0.55, blush: 0.62, lookX: 0.25 }, -0.22);
});
const master = await page.screenshot({ omitBackground: true });
writeFileSync(resolve(iconset, 'icon_512x512@2x.png'), master);
writeFileSync(resolve(root, 'docs/icon.png'), master);

const sizes = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32], ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256], ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
];
const data = `data:image/png;base64,${master.toString('base64')}`;
for (const [name, px] of sizes) {
  const p = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0;background:transparent"><img src="${data}" style="display:block;width:${px}px;height:${px}px">`);
  await p.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  writeFileSync(resolve(iconset, name), await p.screenshot({ omitBackground: true }));
  await p.close();
}
await browser.close();

const images = [];
for (const size of [16, 32, 128, 256, 512]) {
  images.push({ filename: `icon_${size}x${size}.png`, idiom: 'mac', scale: '1x', size: `${size}x${size}` });
  images.push({ filename: `icon_${size}x${size}@2x.png`, idiom: 'mac', scale: '2x', size: `${size}x${size}` });
}
writeFileSync(resolve(iconset, 'Contents.json'), JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
writeFileSync(resolve(iconset, '../Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
console.log('✓ app icon written to', iconset);
