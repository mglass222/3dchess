import { describe, it, expect } from 'vitest';
import {
  THEMES, DEFAULT_THEME, getTheme, makeStarfield, makeGradientTexture,
} from '../src/themes.js';
import { preToneMapCompensate } from '../src/postfx.js';

// makeGradientTexture needs a canvas; stub the minimum (same pattern as
// scene.test.js's fog test), capturing the color stops it feeds the gradient.
function withStubbedCanvas(run) {
  const originalDocument = globalThis.document;
  const stops = [];
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createLinearGradient: () => ({ addColorStop: (offset, color) => stops.push([offset, color]) }),
        fillStyle: null,
        fillRect() {},
      }),
    }),
  };
  try {
    run();
    return stops;
  } finally {
    globalThis.document = originalDocument;
  }
}

describe('themes', () => {
  it('defines several themes with gradient colors', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(4);
    for (const t of THEMES) {
      expect(typeof t.key).toBe('string');
      expect(typeof t.label).toBe('string');
      expect(t.top).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.bottom).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.fog).toMatch(/^#[0-9a-f]{6}$/i);
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
  it('makeStarfield opts its material out of scene fog', () => {
    // The shell sits at a large radius, so fogging it would gut the Cosmos theme.
    expect(makeStarfield(10).material.fog).toBe(false);
  });
  it('makeGradientTexture passes colors through unchanged without compensate', () => {
    const theme = getTheme('midnight');
    const stops = withStubbedCanvas(() => makeGradientTexture(theme.top, theme.bottom));
    expect(stops).toEqual([[0, theme.top], [1, theme.bottom]]);
  });

  it('makeGradientTexture passes the compensate flag through to preToneMapCompensate', () => {
    const theme = getTheme('midnight');
    const stops = withStubbedCanvas(() => makeGradientTexture(theme.top, theme.bottom, { compensate: true }));
    expect(stops).toEqual([
      [0, preToneMapCompensate(theme.top).hex],
      [1, preToneMapCompensate(theme.bottom).hex],
    ]);
    // And it must actually differ from the uncompensated colors - otherwise
    // this test would pass even if the flag were silently ignored.
    expect(stops[0][1]).not.toBe(theme.top);
    expect(stops[1][1]).not.toBe(theme.bottom);
  });

  it('does not include the retired place themes', () => {
    const keys = THEMES.map((theme) => theme.key);
    for (const key of ['egypt', 'paris', 'london', 'rome', 'newyork']) {
      expect(keys).not.toContain(key);
    }
  });
});
