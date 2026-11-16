/**
 * En tekst-CRDT av typen RGA (Replicated Growable Array).
 * Brukes av siden og av test.mjs.
 *
 * Flere skriver i samme tekst uten en server som bestemmer rekkefølgen.
 * "Sett inn x på posisjon 5" betyr ikke det samme for to som har ulik tekst.
 *
 * Derfor bruker jeg id-er i stedet for posisjoner:
 * - Hvert tegn får en id (teller, forfatter) og husker id-en til tegnet det ble satt inn etter.
 * - Settes to tegn inn etter samme tegn, kommer det med høyest id først. Alle følger
 *   samme regel, så alle får samme rekkefølge.
 * - Et slettet tegn blir liggende, merket som slettet. Da finner en innsetting som
 *   kommer sent, fortsatt tegnet den skulle stå etter.
 *
 * To kopier som har fått de samme operasjonene, har samme tekst. Rekkefølgen
 * spiller ingen rolle, og det gjør heller ikke duplikater.
 *
 * Det som sendes over nettverket:
 *   { type: 'insert', id: [teller, forfatter], after: [teller, forfatter] | null, ch }
 *   { type: 'delete', id: [teller, forfatter] }
 */
const key = (id) => (id ? `${id[0]}@${id[1]}` : '');

/** Total orden på id-er: høyest teller først, og forfatternavnet avgjør ved likhet. */
export const newer = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

export class Replica {
  /** @param {string} site  Unikt navn på denne kopien (forfatteren) */
  constructor(site) {
    this.site = site;
    this.clock = 0;          // Lamport-klokke: alltid høyere enn alle tellere kopien har sett
    this.items = [];         // alle tegn i dokumentrekkefølge, også slettede: { id, ch, deleted }
    this.known = new Map();  // id -> tegn, for raskt oppslag
    this.pending = [];       // operasjoner som venter på noe som ikke har kommet frem ennå
  }

  /** Teksten slik brukeren ser den. */
  text() {
    let out = '';
    for (const item of this.items) if (!item.deleted) out += item.ch;
    return out;
  }

  get length() {
    let n = 0;
    for (const item of this.items) if (!item.deleted) n++;
    return n;
  }

  /** Plassen i this.items til det synlige tegnet på "index", eller -1 for "foran alt". */
  slotOf(index) {
    if (index < 0) return -1;
    let seen = -1;
    for (let k = 0; k < this.items.length; k++) {
      if (!this.items[k].deleted && ++seen === index) return k;
    }
    throw new RangeError(`Posisjon ${index} er utenfor teksten`);
  }

  /** Antall synlige tegn foran plass "slot". */
  visibleBefore(slot) {
    let n = 0;
    for (let k = 0; k < slot; k++) if (!this.items[k].deleted) n++;
    return n;
  }

  /* ------------------------------------------------ Lokale endringer */
  /** Brukeren setter inn et tegn på synlig posisjon "index". Returnerer operasjonen som skal sendes. */
  insert(index, ch) {
    const before = index === 0 ? null : this.items[this.slotOf(index - 1)];
    const op = { type: 'insert', id: [++this.clock, this.site], after: before ? before.id : null, ch };
    this.integrate(op);
    return op;
  }

  /** Brukeren sletter tegnet på synlig posisjon "index". Returnerer operasjonen som skal sendes. */
  delete(index) {
    const item = this.items[this.slotOf(index)];
    item.deleted = true;
    return { type: 'delete', id: item.id };
  }

  /* ------------------------------------------------ Mottak */
  /**
   * Tar imot en operasjon fra en annen kopi. Tåler duplikater og feil rekkefølge:
   * viser den til et tegn vi ikke har sett ennå, legges den på vent.
   * Gir endringene i den synlige teksten, så markøren kan flyttes riktig:
   * [{ type: 'insert', index, ch } | { type: 'delete', index }]
   */
  receive(op) {
    const changes = [];
    this.pending.push(op);
    // En operasjon som går gjennom, kan være det en annen ventet på. Prøv til ingenting skjer.
    for (let progress = true; progress;) {
      progress = false;
      for (let k = 0; k < this.pending.length; k++) {
        const waiting = this.pending[k];
        if (!this.ready(waiting)) continue;
        this.pending.splice(k--, 1);
        progress = true;
        const change = this.apply(waiting);
        if (change) changes.push(change);
      }
    }
    return changes;
  }

  ready(op) {
    if (op.type === 'delete') return this.known.has(key(op.id));
    return op.after === null || this.known.has(key(op.after));
  }

  apply(op) {
    if (op.type === 'delete') {
      const item = this.known.get(key(op.id));
      if (item.deleted) return null; // allerede slettet (samtidig sletting eller duplikat)
      const slot = this.items.indexOf(item);
      item.deleted = true;
      return { type: 'delete', index: this.visibleBefore(slot) };
    }
    if (this.known.has(key(op.id))) return null; // duplikat
    const slot = this.integrate(op);
    return { type: 'insert', index: this.visibleBefore(slot), ch: op.ch };
  }

  /**
   * Selve RGA. Det nye tegnet skal stå rett etter after, men andre kan ha satt inn
   * tegn samme sted samtidig. Vi går mot høyre forbi alle tegn med høyere id,
   * og stopper ved det første med lavere id.
   *
   * Det holder å sammenligne id-er fordi et tegn alltid har høyere teller enn
   * tegnet det ble satt inn etter (Lamport-klokke).
   */
  integrate(op) {
    let slot = op.after === null ? 0 : this.items.indexOf(this.known.get(key(op.after))) + 1;
    while (slot < this.items.length && newer(this.items[slot].id, op.id)) slot++;
    const item = { id: op.id, ch: op.ch, deleted: false };
    this.items.splice(slot, 0, item);
    this.known.set(key(op.id), item);
    this.clock = Math.max(this.clock, op.id[0]);
    return slot;
  }

  /** En kompakt signatur av hele tilstanden, også gravsteinene. To like kopier har lik signatur. */
  signature() {
    return this.items.map((item) => `${key(item.id)}${item.deleted ? '-' : '+'}${item.ch}`).join(' ');
  }
}

/**
 * Gjør en endring i et tekstfelt om til operasjoner.
 * Finner felles start og slutt, sletter det som ble borte og setter inn det nye.
 */
export function applyEdit(replica, before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start
    && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const ops = [];
  for (let k = before.length - end - start; k > 0; k--) ops.push(replica.delete(start));
  for (let k = start; k < after.length - end; k++) ops.push(replica.insert(k, after[k]));
  return ops;
}
