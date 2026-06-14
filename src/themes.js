import * as THREE from 'three';

// Self-contained thematic backgrounds: a vertical gradient + an optional starfield.
// No external assets. Used by scene.setTheme(); chooser lives in ui.js.
export const THEMES = [
  { key: 'midnight', label: 'Midnight',     top: '#0c0f17', bottom: '#232a3d' },
  { key: 'walnut',   label: 'Walnut Study', top: '#180f08', bottom: '#5e4029' },
  { key: 'cosmos',   label: 'Cosmos',       top: '#01010a', bottom: '#191540', stars: true },
  { key: 'dusk',     label: 'Dusk',         top: '#1f1140', bottom: '#c9663d' },
  { key: 'emerald',  label: 'Emerald',      top: '#05130e', bottom: '#2f6048' },
];

export const DEFAULT_THEME = 'midnight';

export function getTheme(key) {
  return THEMES.find((t) => t.key === key) ?? THEMES[0];
}

// Vertical-gradient texture for scene.background (browser-only: uses a canvas).
export function makeGradientTexture(topColor, bottomColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A spherical shell of stars (for space-y themes). Pure THREE (works without a DOM).
export function makeStarfield(count = 1400, radius = 46) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius * (0.85 + Math.random() * 0.15);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.9,
  });
  const points = new THREE.Points(geom, mat);
  points.name = 'starfield';
  return points;
}
