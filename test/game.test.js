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

  it('captureTargets finds en passant even though the captured pawn is not on the destination', () => {
    const g = new Game('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3');
    expect(g.captureTargets('e5')).toContain('d6');
    expect(g.pieceAt('d6')).toBeNull();
  });

  it('captureTargets is empty when the piece has no captures available', () => {
    const g = new Game();
    expect(g.captureTargets('e2')).toEqual([]);
  });

  it('captureTargets dedupes a promotion-capture (4 verbose moves) to one destination', () => {
    const g = new Game('r7/1P6/8/8/8/8/k6K/8 w - - 0 1');
    expect(g.captureTargets('b7')).toEqual(['a8']);
  });

  it('kingSquare defaults to the side to move and tracks a moved king', () => {
    const g = new Game();
    expect(g.kingSquare()).toBe('e1');
    expect(g.kingSquare('b')).toBe('e8');
    g.makeMove({ from: 'e2', to: 'e4' });
    g.makeMove({ from: 'e7', to: 'e5' });
    g.makeMove({ from: 'e1', to: 'e2' });
    expect(g.kingSquare('w')).toBe('e2');
  });

  it('reports SAN for a quiet move, a capture, castling, and a promotion', () => {
    let g = new Game();
    expect(g.makeMove({ from: 'e2', to: 'e4' }).san).toBe('e4');

    g = new Game('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    expect(g.makeMove({ from: 'e4', to: 'd5' }).san).toBe('exd5');

    g = new Game('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(g.makeMove({ from: 'e1', to: 'g1' }).san).toBe('O-O');

    g = new Game('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    expect(g.makeMove({ from: 'b7', to: 'b8', promotion: 'q' }).san).toBe('b8=Q+');
  });

  it('increments moveNumber for a White/Black pair and tracks it across turns', () => {
    const g = new Game();
    expect(g.makeMove({ from: 'e2', to: 'e4' }).moveNumber).toBe(1); // White's move 1
    expect(g.makeMove({ from: 'e7', to: 'e5' }).moveNumber).toBe(1); // Black's move 1 (same pair)
    expect(g.makeMove({ from: 'g1', to: 'f3' }).moveNumber).toBe(2); // White's move 2
    expect(g.makeMove({ from: 'b8', to: 'c6' }).moveNumber).toBe(2); // Black's move 2 (same pair)
  });

  it('history() returns the SAN move list', () => {
    const g = new Game();
    g.makeMove({ from: 'e2', to: 'e4' });
    g.makeMove({ from: 'e7', to: 'e5' });
    g.makeMove({ from: 'g1', to: 'f3' });
    expect(g.history()).toEqual(['e4', 'e5', 'Nf3']);
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
