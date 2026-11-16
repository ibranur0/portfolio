import { LEVELS, MATERIALS, MAX_BEAM, Simulation, cost, roadPath, buildable, stars, sameBeam } from './bridge.js';
import { el, store, cssVar, prefersReducedMotion } from '../../assets/js/ui.js';

const PROGRESS_KEY = 'bro:stjerner';
const designKey = (level) => `bro:design:${level.id}`;
const TOP = 3.4, BOTTOM = -4.8, MARGIN = 2.2;   // utsnittet av verden som vises, i meter
const MAX_SCALE = 64;                            // piksler per meter på store skjermer
const STEP = 1 / 60;                             // fysikken går alltid i steg på 1/60 sekund
const TOOLS = ['road', 'wood', 'steel', 'erase'];

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const kr = (n) => `${Math.round(n).toLocaleString('nb-NO')} kr`;

/* ====================== Tilstand ====================== */
let level = LEVELS[0];
let design = [];            // bjelkene: [ax, ay, bx, by, materiale]
let history = [];           // tidligere design, for angring
let sim = null;             // simuleringen mens brua testes
let mode = 'build';         // 'build' | 'test' | 'done'
let drag = null;            // { from: [x, y], to: [x, y] | null, valid }
let hover = null;           // { node } eller { beam } under pekeren
let particles = [];         // fliser og vannsprut
let weakSpot = null;        // der brua røk først i forrige test, vist til designet endres
let roadAlarm = 0;          // tidspunkt da spilleren prøvde å teste uten sammenhengende vei
let slowUntil = 0;          // sakte film et øyeblikk når den første bjelken ryker
let accumulator = 0;
let noteTimer = 0;
let colors = {};
let view = { scale: 40, x0: 0, width: 0, height: 0 };
const progress = store.get(PROGRESS_KEY, {});

const tool = () => document.querySelector('input[name="tool"]:checked').value;
const fmtStars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/* ====================== Verden og skjerm ====================== */
const sx = (x) => (x - view.x0) * view.scale;
const sy = (y) => (TOP - y) * view.scale;
const worldOf = (e) => {
  const rect = canvas.getBoundingClientRect();
  return [view.x0 + (e.clientX - rect.left) / view.scale, TOP - (e.clientY - rect.top) / view.scale];
};

/** Lerretet skal få plass sammen med knappene, så skalaen begrenses av både bredden og høyden. */
function resize() {
  const width = $('stage').clientWidth;
  if (!width) return;
  const span = level.right - level.left + MARGIN * 2;
  const room = Math.max(240, window.innerHeight - 190);
  view.scale = Math.min(MAX_SCALE, width / span, room / (TOP - BOTTOM));
  view.width = width;
  view.height = Math.round((TOP - BOTTOM) * view.scale);
  view.x0 = (level.left + level.right) / 2 - width / view.scale / 2;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(view.height * dpr);
  canvas.style.height = `${view.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function readColors() {
  colors = {
    bg: cssVar('--bg'), surface: cssVar('--surface'), surface2: cssVar('--surface-2'), line: cssVar('--line'), strong: cssVar('--line-strong'),
    text: cssVar('--text'), muted: cssVar('--muted'), accent: cssVar('--accent'), ink: cssVar('--accent-ink'),
    blue: cssVar('--blue'), yellow: cssVar('--yellow'), danger: cssVar('--danger'), rose: cssVar('--rose'), mono: cssVar('--font-mono'),
  };
}

/* ====================== Design ====================== */
/** Alle knutepunkter: festene i fjellet og endepunktene til bjelkene. */
function nodes() {
  const seen = new Map(level.anchors.map(([x, y]) => [`${x},${y}`, [x, y]]));
  for (const [ax, ay, bx, by] of design) { seen.set(`${ax},${ay}`, [ax, ay]); seen.set(`${bx},${by}`, [bx, by]); }
  return [...seen.values()];
}

/** Veistykkene som mangler for at veien skal gå helt over. Tom liste hvis den er hel. */
function missingRoad() {
  if (roadPath(level, design)) return [];
  const gaps = [];
  for (let x = level.left; x < level.right; x++) {
    const piece = [x, 0, x + 1, 0];
    if (!design.some((b) => b[4] === 'road' && sameBeam(b, piece))) gaps.push(x);
  }
  return gaps;
}

function commit(next) {
  history.push(design);
  if (history.length > 200) history.shift();
  design = next;
  weakSpot = null;
  store.set(designKey(level), design);
  renderPanel();
}

function loadLevel(index) {
  level = LEVELS[index];
  const saved = store.get(designKey(level), null);
  const usable = Array.isArray(saved) && saved.every((b) => Array.isArray(b) && b.length === 5 && MATERIALS[b[4]] && buildable(level, b[0], b[1]) && buildable(level, b[2], b[3]));
  design = usable ? saved : (level.start ?? []).map((b) => [...b]);
  history = [];
  weakSpot = null;
  roadAlarm = 0;
  stopTest();
  resize();
  renderLevels();
  renderPanel();
  setNote('');
}

/* ====================== Testen ====================== */
/** Sørger for at hele byggeplassen er synlig, så testen ikke foregår utenfor skjermen. */
function revealStage() {
  const box = $('stage').getBoundingClientRect();
  if (box.top < 64 || box.bottom > window.innerHeight) {
    document.querySelector('.tools').scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}

function startTest() {
  if (!roadPath(level, design)) {
    // Uten sammenhengende vei kan ingen kjøre over. Vis hvor den mangler, der brua er.
    roadAlarm = performance.now();
    const gaps = missingRoad().length;
    setNote(gaps ? `Veien mangler ${gaps === 1 ? 'ett stykke' : `${gaps} stykker`}, der den røde streken går. Velg "Vei" og dra fra knutepunkt til knutepunkt.` : 'Veien henger ikke sammen fra bredd til bredd.', true);
    if (tool() !== 'road') document.querySelector('input[name="tool"][value="road"]').checked = true;
    revealStage();
    return;
  }
  sim = new Simulation(level, design);
  mode = 'test';
  particles = [];
  accumulator = 0;
  slowUntil = 0;
  drag = null; hover = null;
  $('result').hidden = true;
  $('stage').classList.add('testing');
  $('stage').classList.remove('done');
  $('stress-legend').hidden = false;
  $('test').textContent = 'Stopp testen';
  setNote('');
  revealStage();
  renderPanel();
}

function stopTest() {
  sim = null;
  mode = 'build';
  particles = [];
  $('result').hidden = true;
  $('stage').classList.remove('testing', 'done');
  $('stress-legend').hidden = true;
  $('test').textContent = 'Test brua';
  renderPanel();
}

function finish() {
  mode = 'done';
  $('stage').classList.remove('testing');
  $('stage').classList.add('done');
  const won = sim.status === 'won';
  weakSpot = sim.firstBreak;
  const earned = stars(level, design, won);
  const spent = cost(design);
  const [three, two, limit] = level.stars;
  if (earned > (progress[level.id] ?? 0)) { progress[level.id] = earned; store.set(PROGRESS_KEY, progress); }

  $('result').classList.toggle('failed', earned === 0);
  $('result-stars').replaceChildren('★'.repeat(earned), el('span', { class: 'empty', text: '★'.repeat(3 - earned) }));
  const unused = sim.beams.filter((b) => !b.broken && b.material !== 'road' && b.peak < 0.25).length;
  const saving = unused ? ` ${unused} ${unused === 1 ? 'bjelke' : 'bjelker'} ble nesten ikke belastet: de er grønne nå, og kan kanskje fjernes.` : '';

  let title, text;
  if (!won) {
    title = 'Brua røk';
    text = `${sim.reason} ${sim.broken} ${sim.broken === 1 ? 'bjelke' : 'bjelker'} røk. Det røde krysset viser hvor det startet: forsterk der, eller fordel kreftene med flere trekanter.`;
  } else if (earned === 0) {
    title = 'Brua holdt, men den er for dyr';
    text = `Den kostet ${kr(spent)}, og budsjettet er ${kr(limit)}.${saving || ' Bytt stål med tre der belastningen er lav.'}`;
  } else if (earned === 3) {
    title = spent <= three * 0.9 ? 'Brua holdt, og den var supergjerrig!' : 'Brua holdt, og den var billig!';
    text = `${kr(spent)}. Tre stjerner krever ${kr(three)} eller mindre. Høyeste belastning var ${Math.round(Math.min(sim.maxStress, 1) * 100)} %.`;
  } else {
    title = 'Brua holdt!';
    text = `${kr(spent)}. ${earned === 2 ? `Tre stjerner krever ${kr(three)}` : `To stjerner krever ${kr(two)}, tre krever ${kr(three)}`}.${saving}`;
  }
  $('result-title').textContent = title;
  $('result-text').textContent = text;
  const last = LEVELS.indexOf(level) === LEVELS.length - 1;
  $('result-next').hidden = earned === 0 || last;
  $('result-back').textContent = earned === 3 ? 'Prøv enda billigere' : won ? 'Bygg videre' : 'Tilbake til bygging';
  $('result').hidden = false;
  $('test').textContent = 'Tilbake til bygging';
  renderLevels();
  renderPanel();
}

/* ====================== Paneler ====================== */
/** En kort melding oppå lerretet. Advarsler blir stående, andre meldinger forsvinner av seg selv. */
function setNote(text, warn = false) {
  clearTimeout(noteTimer);
  const note = $('note');
  note.hidden = !text;
  note.textContent = text;
  note.classList.toggle('warn', warn);
  if (text) noteTimer = setTimeout(() => { note.hidden = true; }, warn ? 9000 : 4500);
}

function renderLevels() {
  $('levels').replaceChildren(...LEVELS.map((l, k) =>
    el('button', { class: 'level', type: 'button', 'aria-pressed': String(l === level), onclick: () => loadLevel(k) },
      el('span', { class: 'num', text: String(k + 1) }), l.name,
      progress[l.id] ? el('span', { class: 'won', 'aria-label': `${progress[l.id]} av 3 stjerner`, text: '★'.repeat(progress[l.id]) }) : null)));
  $('level-name').textContent = level.name;
  $('level-text').textContent = level.text;
  $('s-stars').textContent = `${Object.values(progress).reduce((a, b) => a + b, 0)} / ${LEVELS.length * 3}`;
}

function renderPanel() {
  const spent = cost(design);
  const [three, two, limit] = level.stars;
  // Måleren går litt forbi budsjettet, så det synes når du er over.
  const full = Math.max(limit * 1.12, spent);
  const reach = spent <= three ? 3 : spent <= two ? 2 : spent <= limit ? 1 : 0;
  $('spent').textContent = kr(spent);
  $('spent').parentElement.classList.toggle('over', spent > limit);
  $('meter').style.width = `${(spent / full) * 100}%`;
  $('meter').className = ['', 'one', 'two', ''][reach] || (reach === 0 ? 'over' : '');
  [three, two, limit].forEach((value, k) => { $(`tick-${3 - k}`).style.left = `${(value / full) * 100}%`; });
  $('goals').replaceChildren(...[[3, three], [2, two], [1, limit]].map(([n, value]) =>
    el('li', { class: reach >= n ? 'reached' : '', 'aria-label': `${n} ${n === 1 ? 'stjerne' : 'stjerner'}: ${kr(value)} eller mindre${n === 1 ? ' (budsjettet)' : ''}` },
      el('span', { class: 'stars', 'aria-hidden': 'true' }, '★'.repeat(n), n === 1 ? el('small', { text: ' budsjett' }) : null),
      el('span', { class: 'value', 'aria-hidden': 'true', text: kr(value) }))));
  $('s-beams').textContent = String(design.length);
  $('s-stress').textContent = sim ? `${Math.round(Math.min(sim.maxStress, 1) * 100)} %` : '-';
  $('s-broken').textContent = sim ? String(sim.broken) : '-';
  $('undo').disabled = mode !== 'build' || !history.length;
  for (const input of document.querySelectorAll('input[name="tool"]')) input.disabled = mode === 'test';
}

/* ====================== Tegning ====================== */
/** Farge etter belastning: fra aksent (trygt) via gult til rødt (like før brudd). */
function stressColor(stress) {
  const t = Math.min(1, stress);
  const mix = (a, b, k) => {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const channel = (shift) => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * k);
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  };
  return t < 0.55 ? mix(colors.accent, colors.yellow, t / 0.55) : mix(colors.yellow, colors.danger, (t - 0.55) / 0.45);
}

const BEAM_WIDTH = { road: 0.2, wood: 0.1, steel: 0.11 };
const beamColor = (material) => (material === 'road' ? colors.text : material === 'wood' ? colors.yellow : colors.blue);

function drawTerrain(now) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, view.width, view.height);

  // Elva
  const water = sy(-4.2);
  ctx.fillStyle = colors.blue;
  ctx.globalAlpha = 0.16;
  ctx.fillRect(0, water, view.width, view.height - water);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = colors.blue;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= view.width; x += 6) ctx.lineTo(x, water + Math.sin(x / 22 + now / 900) * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Fjellet på hver side, og pilarer under fester som står ute i elva
  ctx.fillStyle = colors.surface2;
  ctx.strokeStyle = colors.strong;
  ctx.lineWidth = 1.5;
  const bank = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], k) => (k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.fill(); ctx.stroke();
  };
  const farLeft = view.x0 - 1, farRight = view.x0 + view.width / view.scale + 1;
  bank([[farLeft, 0], [level.left, 0], [level.left, -2.6], [level.left - 0.5, BOTTOM - 1], [farLeft, BOTTOM - 1]]);
  bank([[farRight, 0], [level.right, 0], [level.right, -2.6], [level.right + 0.5, BOTTOM - 1], [farRight, BOTTOM - 1]]);
  for (const [x, y] of level.anchors) {
    if (x > level.left && x < level.right) bank([[x - 0.32, y], [x + 0.32, y], [x + 0.45, BOTTOM - 1], [x - 0.45, BOTTOM - 1]]);
  }

  // Veien inn mot brua på begge sider
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = BEAM_WIDTH.road * view.scale;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(0, sy(0)); ctx.lineTo(sx(level.left), sy(0));
  ctx.moveTo(sx(level.right), sy(0)); ctx.lineTo(view.width, sy(0));
  ctx.stroke();
}

function drawGrid() {
  ctx.fillStyle = colors.strong;
  for (let x = level.left + 1; x < level.right; x++) {
    for (let y = -4; y <= 3; y++) ctx.fillRect(sx(x) - 1, sy(y) - 1, 2, 2);
  }
}

/** Stiplet strek der veien mangler. Den blir rød og blinker litt hvis du prøver å teste uten vei. */
function drawMissingRoad(now) {
  const gaps = missingRoad();
  if (!gaps.length) return;
  const alarm = roadAlarm > 0;
  const blinking = alarm && now - roadAlarm < 3000;
  ctx.save();
  ctx.lineWidth = Math.max(3, BEAM_WIDTH.road * view.scale * 0.8);
  ctx.setLineDash([view.scale * 0.14, view.scale * 0.12]);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = alarm ? colors.danger : colors.muted;
  ctx.globalAlpha = blinking ? 0.55 + 0.45 * Math.sin(now / 90) ** 2 : alarm ? 0.9 : 0.6;
  ctx.beginPath();
  for (const x of gaps) { ctx.moveTo(sx(x) + 6, sy(0)); ctx.lineTo(sx(x + 1) - 6, sy(0)); }
  ctx.stroke();
  ctx.restore();
}

function drawBeam(x1, y1, x2, y2, material, color, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2.5, BEAM_WIDTH[material] * view.scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx(x1), sy(y1)); ctx.lineTo(sx(x2), sy(y2));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawNode(x, y, fixed, highlighted) {
  const r = Math.max(4, (fixed ? 0.16 : 0.11) * view.scale);
  ctx.beginPath();
  ctx.arc(sx(x), sy(y), r, 0, Math.PI * 2);
  ctx.fillStyle = fixed ? colors.accent : colors.surface;
  ctx.fill();
  ctx.lineWidth = highlighted ? 3 : 1.5;
  ctx.strokeStyle = highlighted ? colors.accent : colors.text;
  ctx.stroke();
}

/** Et rødt kryss der det første bruddet skjedde. */
function drawWeakSpot() {
  const x = sx(weakSpot.x), y = sy(weakSpot.y), r = Math.max(7, 0.2 * view.scale);
  ctx.strokeStyle = colors.danger;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 1.9, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawVehicle(v) {
  const s = view.scale, length = 0.9 + v.mass / 45, heavy = v.mass > 25;
  ctx.save();
  ctx.translate(sx(v.x), sy(v.y));
  ctx.rotate(-v.angle);
  ctx.translate(0, -0.13 * s); // hjulene står oppå veidekket
  ctx.fillStyle = heavy ? colors.rose : colors.accent;
  ctx.beginPath();
  ctx.roundRect(-length * 0.5 * s, -0.62 * s, length * 0.68 * s, 0.46 * s, 0.06 * s);   // lasteplan
  ctx.roundRect(length * 0.22 * s, -0.5 * s, length * 0.28 * s, 0.34 * s, 0.06 * s);     // førerhus
  ctx.fill();
  // Hjulene ruller: en eike viser at de går rundt.
  const spin = v.x / 0.13;
  for (const wheel of [-length * 0.3, length * 0.32]) {
    ctx.fillStyle = colors.text;
    ctx.beginPath();
    ctx.arc(wheel * s, -0.12 * s, 0.13 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = colors.bg;
    ctx.lineWidth = Math.max(1, 0.03 * s);
    ctx.beginPath();
    ctx.moveTo(wheel * s, -0.12 * s);
    ctx.lineTo(wheel * s + Math.cos(spin) * 0.1 * s, -0.12 * s + Math.sin(spin) * 0.1 * s);
    ctx.stroke();
  }
  ctx.fillStyle = colors.ink;
  ctx.font = `600 ${Math.max(9, 0.2 * s)}px ${colors.mono}`;
  ctx.textAlign = 'center';
  ctx.fillText(`${v.mass} t`, -length * 0.16 * s, -0.33 * s);
  ctx.restore();
}

function draw(now) {
  drawTerrain(now);

  if (sim) {
    // Under testen viser fargen belastningen nå. Etterpå viser den det verste hver bjelke opplevde.
    for (const beam of sim.beams) {
      if (beam.broken) continue;
      const a = sim.nodes[beam.a], b = sim.nodes[beam.b];
      drawBeam(a.x, a.y, b.x, b.y, beam.material, stressColor(mode === 'done' ? beam.peak : beam.stress));
    }
    for (const n of sim.nodes) drawNode(n.x, n.y, n.fixed, false);
    for (const v of sim.vehicles) drawVehicle(v);
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.water ? colors.blue : colors.danger;
      ctx.fillRect(sx(p.x) - 2, sy(p.y) - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    if (mode === 'done' && weakSpot) drawWeakSpot();
    return;
  }

  drawGrid();
  drawMissingRoad(now);
  design.forEach((beam, k) => {
    const erasing = tool() === 'erase' && hover?.beam === k;
    drawBeam(beam[0], beam[1], beam[2], beam[3], beam[4], erasing ? colors.danger : beamColor(beam[4]), erasing ? 0.6 : 1);
  });
  if (drag?.to) {
    const [fx, fy] = drag.from, [tx, ty] = drag.to;
    const material = tool() === 'erase' ? 'wood' : tool();
    drawBeam(fx, fy, tx, ty, material, drag.valid ? beamColor(material) : colors.danger, 0.55);
    if (drag.valid) {
      const label = kr(Math.hypot(tx - fx, ty - fy) * MATERIALS[material].cost);
      ctx.font = `600 12px ${colors.mono}`;
      ctx.textAlign = 'center';
      const lx = sx((fx + tx) / 2), ly = sy((fy + ty) / 2) - 14;
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = colors.surface;
      ctx.beginPath(); ctx.roundRect(lx - w / 2, ly - 13, w, 19, 6); ctx.fill();
      ctx.fillStyle = colors.text;
      ctx.fillText(label, lx, ly);
    }
  }
  for (const [x, y] of nodes()) {
    const fixed = level.anchors.some(([ax, ay]) => ax === x && ay === y);
    drawNode(x, y, fixed, (hover?.node && hover.node[0] === x && hover.node[1] === y) || (drag && drag.from[0] === x && drag.from[1] === y));
  }
  if (drag?.to && drag.valid) drawNode(drag.to[0], drag.to[1], false, true);
  if (weakSpot) drawWeakSpot();
  // Bilene som venter på bredden, så det er tydelig hva brua skal tåle.
  level.vehicles.forEach((v, k) => drawVehicle({ ...v, x: level.left - 1.3 - k * 1.5, y: 0, angle: 0 }));
}

/* ====================== Løkke ====================== */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'test' && sim) {
    // Fast tidssteg: like rask fysikk på 60 Hz og 144 Hz. Sakte film i et øyeblikk når noe ryker.
    const speed = ($('fast').checked ? 2 : 1) * (now < slowUntil ? 0.3 : 1);
    accumulator = Math.min(accumulator + dt * speed, STEP * 8);
    const brokenBefore = sim.broken;
    while (accumulator >= STEP && sim.status === 'running') { sim.step(); accumulator -= STEP; }
    if (brokenBefore === 0 && sim.broken > 0 && !prefersReducedMotion()) slowUntil = now + 1300;
    for (const event of sim.events.splice(0)) {
      for (let k = 0; k < 8; k++) particles.push({ x: event.x, y: event.y, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3 + 1, life: 1 });
    }
    for (const v of sim.vehicles) {
      if (v.state === 'falling' && v.y < -4.2 && !v.splashed) {
        v.splashed = true;
        for (let k = 0; k < 26; k++) particles.push({ x: v.x + (Math.random() - 0.5) * 0.8, y: -4.2, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 5 + 2, life: 1, water: true });
      }
    }
    $('s-stress').textContent = `${Math.round(Math.min(sim.maxStress, 1) * 100)} %`;
    $('s-broken').textContent = String(sim.broken);
    if (sim.status !== 'running') finish();
  }
  // Brua holdt: bilene kjører videre ut av bildet i stedet for å bli stående ved enden.
  if (mode === 'done' && sim?.status === 'won') for (const v of sim.vehicles) v.x += v.speed * dt;
  for (const p of particles) { p.vy -= 9.81 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.9; }
  particles = particles.filter((p) => p.life > 0);
  draw(now);
  if (!document.hidden) requestAnimationFrame(frame);
}

/* ====================== Bygging med pekeren ====================== */
function nearestNode(wx, wy) {
  const reach = Math.max(0.45, 18 / view.scale);
  let best = null, bestDistance = reach;
  for (const node of nodes()) {
    const d = Math.hypot(node[0] - wx, node[1] - wy);
    if (d < bestDistance) { best = node; bestDistance = d; }
  }
  return best;
}

function nearestBeam(wx, wy) {
  const reach = Math.max(0.28, 12 / view.scale);
  let best = -1, bestDistance = reach;
  design.forEach(([ax, ay, bx, by], k) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((wx - ax) * dx + (wy - ay) * dy) / (dx * dx + dy * dy)));
    const d = Math.hypot(ax + dx * t - wx, ay + dy * t - wy);
    if (d < bestDistance) { best = k; bestDistance = d; }
  });
  return best;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  // Etter en test: et trykk på brua tar deg rett tilbake til byggingen.
  if (mode === 'done') stopTest();
  if (mode !== 'build') return;
  const [wx, wy] = worldOf(e);
  if (tool() === 'erase') {
    const k = nearestBeam(wx, wy);
    if (k >= 0) commit(design.filter((_, i) => i !== k));
    return;
  }
  const node = nearestNode(wx, wy);
  if (!node) { setNote('Start i et knutepunkt: et grønt feste i fjellet, eller enden av en bjelke du har lagt.'); return; }
  canvas.setPointerCapture(e.pointerId);
  drag = { from: node, to: null, valid: false };
});

canvas.addEventListener('pointermove', (e) => {
  if (mode !== 'build') return;
  const [wx, wy] = worldOf(e);
  if (!drag) {
    hover = tool() === 'erase' ? { beam: nearestBeam(wx, wy) } : { node: nearestNode(wx, wy) };
    return;
  }
  // Slipp-punktet er nærmeste rutepunkt. Bjelken må være kort nok, og punktet må ligge i friluft.
  const to = [Math.round(wx), Math.round(wy)];
  const [fx, fy] = drag.from;
  const length = Math.hypot(to[0] - fx, to[1] - fy);
  drag.to = length > 0 ? to : null;
  drag.valid = length > 0 && length <= MAX_BEAM && buildable(level, to[0], to[1]);
});

function endDrag(e) {
  if (!drag) return;
  const { from, to, valid } = drag;
  drag = null;
  if (e.type !== 'pointerup' || !to) return;
  if (!valid) {
    setNote(Math.hypot(to[0] - from[0], to[1] - from[1]) > MAX_BEAM ? 'En bjelke kan være høyst to ruter lang. Bygg videre i flere ledd.' : 'Der er det fjell. Knutepunkter må ligge i friluft mellom breddene.', true);
    return;
  }
  const beam = [from[0], from[1], to[0], to[1], tool()];
  // Ligger det allerede en bjelke her, byttes materialet.
  const existing = design.findIndex((other) => sameBeam(other, beam));
  if (existing >= 0 && design[existing][4] === beam[4]) return;
  commit(existing >= 0 ? design.map((other, k) => (k === existing ? beam : other)) : [...design, beam]);
  if (!missingRoad().length && roadAlarm) { roadAlarm = 0; setNote('Veien henger sammen. Trykk "Test brua".'); }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { hover = null; });
canvas.addEventListener('contextmenu', (e) => {
  // Høyreklikk fjerner bjelken under pekeren, uansett hvilket verktøy som er valgt.
  e.preventDefault();
  if (mode === 'done') stopTest();
  if (mode !== 'build') return;
  const k = nearestBeam(...worldOf(e));
  if (k >= 0) commit(design.filter((_, i) => i !== k));
});

/* ====================== Kontroller ====================== */
function undo() {
  if (mode === 'done') stopTest();
  if (mode !== 'build' || !history.length) return;
  design = history.pop();
  weakSpot = null;
  store.set(designKey(level), design);
  renderPanel();
}

$('test').addEventListener('click', () => (mode === 'build' ? startTest() : stopTest()));
$('undo').addEventListener('click', undo);
// Virker også under og etter en test: testen stoppes først, så nullstilles nivået.
$('clear').addEventListener('click', () => {
  if (mode !== 'build') stopTest();
  const start = (level.start ?? []).map((b) => [...b]);
  if (JSON.stringify(start) === JSON.stringify(design)) {
    setNote('Nivået står allerede slik det startet.');
    return;
  }
  commit(start);
  // Første nivå starter med en halvferdig bru, og det sier vi fra om.
  setNote(start.length
    ? 'Nivået er tilbake slik det startet, med den påbegynte brua. "Angre" henter din bru tilbake.'
    : 'Nivået er tomt igjen. "Angre" henter brua tilbake.');
});
$('result-back').addEventListener('click', stopTest);
$('result-next').addEventListener('click', () => { loadLevel(LEVELS.indexOf(level) + 1); document.querySelector('.board').scrollIntoView({ block: 'start', behavior: 'smooth' }); });
$('tool').addEventListener('change', () => { hover = null; if (mode === 'done') stopTest(); });

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input[type="text"], input[type="number"], textarea, select');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const index = ['1', '2', '3', '4'].indexOf(e.key);
  if (index >= 0 && mode !== 'test') {
    document.querySelector(`input[name="tool"][value="${TOOLS[index]}"]`).checked = true;
    hover = null;
    if (mode === 'done') stopTest();
  } else if (e.key === ' ' && !e.target.closest('button, a, input, label')) {
    e.preventDefault();
    $('test').click();
  } else if (e.key === 'Escape' && mode !== 'build') stopTest();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); requestAnimationFrame(frame); } });
window.addEventListener('themechange', readColors);
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe($('stage'));

/* ====================== Oppstart ====================== */
readColors();
// Start på det første nivået som ikke har tre stjerner.
const next = LEVELS.findIndex((l) => (progress[l.id] ?? 0) < 3);
loadLevel(next < 0 ? 0 : next);
requestAnimationFrame(frame);
