import { compile, disassemble } from './compiler.js';
import { VM, show } from './vm.js';
import { EXAMPLES } from './examples.js';
import { el, fill, store, insertText } from '../../assets/js/ui.js';

const SOURCE_KEY = 'kvist:kilde';
const TOUR_KEY = 'kvist:omvisning-ferdig';
const SLICE = 400_000;                         // instruksjoner per bolk når programmet kjøres for fullt
const PLAY_RATES = [2, 6, 20, 80, 400, 3000];  // instruksjoner per sekund ved avspilling
const MAX_OUTPUT_LINES = 2000;
const LINE_HEIGHT = 22, EDITOR_PADDING = 14;   // må stemme med --lh og --pad i style.css

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const fmt = (n) => Math.round(n).toLocaleString('nb-NO');
const clip = (text, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}...` : text);

let program = null;
let vm = null;
let mode = 'idle';   // 'idle' | 'running' | 'playing'
let timer = 0;
let outputLines = [];
let errorLine = 0;
let shownLine = 0;   // linjen markøren sist sto på
const listings = new WeakMap(); // bytekodeutskrift per funksjon, laget første gang den vises
let tourReady = false;          // omvisningen settes opp nederst i filen

/* ====================== Kompilering og kjøring ====================== */
function setStatus(content, error = false) {
  const status = $('status');
  status.classList.toggle('error', error);
  status.replaceChildren(...[content].flat());
}

function fail(error) {
  stop();
  if (!error.kind) throw error; // ikke en feil i brukerens program
  errorLine = error.line;
  const where = error.trace?.length > 1 ? ` Kallstakk: ${error.trace.join(' ← ')}.` : '';
  setStatus([el('strong', { text: `${error.kind} på linje ${error.line}: ` }), `${error.message}.${where}`], true);
  renderDebugger();
}

/** Sørger for at det finnes en maskin som ikke er ferdig. Returnerer false ved kompileringsfeil. */
function prepare() {
  if (vm && !vm.done) return true;
  reset(false);
  try {
    program = compile(editor.value);
    vm = new VM(program, (line) => {
      outputLines.push(line);
      if (outputLines.length > MAX_OUTPUT_LINES) outputLines.splice(0, outputLines.length - MAX_OUTPUT_LINES);
    });
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

function stop() {
  clearTimeout(timer);
  mode = 'idle';
  $('run').textContent = 'Kjør';
  $('play').textContent = 'Spill av';
}

function reset(announce = true) {
  stop();
  program = null; vm = null; errorLine = 0; outputLines = [];
  if (announce) setStatus('Klar. Trykk "Kjør", eller "Steg" for å følge maskinen.');
  renderDebugger();
}

function finished(started, stepsBefore) {
  stop();
  const ms = performance.now() - started;
  const steps = vm.steps - stepsBefore;
  setStatus(`Ferdig. ${fmt(vm.steps)} instruksjoner${ms > 1 ? `, ${(steps / (ms / 1000) / 1e6).toFixed(1).replace('.', ',')} millioner i sekundet` : ''}.`);
  renderDebugger();
}

/** Kjører for fullt, i bolker, slik at siden ikke fryser og programmet kan stoppes. */
function run() {
  if (mode === 'running') { stop(); setStatus(`Stoppet etter ${fmt(vm.steps)} instruksjoner.`); renderDebugger(); return; }
  stop();
  if (!prepare()) return;
  mode = 'running';
  $('run').textContent = 'Stopp';
  const started = performance.now(), stepsBefore = vm.steps;
  const slice = () => {
    try {
      if (vm.run(SLICE)) { finished(started, stepsBefore); return; }
    } catch (error) { fail(error); return; }
    renderOutput();
    setStatus(`Kjører... ${fmt(vm.steps)} instruksjoner`);
    timer = setTimeout(slice, 0);
  };
  slice();
}

function describePosition() {
  if (vm.done) { setStatus(`Ferdig. ${fmt(vm.steps)} instruksjoner.`); return; }
  setStatus(`Står på linje ${vm.line} i ${vm.frame.proto.name}. ${fmt(vm.steps)} instruksjoner utført.`);
}

function step(wholeLine) {
  stop();
  if (!prepare()) return;
  try {
    if (wholeLine) {
      // Kjør til kildelinjen eller kalldybden endrer seg.
      const line = vm.line, depth = vm.frames.length;
      let guard = 0;
      do { vm.step(); } while (!vm.done && vm.line === line && vm.frames.length === depth && ++guard < 1_000_000);
    } else vm.step();
  } catch (error) { fail(error); return; }
  describePosition();
  renderDebugger();
}

function play() {
  if (mode === 'playing') { stop(); describePosition(); return; }
  stop();
  if (!prepare()) return;
  mode = 'playing';
  $('play').textContent = 'Pause';
  let last = performance.now(), owed = 0;
  const tick = () => {
    const now = performance.now();
    owed += ((now - last) / 1000) * PLAY_RATES[Number($('speed').value) - 1];
    last = now;
    try {
      while (owed >= 1 && !vm.done) { vm.step(); owed -= 1; }
    } catch (error) { fail(error); return; }
    if (vm.done) { stop(); describePosition(); renderDebugger(); return; }
    describePosition();
    renderDebugger();
    timer = setTimeout(tick, 16);
  };
  tick();
}

/* ====================== Visning ====================== */
function renderOutput() {
  const output = $('output');
  const text = outputLines.join('\n');
  if (output.textContent !== text) {
    output.textContent = text;
    output.scrollTop = output.scrollHeight;
  }
}

function renderGutter() {
  const count = editor.value.split('\n').length;
  const gutter = $('gutter');
  if (gutter.childElementCount !== count) {
    gutter.replaceChildren(...Array.from({ length: count }, (_, i) => el('span', { text: String(i + 1) })));
  }
  const active = errorLine || (vm && !vm.done && vm.steps > 0 ? vm.line : 0);
  [...gutter.children].forEach((span, i) => { span.className = i + 1 === active ? (errorLine ? 'failed' : 'active') : ''; });
  // Editoren følger etter når maskinen går til en linje utenfor skjermen.
  // Bare når linjen endrer seg, ellers krangler det med brukerens egen rulling.
  if (active && active !== shownLine) {
    const top = (active - 1) * LINE_HEIGHT;
    if (top < editor.scrollTop || top + LINE_HEIGHT * 2 > editor.scrollTop + editor.clientHeight) {
      editor.scrollTop = Math.max(0, top - editor.clientHeight / 2);
    }
  }
  shownLine = active;
  gutter.scrollTop = editor.scrollTop;

  const marker = $('marker');
  marker.hidden = !active;
  marker.classList.toggle('failed', Boolean(errorLine));
  if (active) marker.style.top = `${EDITOR_PADDING + (active - 1) * LINE_HEIGHT - editor.scrollTop}px`;
  return active;
}

function listing(proto) {
  if (!listings.has(proto)) {
    listings.set(proto, disassemble(proto, program.protos).map((row) =>
      el('li', { dataset: { line: row.line } },
        el('span', { class: 'addr', text: String(row.index).padStart(4, '0') }),
        el('span', { text: row.op }),
        el('span', { class: 'arg', title: row.operand, text: row.operand }),
        el('span', { class: 'src', text: `l.${row.line}` }),
      )));
  }
  return listings.get(proto);
}

function renderDebugger() {
  renderOutput();
  const active = renderGutter();
  const bytecode = $('bytecode');

  if (!vm || !program) {
    $('bytecode-title').textContent = 'Bytekode';
    bytecode.replaceChildren(el('li', { class: 'hint', text: 'Vises når programmet er kompilert.' }));
    $('stack').replaceChildren(el('span', { class: 'hint', text: 'tom' }));
    $('frames').replaceChildren(el('span', { class: 'hint', text: 'Ingen kall ennå.' }));
    checkTour();
    return;
  }

  // Bytekoden til funksjonen som kjører nå, med neste instruksjon markert.
  const frame = vm.frame ?? { proto: program.main, ip: -1 };
  const rows = listing(frame.proto);
  if (bytecode.firstChild !== rows[0]) bytecode.replaceChildren(...rows);
  $('bytecode-title').textContent = `Bytekode: ${frame.proto.name} (${rows.length} instruksjoner)`;
  rows.forEach((row, i) => {
    row.className = i === frame.ip && !vm.done ? 'current' : active && Number(row.dataset.line) === active ? 'same-line' : '';
  });
  const current = rows[frame.ip];
  if (current && !vm.done) {
    // Hold den aktive instruksjonen synlig uten å rulle hele siden.
    const top = current.offsetTop - bytecode.offsetTop;
    if (top < bytecode.scrollTop || top > bytecode.scrollTop + bytecode.clientHeight - 24) bytecode.scrollTop = top - bytecode.clientHeight / 2;
  }

  const shown = vm.stack.slice(-24);
  $('stack').replaceChildren(...(shown.length
    ? [vm.stack.length > shown.length ? el('span', { class: 'top', text: `+${vm.stack.length - shown.length}` }) : '',
      ...shown.map((value) => el('span', { class: 'slot', text: clip(show(value, true), 40) })),
      el('span', { class: 'top', text: '← topp' })]
    : [el('span', { class: 'hint', text: 'tom' })]));

  const frames = vm.frames.slice(-12).reverse();
  $('frames').replaceChildren(...(frames.length
    ? frames.map((f) => {
      const locals = f.proto.slotNames.map((name, i) => [name, f.env.slots[i]]).filter(([name]) => !name.startsWith(' '));
      return el('div', { class: 'frame' },
        el('h3', {}, f.proto.name, el('small', { text: `linje ${f.proto.lines[Math.min(f.ip, f.proto.lines.length - 1)]}` })),
        locals.length ? el('dl', {}, locals.flatMap(([name, value]) => [el('dt', { text: name }), el('dd', { text: clip(show(value, true)) })])) : null,
      );
    })
    : [el('span', { class: 'hint', text: 'Programmet er ferdig.' })]),
  vm.frames.length > 12 ? el('span', { class: 'hint', text: `... og ${vm.frames.length - 12} kall til` }) : '');
  checkTour();
}

/* ====================== Hendelser ====================== */
$('run').addEventListener('click', run);
$('step').addEventListener('click', () => step(false));
$('step-line').addEventListener('click', () => step(true));
$('play').addEventListener('click', play);
$('reset').addEventListener('click', () => reset());

$('example').replaceChildren(
  el('option', { value: '', text: 'Velg et eksempel...', disabled: true }),
  ...EXAMPLES.map((example, i) => el('option', { value: String(i), text: `${example.title}: ${example.note}` })),
);
function loadExample(index) {
  editor.value = EXAMPLES[index].source;
  $('example').value = String(index);
  store.set(SOURCE_KEY, editor.value);
  editor.scrollTop = 0;
  reset();
}
$('example').addEventListener('change', (e) => loadExample(Number(e.target.value)));

editor.addEventListener('input', () => {
  store.set(SOURCE_KEY, editor.value);
  // Koden er endret, så maskinen og bytekoden er utdatert.
  if (vm || errorLine) reset(false);
  else renderGutter();
  setStatus('Koden er endret. Trykk "Kjør" eller "Steg" for å kompilere på nytt.');
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
    // Behold innrykket fra linjen markøren står på, og rykk inn ett hakk til etter "{".
    const line = editor.value.slice(0, editor.selectionStart).split('\n').at(-1);
    const indent = /^[ \t]*/.exec(line)[0] + (line.trimEnd().endsWith('{') ? '  ' : '');
    e.preventDefault();
    insertText(editor, `\n${indent}`);
  }
  if (e.key !== 'Escape') delete editor.dataset.escape; // "Esc, så Tab" gjelder bare neste tastetrykk
});

/* ====================== Omvisning ====================== */
/** Hvert kapittel ber deg gjøre noe, og går videre når maskinen viser at du har gjort det. */
const CHAPTERS = [
  {
    title: 'Fra tekst til instruksjoner',
    text: 'Maskinen forstår ikke kode. Den forstår en liste med små instruksjoner, som du ser under "Bytekode". Trykk "Steg" fem ganger og følg den markerte linjen.',
    example: 0,
    done: () => vm && vm.steps >= 5,
    result: 'Hver instruksjon gjør en liten ting: henter en verdi, legger sammen to tall eller hopper til et annet sted.',
  },
  {
    title: 'Stakken',
    text: 'Instruksjonene snakker sammen gjennom stakken: de legger verdier på toppen og tar dem av igjen. Trykk "Neste linje" til programmet har gått inn i fib.',
    done: () => vm && vm.frames.length >= 2,
    result: 'Argumentet lå på stakken da fib ble kalt. Nå bor det i variabelen n i det nye kallet.',
  },
  {
    title: 'Kallstakken',
    text: 'Hvert kall til fib får sitt eget sett med variabler. Trykk "Spill av" og se "Kall og variabler" vokse og krympe mens fib kaller seg selv.',
    done: () => tour.maxDepth >= 5,
    result: 'Fire kall til fib ligger oppå hverandre, hvert med sin egen n. Slik holder maskinen orden på rekursjon.',
  },
  {
    title: 'Funksjoner som husker',
    text: 'lagTeller returnerer en funksjon som bruker variabelen n, også etter at lagTeller selv er ferdig. Trykk "Kjør" og se at de to tellerne ikke blander seg.',
    example: 1,
    done: () => vm && vm.done && !errorLine && outputLines.length >= 3,
    result: 'Hver teller har sin egen n. Funksjonen tok med seg omgivelsen den ble laget i. Det kalles en closure.',
  },
  {
    title: 'Når det går galt',
    text: 'Dette programmet har en feil som bare viser seg for tomme lister. Trykk "Kjør".',
    example: 6,
    done: () => errorLine > 0,
    result: 'Maskinen stoppet på linjen der feilen skjedde, og kallstakken står igjen slik den var. Hver instruksjon husker hvilken kildelinje den kom fra.',
  },
  {
    title: 'Din tur',
    text: 'Nå kan du skrive ditt eget program, eller prøve Mandelbrot-eksemplet for å se hvor fort maskinen går. Språket er beskrevet nederst på siden.',
    last: true,
  },
];
const tour = { index: store.get(TOUR_KEY, false) ? CHAPTERS.length - 1 : 0, complete: false, maxDepth: 0 };

function enterChapter(index) {
  tour.index = index;
  tour.complete = false;
  tour.maxDepth = 0;
  const chapter = CHAPTERS[index];
  if (chapter.last) store.set(TOUR_KEY, true);
  if (chapter.example !== undefined) loadExample(chapter.example);
  renderTour();
}

function renderTour() {
  const chapter = CHAPTERS[tour.index];
  fill($('tour'),
    el('div', { class: 'tour-head' },
      el('p', { class: 'eyebrow', text: `Omvisning ${tour.index + 1} / ${CHAPTERS.length}` }),
      el('ol', { class: 'tour-dots' }, CHAPTERS.map((_, i) => el('li', { class: i < tour.index ? 'past' : i === tour.index ? 'now' : '' })))),
    el('h2', { class: 'tour-title', text: chapter.title }),
    el('p', { class: 'tour-text', text: chapter.text }),
    !chapter.last && el('p', { class: `tour-status${tour.complete ? ' done' : ''}`, role: 'status', text: tour.complete ? chapter.result : '' }),
    el('div', { class: 'toolbar' }, chapter.last
      ? el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Ta omvisningen på nytt', onclick: () => { store.set(TOUR_KEY, false); enterChapter(0); } })
      : [
        el('button', { class: `btn btn-small ${tour.complete ? 'btn-primary' : 'btn-ghost'}`, type: 'button', text: 'Neste', disabled: !tour.complete, onclick: () => enterChapter(tour.index + 1) }),
        el('button', { class: 'tour-skip', type: 'button', text: 'Hopp over omvisningen', onclick: () => enterChapter(CHAPTERS.length - 1) }),
      ]),
  );
}

/** Kalles hver gang feilsøkeren tegnes: har du gjort det kapittelet ber om? */
function checkTour() {
  if (!tourReady) return;
  const chapter = CHAPTERS[tour.index];
  if (vm) tour.maxDepth = Math.max(tour.maxDepth, vm.frames.length);
  if (tour.complete || chapter.last || !chapter.done()) return;
  tour.complete = true;
  renderTour();
}

/* ====================== Oppstart ====================== */
tourReady = true;
if (CHAPTERS[tour.index].last) {
  // Omvisningen er tatt før: åpne med koden du sist jobbet med.
  const saved = store.get(SOURCE_KEY, null);
  editor.value = typeof saved === 'string' && saved.trim() ? saved : EXAMPLES[0].source;
  const match = EXAMPLES.findIndex((example) => example.source === editor.value);
  $('example').value = match >= 0 ? String(match) : '';
  renderDebugger();
  renderTour();
} else {
  enterChapter(tour.index);
}
