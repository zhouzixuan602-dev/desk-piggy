// Entry point for the macOS shell. The page is a transparent WKWebView; all
// input arrives from Swift through `window.piggy`, and the pig talks back via
// `webkit.messageHandlers.piggy`.

import { createPet, VERSION } from './pet.js';

const bridge = globalThis.webkit?.messageHandlers?.piggy;
const post = (message) => {
  try {
    bridge?.postMessage(message);
  } catch {
    /* the shell went away */
  }
};

const host = {
  setPosition: (x, y) => post({ type: 'pos', x, y }),
  emit: (type, data) => post({ type, ...data }),
};

try {
  const params = new URLSearchParams(location.search);
  const pet = createPet({
    canvas: document.getElementById('pet'),
    overlay: document.getElementById('wrap'),
    host,
    lang: params.get('lang') || navigator.language,
    name: params.get('name') || '',
  });
  globalThis.piggy = pet;
  post({ type: 'ready', version: VERSION });
} catch (error) {
  post({ type: 'error', message: String(error?.stack || error) });
  throw error;
}
