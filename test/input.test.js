import { describe, it, expect, vi } from 'vitest';
import { Input } from '../src/input.js';

function makeFakeScene() {
  return {
    selected: null,
    targets: [],
    selectionCleared: false,
    setSelection(square, targets) {
      this.selected = square;
      this.targets = targets;
      this.selectionCleared = false;
    },
    clearSelection() {
      this.selected = null;
      this.targets = [];
      this.selectionCleared = true;
    },
  };
}

// board: map of square -> { type, color }; targets: map of square -> [dest...];
// captures: map of square -> [dest...] of legalTargets that are captures
// (including en passant, whose victim is not necessarily on the dest square).
function makeFakeGame({
  turn = 'w', board = {}, targets = {}, captures = {}, promotions = [],
}) {
  return {
    moved: null,
    turn: () => turn,
    pieceAt: (sq) => board[sq] ?? null,
    legalTargets: (sq) => targets[sq] ?? [],
    captureTargets: (sq) => captures[sq] ?? [],
    isPromotion: (from, to) => promotions.some((p) => p.from === from && p.to === to),
    makeMove(m) { this.moved = m; return {}; },
  };
}

const noPromo = () => Promise.resolve('q');

describe('Input', () => {
  it('selects a friendly piece and records its selection and classified targets', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e3', 'e4'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e2');
    expect(scene.selected).toBe('e2');
    expect(scene.targets).toEqual([
      { square: 'e3', kind: 'move' },
      { square: 'e4', kind: 'move' },
    ]);
  });

  it('moves to a highlighted target and clears the selection', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e3', 'e4'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e2');
    await input.onSquarePicked('e4');
    expect(game.moved).toEqual({ from: 'e2', to: 'e4', promotion: undefined });
    expect(scene.selectionCleared).toBe(true);
  });

  it('ignores clicks on opponent pieces and empty squares when nothing is selected', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e7: { type: 'p', color: 'b' } }, targets: {} });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e7'); // opponent
    await input.onSquarePicked('d4'); // empty
    expect(scene.selected).toBeNull();
    expect(game.moved).toBeNull();
  });

  it('switches selection when another friendly piece is clicked', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({
      board: { e2: { type: 'p', color: 'w' }, d2: { type: 'p', color: 'w' } },
      targets: { e2: ['e3', 'e4'], d2: ['d3', 'd4'] },
    });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e2');
    await input.onSquarePicked('d2');
    expect(scene.selected).toBe('d2');
    expect(scene.targets).toEqual([
      { square: 'd3', kind: 'move' },
      { square: 'd4', kind: 'move' },
    ]);
  });

  it('asks for a promotion piece before moving a promoting pawn', async () => {
    const scene = makeFakeScene();
    const onPromotion = vi.fn(() => Promise.resolve('r'));
    const game = makeFakeGame({
      board: { a7: { type: 'p', color: 'w' } },
      targets: { a7: ['a8'] },
      promotions: [{ from: 'a7', to: 'a8' }],
    });
    const input = new Input(scene, game, { onPromotion });
    input.enable();
    await input.onSquarePicked('a7');
    await input.onSquarePicked('a8');
    expect(onPromotion).toHaveBeenCalledWith('w');
    expect(game.moved).toEqual({ from: 'a7', to: 'a8', promotion: 'r' });
  });

  it('ignores further clicks while a promotion is pending', async () => {
    const scene = makeFakeScene();
    let resolvePromo;
    const onPromotion = vi.fn(() => new Promise((r) => { resolvePromo = r; }));
    const game = makeFakeGame({
      board: { a7: { type: 'p', color: 'w' }, b2: { type: 'p', color: 'w' } },
      targets: { a7: ['a8'], b2: ['b3'] },
      promotions: [{ from: 'a7', to: 'a8' }],
    });
    const input = new Input(scene, game, { onPromotion });
    input.enable();
    await input.onSquarePicked('a7');
    const pending = input.onSquarePicked('a8'); // opens promotion, awaits
    await input.onSquarePicked('b2');            // must be ignored while pending
    expect(scene.selectionCleared).toBe(true);
    expect(onPromotion).toHaveBeenCalledTimes(1);
    resolvePromo('q');
    await pending;
    expect(game.moved).toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
  });

  it('does nothing while disabled', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e4'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    await input.onSquarePicked('e2'); // not enabled
    expect(scene.selected).toBeNull();
    expect(game.moved).toBeNull();
  });

  it('records the selected square itself, not just its targets', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e3'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e2');
    expect(scene.selected).toBe('e2');
  });

  it('classifies an occupied target as a capture and an empty one as a quiet move', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({
      board: { e4: { type: 'p', color: 'w' }, d5: { type: 'p', color: 'b' } },
      targets: { e4: ['d5', 'e5'] },
      captures: { e4: ['d5'] },
    });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e4');
    expect(scene.targets).toEqual([
      { square: 'd5', kind: 'capture' },
      { square: 'e5', kind: 'move' },
    ]);
  });

  it('classifies en passant as a capture even though the destination square is empty (proves classification never goes through pieceAt)', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({
      board: { e5: { type: 'p', color: 'w' } }, // d6 deliberately has no piece
      targets: { e5: ['d6', 'e6'] },
      captures: { e5: ['d6'] }, // en passant: victim pawn is on d5, not d6
    });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e5');
    expect(scene.targets).toContainEqual({ square: 'd6', kind: 'capture' });
  });

  it('clicking an empty square with a selection active calls clearSelection', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e3'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    await input.onSquarePicked('e2');
    await input.onSquarePicked('d4'); // empty, not a legal target
    expect(scene.selectionCleared).toBe(true);
    expect(scene.selected).toBeNull();
  });
});
