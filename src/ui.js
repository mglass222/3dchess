import { DEFAULT_THEME, THEMES } from './themes.js';
import { PIECE_SETS } from './pieces.js';
import { materialAdvantage, formatAdvantage } from './material.js';

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

// Pairs a flat SAN list into { n, white, black } rows (a trailing White move
// with no reply yet gets black:null). Pure and DOM-free so it's testable
// under node; createUI's move-list rendering is just this plus DOM plumbing.
export function formatMoveList(sanArray) {
  const rows = [];
  for (let i = 0; i < sanArray.length; i += 2) {
    rows.push({ n: i / 2 + 1, white: sanArray[i] ?? null, black: sanArray[i + 1] ?? null });
  }
  return rows;
}

export function isNearScrollEnd({ scrollHeight, scrollTop, clientHeight }, threshold = 4) {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

// Ascending value order, matching how a physical captured-piece tray is read.
const CAPTURE_TYPES = ['p', 'n', 'b', 'r', 'q'];
const CAPTURE_NOUN = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };

// "2 pawns, a knight" / "nothing" — feeds both the glyph row and its
// aria-label, so the two can never drift out of sync.
function describeCaptured(map) {
  const parts = [];
  for (const t of CAPTURE_TYPES) {
    const n = map?.[t] ?? 0;
    if (n <= 0) continue;
    parts.push(n === 1 ? `a ${CAPTURE_NOUN[t]}` : `${n} ${CAPTURE_NOUN[t]}s`);
  }
  return parts.length ? parts.join(', ') : 'nothing';
}

// Builds the HTML overlay and returns handles the app uses to drive it.
// handlers: { onNewGame(side, skill), onSkillChange(skill), onThemeChange, onPieceSetChange, onSoundChange }
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
      .piece-credits { position:fixed; bottom:12px; right:14px; color:#d9d5cc;
        font:12px system-ui,sans-serif; padding:5px 9px; border-radius:6px;
        background:rgba(18,22,30,.65); text-decoration:none; }
      .piece-credits:hover { text-decoration:underline; }
      .piece-credits:focus-visible { outline:2px solid #7fb0ff; outline-offset:2px; }

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
      /* Column layout: the controls row on top, the tray/move-list "extras"
         stacked below. This (not a flex-basis:100% child inside a single row
         container) is deliberate: a percentage flex-basis resolves against
         the flex container's own box, and #panel's box is itself shrink-to-
         fit (no explicit width) - so a 100%-basis child can blow that sizing
         pass up to the width of the nearest ancestor with a definite width,
         which here is the viewport-wide #ui. Stacking as separate rows avoids
         the percentage entirely, so #panel's width stays driven by its
         widest actual content (the controls row, or the capped-width
         move-list/tray below) instead of ballooning into a full-width bar. */
      #panel { display:flex; flex-direction:column; align-items:flex-start; gap:10px;
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
      #panel .controls-row { display:flex; flex-wrap:wrap; gap:10px 14px; align-items:center; }

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
      /* Captured tray + move list. A plain second row in #panel's column
         stack (see #panel's own comment above for why this isn't a
         flex-basis:100% child of a row container) - it stays bounded by the
         move-list's own max-height/max-width rather than stretching the
         card, which is the whole point of keeping #panel compact: backdrop-
         filter cost scales with the sampled area. */
      #panel .extras { display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
      #panel .tray-row { display:flex; align-items:center; gap:8px; font-size:15px; line-height:1; }
      #panel .tray { min-height:1.3em; }
      #panel .tray .glyphs { letter-spacing:1px; }
      #panel .tray .glyphs.w { color:#f4ecd8; } /* same pale tone as the white promotion glyphs */
      #panel .tray .glyphs.b { color:#8fbdf0; } /* same blue as the black promotion glyphs */
      #panel .adv { font-weight:600; min-width:2.4em; text-align:center; }
      #panel .movelist { list-style:none; margin:0; padding:4px 6px; max-height:110px;
            max-width:220px; overflow-y:auto; border-radius:8px;
            background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
            font-variant-numeric:tabular-nums; }
      #panel .movelist:focus-visible { outline:2px solid #7fb0ff; outline-offset:-2px; }
      #panel .movelist li { display:flex; gap:6px; padding:1px 2px; }
      #panel .movelist .mv-n { opacity:.6; min-width:1.6em; }
      #panel .movelist .mv-w, #panel .movelist .mv-b { flex:1; min-width:3.2em; }

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
        #panel { padding:8px 10px; gap:8px; font-size:13px; align-items:flex-start; }
        #panel .controls-row { gap:8px 10px; }
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
    <a class="piece-credits" href="${import.meta.env.BASE_URL}models/Default/LICENSE.txt" target="_blank" rel="noopener">Piece credits</a>
    <div id="panel">
      <div class="controls-row">
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
        <button id="sound" type="button" aria-pressed="true" aria-label="Move sounds">Sound: On</button>
        <span class="status" id="status" role="status" aria-live="polite">White to move</span>
      </div>
      <div class="extras">
        <div class="tray-row">
          <div class="tray" id="trayW" aria-label="White captured: nothing"><span class="glyphs w" aria-hidden="true"></span></div>
          <span class="adv" id="advantage"></span>
          <div class="tray" id="trayB" aria-label="Black captured: nothing"><span class="glyphs b" aria-hidden="true"></span></div>
        </div>
        <ol class="movelist" id="movelist" tabindex="0" aria-label="Move list" aria-live="off"></ol>
      </div>
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
  const soundEl = root.querySelector('#sound');
  function setSoundEnabled(enabled) {
    soundEl.setAttribute('aria-pressed', String(enabled));
    soundEl.textContent = enabled ? 'Sound: On' : 'Sound: Off';
  }
  soundEl.addEventListener('click', () => {
    const enabled = soundEl.getAttribute('aria-pressed') !== 'true';
    setSoundEnabled(enabled);
    handlers.onSoundChange?.(enabled);
  });
  const trayWEl = root.querySelector('#trayW');
  const trayBEl = root.querySelector('#trayB');
  const advantageEl = root.querySelector('#advantage');
  const movelistEl = root.querySelector('#movelist');
  // pushMove appends to this rather than re-deriving from a Game, so createUI
  // stays framework-free; setHistory (called on any board resync) replaces it
  // wholesale, keeping the two paths from ever disagreeing after a resync.
  let historySan = [];
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
  const TRAY_GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

  function renderTraySide(el, map, label) {
    el.setAttribute('aria-label', `${label}: ${describeCaptured(map)}`);
    let glyphs = '';
    for (const t of CAPTURE_TYPES) glyphs += TRAY_GLYPH[t].repeat(map?.[t] ?? 0);
    el.querySelector('.glyphs').textContent = glyphs;
  }

  function renderMoveList() {
    const pinned = isNearScrollEnd(movelistEl);
    movelistEl.innerHTML = '';
    for (const row of formatMoveList(historySan)) {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'mv-n';
      n.textContent = `${row.n}.`;
      const white = document.createElement('span');
      white.className = 'mv-w';
      white.textContent = row.white ?? '';
      const black = document.createElement('span');
      black.className = 'mv-b';
      black.textContent = row.black ?? '';
      li.append(n, white, black);
      movelistEl.appendChild(li);
    }
    // Keep the newest plies in view only when the user was already following
    // the end; preserve their position when they scroll up to review the game.
    if (pinned) movelistEl.scrollTop = movelistEl.scrollHeight;
  }

  return {
    setSoundEnabled,
    setStatus(text) { statusEl.textContent = text; },
    setThinking(on) { statusEl.classList.toggle('thinking', on); if (on) statusEl.textContent = 'Computer is thinking…'; },
    // Wholesale replace: the one path a board resync (New Game, piece-set
    // switch, the dev loadFen hook) uses to re-derive the move list, mirroring
    // how syncBoardFromGame re-derives the pieces rather than replaying moves.
    setHistory(sanArray) {
      historySan = sanArray.slice();
      renderMoveList();
    },
    // Incremental: called from onMove with the just-applied change-set, before
    // any await, so it can never be stale relative to game state.
    pushMove(change) {
      historySan.push(change.san);
      renderMoveList();
    },
    // capturedMap: { w: {type:count}, b: {type:count}, promoted: {w,b} } from
    // material.capturedFromFen. w/b key by the color of the CAPTURED piece
    // (see material.js), so "White captured" reads from capturedMap.b and
    // vice versa.
    setCaptured(capturedMap) {
      renderTraySide(trayWEl, capturedMap?.b, 'White captured');
      renderTraySide(trayBEl, capturedMap?.w, 'Black captured');
      advantageEl.textContent = formatAdvantage(materialAdvantage(capturedMap ?? { w: {}, b: {} }));
    },
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
        const buttons = [];
        const trapFocus = (event) => {
          if (event.key !== 'Tab' || buttons.length === 0) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };
        promoBox.addEventListener('keydown', trapFocus);
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
            promoBox.removeEventListener('keydown', trapFocus);
            promo.style.display = 'none';
            if (invoker && typeof invoker.focus === 'function') invoker.focus();
            resolve(t);
          });
          promoBox.appendChild(btn);
          buttons.push(btn);
          if (!firstBtn) firstBtn = btn;
        }
        // Move focus into the modal so keyboard/screen-reader users land on
        // a choice immediately; restored to `invoker` above on close.
        if (firstBtn) firstBtn.focus();
      });
    },
  };
}
