import { describe, it, expect } from 'vitest';
import { AI } from '../src/ai.js';

const tick = () => new Promise((r) => setTimeout(r));

// Minimal fake engine: records sent commands; emit() feeds output lines to waiters.
function fakeEngine() {
  const waiters = [];
  return {
    sent: [],
    send(cmd) { this.sent.push(cmd); },
    waitFor(match) { return new Promise((resolve) => waiters.push({ match, resolve })); },
    emit(line) {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].match(line)) waiters.splice(i, 1)[0].resolve(line);
      }
    },
  };
}

describe('AI', () => {
  it('performs the UCI handshake and sets skill level', async () => {
    const eng = fakeEngine();
    const ai = new AI(eng, { skill: 5, movetime: 1000 });
    const p = ai.init();
    await tick();
    expect(eng.sent).toContain('uci');
    eng.emit('uciok');
    await tick();
    expect(eng.sent).toContain('setoption name Skill Level value 5');
    expect(eng.sent).toContain('isready');
    eng.emit('readyok');
    await p; // resolves
  });

  it('requests and parses the best move from a FEN', async () => {
    const eng = fakeEngine();
    const ai = new AI(eng, { skill: 5, movetime: 500 });
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const p = ai.bestMove(fen);
    await tick();
    expect(eng.sent).toContain('isready');
    eng.emit('readyok');
    await tick();
    expect(eng.sent).toContain(`position fen ${fen}`);
    expect(eng.sent).toContain('go movetime 500');
    eng.emit('info depth 1 score cp 20'); // ignored
    eng.emit('bestmove e2e4 ponder e7e5');
    const move = await p;
    expect(move).toEqual({ from: 'e2', to: 'e4', promotion: undefined });
  });

  it('parses a promotion best move', async () => {
    const eng = fakeEngine();
    const ai = new AI(eng);
    const p = ai.bestMove('8/P7/8/8/8/8/8/k6K w - - 0 1');
    await tick();
    eng.emit('readyok');
    await tick();
    eng.emit('bestmove a7a8q');
    expect(await p).toEqual({ from: 'a7', to: 'a8', promotion: 'q' });
  });

  it('returns null when there is no legal move', async () => {
    const eng = fakeEngine();
    const ai = new AI(eng);
    const p = ai.bestMove('k7/8/8/8/8/8/8/7K b - - 0 1');
    await tick();
    eng.emit('readyok');
    await tick();
    eng.emit('bestmove (none)');
    expect(await p).toBeNull();
  });

  it('updates skill level on demand', () => {
    const eng = fakeEngine();
    const ai = new AI(eng, { skill: 5 });
    ai.setSkill(12);
    expect(eng.sent).toContain('setoption name Skill Level value 12');
  });
});
