// TEMPORARY verification harness — replaced by the real game controller in Task 11.
import { Scene } from './scene.js';
import { createPiece } from './pieces.js';
import { Game } from './game.js';
import { allSquares } from './coords.js';

const scene = new Scene(document.getElementById('scene'));
const game = new Game();
for (const sq of allSquares()) {
  const p = game.pieceAt(sq);
  if (p) scene.placePiece(sq, createPiece(p.type, p.color));
}
scene.setHighlights(['e4', 'e5', 'd4', 'd5']);
