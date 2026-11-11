// The appearance controls: eye style, three colours, three switches.
// Plain DOM, shared by the web demo and the macOS app's Appearance window.

import { DEFAULT_LOOK, EYE_STYLES, normalizeLook } from './look.js';

const TEXT = {
  zh: {
    eyes: '眼睛', sparkle: '闪亮', button: '圆眼', dot: '豆豆',
    body: '身体', snout: '鼻子', scarf: '围巾', pick: '自选颜色',
    showScarf: '戴围巾', showBelly: '浅色肚皮', showBlush: '腮红', reset: '恢复默认',
  },
  en: {
    eyes: 'Eyes', sparkle: 'Sparkly', button: 'Round', dot: 'Dot',
    body: 'Body', snout: 'Snout', scarf: 'Scarf', pick: 'Custom colour',
    showScarf: 'Wear the scarf', showBelly: 'Pale belly', showBlush: 'Blush', reset: 'Reset',
  },
};

const SWATCHES = {
  body: ['#ffbcc8', '#ffd0b8', '#fff0d6', '#f4f4f6', '#e7d4ff', '#cfe6ff', '#d3f3e3'],
  snout: ['#ff8da3', '#ffa27a', '#ffc46b', '#c9a2ff', '#7fb7ff', '#6fd6b4', '#9a9aa8'],
  scarf: ['#58cfb8', '#ff7a8a', '#ffcf5c', '#6fa8ff', '#a98bff', '#f4f4f6', '#3b3b4f'],
};

const CSS = `
.look-panel{display:grid;gap:12px;font-size:13px;color:var(--ink,#4a2233)}
.look-panel fieldset{margin:0;padding:0;border:0;min-width:0;display:grid;gap:6px}
.look-panel legend{padding:0;font-weight:600;color:var(--ink-soft,#8a6272)}
.lp-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.lp-seg label{position:relative;display:block;cursor:pointer}
.lp-seg input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.lp-seg span{display:block;padding:7px 4px;text-align:center;font-weight:600;border-radius:11px;
  border:1px solid var(--glass-edge,rgba(0,0,0,.12));background:var(--chip,rgba(255,255,255,.78))}
.lp-seg input:checked+span{background:var(--accent,#ff6f9c);color:#fff;border-color:transparent}
.lp-seg input:focus-visible+span{outline:2.5px solid var(--accent,#ff6f9c);outline-offset:2px}
.lp-colors{display:flex;flex-wrap:wrap;align-items:center;gap:7px}
.lp-swatch{width:24px;height:24px;padding:0;border-radius:50%;cursor:pointer;background:var(--c);
  border:1px solid rgba(0,0,0,.14);box-shadow:inset 0 0 0 2px rgba(255,255,255,.55);transition:transform .1s ease}
.lp-swatch:hover{transform:scale(1.12);background:var(--c)}
.lp-swatch[aria-pressed="true"]{outline:2.5px solid var(--accent,#ff6f9c);outline-offset:2px}
.lp-swatch:focus-visible{outline:2.5px solid var(--ink,#4a2233);outline-offset:2px}
.lp-pick{width:30px;height:26px;padding:0;border:1px solid var(--glass-edge,rgba(0,0,0,.12));border-radius:8px;background:none;cursor:pointer}
.lp-flags{display:flex;flex-wrap:wrap;gap:6px 16px}
.lp-flags label{display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.lp-flags input{width:16px;height:16px;margin:0;accent-color:var(--accent,#ff6f9c)}
.lp-reset{justify-self:start;padding:6px 12px;font:inherit;font-weight:600;color:inherit;border-radius:10px;cursor:pointer;
  border:1px solid var(--glass-edge,rgba(0,0,0,.12));background:var(--chip,rgba(255,255,255,.78))}
`;

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * @param {HTMLElement} container
 * @param {{look?: object, lang?: string, onChange?: (look: object) => void}} options
 */
export function createLookPanel(container, { look: initial, lang: initialLang = 'en', onChange } = {}) {
  if (!document.getElementById('look-panel-css')) {
    document.head.append(el('style', { id: 'look-panel-css', textContent: CSS }));
  }
  let look = normalizeLook(initial);
  let lang = TEXT[initialLang] ? initialLang : 'en';
  const labels = []; // [node, key] pairs to re-translate
  const t = (key) => TEXT[lang][key];
  const text = (tag, key, props = {}) => {
    const node = el(tag, { ...props, textContent: t(key) });
    labels.push([node, key]);
    return node;
  };

  const change = (patch) => {
    look = normalizeLook(patch, look);
    sync();
    onChange?.({ ...look });
  };

  const root = el('div', { className: 'look-panel' });

  // Eyes
  const eyeInputs = {};
  const seg = el('div', { className: 'lp-seg' });
  for (const style of EYE_STYLES) {
    const input = el('input', { type: 'radio', name: 'lp-eyes', id: `lp-eyes-${style}`, value: style });
    input.addEventListener('change', () => input.checked && change({ eyes: style }));
    eyeInputs[style] = input;
    seg.append(el('label', { htmlFor: input.id }, input, text('span', style)));
  }
  root.append(el('fieldset', {}, text('legend', 'eyes'), seg));

  // Colours
  const colorRows = {};
  for (const key of ['body', 'snout', 'scarf']) {
    const row = el('div', { className: 'lp-colors' });
    const swatches = SWATCHES[key].map((color) => {
      const b = el('button', { type: 'button', className: 'lp-swatch', title: color });
      b.style.setProperty('--c', color);
      b.setAttribute('aria-label', color);
      b.addEventListener('click', () => change({ [key]: color }));
      row.append(b);
      return [b, color];
    });
    const picker = el('input', { type: 'color', className: 'lp-pick', id: `lp-${key}` });
    labels.push([picker, 'pick']);
    picker.addEventListener('input', () => change({ [key]: picker.value }));
    row.append(picker);
    colorRows[key] = { swatches, picker };
    root.append(el('fieldset', {}, text('legend', key), row));
  }

  // Switches
  const flagInputs = {};
  const flags = el('div', { className: 'lp-flags' });
  for (const key of ['showScarf', 'showBelly', 'showBlush']) {
    const input = el('input', { type: 'checkbox', id: `lp-${key}` });
    input.addEventListener('change', () => change({ [key]: input.checked }));
    flagInputs[key] = input;
    flags.append(el('label', { htmlFor: input.id }, input, text('span', key)));
  }
  root.append(flags);

  const reset = text('button', 'reset', { type: 'button', className: 'lp-reset', id: 'lp-reset' });
  reset.addEventListener('click', () => change({ ...DEFAULT_LOOK }));
  root.append(reset);

  function sync() {
    for (const style of EYE_STYLES) eyeInputs[style].checked = look.eyes === style;
    for (const [key, { swatches, picker }] of Object.entries(colorRows)) {
      picker.value = look[key];
      for (const [button, color] of swatches) button.setAttribute('aria-pressed', String(color === look[key]));
    }
    for (const [key, input] of Object.entries(flagInputs)) input.checked = look[key];
  }

  function translate() {
    for (const [node, key] of labels) {
      if (node.tagName === 'INPUT') {
        node.title = t(key);
        node.setAttribute('aria-label', t(key));
      } else node.textContent = t(key);
    }
  }

  sync();
  translate();
  container.append(root);

  return {
    el: root,
    get: () => ({ ...look }),
    /** Show a look that was changed elsewhere (does not fire onChange). */
    set(next) {
      look = normalizeLook(next);
      sync();
    },
    setLang(next) {
      lang = TEXT[next] ? next : 'en';
      translate();
    },
  };
}
