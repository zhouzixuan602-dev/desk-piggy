// Entry point for the web demo: a pretend desktop the pig can roam, with the
// same brain the macOS app uses. Here the "host" is the page itself.

import { createPet } from './pet.js';
import { createLookPanel } from './look-panel.js';
import { pickLang } from './i18n.js';

const $ = (sel) => document.querySelector(sel);
const box = $('#pet-box');
const dock = $('#dock');
const assistant = $('#assistant');

const BASE = { w: 300, h: 340 };
const size = () => (innerWidth < 560 ? 0.78 : 1);
let hit = { cx: 150, cy: 115, rx: 80, ry: 90, foot: 34 };
let lang = pickLang(new URLSearchParams(location.search).get('lang') || navigator.language);
let ground = 0; // px from the bottom of the viewport to the surface the pig stands on
const where = { x: innerWidth / 2, y: 0 };

function moveBox() {
  const s = size();
  box.style.width = `${BASE.w * s}px`;
  box.style.height = `${BASE.h * s}px`;
  const left = where.x - (BASE.w * s) / 2;
  const bottom = ground + where.y - hit.foot;
  box.style.transform = `translate3d(${left}px, ${-bottom}px, 0)`;
}

const host = {
  setPosition(x, y) {
    where.x = x;
    where.y = y;
    moveBox();
  },
  emit(type, data) {
    if (type === 'hit') {
      hit = data;
      moveBox();
    } else if (type === 'hide') box.classList.add('gone');
    else if (type === 'show') box.classList.remove('gone');
  },
};

// The look someone picked last time stays with their browser.
const LOOK_KEY = 'deskpiggy.look';
const stored = {
  read() {
    try {
      return localStorage.getItem(LOOK_KEY);
    } catch {
      return null; // storage can be blocked; the pig just starts with its default look
    }
  },
  write(look) {
    try {
      localStorage.setItem(LOOK_KEY, JSON.stringify(look));
    } catch {
      /* not remembered, still applied */
    }
  },
};

const pet = createPet({ canvas: $('#pet'), overlay: box, host, lang, look: stored.read() });
window.piggy = pet;
const lookPanel = createLookPanel($('#look-panel'), {
  look: pet.state().look,
  lang,
  onChange(look) {
    pet.config({ look });
    stored.write(look);
  },
});

function measure() {
  ground = innerHeight - dock.getBoundingClientRect().top - 6;
  // the stage ends under the pretend menu bar
  pet.stage({ width: innerWidth, height: innerHeight - ground - 34 });
  moveBox();
}
measure();
pet.place(Math.min(innerWidth - 120, Math.max(120, innerWidth * 0.62)), 0);
addEventListener('resize', measure);

// --- assistant mode (a stand-in for Siri showing up) --------------------------
let assistantOn = false;
function anchor() {
  const r = assistant.getBoundingClientRect();
  const unit = (BASE.h * size()) / 4.3;
  const roomLeft = r.left > BASE.w * size() * 0.8;
  const x = roomLeft ? r.left - unit * 1.05 : r.right + unit * 1.05;
  const feetFromBottom = innerHeight - (r.top + r.height / 2) - unit * 1.35;
  return { x, y: Math.max(0, feetFromBottom - ground) };
}
function setAssistant(on) {
  assistantOn = on;
  assistant.classList.toggle('on', on);
  document.body.classList.toggle('assistant-on', on);
  $('#btn-assistant').setAttribute('aria-pressed', String(on));
  // let the panel finish laying out before asking where it is
  requestAnimationFrame(() => pet.siri(on, on ? anchor() : null));
}
addEventListener('resize', () => assistantOn && pet.siri(true, anchor()));

// --- pointer: look, poke, drag ------------------------------------------------
const overPig = (e) => {
  const r = box.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = r.bottom - e.clientY;
  return ((x - hit.cx) / hit.rx) ** 2 + ((y - hit.cy) / hit.ry) ** 2 <= 1;
};
let press = null;
let lastTap = 0;

addEventListener('pointermove', (e) => {
  const r = box.getBoundingClientRect();
  pet.pointer(e.clientX - (r.left + hit.cx), r.bottom - hit.cy - hit.ry * 0.3 - e.clientY);
  if (!press) {
    document.body.style.cursor = overPig(e) ? 'grab' : '';
    return;
  }
  const dx = e.clientX - press.x;
  const dy = e.clientY - press.y;
  if (!press.dragging && Math.hypot(dx, dy) > 5) {
    press.dragging = true;
    pet.dragStart();
    document.body.style.cursor = 'grabbing';
  }
  if (press.dragging) {
    where.x = press.startX + dx;
    where.y = Math.max(0, press.startY - dy);
    moveBox();
    pet.dragMove(where.x, where.y);
    const now = performance.now();
    const dt = Math.max(1, now - press.t) / 1000;
    press.vx = (e.clientX - press.lx) / dt;
    press.vy = -(e.clientY - press.ly) / dt;
    press.lx = e.clientX;
    press.ly = e.clientY;
    press.t = now;
  }
});
addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !overPig(e) || e.target.closest('button, a, input, label')) return;
  e.preventDefault();
  press = { x: e.clientX, y: e.clientY, startX: where.x, startY: where.y, lx: e.clientX, ly: e.clientY, t: performance.now(), vx: 0, vy: 0, dragging: false };
});
const release = () => {
  if (!press) return;
  const p = press;
  press = null;
  document.body.style.cursor = '';
  if (p.dragging) return pet.dragEnd(p.vx, p.vy);
  const now = performance.now();
  if (now - lastTap < 320) {
    lastTap = 0;
    setAssistant(!assistantOn);
  } else {
    lastTap = now;
    pet.poke();
  }
};
addEventListener('pointerup', release);
addEventListener('pointercancel', release);

// --- controls -----------------------------------------------------------------
document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => pet.command(b.dataset.cmd)));
$('#btn-assistant').addEventListener('click', () => setAssistant(!assistantOn));
$('#roam').addEventListener('change', (e) => pet.config({ roam: e.target.checked }));
$('#name').addEventListener('input', (e) => pet.config({ name: e.target.value }));

function applyLang() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-zh]').forEach((el) => {
    const text = el.dataset[lang];
    if (el.tagName === 'INPUT') el.placeholder = text;
    else el.textContent = text;
  });
  $('#btn-lang').textContent = lang === 'zh' ? 'EN' : '中文';
  pet.config({ lang });
  lookPanel.setLang(lang);
}
$('#btn-lang').addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  applyLang();
});
applyLang();

const clock = $('#clock');
const tickClock = () => (clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
tickClock();
setInterval(tickClock, 20000);

// say hi once everything is up
setTimeout(() => pet.command('wave'), 700);
