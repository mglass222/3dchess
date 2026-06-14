import { describe, it, expect } from 'vitest';
import {
  FILES, SQUARE_SIZE, fileIndex, rankIndex,
  squareToWorld, worldToSquare, isLightSquare, allSquares,
} from '../src/coords.js';

describe('coords', () => {
  it('exposes board constants', () => {
    expect(FILES).toEqual(['a','b','c','d','e','f','g','h']);
    expect(SQUARE_SIZE).toBe(1);
  });

  it('computes file/rank indices', () => {
    expect(fileIndex('a1')).toBe(0);
    expect(fileIndex('h8')).toBe(7);
    expect(rankIndex('a1')).toBe(0);
    expect(rankIndex('a8')).toBe(7);
  });

  it('maps a square to a centered world position', () => {
    expect(squareToWorld('a1')).toEqual({ x: -3.5, y: 0, z: 3.5 });
    expect(squareToWorld('h8')).toEqual({ x: 3.5, y: 0, z: -3.5 });
    expect(squareToWorld('e1')).toEqual({ x: 0.5, y: 0, z: 3.5 });
  });

  it('maps world coordinates back to the nearest square (or null off-board)', () => {
    expect(worldToSquare(-3.5, 3.5)).toBe('a1');
    expect(worldToSquare(3.4, -3.4)).toBe('h8');
    expect(worldToSquare(0.5, 3.5)).toBe('e1');
    expect(worldToSquare(99, 0)).toBeNull();
  });

  it('knows square colors (a1 is dark)', () => {
    expect(isLightSquare('a1')).toBe(false);
    expect(isLightSquare('h1')).toBe(true);
    expect(isLightSquare('a8')).toBe(true);
    expect(isLightSquare('e4')).toBe(true);
  });

  it('lists all 64 squares', () => {
    const all = allSquares();
    expect(all).toHaveLength(64);
    expect(all[0]).toBe('a1');
    expect(all[63]).toBe('h8');
  });
});
