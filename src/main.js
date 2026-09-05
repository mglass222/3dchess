import { Scene } from './scene.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { AI } from './ai.js';
import { createEngine } from './engine.js';
import { createUI, statusText } from './ui.js';
import { createPiece, loadPieces } from './pieces.js';
import { allSquares } from './coords.js';
import { capturedFromFen } from './material.js';

const appEl = document.getElementById('app');
const sceneEl = document.getElementById('scene');

const scene = new Scene(sceneEl);
const game = new Game();
const ui = createUI(appEl, {
  onNewGame,
  onSkillChange,
  onThemeChange,
  onPieceSetChange,
});
const input = new Input(scene, game, { onPromotion: (color) => ui.showPromotion(color) });

const ai = new AI(createEngine(), { skill: ui.getSkill(), movetime: 1000 });
let aiColor = 'b';      // computer plays the side the human did not choose
let aiBusy = false;
let gameId = 0;         // bumped on every New Game; stale AI replies are discarded
let booted = false;     // true once models + engine finish loading; gates UI handlers
let pieceSetLoadId = 0; // bumped on each requested piece-set load; stale replies are ignored
let appliedPieceSetKey = null;
let lastMove = null;    // {from,to} of the most recent move, so a board rebuild
                        // (piece-set switch) can re-apply the highlight
// True for the entire span of an onMove call, including its move/capture
// animation await. aiBusy alone can't guard onPieceSetChange's re-enable: it
// only covers the engine's think time and is cleared (in triggerAI) BEFORE
// game.makeMove fires onMove, so it's false for the ~230-340ms the move/
// capture animation is actually playing - the exact window a piece-set
// switch could otherwise land in and re-enable input mid-animation.
let movePending = false;

// --- board sync ---------------------------------------------------------------
function syncBoardFromGame() {
  scene.clearPieces();
  scene.clearMarkers();
  for (const sq of allSquares()) {
    const p = game.pieceAt(sq);
    if (p) scene.placePiece(sq, createPiece(p.type, p.color));
  }
  // A piece-set switch mid-game keeps its last-move highlight (lastMove
  // survives the call); New Game and loadFen null out lastMove before calling
  // here, so they don't.
  if (lastMove) scene.setLastMove(lastMove.from, lastMove.to);
  scene.setCheck(game.isCheck() ? game.kingSquare(game.turn()) : null);
  // Re-derive, don't accumulate: covers New Game, a piece-set switch, and the
  // dev loadFen hook the same way the piece placement above does.
  ui.setHistory(game.history());
  ui.setCaptured(capturedFromFen(game.fen()));
}

// --- reflect a move change-set on the board -----------------------------------
async function onMove(change) {
  const myGame = gameId;
  movePending = true;
  try {
    input.disable();
    lastMove = { from: change.from, to: change.to };
    scene.setLastMove(change.from, change.to);
    scene.setCheck(null); // the previous glow is stale the instant a move lands

    // Before any await, so this can never land stale: onMove is synchronous up
    // to the first await below, and a New Game cannot interleave before then.
    // change.fenAfter (not game.fen()) is the position THIS move produced,
    // immune to anything that advances the game before the animation settles.
    ui.pushMove(change);
    ui.setCaptured(capturedFromFen(change.fenAfter));

    // capturePiece MUST be called before movePiece: it detaches the victim from
    // scene.pieces synchronously, which is what stops movePiece's
    // pieces.set(to, obj) from clobbering the victim's map entry. The two then
    // animate concurrently — the victim sinks as the attacker arrives instead of
    // popping out before it sets off. attackerFrom/attackerTo let scene.js derive
    // the victim's reaction delay from the attacker's own move profile instead of
    // main.js ever having to know piece types.
    const capture = change.captured
      ? scene.capturePiece(change.captured.square, { attackerFrom: change.from, attackerTo: change.to })
      : null;

    // Castling: fire the rook's slide partway through the king's, rather than
    // fully serial (king 420ms+settle then rook 240ms+settle would run
    // movePending for ~840ms with the new per-type durations - a real feel
    // regression over today's ~560ms) or fully concurrent (their paths cross
    // near the f/g file while the king is still mid-arc). moveDurationFor must
    // be read before scene.movePiece(change.from, change.to) below empties the
    // king's slot. 55% is comfortably past the crossing point for both
    // kingside and queenside castling, so the two pieces never visually collide.
    let rookMove = null;
    if (change.castle) {
      const kingDuration = scene.moveDurationFor(change.from, change.to);
      rookMove = new Promise((resolve) => {
        setTimeout(() => {
          // A New Game landing mid-stagger would otherwise slide whatever
          // piece the resynced board placed on rookFrom (e.g. the fresh
          // game's own rook) - bail out the same way the code below already
          // does for the king/capture pair.
          if (myGame !== gameId) { resolve(); return; }
          resolve(scene.movePiece(change.castle.rookFrom, change.castle.rookTo));
        }, kingDuration * 0.55);
      });
    }

    await Promise.all([scene.movePiece(change.from, change.to), capture, rookMove]);
    if (myGame !== gameId) return; // a New Game landed while we were animating

    if (change.promotion) {
      scene.removePieceAt(change.to);
      scene.placePiece(change.to, createPiece(change.promotion, change.piece.color));
    }
    if (myGame !== gameId) return;

    scene.setCheck(game.isCheck() ? game.kingSquare(game.turn()) : null);
    ui.setStatus(statusText(game));
    if (game.isGameOver()) return;
    if (game.turn() === aiColor) triggerAI();
    else input.enable();
  } finally {
    // Runs after every early return above too (New Game mid-animation, game
    // over), so onPieceSetChange's guard never stays stuck on a move that's
    // actually finished.
    movePending = false;
  }
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

async function onPieceSetChange(key) {
  if (!booted) return;
  const loadId = ++pieceSetLoadId;
  const previousKey = appliedPieceSetKey ?? 'default';
  input.disable();
  ui.setStatus('Loading pieces...');
  try {
    await loadPieces({ set: key });
    if (loadId !== pieceSetLoadId) return;
    appliedPieceSetKey = key;
    try { localStorage.setItem('chess-piece-set', key); } catch { /* ignore */ }
    syncBoardFromGame();
    ui.setStatus(statusText(game));
  } catch (err) {
    if (loadId !== pieceSetLoadId) return;
    console.error('Failed to load piece set:', err);
    ui.setPieceSet(previousKey);
    ui.setStatus(`Failed to load pieces - ${err.message}`);
  } finally {
    if (loadId === pieceSetLoadId && !game.isGameOver() && game.turn() !== aiColor
      && !aiBusy && !movePending) {
      input.enable();
    }
  }
}

function onSkillChange(skill) {
  if (!booted) return;
  ai.setSkill(skill);
}

function onNewGame(side, skill) {
  if (!booted) return;                       // ignore clicks before models/engine load
  gameId++;                                  // invalidate any in-flight AI search
  scene.flyToNewGame(side);                  // Tier 3 C1: slow orbit-in; never gates input (see scene.js)
  aiColor = side === 'w' ? 'b' : 'w';
  ai.setSkill(skill);
  if (aiBusy) ai.stop();                     // hurry the stale search so the engine frees
  game.reset();
  lastMove = null;
  // Must precede syncBoardFromGame: it calls scene.clearMarkers(), which erases
  // the selection ring, but only Input.disable() clears Input's own selected/
  // targets state (enable() just flips the flag). Without this, a New Game while
  // a piece is selected leaves that selection live but invisible, and the next
  // click on a stale target commits a move with nothing ever highlighted.
  input.disable();
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
      gameId++;       // invalidate any in-flight animation/AI search from before the jump
      lastMove = null;
      game.reset(fen);
      input.disable(); // clears stale selection state; see onNewGame
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
    let savedPieceSet = null;
    try { savedPieceSet = localStorage.getItem('chess-piece-set'); } catch { /* ignore */ }
    if (savedPieceSet) ui.setPieceSet(savedPieceSet);
    if (!ui.getPieceSet()) ui.setPieceSet('default');
    await loadPieces({ set: ui.getPieceSet() });
    appliedPieceSetKey = ui.getPieceSet();
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
