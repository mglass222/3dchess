import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, getTheme, makeStarfield } from '../src/themes.js';

describe('themes', () => {
  it('defines several themes with gradient colors', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(4);
    for (const t of THEMES) {
      expect(typeof t.key).toBe('string');
      expect(typeof t.label).toBe('string');
      expect(t.top).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.bottom).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('has a valid default theme', () => {
    expect(THEMES.some((t) => t.key === DEFAULT_THEME)).toBe(true);
  });
  it('getTheme returns the match, or the first theme for unknown keys', () => {
    expect(getTheme('nope')).toBe(THEMES[0]);
    expect(getTheme(DEFAULT_THEME).key).toBe(DEFAULT_THEME);
  });
  it('makeStarfield builds a Points cloud of the requested size', () => {
    const stars = makeStarfield(100, 40);
    expect(stars.isPoints).toBe(true);
    expect(stars.geometry.getAttribute('position').count).toBe(100);
    expect(stars.name).toBe('starfield');
  });
  it('does not include the retired place themes', () => {
    const keys = THEMES.map((theme) => theme.key);
    for (const key of ['egypt', 'paris', 'london', 'rome', 'newyork']) {
      expect(keys).not.toContain(key);
    }
  });
  it('is left with exactly the five mood themes, in order', () => {
    expect(THEMES.map((theme) => theme.key)).toEqual([
      'midnight', 'walnut', 'cosmos', 'dusk', 'emerald',
    ]);
  });
  it('no theme carries leftover place-theme scenery fields', () => {
    for (const t of THEMES) {
      expect(t.scenery).toBeUndefined();
      expect(t.ground).toBeUndefined();
      expect(t.stone).toBeUndefined();
    }
  });
  it('only the cosmos theme enables the starfield flag', () => {
    const starry = THEMES.filter((t) => t.stars).map((t) => t.key);
    expect(starry).toEqual(['cosmos']);
  });
  it('no longer exports the retired scenery builder', async () => {
    const mod = await import('../src/themes.js');
    expect(mod.makeScenery).toBeUndefined();
  });
  it('makeStarfield keeps every point within the requested shell radius', () => {
    const radius = 40;
    const stars = makeStarfield(200, radius);
    const pos = stars.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const dist = Math.sqrt(x * x + y * y + z * z);
      expect(dist).toBeGreaterThanOrEqual(radius * 0.85 - 1e-9);
      expect(dist).toBeLessThanOrEqual(radius + 1e-9);
    }
  });
  it('makeStarfield handles a single-star edge case without NaNs', () => {
    const stars = makeStarfield(1, 10);
    const pos = stars.geometry.getAttribute('position');
    expect(pos.count).toBe(1);
    expect(Number.isFinite(pos.getX(0))).toBe(true);
    expect(Number.isFinite(pos.getY(0))).toBe(true);
    expect(Number.isFinite(pos.getZ(0))).toBe(true);
  });
});
