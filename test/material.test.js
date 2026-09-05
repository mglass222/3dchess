import { describe, it, expect } from 'vitest';
import { capturedFromFen, materialAdvantage, formatAdvantage, PIECE_VALUE } from '../src/material.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('capturedFromFen', () => {
  it('reports nothing captured and zero advantage in the start position', () => {
    const captured = capturedFromFen(START_FEN);
    expect(captured.w).toEqual({});
    expect(captured.b).toEqual({});
    expect(captured.promoted).toEqual({ w: 0, b: 0 });
    expect(materialAdvantage(captured)).toBe(0);
  });

  it('reports a missing black knight as captured, advantage +3', () => {
    const fen = 'r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const captured = capturedFromFen(fen);
    expect(captured.b).toEqual({ n: 1 });
    expect(captured.w).toEqual({});
    expect(materialAdvantage(captured)).toBe(3);
  });

  it('does not report a phantom captured pawn when a pawn promoted (2 queens, 7 pawns)', () => {
    // d2 pawn promoted to a queen sitting on d4; nothing else has changed.
    const fen = 'rnbqkbnr/pppppppp/8/8/3Q4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1';
    const captured = capturedFromFen(fen);
    expect(captured.w.p ?? 0).toBe(0);
    expect(captured.w.q ?? 0).toBe(0);
    expect(captured.promoted.w).toBe(1);
    expect(materialAdvantage(captured)).toBe(8);
  });

  it('handles under-promotion (pawn promoted to a rook, not a queen)', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/3R4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 1';
    const captured = capturedFromFen(fen);
    expect(captured.w.p ?? 0).toBe(0);
    expect(captured.promoted.w).toBe(1);
    expect(materialAdvantage(captured)).toBe(PIECE_VALUE.r - PIECE_VALUE.p); // +4, not +8
  });

  it('handles double promotion (two pawns promoted to queens)', () => {
    const fen = 'rnbqkbnr/pppppppp/8/3Q4/3Q4/8/PPP2PPP/RNBQKBNR w KQkq - 0 1';
    const captured = capturedFromFen(fen);
    expect(captured.w.p ?? 0).toBe(0);
    expect(captured.promoted.w).toBe(2);
    expect(materialAdvantage(captured)).toBe(2 * (PIECE_VALUE.q - PIECE_VALUE.p)); // +16
  });

  it('reports every piece missing when a side is down to a lone king', () => {
    const fen = '4k3/8/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1';
    const captured = capturedFromFen(fen);
    expect(captured.b).toEqual({ p: 8, n: 2, b: 2, r: 2, q: 1 });
    expect(captured.promoted.b).toBe(0);
    expect(materialAdvantage(captured)).toBe(39); // 8+6+6+10+9
  });
});

describe('materialAdvantage sign convention', () => {
  it('is positive when White is ahead, negative when Black is ahead', () => {
    const whiteAhead = capturedFromFen('r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(materialAdvantage(whiteAhead)).toBeGreaterThan(0);

    const blackAhead = capturedFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1');
    expect(materialAdvantage(blackAhead)).toBeLessThan(0);
  });
});

describe('formatAdvantage', () => {
  it('formats a White edge with a leading +', () => {
    expect(formatAdvantage(3)).toBe('+3');
  });
  it('formats a Black edge with a leading -', () => {
    expect(formatAdvantage(-4)).toBe('-4');
  });
  it('is empty when material is even', () => {
    expect(formatAdvantage(0)).toBe('');
  });
});
