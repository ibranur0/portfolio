import { el, store } from '../../assets/js/ui.js';
import { site } from '../../assets/js/site.config.js';

const PRICE_API = 'https://www.hvakosterstrommen.no/api/v1/prices';
// Adressen til API-et, som regner ut den samme planen i Java. Tom adresse betyr at bare Python brukes.
const PLAN_API = (site.stromsmartApi || '').replace(/\/$/, '');
const SETTINGS_KEY = 'stromsmart:valg';
const NS = 'http://www.w3.org/2000/svg';

const PRESETS = [
  { id: 'elbil', name: 'Elbil', note: '30 kWh · 7,4 kW', mode: 'flexible', kwh: 30, kw: 7.4, hours: 4, deadline: '07:00' },
  { id: 'oppvask', name: 'Oppvaskmaskin', note: '1,2 kWh · 2,5 t', mode: 'window', kwh: 1.2, kw: 0.5, hours: 2.5, deadline: '07:00' },
  { id: 'vask', name: 'Vaskemaskin', note: '0,9 kWh · 2 t', mode: 'window', kwh: 0.9, kw: 0.5, hours: 2, deadline: '' },
  { id: 'varmtvann', name: 'Varmtvann', note: '6 kWh · 2 kW', mode: 'flexible', kwh: 6, kw: 2, hours: 3, deadline: '' },
];

const $ = (id) => document.getElementById(id);
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const kr = (v) => `${v.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
const ore = (v) => `${Math.round(v * 100).toLocaleString('nb-NO')} øre`;
const clock = (iso) => iso.slice(11, 16);
/** Midnatt skrives som 24:00 når det er slutten på et tidsrom. */
const endClock = (iso) => (clock(iso) === '00:00' ? '24:00' : clock(iso));

let prices = null;      // rådata fra API-et (i dag + eventuelt i morgen)
let analyze = null;     // kaller Python-funksjonen i py-worker.js, når Pyodide er klar
let lastResult = null;
let activePreset = 'elbil';
let pythonFailed = '';  // feilmeldingen hvis Pyodide ikke kunne startes
let pythonWaiting = false; // "Spar data" er på, og Python lastes først ned når brukeren ber om det
let apiAnswered = false;   // API-et har gitt en plan, så siden klarer seg til Python er klar
let apiNote = '';          // " på 0,4 s. ", tiden API-et brukte på den første planen
let pythonNote = '';       // "Python 3.12 startet i nettleseren på 3,1 s. "

/* ====================== Python ====================== */
/**
 * Python kjører i py-worker.js så siden ikke låser seg mens Pyodide starter.
 * Når den er klar, blir analyze en funksjon som sender JSON dit og får svaret tilbake.
 */
// Kildekoden vises på siden også når Python ikke er startet.
const pythonSource = fetch('stromsmart.py').then((response) => response.text());
pythonSource.then((source) => { $('source').textContent = source; }, () => { $('source').textContent = 'Klarte ikke å hente stromsmart.py.'; });

async function loadPython() {
  const source = await pythonSource;
  const worker = new Worker(new URL('./py-worker.js', import.meta.url), { type: 'module' });
  const waiting = new Map();
  let next = 0;
  const ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') resolve(data);
      else if (data.type === 'failed') reject(new Error(data.message));
      else if (data.type === 'result') { waiting.get(data.id)?.(data.json); waiting.delete(data.id); }
    };
    worker.onerror = (event) => { event.preventDefault(); reject(new Error('Python-tråden stoppet uventet')); };
  });
  worker.postMessage({ type: 'start', source });
  const { version, seconds } = await ready;
  analyze = (request) => new Promise((resolve) => {
    const id = ++next;
    waiting.set(id, resolve);
    worker.postMessage({ type: 'analyze', id, request });
  });
  pythonNote = `Python ${version} startet i nettleseren på ${seconds.toFixed(1).replace('.', ',')} s. `;
  showRuntime();
}

/** Linjen nederst på siden som sier hvor planen ble regnet ut. */
function showRuntime() {
  const parts = [];
  if (apiNote) parts.push('Første plan kom fra ', el('a', { href: `${PLAN_API}/swagger-ui.html`, target: '_blank', rel: 'noopener noreferrer', text: 'API-et' }), apiNote);
  parts.push(pythonNote);
  $('runtime').replaceChildren(...parts);
}

/* ====================== API ====================== */
/**
 * Python bruker noen sekunder på å starte. API-et regner ut den samme planen og
 * svarer som regel først, så vi viser den. Når Python er klar, regnes alt i nettleseren.
 * Svarer ikke API-et, kommer planen fra Python.
 */
async function apiPlan(task) {
  const response = await fetch(`${PLAN_API}/api/v1/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      area: prices.area,
      includeVat: $('vat').checked,
      mode: task.mode.toUpperCase(),
      kwh: task.kwh,
      ...(task.mode === 'flexible' ? { kw: task.kw } : { hours: task.hours }),
      deadline: task.deadline,
    }),
    signal: AbortSignal.timeout?.(8_000),
  });
  const body = await response.json();
  // Feil kommer som Problem Details med en norsk forklaring i "detail".
  if (!response.ok) throw Object.assign(new Error(`API-et svarte med ${response.status}`), { detail: response.status === 422 ? body.detail : null });
  return { mode: task.mode, blocks: body.blocks, cost: body.cost, avg_price: body.averagePrice, baseline_cost: body.baselineCost, saving: body.saving };
}

async function planFromApi(task, run) {
  const started = performance.now();
  let plan;
  try {
    plan = await apiPlan(task);
  } catch (error) {
    if (run !== computing || analyze) return;
    if (error.detail) {
      lastResult = { ...preview(), plan: null, area: prices.area };
      setWaiting(error.detail, true);
      render();
    } else if (apiAnswered) {
      apiAnswered = false; // API-et har sluttet å svare. Da gjelder meldingene om Python igjen.
      compute();
    }
    return;
  }
  if (run !== computing || analyze) return; // en nyere utregning er i gang, eller Python har tatt over
  if (!apiAnswered && !pythonNote) {
    const ms = performance.now() - started;
    apiNote = ms < 1000 ? ` på ${Math.max(1, Math.round(ms))} ms. ` : ` på ${(ms / 1000).toFixed(1).replace('.', ',')} s. `;
    showRuntime();
  }
  apiAnswered = true;
  lastResult = { ...preview(), plan, area: prices.area };
  setState('');
  store.set(SETTINGS_KEY, { area: prices.area, vat: $('vat').checked, preset: activePreset });
  render();
}

/* ====================== Priser ====================== */
/** Dato i Oslo-tid som { year, month, day }, uavhengig av brukerens tidssone. */
function osloDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + offsetDays * 86_400_000));
  const get = (type) => parts.find((p) => p.type === type).value;
  return { year: get('year'), month: get('month'), day: get('day') };
}

async function fetchDay(area, offsetDays) {
  const { year, month, day } = osloDate(offsetDays);
  const key = `stromsmart:${year}-${month}-${day}:${area}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key));
    if (cached) return cached;
  } catch { /* ignorer */ }
  const response = await fetch(`${PRICE_API}/${year}/${month}-${day}_${area}.json`, { signal: AbortSignal.timeout?.(12_000) });
  if (response.status === 404) return []; // morgendagens priser er ikke publisert ennå
  if (!response.ok) throw new Error(`Pristjenesten svarte med ${response.status}`);
  const data = await response.json();
  try { sessionStorage.setItem(key, JSON.stringify(data)); } catch { /* ignorer */ }
  return data;
}

const osloHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));

async function loadPrices() {
  const area = $('area').value;
  setState('');
  setWaiting('Henter priser...');
  try {
    // Morgendagens priser publiseres rundt kl. 13 norsk tid. Før det er det ingenting å hente.
    const [today, tomorrow] = await Promise.all([fetchDay(area, 0), osloHour() >= 13 ? fetchDay(area, 1).catch(() => []) : []]);
    if (area !== $('area').value) return; // brukeren byttet område mens vi ventet
    if (!today.length) throw new Error('Fant ingen priser for i dag');
    prices = { area, rows: [...today, ...tomorrow], hasTomorrow: tomorrow.length > 0 };
    compute();
  } catch (error) {
    prices = null;
    // fetch() gir TypeError når tjenesten ikke svarer og TimeoutError når den er for treg.
    // Feilteksten er på engelsk, så vi skriver vår egen.
    const reason = error.name === 'TypeError' || error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'hvakosterstrommen.no svarer ikke akkurat nå'
      : error.message;
    setState(navigator.onLine ? `Klarte ikke å hente priser: ${reason}.` : 'Du ser ut til å være frakoblet.', true, loadPrices);
    setWaiting('Planen kommer når prisene er hentet.');
  }
}

/* ====================== Beregning ====================== */
function readTask() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const task = { mode, kwh: Number($('kwh').value), kw: Number($('kw').value), hours: Number($('hours').value), deadline: null };
  if ($('use-deadline').checked && $('deadline').value) {
    // Neste gang klokken er dette i Oslo. Tidssoneforskyvningen leses fra prisdataene.
    const first = prices.rows[0].time_start;
    let deadline = new Date(`${first.slice(0, 10)}T${$('deadline').value}:00${first.slice(-6)}`);
    if (deadline <= Date.now()) deadline = new Date(deadline.getTime() + 86_400_000);
    task.deadline = deadline.toISOString();
  }
  return task;
}

let computing = 0; // øker for hver utregning, så et sent svar ikke overskriver et nyere

async function compute() {
  if (!prices) {
    $('chart-title').textContent = chartTitle($('area').value, osloHour() >= 13);
    return;
  }
  const task = readTask();
  const valid = task.kwh > 0 && (task.mode === 'flexible' ? task.kw > 0 : task.hours > 0);
  const run = ++computing;
  if (!analyze) {
    // Python er ikke klar ennå. Vis prisene, og ta planen fra API-et hvis det svarer.
    // Har API-et svart før, blir forrige plan stående til den nye kommer.
    const previous = apiAnswered && valid && lastResult?.area === prices.area ? lastResult.plan : null;
    lastResult = { ...preview(), plan: previous, area: prices.area };
    if (apiAnswered) {
      if (!valid) setWaiting('Fyll inn forbruk og effekt eller varighet.', true);
    } else if (pythonFailed) {
      // Prisene kan komme etter at Python har feilet. Da skal feilen stå, ikke "Python starter".
      setState(pythonFailed, true, () => location.reload());
      setWaiting('Planen kan ikke regnes ut uten Python.');
    } else if (pythonWaiting) {
      setState('Planen regnes ut med Python, som må lastes ned først (ca. 6 MB).', false, startPython, 'Last ned');
      setWaiting('Prisene er hentet. Planen kommer når Python er lastet ned.');
    } else {
      setState('');
      setWaiting('Python lastes ned og starter (ca. 6 MB første gang). Planen kommer om et øyeblikk...');
    }
    render();
    if (PLAN_API && valid) planFromApi(task, run);
    return;
  }
  if (!valid) {
    setWaiting('Fyll inn forbruk og effekt eller varighet.', true);
    return;
  }
  const request = { prices: prices.rows, area: prices.area, include_vat: $('vat').checked, now: new Date().toISOString(), task };
  const result = JSON.parse(await analyze(JSON.stringify(request)));
  if (run !== computing) return;
  if (result.error) {
    // Uten plan viser vi fortsatt prisene.
    const fallback = JSON.parse(await analyze(JSON.stringify({ ...request, task: null })));
    if (run !== computing) return;
    lastResult = { ...fallback, plan: null };
    setWaiting(result.error, true);
  } else {
    lastResult = result;
  }
  setState('');
  store.set(SETTINGS_KEY, { area: prices.area, vat: $('vat').checked, preset: activePreset });
  render();
}

/** Forhåndsvisning av prisene mens Python starter. Erstattes av Pythons svar. */
function preview() {
  const factor = $('vat').checked && prices.area !== 'NO4' ? 1.25 : 1;
  const intervals = prices.rows.map((row) => ({ start: row.time_start, end: row.time_end, price: row.NOK_per_kWh * factor }));
  const values = intervals.map((i) => i.price);
  return { intervals, plan: null, summary: { min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length } };
}

/* ====================== Visning ====================== */
/**
 * Svarboksen står der hele tiden, så siden ikke hopper når svaret kommer.
 * Før planen er klar, står det hva vi venter på.
 */
function setWaiting(text, error = false) {
  $('answer').classList.add('waiting');
  $('answer').classList.toggle('error', error);
  $('answer-label').textContent = 'Billigste tidspunkt';
  $('answer-main').textContent = '...';
  $('answer-sub').replaceChildren(text);
}

const chartTitle = (area, hasTomorrow) =>
  `Spotpris i ${area}, øre/kWh ${$('vat').checked && area !== 'NO4' ? 'med' : 'uten'} mva${hasTomorrow ? '' : ' (morgendagens priser kommer rundt kl. 13)'}`;

function setState(text, error = false, action = null, label = 'Prøv igjen') {
  const state = $('state');
  state.hidden = !text;
  state.classList.toggle('error', error);
  state.replaceChildren(text);
  if (action) state.append(' ', el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: label, onclick: action }));
}

function dayWord(iso) {
  const { year, month, day } = osloDate(0);
  return iso.slice(0, 10) === `${year}-${month}-${day}` ? 'i dag' : 'i morgen';
}

/** Dagen et tidsrom slutter. Slutter det ved midnatt (24:00), er det dagen før som menes. */
function endDayWord(iso) {
  if (clock(iso) !== '00:00') return dayWord(iso);
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return dayWord(new Date(Date.UTC(year, month - 1, day - 1)).toISOString());
}

function renderAnswer() {
  const { plan } = lastResult;
  if (!plan) return; // setWaiting() har allerede sagt hvorfor
  $('answer').classList.remove('waiting', 'error');
  const blocks = plan.blocks;
  const first = blocks[0], last = blocks.at(-1);
  const startsNow = new Date(first.start) - Date.now() < 60_000;

  if (plan.mode === 'window') {
    $('answer-label').textContent = 'Billigste starttidspunkt';
    $('answer-main').textContent = startsNow ? 'Start nå' : `Start kl. ${clock(first.start)} ${dayWord(first.start)}`;
  } else {
    $('answer-label').textContent = blocks.length > 1 ? `Billigst i ${blocks.length} bolker` : 'Billigste tidsrom';
    $('answer-main').textContent = blocks.map((b) => `${clock(b.start)}-${endClock(b.end)}`).join(' og ').replace(/ og (?=.* og )/g, ', ');
  }

  const parts = [`Ferdig kl. ${endClock(last.end)} ${endDayWord(last.end)}. Det koster omtrent `, el('strong', { text: kr(plan.cost) }), ` (${ore(plan.avg_price)} per kWh i snitt).`];
  if (plan.saving != null && plan.saving > 0.005) {
    const percent = Math.round((plan.saving / plan.baseline_cost) * 100);
    parts.push(' Starter du nå i stedet, koster det ', el('strong', { text: kr(plan.baseline_cost) }), `. Du sparer ${kr(plan.saving)}${percent ? `, eller ${percent} %` : ''}.`);
  } else if (plan.saving != null) {
    parts.push(' Det er like billig som å starte med en gang.');
  }
  $('answer-sub').replaceChildren(...parts);
}

function renderChart() {
  const host = $('chart');
  const data = lastResult.intervals;
  const blocks = (lastResult.plan?.blocks ?? []).map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()]);
  const now = Date.now();
  const width = Math.max(host.clientWidth, 300), height = 250;
  const m = { top: 22, right: 8, bottom: 26, left: 42 };
  const innerW = width - m.left - m.right, innerH = height - m.top - m.bottom;
  const t0 = new Date(data[0].start).getTime(), t1 = new Date(data.at(-1).end).getTime();
  const x = (t) => m.left + ((t - t0) / (t1 - t0)) * innerW;

  const maxOre = Math.max(...data.map((d) => d.price)) * 100;
  const minOre = Math.min(0, ...data.map((d) => d.price)) * 100;
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => (maxOre - minOre) / s <= 5) ?? 2000;
  const top = Math.ceil(maxOre / step) * step || step;
  const bottom = Math.floor(minOre / step) * step;
  const y = (v) => m.top + innerH * (1 - (v - bottom) / (top - bottom));

  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  for (let tick = bottom; tick <= top; tick += step) {
    root.append(svg('line', { class: 'c-grid', x1: m.left, x2: width - m.right, y1: y(tick), y2: y(tick) }));
    const label = svg('text', { class: 'c-label', x: m.left - 8, y: y(tick) + 4, 'text-anchor': 'end' });
    label.textContent = tick;
    root.append(label);
  }

  // Klokkeslett under aksen hver sjette time, eller hver tolvte når diagrammet er smalt.
  // Ellers havner "i morgen" og "06" oppå hverandre på mobil.
  const labelEvery = (innerW / (t1 - t0)) * 6 * 3_600_000 < 50 ? 12 : 6;
  const bars = data.map((d) => {
    const start = new Date(d.start).getTime(), end = new Date(d.end).getTime();
    const chosen = blocks.some(([bs, be]) => bs < end && be > start);
    const w = Math.max(1, x(end) - x(start) - (innerW / data.length > 6 ? 2 : 0.5));
    const value = d.price * 100;
    const yTop = Math.min(y(value), y(0)), h = Math.max(1.5, Math.abs(y(value) - y(0)));
    const r = Math.min(3, w / 2, h);
    const bar = svg('path', {
      class: `c-bar${chosen ? ' chosen' : end <= now ? ' past' : ''}`,
      d: value >= 0
        ? `M${x(start)} ${yTop + h} v${-(h - r)} q0 ${-r} ${r} ${-r} h${w - 2 * r} q${r} 0 ${r} ${r} v${h - r} Z`
        : `M${x(start)} ${yTop} h${w} v${h} h${-w} Z`,
    });
    root.append(bar);

    const hour = Number(d.start.slice(11, 13)), minute = d.start.slice(14, 16);
    if (minute === '00' && hour % labelEvery === 0) {
      if (hour === 0 && start !== t0) root.append(svg('line', { class: 'c-day', x1: x(start), x2: x(start), y1: m.top - 6, y2: m.top + innerH }));
      const label = svg('text', { class: `c-label${hour === 0 ? ' c-label-strong' : ''}`, x: x(start), y: height - 8, 'text-anchor': hour === 0 && start === t0 ? 'start' : 'middle' });
      label.textContent = hour === 0 ? dayWord(d.start) : String(hour).padStart(2, '0');
      root.append(label);
    }
    return { start, end, d };
  });

  if (now > t0 && now < t1) {
    root.append(svg('line', { class: 'c-now', x1: x(now), x2: x(now), y1: m.top - 6, y2: m.top + innerH }));
    const label = svg('text', { class: 'c-now-label', x: x(now), y: m.top - 10, 'text-anchor': x(now) > width - 40 ? 'end' : 'middle' });
    label.textContent = 'nå';
    root.append(label);
  }

  // Hover: marker intervallet under pekeren og vis pris og tidsrom.
  const hover = svg('rect', { class: 'c-hover', y: m.top, height: innerH, visibility: 'hidden' });
  root.append(hover);
  const tip = el('div', { class: 'chart-tip', hidden: true }, el('strong'), el('span'));
  const show = (clientX) => {
    const rect = root.getBoundingClientRect();
    const t = t0 + (((clientX - rect.left) / rect.width) * width - m.left) / innerW * (t1 - t0);
    const hit = bars.find((b) => t >= b.start && t < b.end);
    if (!hit) { hide(); return; }
    hover.setAttribute('x', x(hit.start)); hover.setAttribute('width', x(hit.end) - x(hit.start));
    hover.setAttribute('visibility', 'visible');
    tip.firstChild.textContent = `${ore(hit.d.price)}/kWh`;
    tip.lastChild.textContent = `${dayWord(hit.d.start)} ${clock(hit.d.start)}-${endClock(hit.d.end)}`;
    tip.hidden = false;
    const scale = rect.width / width;
    tip.style.left = `${Math.min(Math.max(((x(hit.start) + x(hit.end)) / 2) * scale, 70), rect.width - 70)}px`;
  };
  const hide = () => { hover.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  root.addEventListener('pointermove', (e) => show(e.clientX));
  root.addEventListener('pointerdown', (e) => show(e.clientX));
  root.addEventListener('pointerleave', hide);

  host.replaceChildren(root, tip);
  $('chart-title').textContent = chartTitle(prices.area, prices.hasTomorrow);
}

function render() {
  if (!lastResult) return;
  renderAnswer();
  renderChart();
  const { summary, intervals } = lastResult;
  const current = intervals.find((i) => new Date(i.start) <= Date.now() && new Date(i.end) > Date.now());
  $('s-min').textContent = ore(summary.min);
  $('s-mean').textContent = ore(summary.mean);
  $('s-max').textContent = ore(summary.max);
  $('s-now').textContent = current ? ore(current.price) : '-';
}

/* ====================== Kontroller ====================== */
function syncMode() {
  const flexible = document.querySelector('input[name="mode"]:checked').value === 'flexible';
  $('field-kw').hidden = !flexible;
  $('field-hours').hidden = flexible;
  $('deadline').disabled = !$('use-deadline').checked;
}

function applyPreset(id) {
  const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
  activePreset = preset.id;
  $('kwh').value = preset.kwh; $('kw').value = preset.kw; $('hours').value = preset.hours;
  document.querySelector(`input[name="mode"][value="${preset.mode}"]`).checked = true;
  $('use-deadline').checked = Boolean(preset.deadline);
  if (preset.deadline) $('deadline').value = preset.deadline;
  renderPresets();
  syncMode();
  compute();
}

/**
 * Knappene sier hvilket apparat det gjelder, og en av dem er alltid valgt.
 * Endrer du tallene, er det fortsatt samme apparat, og teksten under navnet
 * viser det som gjelder nå.
 */
const presetButtons = new Map();
function renderPresets() {
  if (!presetButtons.size) {
    for (const p of PRESETS) {
      const note = el('small', { text: p.note });
      presetButtons.set(p.id, { note, button: el('button', { class: 'preset', type: 'button', onclick: () => { applyPreset(p.id); showAnswer(); } }, p.name, note) });
    }
    $('presets').replaceChildren(...[...presetButtons.values()].map((entry) => entry.button));
  }
  const number = (id) => Number($(id).value).toLocaleString('nb-NO', { maximumFractionDigits: 2 });
  const flexible = document.querySelector('input[name="mode"]:checked').value === 'flexible';
  for (const p of PRESETS) {
    const { button, note } = presetButtons.get(p.id);
    const active = p.id === activePreset;
    button.setAttribute('aria-pressed', String(active));
    note.textContent = active ? `${number('kwh')} kWh · ${flexible ? `${number('kw')} kW` : `${number('hours')} t`}` : p.note;
  }
}

/** På smale skjermer ligger svaret over valgene. Da rulles det frem når et nytt apparat velges. */
function showAnswer() {
  const box = $('answer').getBoundingClientRect();
  if (box.bottom < 80 || box.top > window.innerHeight) $('answer').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

let debounce = 0;
const changed = () => {
  renderPresets();
  syncMode();
  clearTimeout(debounce);
  debounce = setTimeout(compute, 150);
};
for (const id of ['kwh', 'kw', 'hours', 'deadline']) $(id).addEventListener('input', changed);
for (const id of ['mode', 'use-deadline']) $(id).addEventListener('change', changed);
$('vat').addEventListener('change', compute);
$('area').addEventListener('change', loadPrices);

let lastWidth = 0;
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (width && width !== lastWidth && lastResult) { lastWidth = width; renderChart(); }
}).observe($('chart'));

/* ====================== Oppstart ====================== */
const saved = store.get(SETTINGS_KEY, {});
if (saved.area) $('area').value = saved.area;
if (saved.vat === false) $('vat').checked = false;
applyPreset(saved.preset || 'elbil');

function startPython() {
  pythonWaiting = false;
  compute();
  loadPython()
    .then(compute)
    .catch(() => {
      showRuntime();
      pythonFailed = 'Klarte ikke å starte Python i nettleseren, så planen kan ikke regnes ut. Sjekk nettforbindelsen, eller om en utvidelse blokkerer cdn.jsdelivr.net.';
      // Pyodide kan ikke startes på nytt i samme side, så "Prøv igjen" laster siden på nytt.
      compute(); // viser feilen der planen skulle stått
    });
}

// Tittelen settes med en gang, så den har riktig lengde før prisene kommer.
$('chart-title').textContent = chartTitle($('area').value, osloHour() >= 13);
// Serveren sover når ingen bruker den. Den vekkes nå, mens prisene hentes.
if (PLAN_API) fetch(`${PLAN_API}/actuator/health/liveness`, { mode: 'no-cors' }).catch(() => {});
loadPrices();
// Med "Spar data" på vises prisene med en gang, men Python lastes først ned når brukeren ber om det.
if (navigator.connection?.saveData) { pythonWaiting = true; showRuntime(); } else startPython();
