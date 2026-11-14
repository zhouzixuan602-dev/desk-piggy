// Entry point for the macOS shell. The same bundle serves two windows:
//
//   • the pig itself — a transparent WKWebView; all input arrives from Swift through
//     `window.piggy`, and the pig talks back via `webkit.messageHandlers.piggy`
//   • the Appearance window — when Swift sets `window.__DESKPIGGY_MODE = "look"` before
//     the page loads, the page becomes a preview of the pig next to its controls
//
// Swift may also set `window.__DESKPIGGY_PRESENT = "copy"` (virtual GPU, or the
// "Compatibility display" setting) to change how frames are put on screen.

import { createPet, VERSION } from './pet.js';
import { createLookPanel } from './look-panel.js';
import { normalizeLook } from './look.js';
import { pickLang } from './i18n.js';

// Set by the shell before the page loads; see stage3d.js for what it means.
const present = globalThis.__DESKPIGGY_PRESENT === 'copy' ? 'copy' : 'direct';

const bridge = globalThis.webkit?.messageHandlers?.piggy;
const post = (message) => {
  try {
    bridge?.postMessage(message);
  } catch {
    /* the shell went away */
  }
};

function startPet() {
  const host = {
    setPosition: (x, y) => post({ type: 'pos', x, y }),
    emit: (type, data) => post({ type, ...data }),
  };
  const pet = createPet({
    canvas: document.getElementById('pet'),
    overlay: document.getElementById('wrap'),
    host,
    lang: navigator.language,
    present,
  });
  globalThis.piggy = pet;
  post({ type: 'ready', version: VERSION });
}

const EDITOR_CSS = `
:root{--ink:#4a2233;--ink-soft:#8a6272;--chip:rgba(255,255,255,.9);--glass-edge:rgba(120,60,90,.18);--accent:#ff6f9c;--panel:#fff7f9;--stage-a:#ffe4ec;--stage-b:#e3f1ff}
@media (prefers-color-scheme:dark){:root{--ink:#fbe9ef;--ink-soft:#c9a9b7;--chip:rgba(255,255,255,.1);--glass-edge:rgba(255,255,255,.16);--panel:#241a2c;--stage-a:#4a2145;--stage-b:#1f2f58;color-scheme:dark}}
html,body{height:100%}
body.look-editor{display:flex;background:var(--panel);cursor:default;
  font:13px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",system-ui,sans-serif}
body.look-editor #wrap{position:relative;inset:auto;flex:0 0 300px;height:100%;min-height:340px;
  background:radial-gradient(90% 70% at 30% 20%,var(--stage-a),transparent 75%),radial-gradient(90% 70% at 80% 90%,var(--stage-b),transparent 75%)}
body.look-editor #pet{position:absolute;left:0;bottom:0;width:300px;height:340px}
#look-side{flex:1;min-width:0;padding:18px 18px 16px;overflow:auto;-webkit-user-select:none;user-select:none}
`;

function startLookEditor() {
  document.head.append(Object.assign(document.createElement('style'), { textContent: EDITOR_CSS }));
  document.body.classList.add('look-editor');
  const side = Object.assign(document.createElement('div'), { id: 'look-side' });
  document.body.append(side);

  let modelError = '';
  const pet = createPet({
    canvas: document.getElementById('pet'),
    overlay: document.getElementById('wrap'),
    host: {
      setPosition() {},
      emit(type, data) {
        if (type === 'model') modelError = data.ok ? '' : data.error;
      },
    },
    lang: navigator.language,
    present,
  });
  // A model on a stand: no wandering off, no chatter.
  pet.config({ roam: false, chatty: false });
  pet.stage({ width: 300, height: 340 });
  pet.place(150, 0);

  const panel = createLookPanel(side, {
    look: pet.state().look,
    lang: pickLang(navigator.language),
    onChange(look) {
      pet.config({ look });
      pet.command('stand'); // wake up and face front so the change is visible
      post({ type: 'look', look });
    },
    // Choosing a file is the shell's job (it shows the open panel and keeps the copy).
    model: { pick: 'native' },
    onModelPick: () => post({ type: 'pickModel' }),
    onModelClear: () => post({ type: 'clearModel' }),
    onModelAdjust(adjust) {
      pet.modelAdjust(adjust);
      post({ type: 'modelAdjust', adjust });
    },
  });

  globalThis.piggy = pet;
  globalThis.piggyLook = {
    ready: true,
    /** Called by the shell with the saved look (object or JSON string) and language. */
    set(look, lang) {
      const valid = normalizeLook(look);
      pet.config({ look: valid, ...(lang ? { lang } : {}) });
      panel.set(valid);
      if (lang) panel.setLang(pickLang(lang));
    },
    get: () => panel.get(),
    /**
     * Called by the shell: wear { url, name, format, adjust }, or null for the built-in pig.
     * `status` lets the shell say that it is busy or that picking failed.
     */
    async model(spec) {
      if (!spec) {
        await pet.model(null);
        panel.setModel(null);
        return;
      }
      panel.setModelStatus('loading');
      if (await pet.model(spec)) panel.setModel({ name: spec.name, adjust: pet.state().model.adjust });
      else panel.setModelStatus(modelError || 'error');
    },
    status: (message) => panel.setModelStatus(message),
  };
  post({ type: 'lookReady', version: VERSION });
}

try {
  if (globalThis.__DESKPIGGY_MODE === 'look') startLookEditor();
  else startPet();
} catch (error) {
  post({ type: 'error', message: String(error?.stack || error) });
  throw error;
}
