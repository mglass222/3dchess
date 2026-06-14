// Pure mapping between chess squares ('a1'..'h8') and a centered 3D board.
// Board top is the y=0 plane; one square = one world unit.
export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const SQUARE_SIZE = 1;

export function fileIndex(square) {
  return square.charCodeAt(0) - 'a'.charCodeAt(0); // 'a' -> 0 ... 'h' -> 7
}

export function rankIndex(square) {
  return square.charCodeAt(1) - '1'.charCodeAt(0); // '1' -> 0 ... '8' -> 7
}

export function squareToWorld(square) {
  const f = fileIndex(square);
  const r = rankIndex(square);
  return { x: f - 3.5, y: 0, z: 3.5 - r };
}

export function worldToSquare(x, z) {
  const f = Math.round(x + 3.5);
  const r = Math.round(3.5 - z);
  if (f < 0 || f > 7 || r < 0 || r > 7) return null;
  return FILES[f] + (r + 1);
}

export function isLightSquare(square) {
  // a1 (file 0, rank 0) is dark; parity flips each step.
  return (fileIndex(square) + rankIndex(square)) % 2 === 1;
}

export function allSquares() {
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) out.push(FILES[f] + (r + 1));
  }
  return out;
}
