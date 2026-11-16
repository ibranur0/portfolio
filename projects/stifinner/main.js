import { ALGORITHMS, EMPTY, WALL, MUD, search, generateMaze, generateTerrain } from './algorithms.js';
import { cssVar, prefersReducedMotion } from '../../assets/js/ui.js';

const SPEEDS = [
  { label: 'Sakte', perFrame: 1 },
  { label: 'Rolig', perFrame: 3 },
  { label: 'Middels', perFrame: 8 },
  { label: 'Rask', perFrame: 22 },
  { label: 'Lynrask', perFrame: 70 },
];

const $ = (id) => document.getElementById(id);
const canvas = $('grid');
const ctx = canvas.getContext('2d');
const wrap = $('grid-wrap');

/* ---------- Tilstand ---------- */
let cols = 0, rows = 0, cell = 24;
let cells = new Uint8Array(0);
let start = 0, goal = 0;
let result = null;          // { visited, path, cost, ms } fra siste søk
let shownVisited = 0, shownPath = 0;
let animating = false;
let colors = {};
// Hvordan kartet ble til. Brukes til å lage det på nytt hvis vinduet endrer størrelse.
const FILL = { maze: generateMaze, terrain: generateTerrain, empty: (c, r) => new Uint8Array(c * r) };
let fill = 'maze';        // starter med en labyrint, så det er noe å utforske med en gang
let handDrawn = false;

const algorithm = () => document.querySelector('input[name="algorithm"]:checked').value;
const tool = () => Number(document.querySelector('input[name="tool"]:checked').value);
const speed = () => SPEEDS[Number($('speed').value) - 1];

/* ---------- Farger ---------- */
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const mix = (a, b, t) => {
  const x = hexToRgb(a), y = hexToRgb(b);
  return `rgb(${x.map((v, i) => Math.round(y[i] + (v - y[i]) * t)).join(', ')})`;
};
function readColors() {
  const surface = cssVar('--surface'), blue = cssVar('--blue'), yellow = cssVar('--yellow');
  colors = {
    gap: cssVar('--line'),
    empty: surface,
    wall: mix(cssVar('--text'), surface, 0.55),
    mud: mix(yellow, surface, 0.45),
    visited: mix(blue, surface, 0.3),
    visitedMud: mix(blue, mix2(yellow, surface, 0.45), 0.35),
    path: cssVar('--accent'),
    goal: cssVar('--text'),
  };
}
// Blander to hex-farger og returnerer hex (trengs for å blande videre).
function mix2(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return `#${x.map((v, i) => Math.round(y[i] + (v - y[i]) * t).toString(16).padStart(2, '0')).join('')}`;
}

/* ---------- Rutenett ---------- */
const odd = (n) => (n % 2 ? n : n - 1);

function layout() {
  const width = wrap.clientWidth;
  if (width < 120) return; // ikke synlig ennå
  const nextCell = width < 520 ? 16 : width < 900 ? 20 : 24;
  const nextCols = odd(Math.floor(width / nextCell));
  const nextRows = width < 520 ? 27 : 21;
  if (nextCols === cols && nextRows === rows && nextCell === cell) return;

  const old = { cells, cols, rows };
  cell = nextCell; cols = nextCols; rows = nextRows;
  const mid = odd(rows >> 1);
  start = mid * cols + 1;
  goal = mid * cols + cols - 2;
  if (handDrawn) {
    // Brukeren har tegnet selv: behold den delen av tegningen som fortsatt får plass.
    cells = new Uint8Array(cols * rows);
    for (let y = 0; y < Math.min(rows, old.rows); y++) {
      for (let x = 0; x < Math.min(cols, old.cols); x++) cells[y * cols + x] = old.cells[y * old.cols + x];
    }
  } else {
    cells = FILL[fill](cols, rows); // et generert kart lages på nytt i den nye størrelsen
  }
  cells[start] = cells[goal] = EMPTY;
  clearSearch(false);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = cols * cell * dpr; canvas.height = rows * cell * dpr;
  canvas.style.width = `${cols * cell}px`; canvas.style.height = `${rows * cell}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  ctx.fillStyle = colors.gap;
  ctx.fillRect(0, 0, cols * cell, rows * cell);

  const fills = [colors.empty, colors.wall, colors.mud];
  for (let i = 0; i < cells.length; i++) {
    ctx.fillStyle = fills[cells[i]];
    ctx.fillRect((i % cols) * cell + 0.5, Math.floor(i / cols) * cell + 0.5, cell - 1, cell - 1);
  }

  if (result) {
    for (let k = 0; k < shownVisited; k++) {
      const i = result.visited[k];
      ctx.fillStyle = cells[i] === MUD ? colors.visitedMud : colors.visited;
      ctx.fillRect((i % cols) * cell + 0.5, Math.floor(i / cols) * cell + 0.5, cell - 1, cell - 1);
    }
    if (shownPath > 1) {
      ctx.strokeStyle = colors.path; ctx.lineWidth = Math.max(3, cell * 0.3);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < shownPath; k++) {
        const i = result.path[k];
        const x = (i % cols + 0.5) * cell, y = (Math.floor(i / cols) + 0.5) * cell;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }

  // Start: fylt sirkel. Mål: ring. Med ulik form kan de skilles fra hverandre uten å se fargene.
  const center = (i) => [(i % cols + 0.5) * cell, (Math.floor(i / cols) + 0.5) * cell];
  let [x, y] = center(start);
  ctx.fillStyle = colors.path;
  ctx.beginPath(); ctx.arc(x, y, cell * 0.36, 0, Math.PI * 2); ctx.fill();
  [x, y] = center(goal);
  ctx.fillStyle = colors.empty; ctx.strokeStyle = colors.goal; ctx.lineWidth = Math.max(2.5, cell * 0.14);
  ctx.beginPath(); ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

/* ---------- Søk ---------- */
function compute() {
  const started = performance.now();
  result = search(algorithm(), { cells, cols, rows }, start, goal);
  result.ms = performance.now() - started;
}

function renderStats(done) {
  $('stat-visited').textContent = result ? shownVisited : '-';
  $('stat-length').textContent = done && result.path.length ? result.path.length - 1 : '-';
  $('stat-cost').textContent = done && result.path.length ? result.cost : '-';
  $('stat-time').textContent = done ? `${result.ms < 10 ? result.ms.toFixed(1).replace('.', ',') : Math.round(result.ms)} ms` : '-';
}

function renderNote() {
  const info = ALGORITHMS[algorithm()];
  const failed = result && !animating && !result.path.length;
  $('note').textContent = failed
    ? 'Ingen vei til målet. Fjern noen vegger og prøv igjen.'
    : `${info.name}: ${info.note}`;
}

/** Viser hele resultatet med en gang (brukes når noe endres etter et søk). */
function showInstantly() {
  animating = false;
  compute();
  shownVisited = result.visited.length;
  shownPath = result.path.length;
  draw();
  renderStats(true);
  renderNote();
  $('run').textContent = 'Start søk';
}

function animate() {
  if (!animating) return;
  if (shownVisited < result.visited.length) {
    shownVisited = Math.min(result.visited.length, shownVisited + speed().perFrame);
  } else if (shownPath < result.path.length) {
    shownPath = Math.min(result.path.length, shownPath + Math.max(1, Math.ceil(speed().perFrame / 6)));
  } else {
    animating = false;
    $('run').textContent = 'Start søk';
    renderStats(true);
    renderNote();
    draw();
    return;
  }
  draw();
  renderStats(false);
  requestAnimationFrame(animate);
}

function run() {
  if (animating) { showInstantly(); return; } // andre trykk hopper til resultatet
  if (prefersReducedMotion()) { showInstantly(); return; }
  compute();
  shownVisited = 0; shownPath = 0;
  animating = true;
  $('run').textContent = 'Hopp til resultat';
  renderNote();
  requestAnimationFrame(animate);
}

function clearSearch(redraw = true) {
  animating = false;
  result = null;
  shownVisited = 0; shownPath = 0;
  $('run').textContent = 'Start søk';
  renderStats(false);
  renderNote();
  if (redraw) draw();
}

/** Kalles når rutenettet er endret: oppdater et ferdig søk, eller bare tegn på nytt. */
function gridChanged() {
  if (animating) clearSearch();
  else if (result) showInstantly();
  else draw();
}

/* ---------- Tegning med pekeren ---------- */
let drag = null; // 'paint' | 'start' | 'goal'
let lastCell = -1;

function cellAt(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
  return x < 0 || y < 0 || x >= cols || y >= rows ? -1 : y * cols + x;
}

/** Alle ruter på linjen mellom to ruter, så raske bevegelser ikke gir hull. */
function line(from, to) {
  const x0 = from % cols, y0 = Math.floor(from / cols);
  const x1 = to % cols, y1 = Math.floor(to / cols);
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const out = [];
  for (let s = 1; s <= steps; s++) {
    out.push(Math.round(y0 + ((y1 - y0) * s) / steps) * cols + Math.round(x0 + ((x1 - x0) * s) / steps));
  }
  return out;
}

function paint(index) {
  if (index === start || index === goal) return;
  cells[index] = tool();
  handDrawn = true;
}

function regenerate(kind) {
  fill = kind;
  handDrawn = false;
  cells = FILL[kind](cols, rows);
  cells[start] = cells[goal] = EMPTY;
  clearSearch();
}

canvas.addEventListener('pointerdown', (e) => {
  const index = cellAt(e);
  if (index < 0) return;
  canvas.setPointerCapture(e.pointerId);
  lastCell = index;
  if (index === start) drag = 'start';
  else if (index === goal) drag = 'goal';
  else { drag = 'paint'; paint(index); gridChanged(); }
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const index = cellAt(e);
  if (index < 0 || index === lastCell) return;
  if (drag === 'paint') {
    line(lastCell, index).forEach(paint);
  } else if (cells[index] !== WALL && index !== start && index !== goal) {
    if (drag === 'start') start = index; else goal = index;
  } else {
    return;
  }
  lastCell = index;
  gridChanged();
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* ---------- Kontroller ---------- */
$('run').addEventListener('click', run);
$('clear-path').addEventListener('click', () => clearSearch());
$('clear-all').addEventListener('click', () => regenerate('empty'));
$('maze').addEventListener('click', () => regenerate('maze'));
$('terrain').addEventListener('click', () => regenerate('terrain'));
$('algorithm').addEventListener('change', () => {
  if (result) showInstantly(); // bytt algoritme og sammenlign på samme kart
  else renderNote();
});
$('speed').addEventListener('input', () => { $('out-speed').textContent = speed().label; });
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || e.target.closest('input, select, button, a')) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
});

window.addEventListener('themechange', () => { readColors(); draw(); });
new ResizeObserver(layout).observe(wrap);

readColors();
layout();
renderNote();
