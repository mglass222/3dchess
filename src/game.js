import { Chess } from 'chess.js';

// Thin, framework-free wrapper around chess.js. Source of truth for the position.
// Emits 'move' (with a board change-set) and 'reset'.
export class Game {
  constructor(fen) {
    this.chess = fen ? new Chess(fen) : new Chess();
    this._listeners = {};
  }

  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  _emit(event, payload) {
    for (const fn of this._listeners[event] ?? []) fn(payload);
  }

  turn() {
    return this.chess.turn();
  }

  pieceAt(square) {
    const p = this.chess.get(square); // undefined when empty in chess.js 1.x
    return p ? { type: p.type, color: p.color } : null;
  }

  // Distinct legal destination squares from `square` (promotion targets collapse to one).
  legalTargets(square) {
    const moves = this.chess.moves({ square, verbose: true });
    return [...new Set(moves.map((m) => m.to))];
  }

  isPromotion(from, to) {
    return this.chess
      .moves({ square: from, verbose: true })
      .some((m) => m.to === to && m.flags.includes('p'));
  }

  // Applies a move. Returns the change-set on success, or null if illegal.
  makeMove({ from, to, promotion }) {
    let move;
    try {
      move = this.chess.move({ from, to, promotion });
    } catch {
      return null; // chess.js 1.x throws on illegal moves
    }
    const change = this._toChange(move);
    this._emit('move', change);
    return change;
  }

  fen() {
    return this.chess.fen();
  }

  isCheck() { return this.chess.isCheck(); }
  isCheckmate() { return this.chess.isCheckmate(); }
  isStalemate() { return this.chess.isStalemate(); }
  isDraw() { return this.chess.isDraw(); }
  isGameOver() { return this.chess.isGameOver(); }

  reset(fen) {
    this.chess = fen ? new Chess(fen) : new Chess();
    this._emit('reset');
  }

  // Derive a board change-set from a chess.js verbose move object.
  _toChange(m) {
    const opponent = m.color === 'w' ? 'b' : 'w';
    const change = {
      from: m.from,
      to: m.to,
      piece: { type: m.piece, color: m.color },
      captured: null,
      castle: null,
      promotion: m.promotion ?? null,
      fenAfter: m.after,
    };

    if (m.flags.includes('e')) {
      // En passant: captured pawn sits on the destination file at the origin rank.
      change.captured = {
        square: m.to[0] + m.from[1],
        piece: { type: 'p', color: opponent },
      };
    } else if (m.captured) {
      change.captured = { square: m.to, piece: { type: m.captured, color: opponent } };
    }

    const rank = m.color === 'w' ? '1' : '8';
    if (m.flags.includes('k')) change.castle = { rookFrom: 'h' + rank, rookTo: 'f' + rank };
    else if (m.flags.includes('q')) change.castle = { rookFrom: 'a' + rank, rookTo: 'd' + rank };

    return change;
  }
}
