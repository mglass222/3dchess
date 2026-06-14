# 3D Chess — Design Spec

**Date:** 2026-06-13
**Status:** Approved (design); pending implementation plan

## Summary

A web-based, PC-oriented chess game rendered in 3D. The player views a standard
8×8 chessboard with realistic-looking pieces and can rotate the view freely by
dragging with the mouse. The game enforces full standard chess rules and the
player competes against a built-in AI opponent.

This is **standard chess presented in 3D** — the rules are normal chess; the "3D"
is the rendering and camera, not a 3D-lattice variant.

## Goals

- Render a standard 8×8 chessboard and pieces in 3D using WebGL.
- Let the user orbit the camera around the board with mouse drag — a full 360°
  around the board and tilt from a top-down view all the way down to viewing the
  board from underneath. The board's "up" axis stays up (orbit, not free roll).
- Enforce full standard chess rules: legal move generation, turn order, check,
  checkmate, stalemate, draws, castling, en passant, and promotion.
- Provide a single-player experience against an adjustable-strength AI.
- Be self-contained and easy to run locally on a PC.

## Non-Goals (deferred to later versions)

- Online / networked multiplayer.
- Local hot-seat two-player mode (architecture will allow adding it easily later).
- PGN/FEN save & export, move takeback history navigation, game clocks.
- Full free "trackball" rotation (rolling the board sideways / arbitrary roll).
- Loading detailed external 3D model files (.glb/.gltf).
- Touch / mobile controls.

## Target Platform

Desktop browser with a mouse and WebGL support. Primary interaction is mouse drag
(rotate), mouse wheel (zoom), and mouse click (select/move pieces).

## Technology Choices

- **Three.js** — 3D rendering and the built-in `OrbitControls` camera controller.
- **chess.js** — authoritative chess rules engine (legal moves, check/checkmate/
  stalemate/draw detection, castling, en passant, promotion, FEN/PGN). Avoids
  hand-writing error-prone rules.
- **Stockfish (WebAssembly)** — the AI opponent, run inside a Web Worker so engine
  thinking never blocks the UI. The difficulty slider maps directly to Stockfish's
  UCI "Skill Level" option (0–20); a single fixed, modest per-move think-time cap
  is applied at all levels so the AI always responds promptly.
- **Vite** — dev server and bundler, so the app runs with a single
  `npm run dev` command and dependencies are managed via npm.
- **Vitest** — unit testing (pairs naturally with Vite).

### Alternatives considered

- *Hand-rolled rules engine + minimax AI:* more control and zero runtime deps, but
  reinvents well-solved, bug-prone problems. Rejected.
- *React-Three-Fiber:* nicer component/state model, but React build overhead is
  overkill for a single-screen app. Rejected.

## Architecture

The system is split into small, single-purpose modules that communicate through
narrow interfaces. The chess rules are the source of truth; the 3D scene is a view
that reflects rule-engine state; input and AI are drivers that request moves.

| Module | Responsibility | Depends on |
|---|---|---|
| `game.js` | Wraps chess.js. The single source of truth: current position, side to move, legal moves for a square, applying a move, and game-over status (checkmate/stalemate/draw). Emits a "moved" event describing what changed (from, to, captured square, castling rook move, en passant square, promotion). | chess.js |
| `scene.js` | Sets up the Three.js scene: renderer, the 8×8 board mesh (alternating light/dark squares), lighting, the camera, and `OrbitControls`. Owns the render loop and exposes helpers to place/move/remove piece meshes and to highlight squares. | three |
| `pieces.js` | Builds procedural Staunton-style piece geometry using `LatheGeometry` rotational profiles (pawn, rook, bishop, queen, king) plus a sculpted knight, in light and dark materials. Returns ready-to-place meshes keyed by piece type + color. | three |
| `input.js` | Raycasts mouse position against pieces and squares. Implements click-to-select / click-to-move: clicking a friendly piece selects it and asks `game` for its legal targets (which `scene` highlights); clicking a highlighted target requests the move. Ignores clicks that should be camera rotation. | scene, game |
| `ai.js` | Owns the Stockfish Web Worker. When it is the computer's turn, sends the current position (FEN) plus the configured skill level / think time, receives the best move, and applies it through `game`. | game, stockfish worker |
| `ui.js` | Minimal HTML overlay: New Game button, side picker (play White or Black), difficulty slider, status line (turn / check / checkmate / draw), move list, and the pawn-promotion picker. | game |
| `main.js` | Composition root. Instantiates all modules and wires their events together. | all of the above |

### Separation rationale

- `game.js` knows nothing about Three.js — it's pure rules/state, independently
  testable.
- `scene.js` and `pieces.js` know nothing about chess legality — they render what
  they're told.
- `input.js` and `ai.js` are the only modules that *request* moves; both go through
  the same `game.makeMove` path so special-move handling is consistent.

## Interaction Model

- **Rotate the board:** click-drag on empty space / background — handled by
  `OrbitControls`. Azimuth (horizontal) is unlimited (full 360°); polar (vertical)
  tilt ranges from near top-down to viewing from below the board, clamped just shy
  of the exact poles to avoid gimbal flip. Up-vector stays fixed (no roll).
- **Zoom:** mouse wheel.
- **Select a piece:** left-click a friendly (side-to-move) piece → it becomes
  selected and its legal destination squares highlight.
- **Move:** left-click a highlighted destination → the move is applied and the
  piece animates to the new square. Clicking elsewhere deselects.

Click-to-move (rather than drag-and-drop) is deliberate: it cannot be confused with
drag-to-rotate, making both interactions reliable.

## Data Flow (a turn)

1. User clicks a friendly piece. `input` asks `game` for that square's legal moves;
   `scene` highlights the targets.
2. User clicks a highlighted square. `input` calls `game.makeMove(from, to)`.
3. `game` validates/applies via chess.js and emits "moved" with the change set.
4. `scene` animates the moving piece and reflects side effects: remove a captured
   piece, slide the rook on castling, remove the en-passant-captured pawn, swap the
   pawn mesh for the promoted piece.
5. `game` reports status. If the game is over, `ui` shows the result and offers a
   new game. Otherwise, if it is now the AI's turn, `main` triggers `ai`.
6. `ai` sends the position to Stockfish, receives a move, and applies it via
   `game.makeMove`, re-entering step 3.

The camera/orbit loop runs continuously and independently of game logic.

## Special Cases & Error Handling

- **Promotion:** when a human pawn reaches the last rank, `ui` shows a Q/R/B/N
  picker and the chosen piece is passed to `game.makeMove` before it commits. The
  AI promotes per Stockfish's chosen move (defaults to queen).
- **Check / checkmate / stalemate / draws:** surfaced by chess.js and shown in the
  status line; on checkmate/stalemate/draw the game ends and offers New Game.
- **Illegal or no-op clicks:** only side-to-move pieces are selectable; clicking an
  opponent piece or an empty square with nothing selected is ignored; clicking a
  non-highlighted square deselects.
- **AI worker failure / slow think:** the UI shows a "thinking…" indicator while
  Stockfish works; if the worker errors, the status line reports it and play falls
  back to allowing a New Game rather than silently hanging.
- **WebGL unavailable:** show a clear message instead of a blank canvas.

## Testing Strategy

- Rules correctness is largely inherited from chess.js (already well-tested).
- **Unit tests (`game.js`):** legal-move listing for a square, applying ordinary
  and special moves (castling, en passant, promotion), and game-over detection
  (checkmate, stalemate, draw).
- **Smoke test:** building from the standard start position yields 32 piece meshes
  in the correct squares.
- The 3D/visual layer is kept thin and verified by running the app
  (manual visual check), since pixel-level rendering is impractical to unit test.

## Build & Run

- `npm install` then `npm run dev` to play locally (Vite dev server).
- `npm run build` produces a static bundle that can be served from any static host.
- `npm test` runs the Vitest unit tests.

## v1 Acceptance Criteria

- The board and all 32 pieces render in 3D from the standard starting position.
- Mouse drag orbits the camera 360° around the board and tilts down to an
  under-board view; wheel zooms.
- The player can choose to play White or Black and set a difficulty level.
- Clicking a friendly piece highlights its legal moves; clicking a target makes the
  move with animation, including captures, castling, en passant, and promotion.
- Illegal moves are impossible (only legal targets are offered).
- The AI responds with a legal move on its turn at the chosen strength.
- Check, checkmate, stalemate, and draws are detected and reported; New Game resets.
