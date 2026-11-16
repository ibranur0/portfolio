import { Regex, RegexError } from './regex.js';
import { el, fill, store } from '../../assets/js/ui.js';

const NS = 'http://www.w3.org/2000/svg';
const SAVE_KEY = 'regex:sist';
const TAPE_MAX = 64;          // så mange tegn vises i den stegvise gjennomgangen
const SHOWN_MAX = 20_000;     // så mange tegn av teksten vises med treff markert
const NATIVE_TIMEOUT = 2000;  // ms før nettleserens motor avbrytes i målingen

const PRESETS = [
  { name: 'E-post', pattern: '[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+', text: 'Skriv til kari@eksempel.no eller ola.nordmann@firma.co.uk. Ikke til @ingen eller kari@.' },
  { name: 'Dato', pattern: '\\b\\d{1,2}\\.\\d{1,2}\\.\\d{4}\\b', text: 'Møtet er 3.2.2027, fristen 17.05.2026. Versjon 1.2.3 er ikke en dato.' },
  { name: 'Mobilnummer', pattern: '(\\+47 ?)?[49]\\d{2} ?\\d{2} ?\\d{3}\\b', text: 'Ring 912 34 567, +47 41234567 eller 99887766. Sentralbord: 22 00 00 00.' },
  { name: 'Heksfarge', pattern: '#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\\b', text: 'color: #45d98b; background: #0a0c0b; border: 1px solid #ccc; id: #overskrift' },
  { name: 'Valg og løkker', pattern: '(ab|a)(bc|c)*d', text: 'abcd acbcd abbcd ad' },
  { name: 'Ondsinnet', pattern: '(a+)+$', text: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' },
];

// Mønstre som blir veldig trege med tilbakesporing. make(n) lager en tekst som nesten matcher.
const EVIL = [
  { pattern: '(a+)+$', make: (n) => `${'a'.repeat(n)}!`, shape: 'aaa...a!' },
  { pattern: '(a|a)*b', make: (n) => 'a'.repeat(n), shape: 'aaa...a' },
  { pattern: '^(\\w+\\s?)*$', make: (n) => `${'a'.repeat(n)}!`, shape: 'aaa...a!' },
];

const $ = (id) => document.getElementById(id);
const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};
const comma = (text) => text.replace(/\.0$/, '').replace('.', ',');

/** Tid i lesbar form, fra nanosekunder til sekunder. */
function fmtTime(ms) {
  if (ms >= 1000) return `${comma((ms / 1000).toFixed(1))} s`;
  if (ms >= 1) return `${comma(ms.toFixed(ms < 10 ? 1 : 0))} ms`;
  if (ms >= 0.001) return `${comma((ms * 1000).toFixed(ms < 0.01 ? 1 : 0))} µs`;
  return `${Math.max(1, Math.round(ms * 1e6))} ns`;
}

/** Gjennomsnittlig tid for ett kall. Raske funksjoner gjentas, siden klokken er grov. */
function timeIt(fn) {
  const started = performance.now();
  let runs = 0, elapsed = 0;
  do { fn(); runs++; elapsed = performance.now() - started; } while (elapsed < 4 && runs < 500_000);
  return elapsed / runs;
}

/* ====================== Tilstand ====================== */
let regex = null;
let steps = [];        // resultatet av regex.trace() for teksten på "tapen"
let tapeText = '';
let position = 0;
let playTimer = 0;
const pills = new Map(); // tegn-id i mønsteret -> SVG-gruppen som viser det
let endMarker = null;

/* ====================== Treff ====================== */
function update() {
  const pattern = $('pattern').value, text = $('text').value;
  store.set(SAVE_KEY, { pattern, text });
  renderPresets();
  stopPlaying();

  try {
    regex = new Regex(pattern);
  } catch (error) {
    if (!(error instanceof RegexError)) throw error;
    regex = null;
    showError(pattern, error);
    return;
  }

  let matches = [];
  const ms = timeIt(() => { matches = regex.matchAll(text); });
  const real = matches.filter((m) => m.end > m.start);
  const empty = matches.length - real.length;
  const count = real.length === 1 ? '1 treff' : `${real.length.toLocaleString('nb-NO')} treff`;
  $('status').classList.remove('error');
  $('status').replaceChildren(
    el('strong', { text: real.length || !empty ? count : 'Bare tomme treff' }),
    `${empty && real.length ? ` (og ${empty} tomme)` : ''} på ${fmtTime(ms)}. Automaten har ${regex.stateCount} tilstander.`,
  );
  renderMatches(text, real);
  drawDiagram();

  tapeText = text.slice(0, TAPE_MAX);
  steps = regex.trace(tapeText);
  position = Math.min(position, tapeText.length);
  $('position').max = tapeText.length;
  renderStep();
}

function showError(pattern, error) {
  // Vis mønsteret med feilstedet markert. Ligger feilen etter siste tegn, markeres en tom plass.
  const at = Math.min(error.index, pattern.length);
  $('status').classList.add('error');
  $('status').replaceChildren(
    el('strong', { text: 'Ugyldig mønster: ' }), `${error.message}.`,
    el('code', { class: 'where' }, pattern.slice(0, at), el('mark', { text: pattern[at] ?? ' ' }), pattern.slice(at + 1)),
  );
  renderMatches($('text').value, []);
  $('diagram').replaceChildren();
  $('diagram').setAttribute('width', 0);
  $('diagram').setAttribute('height', 0);
  pills.clear();
  steps = [];
  $('tape').replaceChildren();
  $('step-note').textContent = 'Rett mønsteret for å se automaten.';
  for (const id of ['step-back', 'step-forward', 'step-play', 'position']) $(id).disabled = true;
}

function renderMatches(text, matches) {
  const shown = text.slice(0, SHOWN_MAX);
  const parts = [];
  let at = 0;
  for (const m of matches) {
    if (m.start >= shown.length) break;
    if (m.start > at) parts.push(shown.slice(at, m.start));
    parts.push(el('mark', { text: shown.slice(m.start, m.end) }));
    at = m.end;
  }
  if (at < shown.length) parts.push(shown.slice(at));
  if (text.length > SHOWN_MAX) parts.push(el('span', { class: 'more', text: `\n... og ${(text.length - SHOWN_MAX).toLocaleString('nb-NO')} tegn til` }));
  $('matches').replaceChildren(...parts);
}

/* ====================== Diagram ====================== */
// Automaten tegnes som et jernbanediagram. Hver node måler seg selv
// ({ w, up, down }) og kan tegne seg på et gitt sted.
const CHAR_W = 7.6, HALF = 14, GAP = 14, VGAP = 10, BRANCH = 22, ARC = 15, PAD = 16;
const ASSERT_LABEL = { '^': 'start', '$': 'slutt', '\\b': 'ordgrense', '\\B': 'ikke ordgrense' };
const track = (d, extra = {}) => svg('path', { class: 'track', d, ...extra });
const visible = (label) => {
  const text = label.replace(/ /g, '␣');
  return text.length > 16 ? `${text.slice(0, 15)}...` : text;
};

function box(node) {
  switch (node.type) {
    case 'char': {
      const label = visible(node.label);
      const w = Math.max(28, label.length * CHAR_W + 16);
      return {
        w, up: HALF, down: HALF,
        draw(x, y, g) {
          const text = svg('text', { class: 'pill-text', x: x + w / 2, y: y + 4.5 });
          text.textContent = label;
          const group = svg('g', { class: 'leaf' }, svg('rect', { class: 'pill', x, y: y - HALF, width: w, height: HALF * 2, rx: 7 }), text);
          pills.set(node.id, group);
          g.append(group);
        },
      };
    }
    case 'assert': {
      const label = ASSERT_LABEL[node.label] ?? node.label;
      const w = label.length * 6.6 + 16;
      return {
        w, up: HALF, down: HALF,
        draw(x, y, g) {
          const text = svg('text', { class: 'assert-text', x: x + w / 2, y: y + 4 });
          text.textContent = label;
          g.append(svg('rect', { class: 'assert', x, y: y - 11, width: w, height: 22, rx: 11 }), text);
        },
      };
    }
    case 'group': return box(node.node);
    case 'cat': {
      const boxes = node.items.map(box);
      if (!boxes.length) return { w: 14, up: 6, down: 6, draw(x, y, g) { g.append(track(`M${x} ${y} H${x + 14}`)); } };
      return {
        w: boxes.reduce((sum, b) => sum + b.w, 0) + GAP * (boxes.length - 1),
        up: Math.max(...boxes.map((b) => b.up)),
        down: Math.max(...boxes.map((b) => b.down)),
        draw(x, y, g) {
          let at = x;
          boxes.forEach((b, k) => {
            if (k) { g.append(track(`M${at} ${y} H${at + GAP}`)); at += GAP; }
            b.draw(at, y, g);
            at += b.w;
          });
        },
      };
    }
    case 'alt': {
      const boxes = node.options.map(box);
      const inner = Math.max(...boxes.map((b) => b.w));
      const offsets = [0];
      for (let k = 1; k < boxes.length; k++) offsets.push(offsets[k - 1] + boxes[k - 1].down + VGAP + boxes[k].up);
      const w = inner + BRANCH * 2;
      return {
        w, up: boxes[0].up, down: offsets.at(-1) + boxes.at(-1).down,
        draw(x, y, g) {
          boxes.forEach((b, k) => {
            const yk = y + offsets[k], left = x + BRANCH, right = x + BRANCH + inner;
            g.append(track(k ? `M${x} ${y} C${x + BRANCH * 0.7} ${y} ${x + BRANCH * 0.3} ${yk} ${left} ${yk}` : `M${x} ${y} H${left}`));
            b.draw(left, yk, g);
            if (b.w < inner) g.append(track(`M${left + b.w} ${yk} H${right}`));
            g.append(track(k ? `M${right} ${yk} C${right + BRANCH * 0.7} ${yk} ${right + BRANCH * 0.3} ${y} ${x + w} ${y}` : `M${right} ${y} H${x + w}`));
          });
        },
      };
    }
    case 'repeat': {
      const inner = box(node.node);
      const loops = node.max > 1, skips = node.min === 0, counted = node.label.startsWith('{');
      const w = inner.w + PAD * 2;
      return {
        w,
        up: inner.up + (loops ? ARC : 0) + (counted ? 13 : 0),
        down: inner.down + (skips ? ARC : 0),
        draw(x, y, g) {
          const a = x + PAD / 2, b = x + w - PAD / 2, r = 7;
          g.append(track(`M${x} ${y} H${x + PAD}`), track(`M${x + PAD + inner.w} ${y} H${x + w}`));
          inner.draw(x + PAD, y, g);
          const top = y - inner.up - (loops ? ARC - 5 : 0);
          if (loops) {
            // Tilbake til starten: tegnet kan leses en gang til.
            g.append(track(`M${b} ${y} V${top + r} Q${b} ${top} ${b - r} ${top} H${a + r} Q${a} ${top} ${a} ${top + r} V${y - 2}`, { 'marker-end': 'url(#arrow)' }));
          }
          if (counted) {
            const label = svg('text', { class: 'count', x: (a + b) / 2, y: top - 4 });
            label.textContent = node.label.replace(/\?$/, '');
            g.append(label);
          }
          if (skips) {
            // Forbi: hele leddet kan hoppes over.
            const bottom = y + inner.down + ARC - 5;
            g.append(track(`M${a} ${y} V${bottom - r} Q${a} ${bottom} ${a + r} ${bottom} H${b - r} Q${b} ${bottom} ${b} ${bottom - r} V${y + 2}`, { 'marker-end': 'url(#arrow)' }));
          }
        },
      };
    }
    default: throw new Error(`Ukjent node: ${node.type}`);
  }
}

function drawDiagram() {
  pills.clear();
  const body = box(regex.ast);
  const lead = 24, margin = 14;
  const width = Math.ceil(margin * 2 + 12 + lead + body.w + lead + 16);
  const height = Math.ceil(body.up + body.down + 20);
  const y = 10 + body.up, x = margin + 12 + lead;
  const g = svg('g');
  g.append(track(`M${margin + 12} ${y} H${x}`));
  body.draw(x, y, g);
  g.append(track(`M${x + body.w} ${y} H${x + body.w + lead}`));
  endMarker = svg('g', { class: 'end' },
    svg('circle', { class: 'end-ring', cx: x + body.w + lead + 8, cy: y, r: 8 }),
    svg('circle', { class: 'end-dot', cx: x + body.w + lead + 8, cy: y, r: 4 }));
  g.append(svg('circle', { class: 'start-dot', cx: margin + 6, cy: y, r: 6 }), endMarker);

  const diagram = $('diagram');
  diagram.setAttribute('viewBox', `0 0 ${width} ${height}`);
  diagram.setAttribute('width', width);
  diagram.setAttribute('height', height);
  diagram.replaceChildren(
    svg('defs', {}, svg('marker', { id: 'arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto' },
      svg('path', { class: 'arrow-head', d: 'M0 0 L8 4 L0 8 Z' }))),
    g,
  );
}

/* ====================== Steg for steg ====================== */
const glyph = (c) => (c === ' ' ? '␣' : c === '\n' ? '↵' : c === '\t' ? '⇥' : c);

function renderStep() {
  const enabled = Boolean(regex);
  $('step-back').disabled = !enabled || position === 0;
  $('step-forward').disabled = !enabled || position >= tapeText.length;
  $('step-play').disabled = !enabled || !tapeText.length;
  $('position').disabled = !enabled || !tapeText.length;
  if (!enabled) return;
  $('position').value = position;

  const step = steps[position];
  const active = new Set(step.leaves);
  for (const [id, group] of pills) group.classList.toggle('active', active.has(id));
  endMarker.classList.toggle('matched', step.matched);

  fill($('tape'), [...tapeText].map((c, i) =>
    el('span', { class: i < position ? 'read' : i === position ? 'next' : '', text: glyph(c) })),
  position === tapeText.length && el('span', { class: 'next end-of-text', text: 'slutt' }));
  // Hold neste tegn synlig ved å rulle selve stripen (ikke siden).
  const wrap = $('tape').parentElement, next = $('tape').querySelector('.next');
  if (next.offsetLeft < wrap.scrollLeft + 24) wrap.scrollLeft = next.offsetLeft - 24;
  else if (next.offsetLeft + next.offsetWidth > wrap.scrollLeft + wrap.clientWidth - 24) wrap.scrollLeft = next.offsetLeft + next.offsetWidth - wrap.clientWidth + 24;

  const places = step.threads === 1 ? 'ett sted' : `${step.threads} steder samtidig`;
  const hit = step.matched ? ' Sluttsirkelen lyser: et treff slutter akkurat her.' : '';
  const truncated = $('text').value.length > TAPE_MAX ? ` (Gjennomgangen viser de første ${TAPE_MAX} tegnene.)` : '';
  $('step-note').textContent = position < tapeText.length
    ? `${position} tegn lest. Automaten kan være ${places}, og venter på "${glyph(tapeText[position])}".${hit}${truncated}`
    : `Hele teksten er lest.${hit || (tapeText.length ? ' Ingen treff slutter her.' : ' Skriv inn en tekst for å følge automaten.')}${truncated}`;
}

function stopPlaying() {
  clearInterval(playTimer);
  playTimer = 0;
  $('step-play').textContent = 'Spill av';
}

function move(to) {
  position = Math.max(0, Math.min(tapeText.length, to));
  renderStep();
}

$('step-back').addEventListener('click', () => { stopPlaying(); move(position - 1); });
$('step-forward').addEventListener('click', () => { stopPlaying(); move(position + 1); });
$('position').addEventListener('input', (e) => { stopPlaying(); move(Number(e.target.value)); });
$('step-play').addEventListener('click', () => {
  if (playTimer) { stopPlaying(); return; }
  if (position >= tapeText.length) move(0);
  $('step-play').textContent = 'Pause';
  playTimer = setInterval(() => {
    move(position + 1);
    if (position >= tapeText.length) stopPlaying();
  }, 420);
});

/* ====================== Eksempler ====================== */
function renderPresets() {
  const pattern = $('pattern').value, text = $('text').value;
  $('presets').replaceChildren(...PRESETS.map((preset) =>
    el('button', {
      class: 'chip', type: 'button', text: preset.name,
      'aria-pressed': String(preset.pattern === pattern && preset.text === text),
      onclick: () => { $('pattern').value = preset.pattern; $('text').value = preset.text; position = 0; update(); },
    })));
}

/* ====================== Kappløp ====================== */
let racing = false;
let abortNative = null;
let worker = null;
let requestId = 0;
let points = [];   // { n, mine, native } der native er null når kjøringen ble avbrutt

/** Kjører nettleserens RegExp i en egen tråd. Gir { ms }, { timeout: true } eller { failed: true }. */
function runNative(pattern, text) {
  return new Promise((resolve) => {
    try {
      worker ??= new Worker(new URL('./worker.js', import.meta.url));
    } catch {
      resolve({ failed: true });
      return;
    }
    const id = ++requestId;
    const finish = (result) => {
      clearTimeout(timer);
      abortNative = null;
      if (!result.ms) { worker?.terminate(); worker = null; } // en tråd som henger kan bare stoppes slik
      resolve(result);
    };
    const timer = setTimeout(() => finish({ timeout: true }), NATIVE_TIMEOUT);
    abortNative = () => finish({ aborted: true });
    worker.onmessage = ({ data }) => { if (data.id === id) finish({ ms: Math.max(data.ms, 1e-6) }); };
    worker.onerror = () => finish({ failed: true });
    worker.postMessage({ id, pattern, text });
  });
}

const evil = () => EVIL[Number(document.querySelector('input[name="evil"]:checked').value)];

async function race() {
  if (racing) { racing = false; abortNative?.(); return; }
  racing = true;
  $('race').textContent = 'Stopp';
  points = [];
  drawChart();
  const { pattern, make } = evil();
  const mine = new Regex(pattern);
  let outcome = 'done';

  for (let n = 10; n <= 48 && racing; n++) {
    $('race-note').textContent = `Måler ${n} tegn...`;
    const text = make(n);
    const mineMs = timeIt(() => mine.test(text));
    const native = await runNative(pattern, text);
    if (native.aborted) { outcome = 'stopped'; break; }
    if (native.failed) { outcome = 'failed'; break; }
    points.push({ n, mine: mineMs, native: native.timeout ? null : native.ms });
    drawChart();
    if (native.timeout) { outcome = 'timeout'; break; }
  }

  racing = false;
  $('race').textContent = 'Start målingen på nytt';
  const last = points.at(-1);
  if (outcome === 'failed' || !last) {
    $('race-note').textContent = outcome === 'failed' ? 'Klarte ikke å starte en egen tråd for nettleserens motor.' : 'Målingen ble stoppet.';
    return;
  }
  const long = make(100_000);
  const longMs = timeIt(() => mine.test(long));
  const measured = points.findLast((p) => p.native != null);
  const note = [];
  if (outcome === 'timeout') {
    note.push(el('strong', { text: `Ved ${last.n} tegn ga nettleserens motor opp: den ble avbrutt etter ${fmtTime(NATIVE_TIMEOUT)}. ` }),
      `Denne motoren brukte ${fmtTime(last.mine)} på den samme teksten. `);
  } else if (measured) {
    note.push(el('strong', { text: `Ved ${measured.n} tegn brukte nettleserens motor ${fmtTime(measured.native)}, og denne ${fmtTime(measured.mine)}. ` }));
  }
  note.push(`Hvert ekstra tegn dobler omtrent tiden for tilbakesporingen, mens automaten bare leser ett tegn til. På 100\u00a0000 tegn bruker den ${fmtTime(longMs)}.`);
  $('race-note').replaceChildren(...note);
}

/* Diagrammet tegnes i faktiske piksler, så teksten er like stor på mobil som på stor skjerm. */
function drawChart() {
  const chart = $('chart');
  const width = Math.max(300, Math.round(chart.parentElement.clientWidth - 2)), height = 300;
  const m = { left: 58, right: 16, top: 14, bottom: 40 };
  const innerW = width - m.left - m.right, innerH = height - m.top - m.bottom;
  const nMin = 10, nMax = Math.max(30, (points.at(-1)?.n ?? 0) + 1);
  const LOW = -4, HIGH = 4; // fra 0,0001 ms til 10 000 ms (10 s), som tierpotenser
  const x = (n) => m.left + ((n - nMin) / (nMax - nMin)) * innerW;
  const y = (ms) => m.top + innerH * (1 - (Math.min(HIGH, Math.max(LOW, Math.log10(ms))) - LOW) / (HIGH - LOW));
  const text = (cls, tx, ty, content, anchor = 'middle') => {
    const node = svg('text', { class: cls, x: tx, y: ty, 'text-anchor': anchor });
    node.textContent = content;
    return node;
  };

  chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  chart.setAttribute('width', width);
  chart.setAttribute('height', height);
  const nodes = [];
  for (let e = LOW; e <= HIGH; e++) {
    const ty = y(10 ** e);
    nodes.push(svg('line', { class: 'c-grid', x1: m.left, x2: width - m.right, y1: ty, y2: ty }));
    if (e % 2 === 0 || width > 520) nodes.push(text('c-label', m.left - 8, ty + 4, fmtTime(10 ** e), 'end'));
  }
  for (let n = nMin; n <= nMax; n += width > 520 ? 2 : 5) nodes.push(text('c-label', x(n), height - m.bottom + 16, String(n)));
  nodes.push(text('c-label', m.left + innerW / 2, height - 6, 'antall tegn i teksten'));

  const limitY = y(NATIVE_TIMEOUT);
  nodes.push(svg('line', { class: 'c-limit', x1: m.left, x2: width - m.right, y1: limitY, y2: limitY }),
    text('c-label', width - m.right - 4, limitY - 5, `avbrytes etter ${fmtTime(NATIVE_TIMEOUT)}`, 'end'));

  const series = (key, cls) => {
    const measured = points.filter((p) => p[key] != null);
    if (measured.length > 1) nodes.push(svg('path', { class: `c-line ${cls}`, d: measured.map((p, i) => `${i ? 'L' : 'M'}${x(p.n).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ') }));
    for (const p of measured) nodes.push(svg('circle', { class: `c-dot ${cls}`, cx: x(p.n), cy: y(p[key]), r: 3.5 }));
  };
  series('mine', 'mine');
  series('native', 'native');
  const gaveUp = points.find((p) => p.native == null);
  if (gaveUp) nodes.push(svg('circle', { class: 'c-timeout', cx: x(gaveUp.n), cy: limitY, r: 6 }));
  chart.replaceChildren(...nodes);
}

$('evil').replaceChildren(...EVIL.map((item, i) =>
  el('label', {}, el('input', { type: 'radio', name: 'evil', value: String(i), checked: i === 0 }), el('span', { text: item.pattern }))));
const describeEvil = () => {
  const { pattern, shape } = evil();
  $('race-input').textContent = `/${pattern}/ mot teksten "${shape}", med stadig flere a-er.`;
};
$('evil').addEventListener('change', () => {
  if (racing) { racing = false; abortNative?.(); }
  points = [];
  drawChart();
  describeEvil();
  $('race-note').textContent = 'Trykk "Start målingen". Den tar rundt ti sekunder.';
  $('race').textContent = 'Start målingen';
});
$('race').addEventListener('click', race);
// Tegn på nytt bare når bredden endrer seg, og vent til neste bilde.
// Ellers kan tegningen endre størrelsen på boksen og sette i gang en ny runde.
let chartWidth = 0;
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (width === chartWidth) return;
  chartWidth = width;
  requestAnimationFrame(drawChart);
}).observe($('chart').parentElement);

/* ====================== Oppstart ====================== */
$('pattern').addEventListener('input', update);
$('text').addEventListener('input', update);

const saved = store.get(SAVE_KEY, null);
const initial = saved && typeof saved.pattern === 'string' && typeof saved.text === 'string' ? saved : PRESETS[0];
$('pattern').value = initial.pattern;
$('text').value = initial.text;
describeEvil();
update();
