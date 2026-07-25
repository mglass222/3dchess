import * as THREE from 'three';
import { preToneMapCompensate } from './postfx.js';

// Self-contained gradient backgrounds. Cosmos also adds a procedural starfield.
// `fog` is authored explicitly (~70% of `bottom`) rather than derived from it:
// fogged geometry is mostly downward-facing and lit from above, so using the
// raw `bottom` value makes distant table *glow brighter* than nearby table —
// an inversion that reads as a bug. Dusk's `bottom` is a saturated orange that
// would tint the whole table, so it gets a desaturated fog and a lower density.
export const THEMES = [
  { key: 'midnight', label: 'Midnight',     top: '#0c0f17', bottom: '#232a3d', fog: '#141926' },
  { key: 'walnut',   label: 'Walnut Study', top: '#180f08', bottom: '#5e4029', fog: '#3a281a' },
  { key: 'cosmos',   label: 'Cosmos',       top: '#01010a', bottom: '#191540', fog: '#0f0d28', stars: true },
  { key: 'dusk',     label: 'Dusk',         top: '#1f1140', bottom: '#c9663d', fog: '#6e4331', density: 0.015 },
  { key: 'emerald',  label: 'Emerald',      top: '#05130e', bottom: '#2f6048', fog: '#1c3a2b' },
];

export const DEFAULT_THEME = 'midnight';
export const DEFAULT_FOG_DENSITY = 0.02;

export function getTheme(key) {
  return THEMES.find((t) => t.key === key) ?? THEMES[0];
}

// Vertical-gradient texture for scene.background (browser-only: uses a canvas).
//
// `compensate` pre-corrects top/bottom for the composer's OutputPass, which
// ACES-tonemaps this texture's decoded-linear texels along with the rest of
// the HDR buffer (see preToneMapCompensate in postfx.js for why) - something
// the direct renderer.render() fallback path never does, because
// WebGLBackground flags this material toneMapped:false for an SRGBColorSpace
// texture. Passing `compensate: true` on the fallback path would therefore
// double-correct a color the render never tonemaps in the first place and
// wash the gradient out - callers MUST gate this on whether a composer is
// actually in the pipeline (Scene.setTheme passes `!!this.post`).
export function makeGradientTexture(topColor, bottomColor, { compensate = false } = {}) {
  const top = compensate ? preToneMapCompensate(topColor).hex : topColor;
  const bottom = compensate ? preToneMapCompensate(bottomColor).hex : bottomColor;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A spherical shell of stars for space-themed backgrounds.
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
    color: 0xffffff,
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    // Material.fog defaults to true. The star shell sits at radius 46, where
    // density 0.02 fogs the far half by ~89% — opt out or Cosmos loses its stars.
    fog: false,
  });
  const points = new THREE.Points(geom, mat);
  points.name = 'starfield';
  return points;
}
