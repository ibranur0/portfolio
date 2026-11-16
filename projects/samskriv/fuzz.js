/**
 * Ett tilfeldig forløp for CRDT-en. Brukes av test.mjs og av selvtesten på siden.
 *
 * To til fem kopier gjør tilfeldige endringer. Meldingene kommer i tilfeldig rekkefølge,
 * noen ganger dobbelt, og kopier går av og på nett. Til slutt leveres alt, og alle
 * kopiene må være like. Kaster en feil med frøet hvis noe er galt.
 */
import { Replica } from './crdt.js';

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const must = (condition, message) => { if (!condition) throw new Error(message); };

/** @returns {{ operations: number, deliveries: number, length: number }} */
export function randomRun(seed) {
  const random = generator(seed);
  const int = (n) => Math.floor(random() * n);
  const size = 2 + int(4);
  const replicas = Array.from({ length: size }, (_, k) => new Replica(`s${k}`));
  const models = replicas.map(() => '');   // fasit for hver kopi: en vanlig tekststreng
  const inbox = replicas.map(() => []);    // operasjoner på vei til hver kopi
  const offline = replicas.map(() => false);
  let operations = 0, deliveries = 0;

  const receiveOne = (to) => {
    // Nettverket stokker om: en vilkårlig ventende melding leveres, av og til to ganger.
    const k = int(inbox[to].length);
    const op = random() < 0.08 ? inbox[to][k] : inbox[to].splice(k, 1)[0];
    for (const change of replicas[to].receive(op)) {
      // Fasiten følger med: den meldte posisjonen skal stemme med det som faktisk skjedde.
      models[to] = change.type === 'insert'
        ? models[to].slice(0, change.index) + change.ch + models[to].slice(change.index)
        : models[to].slice(0, change.index) + models[to].slice(change.index + 1);
    }
    must(replicas[to].text() === models[to], `frø ${seed}: meldt posisjon stemmer ikke`);
    deliveries++;
  };

  for (let step = 20 + int(120); step > 0; step--) {
    const who = int(size);
    const roll = random();
    if (roll < 0.03) offline[who] = !offline[who];
    else if (roll < 0.55) {
      // Lokal endring: sett inn (oftest) eller slett på en tilfeldig posisjon.
      const text = models[who];
      let op;
      if (text.length && random() < 0.3) {
        const at = int(text.length);
        op = replicas[who].delete(at);
        models[who] = text.slice(0, at) + text.slice(at + 1);
      } else {
        const at = int(text.length + 1), ch = 'abcdefgh'[int(8)];
        op = replicas[who].insert(at, ch);
        models[who] = text.slice(0, at) + ch + text.slice(at);
      }
      must(replicas[who].text() === models[who], `frø ${seed}: lokal endring ga feil tekst`);
      replicas.forEach((_, other) => { if (other !== who) inbox[other].push(op); });
      operations++;
    } else if (!offline[who] && inbox[who].length) receiveOne(who);
  }

  // Til slutt kommer alle på nett og alt leveres, fortsatt i tilfeldig rekkefølge.
  replicas.forEach((_, to) => { while (inbox[to].length) receiveOne(to); });
  const first = replicas[0].signature();
  for (const replica of replicas) {
    must(replica.pending.length === 0, `frø ${seed}: operasjoner ble hengende på vent`);
    must(replica.signature() === first, `frø ${seed}: kopiene endte ulikt`);
  }
  return { operations, deliveries, length: replicas[0].items.length };
}
