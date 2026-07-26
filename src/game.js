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

  // Destination squares from `square` that capture something. Derived from
  // chess.js's verbose moves rather than "is there a piece on the target",
  // because en passant captures a pawn that is NOT on the destination square —
  // chess.js still sets `captured` on that move, so this gets ep right for free.
  // legalTargets deliberately keeps returning plain strings: making it return
  // richer objects would ripple into input.js's targets.includes(square) and
  // every assertion in game.test.js / input.test.js for no gain.
  captureTargets(square) {
    const moves = this.chess.moves({ square, verbose: true });
    return [...new Set(moves.filter((m) => m.captured).map((m) => m.to))];
  }

  // Square of `color`'s king ('e1'), or null. chess.js rejects a FEN with a
  // missing king, so the null branch is defensive only.
  kingSquare(color = this.turn()) {
    return this.chess.findPiece({ type: 'k', color })[0] ?? null;
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

  // SAN move list from the start of the game (chess.js's own re-derivation),
  // so a board rebuild can re-derive the move list the same way
  // syncBoardFromGame re-derives the pieces.
  history() {
    return this.chess.history();
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
      san: m.san,
      // FEN's fullmove field increments after Black moves, not after White's,
      // so it already counts "the move number Black just finished" one too
      // high from White's perspective — subtract 1 for Black to get the ply
      // pair's shared move number. Verified against chess.js 1.4.0 directly:
      // White's move N leaves fullmove==N; Black's move N leaves fullmove==N+1.
      moveNumber: Number(m.after.split(' ')[5]) - (m.color === 'b' ? 1 : 0),
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
