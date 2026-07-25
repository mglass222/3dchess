import { DEFAULT_THEME, THEMES } from './themes.js';
import { PIECE_SETS } from './pieces.js';

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
// handlers: { onNewGame(side, skill), onSkillChange(skill), onThemeChange, onPieceSetChange }
export function createUI(container, handlers) {
  const root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = `
    <style>
      /* #ui is only a positioning layer now: no background of its own, so it
         can't double-darken against #vignette. It stays pointer-events:none
         so orbit-drag reaches the canvas through the gaps around the panel;
         #ui > * opts each real child back into pointer-events. */
      #ui { position:absolute; top:0; left:0; right:0; padding:14px;
            display:flex; pointer-events:none; }
      #ui > * { pointer-events:auto; }

      /* Compact glass card, not a full-width bar. Kept narrow on purpose:
         backdrop-filter forces layer promotion and a per-frame blur of
         whatever it samples, so the smaller the sampled region the cheaper
         the frame. It reads as glass because it samples everything already
         painted below it in this stacking context - the WebGL canvas AND
         #vignette - which is why it sits darkest exactly where the vignette
         is darkest instead of fighting it. See the matching warning next to
         #vignette in index.html: #app must never gain filter / opacity<1 /
         transform / will-change, or it becomes a containing block and the
         backdrop-filter sampling chain below the panel breaks. */
      #panel { display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center;
            padding:10px 14px; border-radius:16px;
            background: rgba(18,22,30,0.55);
            backdrop-filter: blur(14px) saturate(120%);
            -webkit-backdrop-filter: blur(14px) saturate(120%);
            border:1px solid rgba(255,255,255,0.10);
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.35);
            color:#e9edf5; font:14px system-ui, sans-serif; }
      /* Engines without backdrop-filter get a solid dark card instead of a
         see-through one; still reads fine against the scene. */
      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        #panel { background: rgba(18,22,30,0.88); }
      }

      #panel label { display:inline-flex; gap:7px; align-items:center; min-width:0; }
      #panel button, #panel select { background:rgba(255,255,255,0.08); color:#e9edf5;
            border:1px solid rgba(255,255,255,0.16); border-radius:8px;
            padding:7px 11px; cursor:pointer; font:inherit; }
      #panel button:hover, #panel select:hover { background:rgba(255,255,255,0.14); }
      /* appearance:none (below) drops the native focus ring in some engines,
         so every interactive control gets an explicit one back. */
      #panel button:focus-visible, #panel select:focus-visible,
      #panel input:focus-visible, #promo button:focus-visible {
            outline:2px solid #7fb0ff; outline-offset:2px; }

      /* <select>, styled but still a real, fully-accessible native control:
         appearance:none plus a drawn caret. The native popup keeps following
         :root { color-scheme: dark } (see index.html) so it renders dark,
         not a flashing white system dropdown. */
      #panel select { appearance:none; -webkit-appearance:none; max-width:180px;
            padding-right:26px;
            background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M0 0 L5 6 L10 0' fill='none' stroke='%23c9d4e6' stroke-width='1.5'/></svg>");
            background-repeat:no-repeat; background-position:right 9px center; background-size:10px 6px; }
      #skill { width:130px; }
      #panel .status { margin-left:auto; font-weight:600; }
      #panel .thinking { opacity:.8; font-style:italic; }
      #panel output { min-width:1.4em; text-align:center; }

      /* <input type=range>, styled but still real: there is no cross-engine
         shorthand for track/thumb, so WebKit and Gecko are styled separately. */
      #panel input[type=range] { -webkit-appearance:none; appearance:none;
            width:130px; height:18px; background:transparent; cursor:pointer; }
      #panel input[type=range]::-webkit-slider-runnable-track {
            height:4px; border-radius:2px; background:rgba(255,255,255,0.2); }
      #panel input[type=range]::-webkit-slider-thumb { -webkit-appearance:none;
            margin-top:-5px; width:14px; height:14px; border-radius:50%;
            background:#7fb0ff; border:1px solid rgba(255,255,255,0.65);
            box-shadow:0 1px 2px rgba(0,0,0,0.4); }
      #panel input[type=range]::-moz-range-track {
            height:4px; border-radius:2px; background:rgba(255,255,255,0.2); }
      #panel input[type=range]::-moz-range-thumb { width:14px; height:14px; border-radius:50%;
            border:1px solid rgba(255,255,255,0.65); background:#7fb0ff;
            box-shadow:0 1px 2px rgba(0,0,0,0.4); }

      @media (max-width: 640px) {
        #ui { padding:10px; }
        #panel { padding:8px 10px; gap:8px 10px; font-size:13px; align-items:flex-start; }
        #panel button, #panel select { padding:6px 9px; }
        #skill { width:96px; }
        #theme { max-width:132px; }
        #panel .status { flex-basis:100%; margin-left:0; text-align:right; }
      }

      /* #promo is NOT a child of #ui (see below) - it lives directly in
         #app, which is position:fixed;inset:0 and so actually covers the
         viewport. It was previously nested in #ui, whose nearest positioned
         ancestor was #ui itself: top/left/right:0 but no explicit height, so
         inset:0 only ever covered #ui's own ~40px bar instead of the screen. */
      #promo { position:absolute; inset:0; display:none; align-items:center;
            justify-content:center; background:rgba(0,0,0,0.55); z-index:10; }
      #promo .box { background:rgba(18,22,30,0.9);
            backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
            border:1px solid rgba(255,255,255,0.12);
            padding:16px; border-radius:14px; display:flex; gap:10px; }
      #promo button { font-size:28px; width:56px; height:56px; border-radius:10px;
            cursor:pointer; border:1px solid rgba(255,255,255,0.2);
            background:rgba(255,255,255,0.08); }
    </style>
    <div id="panel">
      <button id="newgame">New Game</button>
      <label>Play
        <select id="side"><option value="w">White</option><option value="b">Black</option></select>
      </label>
      <label>Difficulty
        <input id="skill" type="range" min="0" max="20" value="5" aria-label="Difficulty" />
        <output id="skillval" for="skill">5</output>
      </label>
      <label>Theme
        <select id="theme"></select>
      </label>
      <label>Pieces
        <select id="pieceset"></select>
      </label>
      <span class="status" id="status" role="status" aria-live="polite">White to move</span>
    </div>
  `;
  container.appendChild(root);

  // Promotion modal: appended directly to #app (the container), not to #ui,
  // so its inset:0 backdrop actually covers the viewport (see the comment
  // above #promo's rule for why #ui doesn't work as the positioned ancestor).
  const promo = document.createElement('div');
  promo.id = 'promo';
  promo.setAttribute('role', 'dialog');
  promo.setAttribute('aria-modal', 'true');
  promo.setAttribute('aria-label', 'Choose a promotion piece');
  promo.innerHTML = '<div class="box"></div>';
  container.appendChild(promo);
  const promoBox = promo.querySelector('.box');

  const statusEl = root.querySelector('#status');
  const skillEl = root.querySelector('#skill');
  const skillVal = root.querySelector('#skillval');
  const sideEl = root.querySelector('#side');
  const themeEl = root.querySelector('#theme');
  const pieceSetEl = root.querySelector('#pieceset');
  for (const t of THEMES) {
    const opt = document.createElement('option');
    opt.value = t.key;
    opt.textContent = t.label;
    themeEl.appendChild(opt);
  }
  for (const set of Object.values(PIECE_SETS)) {
    const opt = document.createElement('option');
    opt.value = set.key;
    opt.textContent = set.label;
    pieceSetEl.appendChild(opt);
  }
  themeEl.addEventListener('change', () => handlers.onThemeChange(themeEl.value));
  pieceSetEl.addEventListener('change', () => handlers.onPieceSetChange(pieceSetEl.value));

  root.querySelector('#newgame').addEventListener('click', () => {
    handlers.onNewGame(sideEl.value, Number(skillEl.value));
  });
  skillEl.addEventListener('input', () => {
    skillVal.textContent = skillEl.value;
    handlers.onSkillChange(Number(skillEl.value));
  });

  const GLYPH = { q: '♛', r: '♜', b: '♝', n: '♞' };
  const PROMO_LABEL = { q: 'Promote to queen', r: 'Promote to rook', b: 'Promote to bishop', n: 'Promote to knight' };

  return {
    setStatus(text) { statusEl.textContent = text; },
    setThinking(on) { statusEl.classList.toggle('thinking', on); if (on) statusEl.textContent = 'Computer is thinking…'; },
    getSide() { return sideEl.value; },
    getSkill() { return Number(skillEl.value); },
    getTheme() { return themeEl.value; },
    setTheme(key) {
      themeEl.value = THEMES.some((theme) => theme.key === key) ? key : DEFAULT_THEME;
    },
    getPieceSet() { return pieceSetEl.value; },
    setPieceSet(key) { pieceSetEl.value = key; },
    // Show Q/R/B/N picker; resolves with the chosen piece letter.
    showPromotion(color) {
      promoBox.innerHTML = '';
      promo.style.display = 'flex';
      const invoker = document.activeElement;
      return new Promise((resolve) => {
        let firstBtn = null;
        for (const t of ['q', 'r', 'b', 'n']) {
          const btn = document.createElement('button');
          btn.textContent = GLYPH[t];
          btn.setAttribute('aria-label', PROMO_LABEL[t]);
          // Not the piece's own #222 for black: these glyphs sit on the dark
          // promo box, where near-black is close to invisible. Use the same
          // blue the black pieces actually render as (pieces.js MATERIALS.b
          // baseHex 0x2c65a8, lightened to clear the panel), so the button
          // still reads as "the blue side" while staying legible.
          btn.style.color = color === 'w' ? '#f4ecd8' : '#8fbdf0';
          btn.addEventListener('click', () => {
            promo.style.display = 'none';
            if (invoker && typeof invoker.focus === 'function') invoker.focus();
            resolve(t);
          });
          promoBox.appendChild(btn);
          if (!firstBtn) firstBtn = btn;
        }
        // Move focus into the modal so keyboard/screen-reader users land on
        // a choice immediately; restored to `invoker` above on close.
        if (firstBtn) firstBtn.focus();
      });
    },
  };
}
