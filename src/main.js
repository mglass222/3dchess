import { Scene } from './scene.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { AI } from './ai.js';
import { createEngine } from './engine.js';
import { createUI, statusText } from './ui.js';
import { createPiece, loadPieces } from './pieces.js';
import { allSquares } from './coords.js';

const appEl = document.getElementById('app');
const sceneEl = document.getElementById('scene');

const scene = new Scene(sceneEl);
const game = new Game();
const ui = createUI(appEl, { onNewGame, onSkillChange, onThemeChange });
const input = new Input(scene, game, { onPromotion: (color) => ui.showPromotion(color) });

const ai = new AI(createEngine(), { skill: ui.getSkill(), movetime: 1000 });
let aiColor = 'b';      // computer plays the side the human did not choose
let aiBusy = false;
let gameId = 0;         // bumped on every New Game; stale AI replies are discarded
let booted = false;     // true once models + engine finish loading; gates UI handlers

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
  if (aiBusy || game.isGameOver() || game.turn() !== aiColor) return;
  aiBusy = true;
  const myGame = gameId;
  input.disable();
  ui.setThinking(true);

  let mv = null;
  try {
    mv = await ai.bestMove(game.fen());
  } catch (err) {
    console.error('AI move failed:', err);
  }
  aiBusy = false;

  if (gameId !== myGame) {
    // A New Game started while we were thinking: discard this stale result.
    // If the fresh position now needs an AI move, start it (engine is free again).
    if (game.turn() === aiColor && !game.isGameOver()) triggerAI();
    return;
  }

  ui.setThinking(false);
  if (mv && game.makeMove(mv)) return; // onMove updates status + re-enables input

  // No move applied (engine error or no legal move): restore status, re-open input.
  ui.setStatus(statusText(game));
  if (!game.isGameOver()) input.enable();
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
function onThemeChange(key) {
  scene.setTheme(key);
  try { localStorage.setItem('chess-theme', key); } catch { /* ignore */ }
}

function onSkillChange(skill) {
  if (!booted) return;
  ai.setSkill(skill);
}

function onNewGame(side, skill) {
  if (!booted) return;                       // ignore clicks before models/engine load
  gameId++;                                  // invalidate any in-flight AI search
  aiColor = side === 'w' ? 'b' : 'w';
  ai.setSkill(skill);
  if (aiBusy) ai.stop();                     // hurry the stale search so the engine frees
  game.reset();
  syncBoardFromGame();
  ui.setThinking(false);
  ui.setStatus(statusText(game));

  if (aiBusy) {
    // The previous search is still draining; its triggerAI tail will start the
    // new AI turn when it finishes. Set input for the new side meanwhile.
    if (game.turn() === aiColor) input.disable();
    else input.enable();
    return;
  }

  if (game.turn() === aiColor && !game.isGameOver()) triggerAI();
  else input.enable();
}

// --- dev-only hook (stripped from production builds) --------------------------
// Lets automated/e2e checks drive moves via input.onSquarePicked without
// computing screen pixels. Not present in `vite build` output.
if (import.meta.env.DEV) {
  window.__chess = {
    game, input, scene, ai,
    get aiBusy() { return aiBusy; },
    // Test helper: jump to a FEN, resync the board, disable AI (tests drive both sides).
    loadFen(fen) {
      aiColor = null;
      game.reset(fen);
      syncBoardFromGame();
      ui.setStatus(statusText(game));
      input.enable();
    },
  };
}

// --- boot ---------------------------------------------------------------------
(async function boot() {
  try {
    ui.setStatus('Loading…');
    await loadPieces();
    await ai.init();
    booted = true;
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('chess-theme'); } catch { /* ignore */ }
    if (savedTheme) { ui.setTheme(savedTheme); scene.setTheme(savedTheme); }
    onNewGame(ui.getSide(), ui.getSkill());
  } catch (err) {
    console.error('Failed to start:', err);
    ui.setStatus('Failed to load — see console');
  }
})();
