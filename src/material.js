// Pure, framework-free derivation of captured material from a FEN. No
// accumulator: New Game, a piece-set switch, and the dev loadFen hook all
// resync the board out from under anything that tried to replay moves, so a
// FEN re-read (same reasoning as main.js's syncBoardFromGame re-reading the
// position rather than replaying moves) is the only source of truth that
// can't go stale.

export const START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

// Order matters only for iteration; king is never captured or promoted in a
// legal position (chess.js won't produce a FEN missing one), so it's excluded
// from both the captured/promoted bookkeeping and PIECE_VALUE.
const TRACKED = ['p', 'n', 'b', 'r', 'q'];
const PROMOTABLE = ['n', 'b', 'r', 'q'];

function countBoard(fen) {
  const boardField = fen.split(' ')[0];
  const counts = { w: {}, b: {} };
  for (const ch of boardField) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    const color = ch === ch.toUpperCase() ? 'w' : 'b';
    const type = ch.toLowerCase();
    counts[color][type] = (counts[color][type] ?? 0) + 1;
  }
  return counts;
}

// Derives captured pieces (and promotions) per side directly from a FEN.
//
// The trap: a pawn that promoted disappears from the board as a pawn exactly
// the same way a captured pawn does, so raw "pawns missing" over-counts
// captures whenever a promotion happened. The fix is to first attribute any
// non-pawn piece count ABOVE the starting count (a queen where there should
// be at most one, etc.) to promotion — chess.js can't produce a legal
// position with MORE of a piece type than START_COUNTS any other way — and
// only report the leftover missing pawns as genuinely captured.
//
// Returns { w: {type: count}, b: {type: count}, promoted: { w, b } }. Empty
// per-side objects when nothing of that type is missing. Also carries a
// non-spec `promotedValue: { w, b }` (material value gained by promotion,
// e.g. queen-for-pawn = +8), used by materialAdvantage below so double/under-
// promotions are valued exactly instead of assumed-to-be-queens.
export function capturedFromFen(fen) {
  const board = countBoard(fen);
  const captured = { w: {}, b: {}, promoted: { w: 0, b: 0 }, promotedValue: { w: 0, b: 0 } };

  for (const color of ['w', 'b']) {
    const onBoard = board[color];

    let totalSurplus = 0;
    let gain = 0;
    for (const t of PROMOTABLE) {
      const have = onBoard[t] ?? 0;
      const surplus = Math.max(0, have - START_COUNTS[t]);
      if (surplus > 0) {
        totalSurplus += surplus;
        gain += surplus * (PIECE_VALUE[t] - PIECE_VALUE.p);
      }
    }

    const missingPawns = Math.max(0, START_COUNTS.p - (onBoard.p ?? 0));
    const promotedCount = Math.min(missingPawns, totalSurplus);
    const capturedPawns = missingPawns - promotedCount;
    if (capturedPawns > 0) captured[color].p = capturedPawns;

    for (const t of PROMOTABLE) {
      const have = onBoard[t] ?? 0;
      const missing = Math.max(0, START_COUNTS[t] - have);
      if (missing > 0) captured[color][t] = missing;
    }

    captured.promoted[color] = promotedCount;
    captured.promotedValue[color] = gain;
  }

  return captured;
}

// Signed material value, positive favours White. Combines genuinely captured
// pieces with the exact value gained by promotion (via promotedValue, not a
// flat "assume queen" guess), so under-promotion and double promotion both
// come out right.
export function materialAdvantage(captured) {
  // captured.b is material Black has LOST (White's gain); captured.w is
  // material White has lost (Black's gain). promotedValue[side] is value
  // `side` itself gained by promoting, so it adds on the same side as that
  // side's own gains, not its losses.
  const capturedValue = (side) =>
    TRACKED.reduce((sum, t) => sum + (PIECE_VALUE[t] ?? 0) * (captured[side]?.[t] ?? 0), 0);
  const whiteGain = capturedValue('b') + (captured.promotedValue?.w ?? 0);
  const blackGain = capturedValue('w') + (captured.promotedValue?.b ?? 0);
  return whiteGain - blackGain;
}

// '+3' / '-3' / '' (equal). Shared by anything that wants to show the
// advantage next to a captured-piece tray.
export function formatAdvantage(advantage) {
  if (advantage === 0) return '';
  return advantage > 0 ? `+${advantage}` : `${advantage}`;
}
