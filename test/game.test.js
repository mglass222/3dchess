import { describe, it, expect, vi } from 'vitest';
import { Game } from '../src/game.js';

describe('Game', () => {
  it('starts with White to move and the standard position', () => {
    const g = new Game();
    expect(g.turn()).toBe('w');
    expect(g.pieceAt('e1')).toEqual({ type: 'k', color: 'w' });
    expect(g.pieceAt('e4')).toBeNull();
  });

  it('lists legal destination squares for a square (promotions de-duplicated)', () => {
    const g = new Game();
    expect(g.legalTargets('e2').sort()).toEqual(['e3', 'e4']);
    expect(g.legalTargets('b1').sort()).toEqual(['a3', 'c3']);
  });

  it('applies a quiet move and emits a change-set', () => {
    const g = new Game();
    const seen = vi.fn();
    g.on('move', seen);
    const change = g.makeMove({ from: 'e2', to: 'e4' });
    expect(change.from).toBe('e2');
    expect(change.to).toBe('e4');
    expect(change.piece).toEqual({ type: 'p', color: 'w' });
    expect(change.captured).toBeNull();
    expect(change.castle).toBeNull();
    expect(change.promotion).toBeNull();
    expect(seen).toHaveBeenCalledOnce();
    expect(g.turn()).toBe('b');
  });

  it('reports a normal capture with the captured piece on the destination', () => {
    const g = new Game('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    const change = g.makeMove({ from: 'e4', to: 'd5' });
    expect(change.captured).toEqual({ square: 'd5', piece: { type: 'p', color: 'b' } });
  });

  it('reports en passant with the captured pawn NOT on the destination square', () => {
    const g = new Game('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    const change = g.makeMove({ from: 'e5', to: 'd6' });
    expect(change.captured).toEqual({ square: 'd5', piece: { type: 'p', color: 'b' } });
  });

  it('reports the rook hop on kingside castling', () => {
    const g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const change = g.makeMove({ from: 'e1', to: 'g1' });
    expect(change.castle).toEqual({ rookFrom: 'h1', rookTo: 'f1' });
  });

  it('detects and reports promotion', () => {
    const g = new Game('8/P7/8/8/8/8/8/k6K w - - 0 1');
    expect(g.isPromotion('a7', 'a8')).toBe(true);
    const change = g.makeMove({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(change.piece).toEqual({ type: 'p', color: 'w' });
    expect(change.promotion).toBe('q');
  });

  it('returns null and does not emit on an illegal move', () => {
    const g = new Game();
    const seen = vi.fn();
    g.on('move', seen);
    expect(g.makeMove({ from: 'e2', to: 'e5' })).toBeNull();
    expect(seen).not.toHaveBeenCalled();
    expect(g.turn()).toBe('w');
  });

  it('detects checkmate (fool\'s mate)', () => {
    const g = new Game();
    g.makeMove({ from: 'f2', to: 'f3' });
    g.makeMove({ from: 'e7', to: 'e5' });
    g.makeMove({ from: 'g2', to: 'g4' });
    g.makeMove({ from: 'd8', to: 'h4' });
    expect(g.isCheckmate()).toBe(true);
    expect(g.isGameOver()).toBe(true);
  });

  it('resets to a new game and emits reset', () => {
    const g = new Game();
    g.makeMove({ from: 'e2', to: 'e4' });
    const seen = vi.fn();
    g.on('reset', seen);
    g.reset();
    expect(g.turn()).toBe('w');
    expect(g.pieceAt('e4')).toBeNull();
    expect(seen).toHaveBeenCalledOnce();
  });
});
