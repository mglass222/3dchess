import { describe, it, expect } from 'vitest';
import { statusText } from '../src/ui.js';

// Minimal fake game exposing only what statusText reads.
function g({ turn = 'w', check = false, checkmate = false, stalemate = false, draw = false }) {
  return {
    turn: () => turn,
    isCheck: () => check,
    isCheckmate: () => checkmate,
    isStalemate: () => stalemate,
    isDraw: () => draw,
  };
}

describe('statusText', () => {
  it('announces whose turn it is', () => {
    expect(statusText(g({ turn: 'w' }))).toBe('White to move');
    expect(statusText(g({ turn: 'b' }))).toBe('Black to move');
  });

  it('announces check', () => {
    expect(statusText(g({ turn: 'w', check: true }))).toBe('White to move — check');
  });

  it('announces checkmate with the winner (side to move is mated)', () => {
    expect(statusText(g({ turn: 'b', checkmate: true }))).toBe('Checkmate — White wins');
    expect(statusText(g({ turn: 'w', checkmate: true }))).toBe('Checkmate — Black wins');
  });

  it('announces stalemate and draw', () => {
    expect(statusText(g({ stalemate: true }))).toBe('Stalemate — draw');
    expect(statusText(g({ draw: true }))).toBe('Draw');
  });
});
