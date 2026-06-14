// Status string derived purely from game state (unit-tested).
export function statusText(game) {
  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'Black' : 'White';
    return `Checkmate — ${winner} wins`;
  }
  if (game.isStalemate()) return 'Stalemate — draw';
  if (game.isDraw()) return 'Draw';
  const side = game.turn() === 'w' ? 'White' : 'Black';
  return game.isCheck() ? `${side} to move — check` : `${side} to move`;
}

// Builds the HTML overlay and returns handles the app uses to drive it.
// handlers: { onNewGame(side, skill), onSkillChange(skill) }
export function createUI(container, handlers) {
  const root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = `
    <style>
      #ui { position:absolute; top:0; left:0; right:0; padding:10px 14px; display:flex;
            gap:14px; align-items:center; background:linear-gradient(#0009,#0000);
            color:#eee; font:14px system-ui, sans-serif; pointer-events:none; }
      #ui > * { pointer-events:auto; }
      #ui button, #ui select { background:#2a2f3a; color:#eee; border:1px solid #444;
            border-radius:6px; padding:6px 10px; cursor:pointer; }
      #ui .status { margin-left:auto; font-weight:600; }
      #ui .thinking { opacity:.8; font-style:italic; }
      #promo { position:absolute; inset:0; display:none; align-items:center;
            justify-content:center; background:#0008; }
      #promo .box { background:#222; padding:16px; border-radius:10px; display:flex; gap:10px; }
      #promo button { font-size:28px; width:56px; height:56px; }
    </style>
    <button id="newgame">New Game</button>
    <label>Play
      <select id="side"><option value="w">White</option><option value="b">Black</option></select>
    </label>
    <label>Difficulty
      <input id="skill" type="range" min="0" max="20" value="5" />
      <span id="skillval">5</span>
    </label>
    <span class="status" id="status">White to move</span>
    <div id="promo"><div class="box"></div></div>
  `;
  container.appendChild(root);

  const statusEl = root.querySelector('#status');
  const skillEl = root.querySelector('#skill');
  const skillVal = root.querySelector('#skillval');
  const sideEl = root.querySelector('#side');
  const promo = root.querySelector('#promo');
  const promoBox = promo.querySelector('.box');

  root.querySelector('#newgame').addEventListener('click', () => {
    handlers.onNewGame(sideEl.value, Number(skillEl.value));
  });
  skillEl.addEventListener('input', () => {
    skillVal.textContent = skillEl.value;
    handlers.onSkillChange(Number(skillEl.value));
  });

  const GLYPH = { q: '♛', r: '♜', b: '♝', n: '♞' };

  return {
    setStatus(text) { statusEl.textContent = text; },
    setThinking(on) { statusEl.classList.toggle('thinking', on); if (on) statusEl.textContent = 'Computer is thinking…'; },
    getSide() { return sideEl.value; },
    getSkill() { return Number(skillEl.value); },
    // Show Q/R/B/N picker; resolves with the chosen piece letter.
    showPromotion(color) {
      promoBox.innerHTML = '';
      promo.style.display = 'flex';
      return new Promise((resolve) => {
        for (const t of ['q', 'r', 'b', 'n']) {
          const btn = document.createElement('button');
          btn.textContent = GLYPH[t];
          btn.style.color = color === 'w' ? '#f4ecd8' : '#222';
          btn.addEventListener('click', () => { promo.style.display = 'none'; resolve(t); });
          promoBox.appendChild(btn);
        }
      });
    },
  };
}
