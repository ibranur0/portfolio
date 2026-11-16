import { LEVELS, World, Attempt, programSize, stars } from './robot.js';
import { el, store, cssVar, insertText, prefersReducedMotion } from '../../assets/js/ui.js';

const PROGRESS_KEY = 'robot:stjerner';
const codeKey = (level) => `robot:kode:${level.id}`;
const DURATIONS = [460, 240, 110, 28];          // millisekunder per bevegelse for hver fart
const LINE_HEIGHT = 23, EDITOR_PADDING = 12;    // må stemme med --lh og --pad i style.css
const PALETTE = [
  ['frem();', 'move'], ['venstre();', 'move'], ['høyre();', 'move'],
  ['fri()', 'sensor'], ['friVenstre()', 'sensor'], ['friHøyre()', 'sensor'], ['mål()', 'sensor'],
  ['for i in range(4) {\n  \n}', 'shape', 'for... { }'], ['while fri() {\n  \n}', 'shape', 'while... { }'],
  ['if fri() {\n  \n} else {\n  \n}', 'shape', 'if... else'], ['fn navn() {\n  \n}', 'shape', 'fn navn() { }'], ['not ', 'shape', 'not'],
];

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

/* ====================== Tilstand ====================== */
let level = LEVELS[0];
let world = new World(level.maps[0]);   // banen som vises
let attempt = null;                     // programmet som kjører, eller null
let mapIndex = 0;
let passed = [];                        // utfallet på hver bane i dette forsøket: true | false | undefined
let playing = false;                    // kjører av seg selv (ikke steg for steg)
let timer = 0;
let activeLine = 0, errorLine = 0;
let colors = {};
let cell = 48;
const progress = store.get(PROGRESS_KEY, {});
// Det som tegnes: roboten glir mellom rutene i stedet for å hoppe.
const robot = { x: 0, y: 0, angle: 0, fromX: 0, fromY: 0, fromAngle: 0, toX: 0, toY: 0, toAngle: 0, start: 0, duration: 1, bump: 0 };
const sparks = [];                      // krystaller som nettopp ble plukket: { x, y, born }

const duration = () => (prefersReducedMotion() ? 0 : DURATIONS[Number($('speed').value) - 1]);

/* ====================== Nivå og bane ====================== */
function loadLevel(index) {
  level = LEVELS[index];
  const saved = store.get(codeKey(level), null);
  editor.value = typeof saved === 'string' && saved.trim() ? saved : level.starter;
  editor.scrollTop = 0;
  resetRun();
  renderLevels();
  renderSize();
  setStatus(level.maps.length > 1 ? `Dette nivået har ${level.maps.length} baner. Det samme programmet må klare alle.` : 'Skriv programmet, og trykk "Kjør".');
}

function showMap(index) {
  mapIndex = index;
  world = attempt ? attempt.world : new World(level.maps[index]);
  robot.x = robot.toX = world.x; robot.y = robot.toY = world.y;
  robot.angle = robot.toAngle = world.dir * (Math.PI / 2);
  robot.start = 0; robot.bump = 0;
  sparks.length = 0;
  resize();
  renderGauges();
  renderMaps();
}

function resetRun() {
  clearTimeout(timer);
  attempt = null;
  playing = false;
  passed = [];
  activeLine = 0; errorLine = 0;
  $('result').hidden = true;
  $('run').textContent = 'Kjør';
  showMap(0);
  renderGutter();
}

/* ====================== Kjøring ====================== */
/** Starter programmet på en bane. Returnerer false hvis det ikke lar seg kompilere. */
function begin(index) {
  try {
    attempt = new Attempt(editor.value, level.maps[index]);
  } catch (error) {
    if (!error.kind) throw error;
    attempt = null;
    fail(`${error.kind} på linje ${error.line}`, `${error.message}.`, error.line);
    return false;
  }
  showMap(index);
  return true;
}

function fail(title, text, line = 0) {
  clearTimeout(timer);
  playing = false;
  errorLine = line;
  activeLine = 0;
  $('run').textContent = 'Kjør';
  setStatus([el('strong', { text: `${title}: ` }), text], true);
  renderGutter();
}

/** Utfører en kommando: maskinen kjører til roboten har gjort noe, og bevegelsen animeres. */
function tick() {
  const events = attempt.advance();
  activeLine = attempt.lastLine;
  const now = performance.now();
  for (const event of events) {
    if (event.type === 'pick') sparks.push({ x: event.x, y: event.y, born: now });
    if (event.type === 'bump') robot.bump = now;
  }
  // Start en glidende overgang fra der roboten tegnes nå, til der den faktisk er.
  robot.fromX = robot.x; robot.fromY = robot.y; robot.fromAngle = robot.angle;
  robot.toX = world.x; robot.toY = world.y;
  const turn = events.find((e) => e.type === 'turn');
  robot.toAngle += turn ? turn.by * (Math.PI / 2) : 0; // regnes fra forrige mål, så raske steg ikke gir skjev robot
  robot.start = now; robot.duration = Math.max(1, duration());
  renderGauges();
  renderGutter();

  if (attempt.outcome) { timer = setTimeout(finishMap, duration() + 260); return; }
  if (playing) timer = setTimeout(tick, duration() + 30);
  else setStatus(`Linje ${activeLine}. Trykk "Steg" for neste kommando, eller "Kjør" for å fortsette.`);
}

function finishMap() {
  const { outcome } = attempt;
  passed[mapIndex] = outcome.won;
  renderMaps();
  if (outcome.won && mapIndex + 1 < level.maps.length) {
    // Klarte denne banen: samme program, neste bane.
    setStatus(`Bane ${mapIndex + 1} er klart. Nå samme program på bane ${mapIndex + 2}.`);
    if (!begin(mapIndex + 1)) return;
    timer = setTimeout(tick, playing ? 500 : 0);
    return;
  }
  playing = false;
  $('run').textContent = 'Kjør';
  if (!outcome.won) {
    const where = level.maps.length > 1 ? `Bane ${mapIndex + 1} av ${level.maps.length}` : 'Ikke helt';
    errorLine = outcome.line ?? 0;
    showResult(false, where, outcome.reason);
    setStatus([el('strong', { text: `${where}: ` }), outcome.reason], true);
    renderGutter();
    return;
  }
  const size = programSize(editor.value);
  const earned = stars(level, size, true);
  if (earned > (progress[level.id] ?? 0)) { progress[level.id] = earned; store.set(PROGRESS_KEY, progress); }
  activeLine = 0;
  showResult(true, earned === 3 ? 'Perfekt!' : 'Fremme!',
    earned === 3 ? `${size} symboler. Kortere enn det blir det knapt.`
      : `${size} symboler. Tre stjerner krever ${level.par} eller færre${earned === 1 ? `, to krever ${Math.ceil(level.par * 1.5)}` : ''}. Kan noe gjentas med en løkke eller en funksjon?`, earned);
  setStatus('Roboten er fremme.');
  renderLevels();
  renderGutter();
}

function showResult(won, title, text, earned = 0) {
  $('result').classList.toggle('failed', !won);
  $('result-stars').replaceChildren('★'.repeat(earned), el('span', { class: 'empty', text: '★'.repeat(3 - earned) }));
  $('result-title').textContent = title;
  $('result-text').textContent = text;
  $('result-next').hidden = !won || LEVELS.indexOf(level) === LEVELS.length - 1;
  $('result-back').textContent = won ? 'Forbedre programmet' : 'Prøv igjen';
  $('result').hidden = false;
}

/** På smale skjermer ligger banen under editoren. Da rulles den frem når programmet starter. */
function showBoard() {
  const box = $('stage').getBoundingClientRect();
  if (box.top < 60 || box.bottom > window.innerHeight) $('stage').scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function run() {
  if (playing) { // "Pause"
    clearTimeout(timer);
    playing = false;
    $('run').textContent = 'Fortsett';
    setStatus('Pause. "Fortsett" kjører videre, "Steg" tar en kommando om gangen.');
    return;
  }
  if (!attempt || attempt.outcome) { resetRun(); if (!begin(0)) return; }
  playing = true;
  showBoard();
  $('run').textContent = 'Pause';
  setStatus('Kjører...');
  clearTimeout(timer);
  tick();
}

function step() {
  clearTimeout(timer);
  playing = false;
  $('run').textContent = 'Fortsett';
  if (!attempt || attempt.outcome) { resetRun(); if (!begin(0)) return; $('run').textContent = 'Fortsett'; }
  showBoard();
  tick();
}

/* ====================== Paneler ====================== */
function setStatus(content, error = false) {
  $('status').classList.toggle('error', error);
  $('status').replaceChildren(...[content].flat());
}

function renderLevels() {
  $('levels').replaceChildren(...LEVELS.map((l, k) =>
    el('button', { class: 'level', type: 'button', 'aria-pressed': String(l === level), onclick: () => loadLevel(k) },
      el('span', { class: 'num', text: String(k + 1) }), l.name,
      progress[l.id] ? el('span', { class: 'won', 'aria-label': `${progress[l.id]} av 3 stjerner`, text: '★'.repeat(progress[l.id]) }) : null)));
  $('level-name').textContent = level.name;
  $('level-text').textContent = level.text;
}

function renderMaps() {
  $('maps').replaceChildren(...level.maps.map((_, k) =>
    el('span', { class: passed[k] === true ? 'passed' : passed[k] === false ? 'failed' : k === mapIndex ? 'now' : '' },
      `Bane ${k + 1}`, passed[k] === true ? ' ✓' : passed[k] === false ? ' ✕' : '')));
}

function renderGauges() {
  $('battery').textContent = `${world.battery - world.moves}`;
  $('crystals').textContent = world.crystals.size ? `${world.crystals.size} igjen` : 'alle tatt';
}

function renderSize() {
  let size = null;
  try { size = programSize(editor.value); } catch { /* koden kompilerer ikke akkurat nå: det meldes når den kjøres */ }
  $('size').textContent = size == null ? '-' : `${size} / ${level.par}`;
  $('size').classList.toggle('over', size != null && size > level.par);
  $('size').title = 'Antall symboler i programmet, og hvor få som gir tre stjerner';
}

function renderGutter() {
  const count = editor.value.split('\n').length;
  const gutter = $('gutter');
  if (gutter.childElementCount !== count) gutter.replaceChildren(...Array.from({ length: count }, (_, i) => el('span', { text: String(i + 1) })));
  const active = errorLine || activeLine;
  [...gutter.children].forEach((span, i) => { span.className = i + 1 === active ? (errorLine ? 'failed' : 'active') : ''; });
  if (active) {
    const top = (active - 1) * LINE_HEIGHT;
    if (top < editor.scrollTop || top + LINE_HEIGHT * 2 > editor.scrollTop + editor.clientHeight) editor.scrollTop = Math.max(0, top - editor.clientHeight / 2);
  }
  gutter.scrollTop = editor.scrollTop;
  const marker = $('marker');
  marker.hidden = !active;
  marker.classList.toggle('failed', Boolean(errorLine));
  if (active) marker.style.top = `${EDITOR_PADDING + (active - 1) * LINE_HEIGHT - editor.scrollTop}px`;
}

/* ====================== Tegning ====================== */
function readColors() {
  colors = {
    bg: cssVar('--bg'), surface: cssVar('--surface'), surface2: cssVar('--surface-2'), line: cssVar('--line'), strong: cssVar('--line-strong'),
    text: cssVar('--text'), muted: cssVar('--muted'), accent: cssVar('--accent'), ink: cssVar('--accent-ink'), soft: cssVar('--accent-soft'),
    blue: cssVar('--blue'), danger: cssVar('--danger'),
  };
}

function resize() {
  const available = $('stage').clientWidth - 34;
  if (available <= 0) return;
  cell = Math.floor(Math.min(64, available / world.width, 400 / world.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = world.width * cell * dpr;
  canvas.height = world.height * cell * dpr;
  canvas.style.width = `${world.width * cell}px`;
  canvas.style.height = `${world.height * cell}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(now) {
  const { width, height } = world;
  ctx.clearRect(0, 0, width * cell, height * cell);
  const pad = Math.max(1, cell * 0.04);

  // Gulv, spor og vegger
  const visited = new Set(world.trail.map(([x, y]) => `${x},${y}`));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wall = world.walls[y][x];
      ctx.fillStyle = wall ? colors.surface2 : colors.surface;
      ctx.beginPath();
      ctx.roundRect(x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2, cell * (wall ? 0.16 : 0.1));
      ctx.fill();
      if (wall) { ctx.strokeStyle = colors.strong; ctx.lineWidth = 1; ctx.stroke(); }
      else if (visited.has(`${x},${y}`)) { ctx.fillStyle = colors.soft; ctx.fill(); }
    }
  }

  // Målet: to ringer
  const [gx, gy] = world.goal;
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = Math.max(2, cell * 0.07);
  for (const r of [0.3, 0.14]) {
    ctx.beginPath();
    ctx.arc((gx + 0.5) * cell, (gy + 0.5) * cell, cell * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Krystaller, og de som nettopp ble plukket (de vokser og blekner)
  const diamond = (x, y, size, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colors.blue;
    ctx.beginPath();
    ctx.moveTo((x + 0.5) * cell, (y + 0.5 - size) * cell);
    ctx.lineTo((x + 0.5 + size * 0.72) * cell, (y + 0.5) * cell);
    ctx.lineTo((x + 0.5) * cell, (y + 0.5 + size) * cell);
    ctx.lineTo((x + 0.5 - size * 0.72) * cell, (y + 0.5) * cell);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  for (const key of world.crystals) {
    const [x, y] = key.split(',').map(Number);
    diamond(x, y, 0.24 + Math.sin(now / 320 + x + y) * 0.015, 1);
  }
  for (let k = sparks.length - 1; k >= 0; k--) {
    const age = (now - sparks[k].born) / 420;
    if (age >= 1) sparks.splice(k, 1); else diamond(sparks[k].x, sparks[k].y, 0.24 + age * 0.3, 1 - age);
  }

  // Roboten glir fra forrige rute til den nye, og rister hvis den traff en vegg
  const t = robot.start ? Math.min(1, (now - robot.start) / robot.duration) : 1;
  const ease = t < 1 ? 1 - (1 - t) ** 3 : 1;
  robot.x = robot.fromX + (robot.toX - robot.fromX) * ease;
  robot.y = robot.fromY + (robot.toY - robot.fromY) * ease;
  robot.angle = robot.fromAngle + (robot.toAngle - robot.fromAngle) * ease;
  if (!robot.start) { robot.x = robot.toX; robot.y = robot.toY; robot.angle = robot.toAngle; }
  const bumped = robot.bump ? Math.max(0, 1 - (now - robot.bump) / 380) : 0;
  const crashed = world.status === 'crashed';
  ctx.save();
  ctx.translate((robot.x + 0.5) * cell, (robot.y + 0.5) * cell);
  ctx.rotate(robot.angle);
  ctx.translate(0, -Math.sin(bumped * Math.PI * 3) * cell * 0.16 * bumped); // "frem" er oppover i robotens eget koordinatsystem
  const half = cell * 0.33;
  ctx.fillStyle = crashed ? colors.danger : colors.accent;
  ctx.beginPath();
  ctx.roundRect(-half, -half, half * 2, half * 2, cell * 0.12);
  ctx.fill();
  ctx.fillStyle = colors.ink;                // to øyne som viser hvilken vei den ser
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * half * 0.42, -half * 0.42, cell * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = crashed ? colors.danger : colors.accent;   // en liten nese foran
  ctx.beginPath();
  ctx.moveTo(-half * 0.36, -half); ctx.lineTo(0, -half - cell * 0.13); ctx.lineTo(half * 0.36, -half);
  ctx.fill();
  ctx.restore();

  if (!document.hidden) requestAnimationFrame(draw);
}

/* ====================== Hendelser ====================== */
$('run').addEventListener('click', run);
$('step').addEventListener('click', step);
$('reset').addEventListener('click', () => { resetRun(); setStatus('Roboten står på start igjen.'); });
$('result-back').addEventListener('click', () => { resetRun(); editor.focus(); });
$('result-next').addEventListener('click', () => loadLevel(LEVELS.indexOf(level) + 1));

editor.addEventListener('input', () => {
  store.set(codeKey(level), editor.value);
  if (attempt || errorLine) resetRun(); else renderGutter(); // koden er endret: et påbegynt forsøk gjelder ikke lenger
  renderSize();
});
editor.addEventListener('scroll', renderGutter);
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
  else if (e.key === 'Tab' && !e.shiftKey && !e.altKey) {
    if (editor.dataset.escape) { delete editor.dataset.escape; return; } // Esc og så Tab flytter fokus som vanlig
    e.preventDefault();
    insertText(editor, '  ');
  } else if (e.key === 'Escape') editor.dataset.escape = '1';
  else if (e.key === 'Enter' && !e.isComposing) {
    const line = editor.value.slice(0, editor.selectionStart).split('\n').at(-1);
    e.preventDefault();
    insertText(editor, `\n${/^[ \t]*/.exec(line)[0]}${line.trimEnd().endsWith('{') ? '  ' : ''}`);
  }
  if (e.key !== 'Escape') delete editor.dataset.escape;
});

$('palette').replaceChildren(...PALETTE.map(([text, kind, label]) =>
  el('button', { class: kind, type: 'button', text: label ?? text, title: 'Sett inn ved markøren',
    onclick: () => {
      // Hele kommandoer havner på sin egen linje. Sensorer og "not" settes inn der markøren står.
      const before = editor.value.slice(0, editor.selectionStart);
      const lineStart = /(^|\n)[ \t]*$/.test(before);
      const indent = /[ \t]*$/.exec(before.split('\n').at(-1))[0];
      const wholeLine = kind === 'move' || text.includes('\n');
      const body = text.replace(/\n/g, `\n${indent}`);
      insertText(editor, wholeLine ? `${lineStart ? '' : `\n${indent}`}${body}${kind === 'move' ? `\n${indent}` : ''}` : text);
    } })));

window.addEventListener('themechange', readColors);
document.addEventListener('visibilitychange', () => { if (!document.hidden) requestAnimationFrame(draw); });
new ResizeObserver(resize).observe($('stage'));

/* ====================== Oppstart ====================== */
readColors();
const next = LEVELS.findIndex((l) => !progress[l.id]);
loadLevel(next < 0 ? 0 : next);
requestAnimationFrame(draw);
