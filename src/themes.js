import * as THREE from 'three';
import { preToneMapCompensate } from './postfx.js';

// Self-contained gradient backgrounds. Cosmos also adds a procedural starfield.
// `fog` is authored explicitly (~70% of `bottom`) rather than derived from it:
// fogged geometry is mostly downward-facing and lit from above, so using the
// raw `bottom` value makes distant table *glow brighter* than nearby table —
// an inversion that reads as a bug. Dusk's `bottom` is a saturated orange that
// would tint the whole table, so it gets a desaturated fog and a lower density.
//
// `light` (optional): thematic lighting, layered on top of the base rig
// _addLights already picks (LIGHT_RIG in scene.js). Colours here are
// ABSOLUTE; the four intensity-ish fields (keyIntensity, hemiIntensity,
// rimIntensity, env) and `exposure` are MULTIPLIERS applied to that base, not
// replacement values — that's what lets a theme compose with the existing
// _envFailed fallback (which already swaps in brighter pre-IBL intensities)
// instead of fighting it. `midnight` deliberately carries no `light` block at
// all: applyThemeLighting/applyThemeEnvIntensity fall back to
// THEME_LIGHT_DEFAULT's 1x multipliers, so midnight reproduces the Tier-1
// calibration byte-for-byte and needs no separate "identity theme" case.
//
// Deliberately NOT tinting board wood (LIGHT_SQ/DARK_SQ in scene.js) per
// theme: those are a measured calibration (light 64.8%, dark 20.6%, 3.14:1),
// and material.color multiplies the grain map, so a tint can't preserve that
// luminance without extra machinery. The key-light colour gets the same
// payoff coherently instead — it tints board, pieces and table together,
// which reads as *lighting* rather than as five different chess sets. Don't
// add a board tint back in.
export const THEMES = [
  { key: 'midnight', label: 'Midnight',     top: '#0c0f17', bottom: '#232a3d', fog: '#141926' },
  {
    key: 'walnut', label: 'Walnut Study', top: '#180f08', bottom: '#5e4029', fog: '#3a281a',
    light: {
      key: '#ffd9a0', keyIntensity: 1.05,
      hemiSky: '#ffe8c8', hemiGround: '#3a2a1c', hemiIntensity: 1.15,
      rim: '#ffb877', rimIntensity: 0.70,
      env: 0.92, exposure: 1.03,
    },
  },
  {
    key: 'cosmos', label: 'Cosmos', top: '#01010a', bottom: '#191540', fog: '#0f0d28', stars: true,
    light: {
      key: '#cfd8ff', keyIntensity: 0.88,
      hemiSky: '#9fb4ff', hemiGround: '#10121f', hemiIntensity: 0.80,
      rim: '#7fa8ff', rimIntensity: 1.35,
      env: 1.15, exposure: 0.96,
    },
  },
  {
    key: 'dusk', label: 'Dusk', top: '#1f1140', bottom: '#c9663d', fog: '#6e4331', density: 0.015,
    light: {
      key: '#ffb07a', keyIntensity: 1.10,
      hemiSky: '#ffc9a2', hemiGround: '#402a3a', hemiIntensity: 1.00,
      rim: '#7b6cff', rimIntensity: 0.90,
      env: 1.05, exposure: 1.05,
    },
  },
  {
    key: 'emerald', label: 'Emerald', top: '#05130e', bottom: '#2f6048', fog: '#1c3a2b',
    light: {
      key: '#eaffe4', keyIntensity: 0.95,
      hemiSky: '#bfffd8', hemiGround: '#16281c', hemiIntensity: 1.15,
      rim: '#6fe0b0', rimIntensity: 0.80,
      env: 0.95, exposure: 1.00,
    },
  },
];

// Default multipliers/colours applied when a theme carries no `light` block
// (midnight) or omits a field. Colours are absolute (matching _addLights'
// literals exactly); the rest are 1x multipliers, so the base rig passes
// through unchanged.
export const THEME_LIGHT_DEFAULT = {
  key: '#fff1cf', keyIntensity: 1,
  hemiSky: '#f4fff4', hemiGround: '#33402c', hemiIntensity: 1,
  rim: '#bad7ff', rimIntensity: 1,
  env: 1, exposure: 1,
};
// Clamp on THEME_ENV_RANGE's upper bound: board envMapIntensity 0.55/0.50/0.45
// (~2x today's 0.28/0.25/0.22) measured light squares at 73% and darks at 29%
// luminance — both over the documented 18-24% dark-square band. Linearising,
// a factor of 1.20 moves darks to ~22.3% (still inside the band) and the
// light:dark ratio to ~2.99:1; below 0.85 the darks fall out the other way.
// Kept as an asserted range so no theme author picks e.g. `env: 1.6`.
export const THEME_INTENSITY_RANGE = [0.7, 1.4];
export const THEME_ENV_RANGE = [0.85, 1.20];
export const THEME_EXPOSURE_RANGE = [0.92, 1.08];

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
