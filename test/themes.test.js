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
  it('includes the named "place" themes, each with a skyline + ground + silhouette', () => {
    for (const key of ['egypt', 'paris', 'london', 'rome', 'newyork']) {
      const t = THEMES.find((x) => x.key === key);
      expect(t, `theme ${key}`).toBeTruthy();
      expect(typeof t.scenery).toBe('string');
      expect(t.ground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.stone).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
