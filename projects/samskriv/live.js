/**
 * Samme CRDT, men med ekte sending mellom faner via BroadcastChannel.
 * Ingen fane bestemmer. En ny fane ber om alt som har skjedd og får det fra de andre,
 * eller fra loggen i localStorage hvis ingen andre er åpne.
 *
 * Meldinger på kanalen:
 *   { type: 'ops',   from, ops }       nye operasjoner
 *   { type: 'hello', from }            en ny fane ber om det de andre har
 *   { type: 'state', from, to, ops }   svar på hello, hele loggen
 *   { type: 'ping',  from }            livstegn, så fanene kan telle hverandre
 */
import { Replica, applyEdit } from './crdt.js';
import { el, store } from '../../assets/js/ui.js';

const LOG_KEY = 'samskriv:delt-logg';
const MAX_LOG = 4000;       // loggen vokser med hvert tastetrykk. Over grensen lagres den ikke lenger.
const PALETTE = ['by-ada', 'by-bo', 'by-cleo'];

const $ = (id) => document.getElementById(id);
const glyph = (c) => (c === ' ' ? '␣' : c === '\n' ? '↵' : c);
const idOf = (op) => `${op.type}:${op.id[0]}@${op.id[1]}`;

export function startLive() {
  if (!('BroadcastChannel' in window)) {
    $('live').hidden = true;
    return;
  }
  const area = $('live-text');
  const me = Math.random().toString(36).slice(2, 8);   // denne fanens forfatter-id
  let replica = new Replica(me);
  const channel = new BroadcastChannel('samskriv-delt');
  const peers = new Map();    // fane-id -> når vi sist hørte fra den
  const seen = new Set();     // operasjoner som allerede ligger i loggen
  const log = [];             // alt denne fanen kjenner til, i den rekkefølgen det kom
  let unsent = [];            // egne operasjoner gjort mens fanen var frakoblet
  let connected = true;
  let visible = '';           // teksten som står i feltet akkurat nå

  const save = () => { if (log.length <= MAX_LOG) store.set(LOG_KEY, log); };

  /** Tar imot operasjoner (fra en annen fane eller fra loggen) og oppdaterer tekstfeltet. */
  function absorb(ops) {
    let start = area.selectionStart, end = area.selectionEnd;
    for (const op of ops) {
      if (seen.has(idOf(op))) continue;
      seen.add(idOf(op));
      log.push(op);
      // Markøren flyttes med, slik at den blir stående ved det samme tegnet.
      for (const change of replica.receive(op)) {
        const shift = change.type === 'insert' ? 1 : -1;
        if (change.index < start) start += shift;
        if (change.index < end) end += shift;
      }
    }
    visible = replica.text();
    if (area.value !== visible) {
      area.value = visible;
      if (document.activeElement === area) area.setSelectionRange(start, end);
    }
    save();
    render();
  }

  function render() {
    const authors = [...new Set(replica.items.map((item) => item.id[1]))];
    $('live-strip').replaceChildren(...replica.items.map((item) =>
      el('span', {
        class: `cell ${PALETTE[authors.indexOf(item.id[1]) % PALETTE.length]}${item.deleted ? ' gone' : ''}`,
        title: `"${item.ch}" skrevet i fane ${item.id[1]}${item.id[1] === me ? ' (denne)' : ''}, teller ${item.id[0]}${item.deleted ? ' (slettet)' : ''}`,
        text: glyph(item.ch),
      })));
    const now = Date.now();
    for (const [id, at] of peers) if (now - at > 4500) peers.delete(id);
    const count = peers.size;
    $('live-peers').textContent = !connected ? 'Denne fanen er frakoblet'
      : count === 0 ? 'Ingen andre faner åpne' : count === 1 ? 'Koblet til 1 annen fane' : `Koblet til ${count} andre faner`;
    $('live-peers').classList.toggle('ok', connected && count > 0);
    $('live').classList.toggle('offline', !connected);
    $('live-toggle').textContent = connected ? 'Koble fra denne fanen' : 'Koble til igjen';
    $('live-toggle').setAttribute('aria-pressed', String(!connected));
    $('live-state').textContent = `Fane ${me}. ${replica.items.length} tegn lagret${unsent.length ? `, ${unsent.length} endringer venter på nett` : ''}.`;
  }

  channel.onmessage = ({ data }) => {
    if (!connected || !data || data.from === me) return;
    peers.set(data.from, Date.now());
    if (data.type === 'ops') absorb(data.ops);
    else if (data.type === 'hello') { channel.postMessage({ type: 'state', from: me, to: data.from, ops: log }); render(); }
    else if (data.type === 'state' && data.to === me) absorb(data.ops);
    else render();
  };

  area.addEventListener('input', () => {
    const ops = applyEdit(replica, visible, area.value);
    visible = area.value;
    for (const op of ops) { seen.add(idOf(op)); log.push(op); }
    if (connected) channel.postMessage({ type: 'ops', from: me, ops }); else unsent.push(...ops);
    save();
    render();
  });

  $('live-toggle').addEventListener('click', () => {
    connected = !connected;
    if (connected) {
      // Tilbake på nett: send det som ble skrevet i mellomtiden, og be om det vi gikk glipp av.
      if (unsent.length) channel.postMessage({ type: 'ops', from: me, ops: unsent });
      unsent = [];
      channel.postMessage({ type: 'hello', from: me });
    } else peers.clear();
    render();
  });

  $('live-clear').addEventListener('click', () => {
    if (connected && peers.size === 0) {
      // Ingen andre har en kopi: da kan historikken kastes, ikke bare skjules bak gravsteiner.
      replica = new Replica(me);
      log.length = 0;
      seen.clear();
      visible = '';
      area.value = '';
      save();
      render();
      return;
    }
    // Andre faner har teksten: da må slettingen gå som vanlige operasjoner, så alle får den med seg.
    area.value = '';
    area.dispatchEvent(new Event('input'));
  });

  // Oppstart: les loggen fra forrige besøk, si fra til de andre fanene, og hold kontakten.
  const saved = store.get(LOG_KEY, []);
  if (Array.isArray(saved)) absorb(saved.filter((op) => op && Array.isArray(op.id)));
  channel.postMessage({ type: 'hello', from: me });
  setInterval(() => { if (connected) channel.postMessage({ type: 'ping', from: me }); render(); }, 1500);
  window.addEventListener('pagehide', () => channel.close());
  render();
}
