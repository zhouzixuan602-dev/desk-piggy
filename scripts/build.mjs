// Bundles the pig into self-contained HTML files:
//   macos/DeskPiggy/Resources/pet.html  – what the macOS app loads in its WKWebView
//   docs/index.html                     – the web demo (GitHub Pages)
//
//   node scripts/build.mjs            build once
//   node scripts/build.mjs --check    fail if the committed outputs are stale (CI)
//   node scripts/build.mjs --watch    rebuild on change

import { build, context } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const at = (p) => resolve(root, p);
const pkg = JSON.parse(readFileSync(at('package.json'), 'utf8'));
const repoUrl = pkg.homepage.replace(/\/$/, '');
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--watch') ? 'watch' : 'build';

const targets = [
  { entry: 'web/src/pet-entry.js', template: 'web/templates/pet.html', out: 'macos/DeskPiggy/Resources/pet.html' },
  { entry: 'web/src/demo-entry.js', template: 'web/templates/demo.html', out: 'docs/index.html' },
];

const options = (entry) => ({
  entryPoints: [at(entry)],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['safari16', 'chrome110', 'firefox115'],
  legalComments: 'inline',
  write: false,
  logLevel: 'warning',
});

function inline(template, js) {
  // A script element ends at the first "</script", and "<!--" changes how it is parsed.
  const safe = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  const html = readFileSync(at(template), 'utf8');
  if (!html.includes('/*__BUNDLE__*/')) throw new Error(`${template}: missing /*__BUNDLE__*/ marker`);
  return html.replaceAll('__REPO_URL__', repoUrl).replace('/*__BUNDLE__*/', () => safe);
}

async function run() {
  let stale = 0;
  for (const t of targets) {
    const result = await build(options(t.entry));
    const html = inline(t.template, result.outputFiles[0].text);
    const out = at(t.out);
    if (mode === 'check') {
      const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
      if (current !== html) {
        stale++;
        console.error(`✗ ${t.out} is out of date — run "npm run build" and commit the result`);
      } else console.log(`✓ ${t.out}`);
    } else {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, html);
      console.log(`✓ ${t.out}  ${(html.length / 1024).toFixed(0)} kB`);
    }
  }
  if (stale) process.exit(1);
}

if (mode === 'watch') {
  for (const t of targets) {
    const ctx = await context({
      ...options(t.entry),
      plugins: [
        {
          name: 'inline-html',
          setup(b) {
            b.onEnd((r) => {
              if (r.errors.length || !r.outputFiles) return;
              mkdirSync(dirname(at(t.out)), { recursive: true });
              writeFileSync(at(t.out), inline(t.template, r.outputFiles[0].text));
              console.log(`✓ ${t.out}`);
            });
          },
        },
      ],
    });
    await ctx.watch();
  }
  console.log('watching…');
} else {
  await run();
}
