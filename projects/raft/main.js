import { Sim } from './raft.js';
import { el, fill, store } from '../../assets/js/ui.js';

const NS = 'http://www.w3.org/2000/svg';
const CENTER = [260, 232];
const RADIUS = 158;
const NODE_R = 34;
const TICKS_PER_FRAME = 2; // ved normal hastighet
const ROLE = { LEADER: 'Leder', CANDIDATE: 'Kandidat', FOLLOWER: 'Følger' };
const KEYS = ['x', 'y', 'z'];
const TOUR_KEY = 'raft:omvisning-ferdig';

const $ = (id) => document.getElementById(id);
const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};

let sim = null;
let state = null;     // siste øyeblikksbilde av simuleringen
let running = true;
let selected = -1;
let carry = 0;        // brøkdeler av tikk ved sakte fart
let writes = 0;
let lastEventId = -1;
const view = { nodes: [], links: new Map(), messages: new Map(), cells: new Map() };

const leaders = () => state.nodes.filter((n) => n.alive && n.role === 'LEADER').sort((a, b) => b.term - a.term);
const refresh = () => { state = sim.snapshot(); render(); };

/* ====================== Omvisning ====================== */
/**
 * Hvert kapittel har en forklaring, noe brukeren skal gjøre, og en sjekk mot simuleringen.
 * Omvisningen går videre når klyngen faktisk har gjort det.
 */
const CHAPTERS = [
  {
    title: 'Hvem bestemmer?',
    text: 'Fem servere har nettopp startet, og ingen er sjef. Hver av dem venter en tilfeldig stund. Ringen rundt noden viser hvor lenge. Den første som mister tålmodigheten, ber de andre om stemmer.',
    waiting: 'Følg med på ringene. Vent til en node blir grønn.',
    done: () => leaders().length > 0,
    result: () => `S${leaders()[0].id} fikk flertall og er leder. Nå sender den jevnlige livstegn, så ingen andre stiller til valg.`,
  },
  {
    title: 'En skriver, alle kopierer',
    text: 'All skriving går gjennom lederen. Den legger kommandoen i loggen sin og sender den til følgerne. Når tre av fem har lagret den, er den bekreftet og kan ikke gå tapt.',
    action: 'Send x = 1 til lederen',
    act: () => sim.propose(-1, 'x', '1'), // false hvis klyngen er uten leder akkurat nå
    waiting: 'Se loggmeldingene gå ut fra lederen, og svarene komme tilbake.',
    done: () => state.nodes.every((n) => !n.alive || n.store.x === '1'),
    result: () => 'Se på loggene nederst: rammen ble heltrukket i det øyeblikket flertallet hadde lagret oppføringen.',
  },
  {
    title: 'Lederen dør',
    text: 'Servere krasjer. Det er hele grunnen til at vi har fem av dem. Ta ned lederen og se hva de andre gjør.',
    action: 'Krasj lederen',
    enter: (ctx) => { ctx.old = leaders()[0]?.id ?? -1; },
    act: (ctx) => {
      ctx.old = leaders()[0]?.id ?? -1;
      if (ctx.old < 0) return false;
      sim.crash(ctx.old);
      return true;
    },
    waiting: 'Livstegnene har stoppet. Hvem går først tom for tålmodighet?',
    done: (ctx) => ctx.acted && leaders().some((n) => n.id !== ctx.old),
    result: () => `S${leaders()[0].id} tok over. Klyngen var uten leder i et par sekunder, men x = 1 er fortsatt trygt lagret hos de fire som lever.`,
  },
  {
    title: 'To som tror de er sjef',
    text: 'Nå kutter vi nettverket rundt lederen i stedet for å krasje den. Den vet ikke at den er alene, og tar gjerne imot en kommando.',
    action: 'Isoler lederen og skriv y = 2 til den',
    enter: () => { state.nodes.filter((n) => !n.alive).forEach((n) => sim.restart(n.id)); },
    act: (ctx) => {
      ctx.old = leaders()[0]?.id ?? -1;
      if (ctx.old < 0) return false;
      sim.isolate(ctx.old);
      sim.propose(ctx.old, 'y', '2');
      selected = ctx.old;
      return true;
    },
    waiting: 'Den isolerte sender og sender, men ingen svarer. Hva gjør resten?',
    done: (ctx) => ctx.acted && leaders().length >= 2,
    result: () => 'Nå finnes det to ledere, men i hver sin termin. Den isolerte har y = 2 med stiplet ramme: den fikk aldri flertall, så den er ikke bekreftet.',
  },
  {
    title: 'Flertallet vinner',
    text: 'Hva skjer når de to møtes igjen? Koble nettverket sammen og se hvem som gir seg.',
    action: 'Reparer nettverket',
    act: () => sim.heal(),
    waiting: 'Den gamle lederen får snart en melding med høyere termin...',
    done: (ctx) => ctx.acted && leaders().length === 1
      && state.nodes.every((n) => n.cut.length === 0 && (!n.alive || (n.commit === state.committed && n.logSize === state.nodes[leaders()[0].id].logSize))),
    result: () => 'Den gamle lederen gikk av og forkastet y = 2, som aldri ble bekreftet. Alle fem har nå nøyaktig samme logg. Ingen bekreftede data gikk tapt.',
  },
  {
    title: 'Din tur',
    text: 'Det var hele algoritmen. Nå kan du prøve å lure den: skru opp pakketapet, del nettverket i to, eller klikk på en node for å krasje den. Merket øverst til venstre blir rødt hvis klyngen noen gang bryter en av reglene. Testene har prøvd 20\u00a0000 tilfeldige kaosscenarier uten å få det til.',
    last: true,
  },
];

const tour = { index: store.get(TOUR_KEY, false) ? CHAPTERS.length - 1 : 0, ctx: {}, complete: false };

function enterChapter(index) {
  tour.index = index;
  tour.ctx = { acted: false };
  tour.complete = false;
  CHAPTERS[index].enter?.(tour.ctx);
  if (CHAPTERS[index].last) store.set(TOUR_KEY, true);
  refresh();
  renderTour();
}

function renderTour() {
  const chapter = CHAPTERS[tour.index];
  const dots = el('ol', { class: 'tour-dots', 'aria-label': `Kapittel ${tour.index + 1} av ${CHAPTERS.length}` },
    CHAPTERS.map((_, i) => el('li', { class: i < tour.index ? 'past' : i === tour.index ? 'now' : '' })));

  const actions = el('div', { class: 'toolbar' });
  if (chapter.last) {
    actions.append(el('button', {
      class: 'btn btn-ghost btn-small', type: 'button', text: 'Ta omvisningen på nytt',
      onclick: () => { store.set(TOUR_KEY, false); $('size').value = '5'; restart(); enterChapter(0); }, // omvisningen er skrevet for fem noder
    }));
  } else {
    if (chapter.action) {
      actions.append(el('button', {
        class: 'btn btn-primary', type: 'button', text: chapter.action, disabled: tour.ctx.acted,
        onclick: () => {
          running = true;
          // Dette trenger en leder. Finnes det ingen akkurat nå, ber vi brukeren vente.
          tour.ctx.acted = chapter.act(tour.ctx) !== false;
          tour.ctx.note = tour.ctx.acted ? '' : 'Klyngen har ingen leder akkurat nå. Vent til en node blir grønn, og prøv igjen.';
          refresh();
          renderTour();
        },
      }));
    }
    actions.append(el('button', { class: `btn ${tour.complete ? 'btn-primary' : 'btn-ghost'}`, type: 'button', text: 'Neste', disabled: !tour.complete, onclick: () => enterChapter(tour.index + 1) }));
  }

  const waitingFor = chapter.action && !tour.ctx.acted ? tour.ctx.note ?? '' : chapter.waiting ?? '';
  fill($('tour'),
    el('div', { class: 'tour-head' }, el('p', { class: 'eyebrow', text: `Omvisning ${tour.index + 1} / ${CHAPTERS.length}` }), dots),
    el('h2', { class: 'tour-title', text: chapter.title }),
    el('p', { class: 'tour-text', text: chapter.text }),
    el('p', { class: `tour-status${tour.complete ? ' done' : ''}`, role: 'status', text: tour.complete ? chapter.result() : waitingFor }),
    actions,
    !chapter.last && el('button', { class: 'tour-skip', type: 'button', text: 'Hopp over omvisningen', onclick: () => enterChapter(CHAPTERS.length - 1) }),
  );
}

/** Kalles hvert bilde: har klyngen gjort det kapittelet venter på? */
function checkTour() {
  const chapter = CHAPTERS[tour.index];
  if (tour.complete || chapter.last || !chapter.done(tour.ctx)) return;
  tour.complete = true;
  renderTour();
  $('tour').querySelector('.btn:not(:disabled)')?.focus({ preventScroll: true });
}

/* ====================== Simulering ====================== */
function restart() {
  const size = Number($('size').value);
  sim = new Sim(size, Date.now() % 1_000_000);
  selected = -1;
  lastEventId = -1;
  writes = 0;
  $('drop').value = 0;
  $('out-drop').textContent = '0 %';
  $('events').replaceChildren();
  state = sim.snapshot();
  buildCluster(size);
  render();
}

function frame() {
  if (running) {
    carry += TICKS_PER_FRAME * Number(document.querySelector('input[name="speed"]:checked').value);
    const ticks = Math.floor(carry);
    if (ticks > 0) {
      carry -= ticks;
      sim.run(ticks);
      state = sim.snapshot();
      render();
      checkTour();
    }
  }
  requestAnimationFrame(frame);
}

/* ====================== Oppbygging ====================== */
const position = (i, n) => {
  const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
  return [CENTER[0] + Math.cos(angle) * RADIUS, CENTER[1] + Math.sin(angle) * RADIUS];
};

function buildCluster(size) {
  const linkLayer = svg('g'), messageLayer = svg('g'), nodeLayer = svg('g');
  view.links.clear(); view.messages.clear(); view.cells.clear();
  view.logSignature = '';
  view.pos = Array.from({ length: size }, (_, i) => position(i, size));

  for (let a = 0; a < size; a++) {
    for (let b = a + 1; b < size; b++) {
      const [x1, y1] = view.pos[a], [x2, y2] = view.pos[b];
      const line = svg('line', { class: 'link', x1, y1, x2, y2 });
      view.links.set(`${a}-${b}`, line);
      linkLayer.append(line);
    }
  }

  view.nodes = view.pos.map(([x, y], i) => {
    const timer = svg('circle', { class: 'timer', r: NODE_R + 6, transform: 'rotate(-90)', 'stroke-dasharray': '0 999' });
    const term = svg('text', { class: 'term', y: 19 });
    const role = svg('text', { class: 'role', y: y < CENTER[1] ? -NODE_R - 16 : NODE_R + 26 });
    const name = svg('text', { y: 4 });
    name.textContent = `S${i}`;
    const group = svg('g', { class: 'node', transform: `translate(${x} ${y})`, tabindex: '0', role: 'button' },
      svg('circle', { class: 'ring', r: NODE_R + 12 }), timer, svg('circle', { class: 'body', r: NODE_R }), name, term, role);
    const choose = () => { selected = selected === i ? -1 : i; render(); };
    group.addEventListener('click', choose);
    group.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
    nodeLayer.append(group);
    return { group, timer, term, role };
  });
  $('cluster').replaceChildren(linkLayer, messageLayer, nodeLayer);
  view.messageLayer = messageLayer;
}

/* ====================== Tegning ====================== */
function render() {
  renderCluster();
  renderLogs();
  renderEvents();
  renderSelected();

  const badge = $('invariants');
  badge.classList.toggle('bad', Boolean(state.violation));
  badge.textContent = state.violation ?? 'Sikkerhetsegenskapene holder';
  $('counters').textContent = `tikk ${state.tick.toLocaleString('nb-NO')} · ${state.delivered.toLocaleString('nb-NO')} meldinger levert · ${state.lost.toLocaleString('nb-NO')} tapt · ${state.committed} bekreftet`;
  $('play').textContent = running ? 'Pause' : 'Fortsett';
}

function renderCluster() {
  const circumference = 2 * Math.PI * (NODE_R + 6);
  state.nodes.forEach((n, i) => {
    const v = view.nodes[i];
    v.group.setAttribute('class', `node ${n.alive ? n.role.toLowerCase() : 'dead'}${selected === i ? ' selected' : ''}`);
    v.group.setAttribute('aria-label', `S${i}, termin ${n.term}, ${n.alive ? ROLE[n.role] : 'nede'}`);
    v.term.textContent = `termin ${n.term}`;
    v.role.textContent = n.alive ? ROLE[n.role].toUpperCase() : 'NEDE';
    // Ringen fylles mens noden venter på livstegn. Når den er full, stiller noden til valg.
    v.timer.setAttribute('stroke-dasharray', `${(n.timer * circumference).toFixed(1)} 999`);
  });

  for (const [key, line] of view.links) {
    const [a, b] = key.split('-').map(Number);
    line.setAttribute('class', state.nodes[a].cut.includes(b) ? 'link cut' : 'link');
  }

  // Meldinger: en sirkel per melding, flyttet langs linjen mellom avsender og mottaker.
  const seen = new Set();
  for (const m of state.messages) {
    seen.add(m.id);
    let dot = view.messages.get(m.id);
    if (!dot) {
      const kind = m.type === 'APPEND_ENTRIES' ? 'append' : m.type === 'REQUEST_VOTE' ? 'vote' : m.ok ? 'reply' : 'denied';
      dot = svg('circle', { class: `msg ${kind}`, r: m.type === 'APPEND_ENTRIES' && m.entries ? 6.5 : 4.5 });
      view.messages.set(m.id, dot);
      view.messageLayer.append(dot);
    }
    const progress = Math.min(1, (state.tick - m.sent) / Math.max(1, m.due - m.sent));
    const along = m.lost ? progress * 0.5 : progress; // tapte meldinger forsvinner halvveis
    const [x1, y1] = view.pos[m.from], [x2, y2] = view.pos[m.to];
    dot.setAttribute('cx', x1 + (x2 - x1) * along);
    dot.setAttribute('cy', y1 + (y2 - y1) * along);
    dot.setAttribute('opacity', m.lost ? 1 - progress : 1);
  }
  for (const [id, dot] of view.messages) {
    if (!seen.has(id)) { dot.remove(); view.messages.delete(id); }
  }
}

function renderLogs() {
  // Loggene tegnes bare på nytt når noe er endret. Ellers starter animasjonene på nytt
  // og verktøytipsene forsvinner hele tiden.
  const signature = state.nodes.map((n) =>
    `${n.alive}|${n.role}|${n.commit}|${n.logSize}|${n.log.map((e) => `${e.t}:${e.c}`).join(',')}|${Object.entries(n.store).join(';')}`).join('/');
  if (signature === view.logSignature) return;
  view.logSignature = signature;

  const rows = state.nodes.map((n, i) => {
    const cells = n.log.map((entry) => {
      const key = `${i}:${entry.i}:${entry.t}`;
      const fresh = !view.cells.has(key);
      view.cells.set(key, state.tick);
      return el('div', { class: `cell-entry${entry.i <= n.commit ? ' committed' : ''}${fresh ? ' fresh' : ''}`, title: `Indeks ${entry.i}, termin ${entry.t}` },
        entry.c ? entry.c.replace(' ', '=') : '·', el('small', { text: `t${entry.t}` }));
    });
    const hidden = n.logSize - n.log.length;
    const values = Object.entries(n.store).map(([k, v]) => `${k}=${v}`).join('  ');
    return el('div', { class: `log-row${n.alive ? '' : ' dead'}` },
      el('div', { class: 'log-name' }, `S${i}`, el('small', { text: n.alive ? ROLE[n.role] : 'Nede' })),
      el('div', { class: 'log-cells' }, hidden > 0 && el('span', { class: 'log-more', text: `+${hidden}` }), cells),
      el('div', { class: 'log-store', text: values || 'tom' }),
    );
  });
  $('logs').replaceChildren(...rows);
  // Glem celler som ikke lenger vises, så kartet ikke vokser uten grense.
  if (view.cells.size > 600) for (const [key, tick] of view.cells) if (tick < state.tick - 50) view.cells.delete(key);
}

function renderEvents() {
  const list = $('events');
  const fresh = state.events.filter((e) => e.id > lastEventId);
  if (!fresh.length) return;
  lastEventId = fresh.at(-1).id;
  for (const e of fresh) {
    list.prepend(el('li', {}, el('time', { text: `t ${e.tick}` }), el('span', { class: e.kind, text: e.text })));
  }
  while (list.children.length > 60) list.lastChild.remove();
}

function renderSelected() {
  const host = $('selected');
  const n = state.nodes[selected];
  if (!n) {
    if (host.dataset.node !== 'none') {
      host.dataset.node = 'none';
      host.replaceChildren(el('p', { class: 'hint', text: 'Klikk på en node for å krasje den, isolere den eller skrive direkte til den.' }));
    }
    return;
  }
  // Bygg bare på nytt når noe relevant er endret, så knappene ikke mister fokus hvert bilde.
  const signature = `${selected}|${n.alive}|${n.role}|${n.term}|${n.commit}|${n.logSize}|${n.cut.length}|${n.votedFor}`;
  if (host.dataset.node === signature) return;
  host.dataset.node = signature;
  const row = (label, value) => [el('dt', { text: label }), el('dd', { text: value })];
  const act = (fn) => () => { fn(); refresh(); };
  host.replaceChildren(
    el('h3', { text: `S${selected} · ${n.alive ? ROLE[n.role] : 'Nede'}` }),
    el('dl', {},
      row('Termin', String(n.term)),
      row('Stemte på', n.votedFor >= 0 ? `S${n.votedFor}` : 'ingen'),
      row('Logg', `${n.logSize} oppføringer, ${n.commit} bekreftet`),
      row('Forbindelser', n.cut.length ? `brutt mot ${n.cut.map((c) => `S${c}`).join(', ')}` : 'alle oppe'),
    ),
    el('div', { class: 'toolbar' },
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: n.alive ? 'Krasj' : 'Start på nytt', onclick: act(() => (n.alive ? sim.crash(selected) : sim.restart(selected))) }),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Isoler', onclick: act(() => sim.isolate(selected)) }),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Skriv hit', onclick: act(() => write(selected)) }),
    ),
  );
}

/* ====================== Fri lek ====================== */
function write(target = -1) {
  const key = KEYS[writes % KEYS.length];
  sim.propose(target, key, String(10 + ++writes));
}

$('write').addEventListener('click', () => { write(); refresh(); });
$('heal').addEventListener('click', () => {
  sim.heal();
  state.nodes.filter((n) => !n.alive).forEach((n) => sim.restart(n.id));
  refresh();
});
$('split').addEventListener('click', () => {
  // Lederen havner i mindretallet, så det er noe å se på.
  const leader = leaders()[0]?.id ?? 0;
  const size = state.nodes.length;
  sim.split(Array.from({ length: Math.floor((size - 1) / 2) }, (_, k) => (leader + k) % size));
  refresh();
});
$('drop').addEventListener('input', (e) => {
  $('out-drop').textContent = `${e.target.value} %`;
  sim.setDropRate(Number(e.target.value) / 100);
});
$('play').addEventListener('click', () => { running = !running; render(); });
$('restart').addEventListener('click', () => { restart(); enterChapter(CHAPTERS[tour.index].last ? tour.index : 0); });
$('size').addEventListener('change', () => { restart(); enterChapter(CHAPTERS.length - 1); }); // omvisningen er skrevet for fem noder
// Simuleringen hviler mens fanen er skjult, og fortsetter av seg selv når du kommer tilbake.
let pausedByTab = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) { running = false; pausedByTab = true; }
  else if (!document.hidden && pausedByTab) { running = true; pausedByTab = false; }
  render();
});

restart();
enterChapter(tour.index);
requestAnimationFrame(frame);
