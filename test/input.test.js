import { describe, it, expect, vi } from 'vitest';
import { Input } from '../src/input.js';

function makeFakeScene() {
  return {
    highlights: [],
    setHighlights(s) { this.highlights = s; },
    clearHighlights() { this.highlights = []; },
  };
}

// board: map of square -> { type, color }; targets: map of square -> [dest...]
function makeFakeGame({ turn = 'w', board = {}, targets = {}, promotions = [] }) {
  return {
    moved: null,
    turn: () => turn,
    pieceAt: (sq) => board[sq] ?? null,
    legalTargets: (sq) => targets[sq] ?? [],
    isPromotion: (from, to) => promotions.some((p) => p.from === from && p.to === to),
    makeMove(m) { this.moved = m; return {}; },
  };
}

const noPromo = () => Promise.resolve('q');

describe('Input', () => {
  it('selects a friendly piece and highlights its legal targets', () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e3', 'e4'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    input.onSquarePicked('e2');
    expect(scene.highlights).toEqual(['e3', 'e4']);
  });

  it('moves to a highlighted target and clears the selection', async () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e3', 'e4'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    input.onSquarePicked('e2');
    await input.onSquarePicked('e4');
    expect(game.moved).toEqual({ from: 'e2', to: 'e4', promotion: undefined });
    expect(scene.highlights).toEqual([]);
  });

  it('ignores clicks on opponent pieces and empty squares when nothing is selected', () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e7: { type: 'p', color: 'b' } }, targets: {} });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    input.onSquarePicked('e7'); // opponent
    input.onSquarePicked('d4'); // empty
    expect(scene.highlights).toEqual([]);
    expect(game.moved).toBeNull();
  });

  it('switches selection when another friendly piece is clicked', () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({
      board: { e2: { type: 'p', color: 'w' }, d2: { type: 'p', color: 'w' } },
      targets: { e2: ['e3', 'e4'], d2: ['d3', 'd4'] },
    });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.enable();
    input.onSquarePicked('e2');
    input.onSquarePicked('d2');
    expect(scene.highlights).toEqual(['d3', 'd4']);
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
    input.onSquarePicked('a7');
    await input.onSquarePicked('a8');
    expect(onPromotion).toHaveBeenCalledWith('w');
    expect(game.moved).toEqual({ from: 'a7', to: 'a8', promotion: 'r' });
  });

  it('does nothing while disabled', () => {
    const scene = makeFakeScene();
    const game = makeFakeGame({ board: { e2: { type: 'p', color: 'w' } }, targets: { e2: ['e4'] } });
    const input = new Input(scene, game, { onPromotion: noPromo });
    input.onSquarePicked('e2'); // not enabled
    expect(scene.highlights).toEqual([]);
  });
});
