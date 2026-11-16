import { Engine, START_FEN, WHITE, BLACK, QUEEN, ROOK, BISHOP, KNIGHT, moveFrom, moveTo, movePromo, moveToUci, squareName } from './engine.js';
import { el, store } from '../../assets/js/ui.js';

const SAVE_KEY = 'sjakk:parti';
const NORWEGIAN = ' PSLTDK';
const GLYPH = ['', '♟', '♞', '♝', '♜', '♛', '♚'].map((g) => (g ? `${g}︎` : '')); // FE0E: tving teksttegn, ikke emoji
const NAMES = ['', 'bonde', 'springer', 'løper', 'tårn', 'dronning', 'konge'];
const RESULT = {
  stalemate: 'Patt. Partiet er remis.',
  repetition: 'Remis ved trekkgjentakelse.',
  fifty: 'Remis etter femtitrekksregelen.',
  material: 'Remis. Ingen kan sette matt.',
};

const $ = (id) => document.getElementById(id);
const boardEl = $('board');

/* ---------- Tilstand ---------- */
const game = new Engine();
let startFen = START_FEN;
let played = [];        // { uci, san, from, to }
let human = WHITE;
let flipped = false;
let selected = -1;
let legal = [];
let thinking = false;
let over = null;
let lastInfo = null;

const timeMs = () => Number(document.querySelector('input[name="time"]:checked').value);

/* ---------- Motor i Web Worker ---------- */
let worker = null;
let requestId = 0;

function startWorker() {
  worker?.terminate();
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.id !== requestId) return; // svar på et søk som er avbrutt
      if (data.depth > 0) renderInfo(data); // ett lovlig trekk spilles uten søk: behold forrige vurdering
      if (data.type === 'done') engineMoved(data.move);
    };
    worker.onerror = () => { worker = null; if (thinking) fallbackSearch(); };
  } catch {
    worker = null;
  }
}

/** Reserve hvis modul-workere ikke støttes: søk på hovedtråden. */
function fallbackSearch() {
  const id = ++requestId;
  setTimeout(() => {
    if (id !== requestId) return;
    const white = game.side === WHITE;
    const result = game.search({ timeMs: Math.min(timeMs(), 1000) });
    if (result.depth > 0) renderInfo({ depth: result.depth, nodes: result.nodes, ms: result.ms, score: white ? result.score : -result.score, mate: null, pv: [] });
    engineMoved({ from: moveFrom(result.move), to: moveTo(result.move), promo: movePromo(result.move) });
  }, 30);
}

function requestEngineMove() {
  thinking = true;
  renderStatus();
  if (!worker) { fallbackSearch(); return; }
  worker.postMessage({ id: ++requestId, startFen, moves: played.map((p) => p.uci), timeMs: timeMs() });
}

function cancelSearch() {
  if (!thinking) return;
  thinking = false;
  requestId++;
  startWorker(); // et synkront søk kan bare stoppes ved å starte workeren på nytt
}

function engineMoved(move) {
  thinking = false;
  if (!move) return;
  const found = legal.find((m) => moveFrom(m) === move.from && moveTo(m) === move.to && movePromo(m) === move.promo);
  if (found) play(found);
}

/* ---------- Spillflyt ---------- */
function refresh() {
  legal = game.legalMoves();
  over = game.status();
  selected = -1;
  $('promo').hidden = true; // et åpent forvandlingsvalg gjelder ikke lenger når stillingen endres
  render();
  save();
}

function play(move) {
  const san = game.toSan(move, NORWEGIAN);
  game.make(move);
  played.push({ uci: moveToUci(move), san, from: moveFrom(move), to: moveTo(move) });
  refresh();
  if (!over && game.side !== human) requestEngineMove();
}

function newGame(fen = START_FEN) {
  cancelSearch();
  game.setFen(fen);
  startFen = fen;
  played = [];
  lastInfo = null;
  renderInfo(null);
  refresh();
  if (!over && game.side !== human) requestEngineMove();
}

function undo() {
  cancelSearch();
  if (!played.length) return;
  // Angre til det igjen er din tur: motorens svar og ditt eget trekk.
  do { game.unmake(); played.pop(); } while (played.length && game.side !== human);
  refresh();
  if (!over && game.side !== human) requestEngineMove();
}

function save() {
  store.set(SAVE_KEY, { startFen, moves: played.map((p) => p.uci), human });
}

function restore() {
  const saved = store.get(SAVE_KEY, null);
  if (!saved) return;
  try {
    game.setFen(saved.startFen);
    startFen = saved.startFen;
    human = saved.human === BLACK ? BLACK : WHITE;
    for (const uci of saved.moves) {
      const move = game.legalMoves().find((m) => moveToUci(m) === uci);
      if (!move) break;
      played.push({ uci, san: game.toSan(move, NORWEGIAN), from: moveFrom(move), to: moveTo(move) });
      game.make(move);
    }
  } catch {
    game.setFen(START_FEN); startFen = START_FEN; played = [];
  }
  flipped = human === BLACK;
  document.querySelector(`input[name="color"][value="${human}"]`).checked = true;
}

/* ---------- Klikk på brettet ---------- */
function onSquare(sq) {
  if (over || thinking || game.side !== human) return;
  const piece = game.board[sq];
  const candidates = legal.filter((m) => moveFrom(m) === selected && moveTo(m) === sq);

  if (selected >= 0 && candidates.length) {
    if (candidates.length > 1) askPromotion(candidates); // bondeforvandling: fire mulige trekk
    else play(candidates[0]);
    return;
  }
  selected = piece && (piece >> 3) === human && sq !== selected ? sq : -1;
  render();
}

function askPromotion(candidates) {
  const box = $('promo');
  box.replaceChildren(...[QUEEN, ROOK, BISHOP, KNIGHT].map((type) =>
    el('button', {
      type: 'button', 'aria-label': NAMES[type],
      onclick: () => { box.hidden = true; play(candidates.find((m) => movePromo(m) === type)); },
    }, el('span', { class: `piece${human === BLACK ? ' black' : ''}`, text: GLYPH[type] }))));
  box.hidden = false;
  box.querySelector('button').focus();
}

/* ---------- Tegning ---------- */
function render() {
  const last = played.at(-1);
  const focused = document.activeElement?.dataset?.sq; // behold tastaturfokus når brettet tegnes på nytt
  const targets = new Map(legal.filter((m) => moveFrom(m) === selected).map((m) => [moveTo(m), m]));
  const movable = new Set(!over && !thinking && game.side === human ? legal.map(moveFrom) : []);
  const checked = game.inCheck() ? game.kings[game.side] : -1;
  const squares = [];

  for (let i = 0; i < 64; i++) {
    const row = flipped ? 7 - (i >> 3) : i >> 3;
    const file = flipped ? 7 - (i & 7) : i & 7;
    const sq = row * 16 + file;
    const piece = game.board[sq];
    const classes = ['sq'];
    if ((row + file) % 2) classes.push('dark');
    if (last && (sq === last.from || sq === last.to)) classes.push('last');
    if (last && sq === last.to) classes.push('arrived');
    if (sq === selected) classes.push('selected');
    if (sq === checked) classes.push('check');
    if (targets.has(sq)) classes.push('target', piece ? 'occupied' : 'free');
    if (movable.has(sq)) classes.push('movable');

    const label = `${squareName(sq)}${piece ? `: ${piece & 8 ? 'svart' : 'hvit'} ${NAMES[piece & 7]}` : ''}`;
    squares.push(el('button', { class: classes.join(' '), type: 'button', 'aria-label': label, dataset: { sq }, onclick: () => onSquare(sq) },
      (i & 7) === 0 && el('span', { class: 'coord coord-rank', 'aria-hidden': 'true', text: String(8 - row) }),
      (i >> 3) === 7 && el('span', { class: 'coord coord-file', 'aria-hidden': 'true', text: 'abcdefgh'[file] }),
      piece ? el('span', { class: `piece${piece & 8 ? ' black' : ''}`, 'aria-hidden': 'true', text: GLYPH[piece & 7] }) : null,
    ));
  }
  boardEl.replaceChildren(...squares);
  if (focused != null) boardEl.querySelector(`[data-sq="${focused}"]`)?.focus();
  $('evalbar').classList.toggle('flipped', flipped);
  renderStatus();
  renderMoves();
  if (document.activeElement !== $('fen')) $('fen').value = game.fen(); // ikke skriv over en FEN brukeren holder på å lime inn
  $('undo').disabled = !played.length;
}

function renderStatus() {
  let text;
  if (over === 'checkmate') text = game.side === human ? 'Sjakkmatt. Motoren vant.' : 'Sjakkmatt. Du vant!';
  else if (over) text = RESULT[over];
  else if (thinking) text = 'Motoren tenker...';
  else text = `${game.side === WHITE ? 'Hvit' : 'Svart'} i trekket${game.inCheck() ? ' (sjakk)' : ''}`;
  $('status').textContent = text;
}

function renderMoves() {
  const list = $('moves');
  const firstNumber = Number(startFen.split(' ')[5]) || 1;
  const blackStarts = startFen.split(' ')[1] === 'b';
  const cells = [];
  played.forEach((p, i) => {
    const index = i + (blackStarts ? 1 : 0);
    if (index % 2 === 0 || i === 0) cells.push(el('span', { class: 'num', text: `${firstNumber + (index >> 1)}.` }));
    if (i === 0 && blackStarts) cells.push(el('span', { class: 'ply', text: '...' }));
    cells.push(el('span', { class: `ply${i === played.length - 1 ? ' current' : ''}`, text: p.san }));
  });
  list.replaceChildren(...cells);
  list.scrollTop = list.scrollHeight;
  $('moves-empty').hidden = played.length > 0;
}

function renderInfo(info) {
  lastInfo = info;
  if (!info) {
    $('e-score').textContent = '0,0'; $('e-depth').textContent = '0'; $('e-nps').textContent = '0';
    $('e-pv').textContent = 'Hovedvarianten vises her når motoren har tenkt.';
    $('evalbar-fill').style.height = '50%';
    return;
  }
  const scoreText = info.mate != null
    ? `${info.mate > 0 ? '' : '-'}M${Math.abs(info.mate)}`
    : `${info.score > 0 ? '+' : info.score < 0 ? '-' : ''}${(Math.abs(info.score) / 100).toFixed(1).replace('.', ',')}`;
  $('e-score').textContent = scoreText;
  $('e-depth').textContent = info.depth;
  const nps = info.ms > 0 ? (info.nodes / info.ms) * 1000 : 0;
  $('e-nps').textContent = nps >= 1e6 ? `${(nps / 1e6).toFixed(1).replace('.', ',')} M` : `${Math.round(nps / 1000)} k`;
  // Søylen mettes mykt: pluss eller minus 4 bønder er nesten fullt utslag.
  const share = info.mate != null ? (info.mate > 0 ? 1 : 0) : 0.5 + 0.5 * Math.tanh(info.score / 400);
  $('evalbar-fill').style.height = `${(share * 100).toFixed(1)}%`;
  if (info.pv.length) {
    $('e-pv').replaceChildren(
      el('strong', { text: info.pv[0] }), ` ${info.pv.slice(1).join(' ')}`,
      el('br'), `${info.nodes.toLocaleString('nb-NO')} stillinger på ${Math.round(info.ms)} ms`,
    );
  }
}

/* ---------- Hendelser ---------- */
$('new').addEventListener('click', () => newGame());
$('undo').addEventListener('click', undo);
$('flip').addEventListener('click', () => { flipped = !flipped; render(); });
$('color').addEventListener('change', (e) => {
  human = Number(e.target.value);
  flipped = human === BLACK;
  newGame();
});
$('fen-load').addEventListener('click', () => {
  try {
    const fen = $('fen').value.trim();
    new Engine(fen); // validerer før vi bytter stilling
    human = fen.split(/\s+/)[1] === 'b' ? BLACK : WHITE; // du overtar siden som er i trekket
    flipped = human === BLACK;
    document.querySelector(`input[name="color"][value="${human}"]`).checked = true;
    newGame(fen);
    $('fen-note').textContent = 'Stillingen er lastet inn.';
  } catch (error) {
    $('fen-note').textContent = error.message;
  }
});
$('fen-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(game.fen()); $('fen-note').textContent = 'Kopiert.'; }
  catch { $('fen-note').textContent = 'Kunne ikke kopiere.'; }
});
/* ---------- Dra og slipp ---------- */
// Et trykk på en egen brikke velger den. Drar du den, følger brikken med,
// og trekket spilles der du slipper. Å klikke på to felt virker som før.
let drag = null; // { from, x, y, ghost }

boardEl.addEventListener('pointerdown', (e) => {
  const square = e.target.closest('[data-sq]');
  if (!square || e.button > 0 || over || thinking || game.side !== human) return;
  const sq = Number(square.dataset.sq);
  const piece = game.board[sq];
  if (!piece || (piece >> 3) !== human || !legal.some((m) => moveFrom(m) === sq)) return;
  drag = { from: sq, x: e.clientX, y: e.clientY, ghost: null, glyph: GLYPH[piece & 7], size: square.getBoundingClientRect().width };
  if (selected !== sq) { selected = sq; render(); } // et allerede valgt felt lar vi være, så et nytt klikk kan velge det bort
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return; // et vanlig klikk, ikke et drag
    drag.ghost = el('span', { class: `piece ghost${human === BLACK ? ' black' : ''}`, 'aria-hidden': 'true', text: drag.glyph });
    drag.ghost.style.fontSize = `${drag.size * 0.78}px`;
    document.body.append(drag.ghost);
    boardEl.querySelector(`[data-sq="${drag.from}"]`)?.classList.add('lifted');
  }
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
});

function endDrag(e) {
  if (!drag) return;
  const { from, ghost } = drag;
  drag = null;
  if (!ghost) return;
  ghost.remove();
  boardEl.querySelector('.lifted')?.classList.remove('lifted');
  const target = e.type === 'pointerup' ? document.elementFromPoint(e.clientX, e.clientY)?.closest('#board [data-sq]') : null;
  const candidates = target ? legal.filter((m) => moveFrom(m) === from && moveTo(m) === Number(target.dataset.sq)) : [];
  if (candidates.length > 1) askPromotion(candidates);
  else if (candidates.length) play(candidates[0]);
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// Piltastene flytter fokus mellom feltene, slik at brettet kan brukes uten mus.
boardEl.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key];
  const index = [...boardEl.children].indexOf(document.activeElement);
  if (!step || index < 0) return;
  e.preventDefault();
  const next = index + step;
  const sameRow = Math.abs(step) === 8 || (next >> 3) === (index >> 3);
  if (next >= 0 && next < 64 && sameRow) boardEl.children[next].focus();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  $('promo').hidden = true;
  if (selected >= 0) { selected = -1; render(); }
});

startWorker();
restore();
refresh();
if (!over && game.side !== human) requestEngineMove();
