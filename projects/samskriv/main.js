import { Replica, applyEdit } from './crdt.js';
import { startLive } from './live.js';
import { el, store, prefersReducedMotion } from '../../assets/js/ui.js';

const NS = 'http://www.w3.org/2000/svg';
const SEEN_KEY = 'samskriv:demo-sett';
const START_TEXT = 'Hei verden';
const MAX_LENGTH = 400;
const SITES = [
  { id: 'ada', name: 'Ada', at: [160, 40] },
  { id: 'bo', name: 'Bo', at: [56, 172] },
  { id: 'cleo', name: 'Cleo', at: [264, 172] },
];

const $ = (id) => document.getElementById(id);
const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};
const glyph = (c) => (c === ' ' ? '␣' : c === '\n' ? '↵' : c);
const delay = () => Number($('delay').value) * 1000;

/* ====================== Tilstand ====================== */
let replicas = [];
let shown = [];          // teksten som står i hvert tekstfelt akkurat nå
let online = [true, true, true];
let messages = [];       // { from, to, op, held, sentAt, due }
let demoRun = 0;         // øker hver gang demonstrasjonen startes eller avbrytes
const view = SITES.map(() => ({}));

/* ====================== Nettverk ====================== */
function launch(message, now, stagger = 0) {
  message.held = false;
  message.sentAt = now + stagger;
  // Ujevn forsinkelse: meldinger kan gå forbi hverandre underveis.
  message.due = message.sentAt + delay() * (0.55 + Math.random() * 0.9);
}

function broadcast(from, ops) {
  const now = performance.now();
  ops.forEach((op, k) => {
    SITES.forEach((_, to) => {
      if (to === from) return;
      const message = { from, to, op, held: true, sentAt: 0, due: 0 };
      if (online[from] && online[to]) launch(message, now, k * 25);
      messages.push(message);
    });
  });
}

function setOnline(site, next) {
  online[site] = next;
  const now = performance.now();
  let stagger = 0;
  for (const message of messages) {
    if (message.from !== site && message.to !== site) continue;
    const open = online[message.from] && online[message.to];
    if (!open) message.held = true;                 // det som var underveis, må sendes på nytt senere
    else if (message.held) { launch(message, now, stagger); stagger += 18; }
  }
  renderCards();
}

/** Leverer en endring og flytter markøren i tekstfeltet slik at den blir stående ved samme tegn. */
function deliver(message) {
  const { to } = message;
  const area = view[to].area;
  let start = area.selectionStart, end = area.selectionEnd;
  for (const change of replicas[to].receive(message.op)) {
    const shift = change.type === 'insert' ? 1 : -1;
    if (change.index < start) start += shift;
    if (change.index < end) end += shift;
  }
  shown[to] = replicas[to].text();
  if (area.value !== shown[to]) {
    area.value = shown[to];
    if (document.activeElement === area) area.setSelectionRange(start, end);
  }
}

function frame(now) {
  let changed = false;
  const waiting = [];
  for (const message of messages) {
    if (!message.held && now >= message.due) { deliver(message); changed = true; } else waiting.push(message);
  }
  messages = waiting;
  if (changed) renderCards();
  renderNetwork(now);
  requestAnimationFrame(frame);
}

/* ====================== Redigering ====================== */
/** Tekstfeltet er endret (av brukeren eller demonstrasjonen): gjør endringen om til operasjoner. */
function edited(site) {
  const area = view[site].area;
  const ops = applyEdit(replicas[site], shown[site], area.value);
  shown[site] = area.value;
  broadcast(site, ops);
  renderCards();
}

function reset(text = START_TEXT) {
  replicas = SITES.map((site) => new Replica(site.id));
  // Utgangsteksten skrives av Ada og leveres til de andre med en gang.
  const ops = [...text].map((ch, k) => replicas[0].insert(k, ch));
  for (const other of replicas.slice(1)) ops.forEach((op) => other.receive(op));
  shown = replicas.map((replica) => replica.text());
  online = [true, true, true];
  messages = [];
  view.forEach((v, k) => { v.area.value = shown[k]; });
  renderCards();
}

/* ====================== Visning ====================== */
function buildCards() {
  $('editors').replaceChildren(...SITES.map((site, k) => {
    const v = view[k];
    v.area = el('textarea', {
      class: 'input', rows: '3', maxlength: String(MAX_LENGTH), spellcheck: 'false', autocomplete: 'off',
      'aria-label': `Teksten hos ${site.name}`,
      oninput: () => { stopDemo(); edited(k); },
    });
    v.toggle = el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => { stopDemo(); setOnline(k, !online[k]); } });
    v.state = el('p', { class: 'card-state' });
    v.strip = el('div', { class: 'strip', 'aria-hidden': 'true' });
    v.card = el('section', { class: `panel card by-${site.id}`, 'aria-label': site.name },
      el('div', { class: 'card-head' },
        el('h2', { class: 'card-name' }, el('i', { class: 'dot' }), site.name),
        v.toggle),
      v.area, v.state, v.strip);
    return v.card;
  }));
}

function renderCards() {
  SITES.forEach((site, k) => {
    const v = view[k];
    const outgoing = messages.filter((m) => m.from === k && m.held).length / (SITES.length - 1);
    const incoming = messages.filter((m) => m.to === k && m.held).length;
    v.card.classList.toggle('offline', !online[k]);
    v.toggle.textContent = online[k] ? 'Koble fra' : 'Koble til';
    v.toggle.setAttribute('aria-pressed', String(!online[k]));
    v.state.textContent = online[k]
      ? `På nett. ${replicas[k].items.length} tegn lagret, ${replicas[k].items.filter((item) => item.deleted).length} av dem slettet.`
      : `Frakoblet. ${Math.round(outgoing)} egne endringer venter på å bli sendt, ${incoming} venter på å komme inn.`;

    // Stripen: alle tegn kopien har lagret, i dokumentrekkefølge, farget etter forfatter.
    const signature = replicas[k].signature();
    if (v.signature !== signature) {
      v.signature = signature;
      v.strip.replaceChildren(...replicas[k].items.map((item) => {
        const author = SITES.find((s) => s.id === item.id[1]);
        return el('span', {
          class: `cell by-${item.id[1]}${item.deleted ? ' gone' : ''}`,
          title: `"${item.ch}" skrevet av ${author?.name ?? item.id[1]}, teller ${item.id[0]}${item.deleted ? ' (slettet)' : ''}`,
          text: glyph(item.ch),
        });
      }));
      if (!replicas[k].items.length) v.strip.append(el('span', { class: 'hint', text: 'Ingen tegn ennå.' }));
    }
  });

  const same = replicas.every((replica) => replica.signature() === replicas[0].signature());
  const underway = messages.length;
  const badge = $('badge');
  badge.classList.toggle('ok', same && !underway);
  badge.textContent = same && !underway
    ? 'Alle tre har samme tekst'
    : `${same ? 'Samme tekst' : 'Ulik tekst'} akkurat nå. ${Math.ceil(underway / (SITES.length - 1))} ${underway <= SITES.length - 1 ? 'endring' : 'endringer'} er underveis.`;
}

function buildNetwork() {
  const links = svg('g'), dots = svg('g'), nodes = svg('g');
  const lines = new Map();
  for (let a = 0; a < SITES.length; a++) {
    for (let b = a + 1; b < SITES.length; b++) {
      const line = svg('line', { class: 'link', x1: SITES[a].at[0], y1: SITES[a].at[1], x2: SITES[b].at[0], y2: SITES[b].at[1] });
      lines.set(`${a}-${b}`, line);
      links.append(line);
    }
  }
  const groups = SITES.map((site, k) => {
    const label = svg('text', { class: 'node-name', y: 5 });
    label.textContent = site.name;
    const held = svg('text', { class: 'node-held', y: k === 0 ? -30 : 42 });
    const group = svg('g', { class: `node by-${site.id}`, transform: `translate(${site.at[0]} ${site.at[1]})`, tabindex: '0', role: 'button' },
      svg('circle', { class: 'node-body', r: 24 }), label, held);
    const toggle = () => { stopDemo(); setOnline(k, !online[k]); };
    group.addEventListener('click', toggle);
    group.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    nodes.append(group);
    return { group, held };
  });
  $('network').replaceChildren(links, dots, nodes);
  return { lines, dots, groups };
}

let net = null;
function renderNetwork(now) {
  for (const [pair, line] of net.lines) {
    const [a, b] = pair.split('-').map(Number);
    line.setAttribute('class', online[a] && online[b] ? 'link' : 'link cut');
  }
  net.groups.forEach(({ group, held }, k) => {
    group.setAttribute('class', `node by-${SITES[k].id}${online[k] ? '' : ' offline'}`);
    group.setAttribute('aria-label', `${SITES[k].name}: ${online[k] ? 'på nett. Trykk for å koble fra' : 'frakoblet. Trykk for å koble til'}`);
    const count = Math.round(messages.filter((m) => m.from === k && m.held).length / (SITES.length - 1));
    held.textContent = count ? `${count} venter` : '';
  });
  // En prikk per melding som er underveis. Nok til å vise trafikken, uten å tegne tusenvis.
  const flying = messages.filter((m) => !m.held && now >= m.sentAt).slice(0, 80);
  const dots = net.dots;
  while (dots.childElementCount > flying.length) dots.lastChild.remove();
  while (dots.childElementCount < flying.length) dots.append(svg('circle', { r: 4 }));
  flying.forEach((m, k) => {
    const t = Math.min(1, (now - m.sentAt) / Math.max(1, m.due - m.sentAt));
    const [x1, y1] = SITES[m.from].at, [x2, y2] = SITES[m.to].at;
    const dot = dots.children[k];
    dot.setAttribute('class', `msg by-${SITES[m.from].id}${m.op.type === 'delete' ? ' delete' : ''}`);
    dot.setAttribute('cx', x1 + (x2 - x1) * t);
    dot.setAttribute('cy', y1 + (y2 - y1) * t);
  });
}

/* ====================== Demonstrasjon ====================== */
const say = (text) => { $('story').textContent = text; };

function stopDemo() {
  if (!$('demo').disabled) return;
  demoRun++;
  $('demo').disabled = false;
  say('Eksempelet er stoppet. Skriv videre selv, eller koble noen fra og se hva som skjer.');
}

async function demo() {
  const run = ++demoRun;
  const pace = prefersReducedMotion() ? 0 : 1;
  const wait = (ms) => new Promise((resolve, reject) => {
    setTimeout(() => (run === demoRun ? resolve() : reject(new Error('avbrutt'))), ms * pace);
  });
  /** Skriver i et tekstfelt slik en bruker ville gjort: ett tegn om gangen. */
  const type = async (site, at, text) => {
    for (let k = 0; k < text.length; k++) {
      const area = view[site].area;
      area.value = area.value.slice(0, at + k) + text[k] + area.value.slice(at + k);
      edited(site);
      await wait(95);
    }
  };
  const erase = async (site, at, count) => {
    for (let k = 0; k < count; k++) {
      const area = view[site].area;
      area.value = area.value.slice(0, at) + area.value.slice(at + 1);
      edited(site);
      await wait(95);
    }
  };

  $('demo').disabled = true;
  try {
    reset();
    say('Alle tre starter med "Hei verden". Nå mister Bo nettet.');
    await wait(1600);
    setOnline(1, false);
    await wait(900);
    say('Ada skriver "kjære " etter "Hei". Cleo får endringen, Bo får den ikke.');
    await type(0, 4, 'kjære ');
    await wait(1400);
    say('Bo vet ingenting om det, og skriver "vakre " på nøyaktig samme sted.');
    await type(1, 4, 'vakre ');
    await wait(1200);
    say('Samtidig bytter Cleo ut "Hei" med "Hallo". Nå finnes det to ulike versjoner av teksten.');
    await erase(2, 0, 3);
    await type(2, 0, 'Hallo');
    await wait(2200);
    say('Bo kobler seg til igjen. Endringene krysser hverandre på veien...');
    setOnline(1, true);
    // Vent til alt har kommet frem.
    while (messages.length) await wait(200);
    await wait(300);
    say(`Alle tre endte med "${replicas[0].text()}". Alle endringene kom med, og ingen server måtte bestemme rekkefølgen. Prøv selv: koble noen fra og skriv i feltene.`);
  } catch {
    return; // avbrutt av brukeren
  }
  if (run === demoRun) $('demo').disabled = false;
  store.set(SEEN_KEY, true);
}

/* ====================== Oppstart ====================== */
$('demo').addEventListener('click', demo);
$('reset').addEventListener('click', () => {
  stopDemo();
  reset();
  say('Alle tre starter med samme tekst. Skriv i et av feltene, eller koble en av dem fra først.');
});
$('delay').addEventListener('input', (e) => { $('out-delay').textContent = `${Number(e.target.value).toFixed(1).replace('.', ',')} s`; });

buildCards();
net = buildNetwork();
reset();
requestAnimationFrame(frame);
// Første besøk: vis demonstrasjonen med en gang, så det er noe å se på.
if (store.get(SEEN_KEY, false)) say('Skriv i et av feltene, koble noen fra, eller se eksempelet på nytt.');
else demo();
startLive();
