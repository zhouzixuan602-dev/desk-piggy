// Dev helper: step the real pet runtime deterministically and lay frames out as a film strip.
//   node scripts/filmstrip.mjs out.png '<js that issues a command>' 0.25 8 [bg] [warmup]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [out, action = '', stepStr = '0.25', countStr = '8', bg = '#e9eef5', warm = '0.5'] = process.argv.slice(2);
const step = Number(stepStr), count = Number(countStr);
const html = readFileSync('macos/DeskPiggy/Resources/pet.html', 'utf8');
const W = 300, H = 340, cols = Math.min(count, 8), rows = Math.ceil(count / cols);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await p.addInitScript(() => {
  window.__msgs = [];
  window.webkit = { messageHandlers: { piggy: { postMessage: (m) => window.__msgs.push(m) } } };
  Math.random = (() => { let s = 12345; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
});
await p.setContent(html.replace('<body>', `<body style="background:${bg}">`));
await p.waitForFunction(() => window.piggy?.ready, null, { timeout: 30000 });
await p.evaluate((warm) => { piggy.pause(true); piggy.stage({ width: 1200, height: 700 }); piggy.place(600, 0); piggy._internals.brain.timer = 999; piggy.step(1 / 60, Math.round(warm * 60)); }, Number(warm));
if (action) await p.evaluate(action);
const shots = [];
for (let i = 0; i < count; i++) {
  if (i > 0) await p.evaluate((s) => piggy.step(1 / 60, Math.round(s * 60)), step);
  else await p.evaluate(() => piggy.step(1 / 60, 1));
  shots.push((await p.screenshot()).toString('base64'));
}
const state = await p.evaluate(() => JSON.stringify(piggy.state()));
const p2 = await b.newPage({ viewport: { width: W * cols, height: H * rows } });
await p2.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap">${shots.map((s) => `<img src="data:image/png;base64,${s}" width="${W}" height="${H}">`).join('')}</body>`);
await p2.screenshot({ path: out });
await b.close();
if (errs.length) console.log('ERRORS:\n' + errs.slice(0, 10).join('\n'));
console.log(state);
