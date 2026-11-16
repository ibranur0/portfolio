import { Network } from './network.js';
import { datasets } from './datasets.js';
import { cssVar } from '../../assets/js/ui.js';

const SIZE = 640;           // intern oppløsning på lerretet
const HEAT = 72;            // beslutningsflaten beregnes i 72 x 72 og skaleres opp
const POINTS = 220;
const EPOCHS_PER_FRAME = 2;
const MAX_HISTORY = 400;
const NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);
const canvas = $('field');
canvas.width = canvas.height = SIZE;
const ctx = canvas.getContext('2d');
const heatCanvas = document.createElement('canvas');
heatCanvas.width = heatCanvas.height = HEAT;
const heatCtx = heatCanvas.getContext('2d');
const heatImage = heatCtx.createImageData(HEAT, HEAT);

const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const fmt = (v, digits) => v.toLocaleString('nb-NO', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/* ---------- Tilstand ---------- */
let network;
let points = [];
let epoch = 0;
let running = false;
let history = [];
let historyStride = 1;   // antall epoker mellom hvert punkt på tapskurven
let colors = {};
let links = [];
let frame = 0;
let looping = false;

const settings = () => ({
  dataset: document.querySelector('input[name="dataset"]:checked').value,
  noise: Number($('noise').value),
  layers: Number($('layers').value),
  neurons: Number($('neurons').value),
  activation: $('activation').value,
  rate: Number($('rate').value),
});

function readColors() {
  colors = { surface: hexToRgb(cssVar('--surface-2')), c0: hexToRgb(cssVar('--blue')), c1: hexToRgb(cssVar('--rose')), ring: cssVar('--surface'), line: cssVar('--line-strong') };
}

/* ---------- Oppsett ---------- */
function newNetwork() {
  const s = settings();
  network = new Network([2, ...Array(s.layers).fill(s.neurons), 1], s.activation);
  epoch = 0;
  history = [];
  historyStride = 1;
  buildDiagram();
  $('stat-params').textContent = network.parameterCount;
  $('loss-note').textContent = 'Start treningen for å se kurven.';
  render();
}

function newData() {
  const s = settings();
  points = datasets[s.dataset].generate(POINTS, s.noise);
  newNetwork();
}

/* ---------- Trening ---------- */
function trainEpoch() {
  const rate = settings().rate;
  // Fisher-Yates: ny tilfeldig rekkefølge hver epoke
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }
  let loss = 0;
  for (const p of points) loss += network.train(p.x, p.y, p.label, rate);
  epoch++;
  // Blir kurven for lang, beholder vi annenhver måling og lagrer sjeldnere fra nå av.
  if (epoch % historyStride === 0) history.push(loss / points.length);
  if (history.length > MAX_HISTORY) {
    history = history.filter((_, i) => i % 2 === 1);
    historyStride *= 2;
  }
}

function evaluate() {
  let correct = 0, loss = 0;
  for (const p of points) {
    const out = network.forward(p.x, p.y);
    if ((out >= 0.5 ? 1 : 0) === p.label) correct++;
    loss -= p.label ? Math.log(out + 1e-12) : Math.log(1 - out + 1e-12);
  }
  return { accuracy: correct / points.length, loss: loss / points.length };
}

/* ---------- Tegning ---------- */
function drawField() {
  // Beslutningsflate: nøytral ved 0,5 og gradvis mer farget jo sikrere nettverket er.
  const data = heatImage.data;
  for (let row = 0; row < HEAT; row++) {
    const y = 1 - ((row + 0.5) / HEAT) * 2;
    for (let col = 0; col < HEAT; col++) {
      const x = ((col + 0.5) / HEAT) * 2 - 1;
      const p = network.forward(x, y);
      const target = p >= 0.5 ? colors.c1 : colors.c0;
      const strength = Math.abs(p - 0.5) * 2 * 0.62;
      const k = (row * HEAT + col) * 4;
      data[k] = colors.surface[0] + (target[0] - colors.surface[0]) * strength;
      data[k + 1] = colors.surface[1] + (target[1] - colors.surface[1]) * strength;
      data[k + 2] = colors.surface[2] + (target[2] - colors.surface[2]) * strength;
      data[k + 3] = 255;
    }
  }
  heatCtx.putImageData(heatImage, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(heatCanvas, 0, 0, SIZE, SIZE);

  // Akser
  ctx.strokeStyle = colors.line; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.moveTo(SIZE / 2, 0); ctx.lineTo(SIZE / 2, SIZE); ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2); ctx.stroke();
  ctx.globalAlpha = 1;

  // Datapunkter med en ring i flatefargen, så de skiller seg fra bakgrunnen
  ctx.lineWidth = 2; ctx.strokeStyle = colors.ring;
  for (const p of points) {
    const [r, g, b] = p.label ? colors.c1 : colors.c0;
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.beginPath();
    ctx.arc(((p.x + 1) / 2) * SIZE, ((1 - p.y) / 2) * SIZE, 6, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
}

function buildDiagram() {
  const svg = $('diagram');
  svg.replaceChildren();
  links = [];
  const { sizes } = network;
  const pos = sizes.map((n, l) => {
    const x = 28 + (344 * l) / (sizes.length - 1);
    const gap = Math.min(24, 150 / n);
    return Array.from({ length: n }, (_, i) => [x, 86 + (i - (n - 1) / 2) * gap]);
  });
  const linkGroup = svgEl('g');
  for (let l = 1; l < sizes.length; l++) {
    const nIn = sizes[l - 1];
    for (let j = 0; j < sizes[l]; j++) {
      for (let i = 0; i < nIn; i++) {
        const [x1, y1] = pos[l - 1][i], [x2, y2] = pos[l][j];
        const line = svgEl('line', { x1, y1, x2, y2, class: 'link' });
        links.push({ line, layer: l, index: j * nIn + i });
        linkGroup.append(line);
      }
    }
  }
  svg.append(linkGroup);
  pos.forEach((layer, l) => layer.forEach(([cx, cy]) => {
    svg.append(svgEl('circle', { cx, cy, r: 6.5, class: l === 0 || l === sizes.length - 1 ? 'node node-io' : 'node' }));
  }));
  const label = (x, text) => { const t = svgEl('text', { x, y: 184, class: 'diagram-label' }); t.textContent = text; svg.append(t); };
  label(28, 'x, y');
  label(372, 'klasse');
  updateDiagram();
}

function updateDiagram() {
  for (const { line, layer, index } of links) {
    const weight = network.w[layer][index];
    line.setAttribute('class', `link ${weight >= 0 ? 'link-pos' : 'link-neg'}`);
    line.setAttribute('stroke-width', Math.min(5, 0.3 + Math.abs(weight) * 1.3).toFixed(2));
    line.setAttribute('stroke-opacity', Math.min(0.9, 0.15 + Math.abs(weight) * 0.4).toFixed(2));
  }
}

function drawLoss() {
  const svg = $('loss');
  svg.replaceChildren();
  const m = { left: 34, right: 8, top: 10, bottom: 22 };
  const w = 400 - m.left - m.right, h = 190 - m.top - m.bottom;
  const max = Math.max(0.7, ...history);
  for (const tick of [0, max / 2, max]) {
    const y = m.top + h * (1 - tick / max);
    svg.append(svgEl('line', { class: 'loss-grid', x1: m.left, x2: 400 - m.right, y1: y, y2: y }));
    const label = svgEl('text', { class: 'loss-label', x: m.left - 6, y: y + 3, 'text-anchor': 'end' });
    label.textContent = fmt(tick, 2);
    svg.append(label);
  }
  const axis = svgEl('text', { class: 'loss-label', x: 400 - m.right, y: 186, 'text-anchor': 'end' });
  axis.textContent = `epoke ${epoch}`;
  svg.append(axis);
  if (history.length < 2) return;
  const d = history.map((v, i) =>
    `${i ? 'L' : 'M'}${(m.left + (w * i) / (history.length - 1)).toFixed(1)} ${(m.top + h * (1 - v / max)).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', { class: 'loss-line', d }));
}

function render() {
  drawField();
  const { accuracy, loss } = evaluate();
  $('stat-epoch').textContent = epoch;
  $('stat-loss').textContent = fmt(loss, 3);
  $('stat-acc').textContent = `${fmt(accuracy * 100, 0)} %`;
  drawLoss();
  updateDiagram();
  if (epoch > 0) {
    $('loss-note').textContent = accuracy === 1
      ? 'Alle punktene klassifiseres riktig.'
      : `${Math.round((1 - accuracy) * points.length)} av ${points.length} punkter er fortsatt feil.`;
  }
}

/* ---------- Løkke ---------- */
function loop() {
  if (!running) { looping = false; return; }
  for (let i = 0; i < EPOCHS_PER_FRAME; i++) trainEpoch();
  frame++;
  // Feltet tegnes hver frame. Diagrammer og tall tegnes annenhver gang.
  if (frame % 2 === 0) render(); else drawField();
  requestAnimationFrame(loop);
}

function setRunning(next) {
  running = next;
  $('toggle').textContent = running ? 'Pause' : epoch ? 'Fortsett' : 'Tren';
  if (!running) render();
  else if (!looping) { looping = true; requestAnimationFrame(loop); }
}

/* ---------- Hendelser ---------- */
/** På smale skjermer ligger knappene under feltet. Da rulles feltet frem når treningen starter. */
function showField() {
  const box = canvas.getBoundingClientRect();
  if (box.bottom < 120 || box.top > window.innerHeight - 120) canvas.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
$('toggle').addEventListener('click', () => { setRunning(!running); if (running) showField(); });
$('step').addEventListener('click', () => { setRunning(false); trainEpoch(); setRunning(false); showField(); });
$('reset').addEventListener('click', () => { setRunning(false); newNetwork(); setRunning(false); });
$('dataset').addEventListener('change', () => { newData(); setRunning(running); });

const bindRange = (id, out, format, onChange) => {
  $(id).addEventListener('input', () => {
    $(out).textContent = format(Number($(id).value));
    onChange();
    $('toggle').textContent = running ? 'Pause' : epoch ? 'Fortsett' : 'Tren';
  });
};
bindRange('noise', 'out-noise', (v) => fmt(v, 2), newData);
bindRange('layers', 'out-layers', String, newNetwork);
bindRange('neurons', 'out-neurons', String, newNetwork);
$('activation').addEventListener('change', () => { newNetwork(); setRunning(running); });

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((e.clientY - rect.top) / rect.height) * 2;
  const label = Number(document.querySelector('input[name="brush"]:checked').value);
  points.push({ x, y, label });
  if (!running) render();
});

window.addEventListener('themechange', () => { readColors(); if (!running) render(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && running) setRunning(false); });

readColors();
newData();
