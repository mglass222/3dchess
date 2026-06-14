// High-level Stockfish controller. Works against any { send, waitFor } engine,
// so it is unit-testable with a fake engine. Difficulty = UCI Skill Level (0..20).
export class AI {
  constructor(engine, { skill = 5, movetime = 1000 } = {}) {
    this.engine = engine;
    this.skill = skill;
    this.movetime = movetime;
  }

  async init() {
    this.engine.send('uci');
    await this.engine.waitFor((l) => l === 'uciok' || l.startsWith('uciok'));
    this.setSkill(this.skill);
    this.engine.send('isready');
    await this.engine.waitFor((l) => l === 'readyok');
  }

  setSkill(level) {
    this.skill = level;
    this.engine.send(`setoption name Skill Level value ${level}`);
  }

  async bestMove(fen) {
    // Always confirm readiness before position/go (avoids dropped commands).
    this.engine.send('isready');
    await this.engine.waitFor((l) => l === 'readyok');
    this.engine.send(`position fen ${fen}`);
    this.engine.send(`go movetime ${this.movetime}`);
    const line = await this.engine.waitFor((l) => l.startsWith('bestmove'));
    return parseBestMove(line);
  }
}

// "bestmove e2e4 ponder e7e5" / "bestmove e7e8q" / "bestmove (none)"
export function parseBestMove(line) {
  const move = line.split(/\s+/)[1];
  if (!move || move === '(none)') return null;
  return {
    from: move.slice(0, 2),
    to: move.slice(2, 4),
    promotion: move.length > 4 ? move[4] : undefined,
  };
}
