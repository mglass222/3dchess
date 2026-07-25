import { describe, it, expect } from 'vitest';
import {
  THEMES, DEFAULT_THEME, getTheme, makeStarfield, makeGradientTexture,
  THEME_LIGHT_DEFAULT, THEME_INTENSITY_RANGE, THEME_ENV_RANGE, THEME_EXPOSURE_RANGE,
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

  describe('thematic lighting data', () => {
    it('midnight carries no light block at all (the mechanically-testable identity theme)', () => {
      expect(getTheme('midnight').light).toBeUndefined();
    });

    it('every non-midnight theme has a light block, and every field validates', () => {
      const colorPattern = /^#[0-9a-f]{6}$/i;
      const nonMidnight = THEMES.filter((t) => t.key !== 'midnight');
      expect(nonMidnight.length).toBeGreaterThanOrEqual(4);

      for (const theme of nonMidnight) {
        const light = theme.light;
        expect(light).toBeDefined();

        expect(light.key).toMatch(colorPattern);
        expect(light.hemiSky).toMatch(colorPattern);
        expect(light.hemiGround).toMatch(colorPattern);
        expect(light.rim).toMatch(colorPattern);

        for (const field of ['keyIntensity', 'hemiIntensity', 'rimIntensity']) {
          expect(light[field]).toBeGreaterThanOrEqual(THEME_INTENSITY_RANGE[0]);
          expect(light[field]).toBeLessThanOrEqual(THEME_INTENSITY_RANGE[1]);
        }
        expect(light.env).toBeGreaterThanOrEqual(THEME_ENV_RANGE[0]);
        expect(light.env).toBeLessThanOrEqual(THEME_ENV_RANGE[1]);
        expect(light.exposure).toBeGreaterThanOrEqual(THEME_EXPOSURE_RANGE[0]);
        expect(light.exposure).toBeLessThanOrEqual(THEME_EXPOSURE_RANGE[1]);
      }
    });

    it('THEME_LIGHT_DEFAULT matches the Tier-1 calibration colours exactly, with 1x multipliers', () => {
      expect(THEME_LIGHT_DEFAULT).toEqual({
        key: '#fff1cf', keyIntensity: 1,
        hemiSky: '#f4fff4', hemiGround: '#33402c', hemiIntensity: 1,
        rim: '#bad7ff', rimIntensity: 1,
        env: 1, exposure: 1,
      });
    });
  });
});
