import { Scene } from './scene.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { AI } from './ai.js';
import { createEngine } from './engine.js';
import { createUI, statusText } from './ui.js';
import { createPiece } from './pieces.js';
import { allSquares } from './coords.js';

const appEl = document.getElementById('app');
const sceneEl = document.getElementById('scene');

const scene = new Scene(sceneEl);
const game = new Game();
const ui = createUI(appEl, { onNewGame, onSkillChange });
const input = new Input(scene, game, { onPromotion: (color) => ui.showPromotion(color) });

const ai = new AI(createEngine(), { skill: ui.getSkill(), movetime: 1000 });
let aiColor = 'b';      // computer plays the side the human did not choose
let aiBusy = false;

// --- board sync ---------------------------------------------------------------
function syncBoardFromGame() {
  scene.clearPieces();
  for (const sq of allSquares()) {
    const p = game.pieceAt(sq);
    if (p) scene.placePiece(sq, createPiece(p.type, p.color));
  }
}

// --- reflect a move change-set on the board -----------------------------------
async function onMove(change) {
  input.disable();
  if (change.captured) scene.removePieceAt(change.captured.square);
  await scene.movePiece(change.from, change.to);
  if (change.castle) await scene.movePiece(change.castle.rookFrom, change.castle.rookTo);
  if (change.promotion) {
    scene.removePieceAt(change.to);
    scene.placePiece(change.to, createPiece(change.promotion, change.piece.color));
  }
  ui.setStatus(statusText(game));
  if (game.isGameOver()) return;
  if (game.turn() === aiColor) triggerAI();
  else input.enable();
}

game.on('move', onMove);

// --- AI turn ------------------------------------------------------------------
async function triggerAI() {
  if (aiBusy) return;
  aiBusy = true;
  input.disable();
  ui.setThinking(true);
  try {
    const mv = await ai.bestMove(game.fen());
    if (mv) game.makeMove(mv); // emits 'move' -> onMove handles the rest
  } finally {
    ui.setThinking(false);
    aiBusy = false;
  }
}

// --- pointer: distinguish a click (select/move) from a drag (rotate) ----------
let downPt = null;
scene.domElement.addEventListener('pointerdown', (e) => { downPt = { x: e.clientX, y: e.clientY }; });
scene.domElement.addEventListener('pointerup', (e) => {
  if (!downPt) return;
  const moved = Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y);
  downPt = null;
  if (moved > 5) return; // a drag → OrbitControls already rotated; ignore
  const sq = scene.pickSquare(e);
  if (sq) input.onSquarePicked(sq);
});

// --- UI handlers --------------------------------------------------------------
function onSkillChange(skill) { ai.setSkill(skill); }

function onNewGame(side, skill) {
  aiColor = side === 'w' ? 'b' : 'w';
  ai.setSkill(skill);
  game.reset();
  syncBoardFromGame();
  ui.setStatus(statusText(game));
  if (game.turn() === aiColor) triggerAI();
  else input.enable();
}

// --- dev-only hook (stripped from production builds) --------------------------
// Lets automated/e2e checks drive moves via input.onSquarePicked without
// computing screen pixels. Not present in `vite build` output.
if (import.meta.env.DEV) {
  window.__chess = { game, input, scene, ai };
}

// --- boot ---------------------------------------------------------------------
(async function boot() {
  ui.setStatus('Loading engine…');
  await ai.init();
  onNewGame(ui.getSide(), ui.getSkill());
})();
