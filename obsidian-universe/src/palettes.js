// Colour schemes. Each is a gradient: galaxies take evenly spaced colours from it,
// and the brain shows the whole gradient across its regions.
export const SCHEMES = {
  neon: { name: 'Neon', stops: ['#ff2bd6', '#a64dff', '#5468ff', '#00b8ff', '#00ffd0', '#3dff7a', '#d8ff3a', '#ffcf3a', '#ff8a3d', '#ff3d5e'] },
  aurora: { name: 'Aurora', stops: ['#00ffa3', '#00e1ff', '#4d7cff', '#9b5cff', '#ff5cf0'] },
  synthwave: { name: 'Synthwave', stops: ['#ff007a', '#ff4fa3', '#c84dff', '#6b5cff', '#00d0ff', '#00ffe1'] },
  ember: { name: 'Ember', stops: ['#fff07a', '#ffc23d', '#ff7a2e', '#ff3d5a', '#ff2bd6'] },
  ice: { name: 'Ice', stops: ['#ffffff', '#c8ecff', '#7fd4ff', '#4c95ff', '#8f7bff'] },
};

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export function gradientAt(stops, t) {
  const rgb = stops.map(hexToRgb);
  const x = Math.min(0.99999, Math.max(0, t)) * (rgb.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = rgb[i], b = rgb[Math.min(i + 1, rgb.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const rgbToCss = ([r, g, b], alpha = 1) =>
  alpha === 1 ? `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`
    : `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`;

/** Colour slot for galaxy i of n: spread so the biggest galaxies don't get neighbouring hues. */
export function colorSlot(i, n) {
  if (n <= 2) return i;
  let step = Math.max(1, Math.round(n * 0.38));
  while (gcd(step, n) !== 1) step++;
  return (i * step) % n;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export function galaxyColor(schemeKey, slot, n) {
  const stops = (SCHEMES[schemeKey] || SCHEMES.neon).stops;
  return gradientAt(stops, n <= 1 ? 0.3 : (slot + 0.5) / n);
}

export function loadScheme() {
  try { return localStorage.getItem('ou.scheme') || 'neon'; } catch { return 'neon'; }
}
export function saveScheme(key) {
  try { localStorage.setItem('ou.scheme', key); } catch { /* private mode */ }
}
