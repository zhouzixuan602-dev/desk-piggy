// The pig's customisable appearance: what can be changed, how input is
// validated, and how the full palette is derived from the three colours a
// person picks. Pure functions only, so this runs (and is tested) without a renderer.

export const EYE_STYLES = Object.freeze(['sparkle', 'button', 'dot']);

export const DEFAULT_LOOK = Object.freeze({
  eyes: 'sparkle',
  body: '#ffbcc8',
  snout: '#ff8da3',
  scarf: '#58cfb8',
  showScarf: true,
  showBelly: true,
  showBlush: true,
});

const COLOR_KEYS = ['body', 'snout', 'scarf'];
const FLAG_KEYS = ['showScarf', 'showBelly', 'showBlush'];
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Turn anything (an object, a JSON string, junk) into a complete, valid look.
 * Unknown or malformed fields fall back to `base`.
 */
export function normalizeLook(input, base = DEFAULT_LOOK) {
  let source = input;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  const look = { ...DEFAULT_LOOK, ...base };
  if (!source || typeof source !== 'object') return look;
  if (EYE_STYLES.includes(source.eyes)) look.eyes = source.eyes;
  for (const key of COLOR_KEYS) {
    if (typeof source[key] === 'string' && HEX.test(source[key])) look[key] = source[key].toLowerCase();
  }
  for (const key of FLAG_KEYS) {
    if (typeof source[key] === 'boolean') look[key] = source[key];
  }
  return look;
}

export const sameLook = (a, b) => [...COLOR_KEYS, ...FLAG_KEYS, 'eyes'].every((key) => a[key] === b[key]);

// --- colour maths (plain sRGB; plenty for deriving a toy's palette) ------------

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

export const mix = (a, b, t) => {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((c, i) => c + (y[i] - c) * t));
};

/** Scale brightness, then push the colour away from grey by `saturation`. */
export const shade = (hex, brightness, saturation = 1) => {
  const rgb = toRgb(hex).map((c) => c * brightness);
  const grey = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
  return toHex(rgb.map((c) => grey + (c - grey) * saturation));
};

/** Every colour the model needs, derived from the three that can be picked. */
export function derivePalette(look) {
  const { body, snout, scarf } = normalizeLook(look);
  return {
    skin: body,
    skinSheen: mix(body, '#ffffff', 0.8),
    snout,
    earInner: mix(snout, body, 0.1),
    hoof: shade(snout, 0.91),
    belly: mix(body, '#ffffff', 0.5),
    line: shade(snout, 0.6, 1.5),
    blush: mix(snout, '#ff3b6b', 0.6),
    scarf,
    scarfSheen: mix(scarf, '#ffffff', 0.75),
  };
}
