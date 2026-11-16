// Tester for CRDT-en:  node projects/samskriv/test.mjs [antall forløp]
//
// Det som testes er at kopiene blir like. Har de fått de samme operasjonene,
// skal de ende med samme tekst uansett rekkefølge, forsinkelser og duplikater.
import assert from 'node:assert/strict';
import { Replica, applyEdit } from './crdt.js';
import { randomRun } from './fuzz.js';

const started = performance.now();
const ROUNDS = Number(process.argv[2]) || 5000;

/** Skriver en hel tekst inn i en kopi, tegn for tegn, fra posisjon "at". */
const type = (replica, at, text) => [...text].map((ch, k) => replica.insert(at + k, ch));
const deliver = (replica, ops) => ops.forEach((op) => replica.receive(op));

/* ====================== 1. Scenarier ====================== */
{
  // Samtidig skriving på samme sted: begge ord overlever, hele, og i samme rekkefølge hos begge.
  const a = new Replica('ada'), b = new Replica('bo');
  const base = type(a, 0, 'Hei verden');
  deliver(b, base);
  const fromA = type(a, 4, 'kjære ');
  const fromB = type(b, 4, 'vakre ');
  deliver(a, fromB);
  deliver(b, fromA);
  assert.equal(a.text(), b.text());
  assert.ok(['Hei kjære vakre verden', 'Hei vakre kjære verden'].includes(a.text()), a.text());
}
{
  // Sletting og innsetting samtidig: innsettingen finner stedet sitt selv om naboen er slettet.
  const a = new Replica('ada'), b = new Replica('bo');
  deliver(b, type(a, 0, 'abc'));
  const del = a.delete(1);            // Ada sletter "b"
  const ins = b.insert(2, 'X');       // Bo setter inn X rett etter "b"
  a.receive(ins);
  b.receive(del);
  assert.equal(a.text(), 'aXc');
  assert.equal(b.text(), 'aXc');
}
{
  // Begge sletter det samme tegnet: det forsvinner en gang.
  const a = new Replica('ada'), b = new Replica('bo');
  deliver(b, type(a, 0, 'abc'));
  const d1 = a.delete(1), d2 = b.delete(1);
  a.receive(d2);
  b.receive(d1);
  assert.equal(a.text(), 'ac');
  assert.equal(b.text(), 'ac');
}
{
  // Baklengs levering og duplikater: operasjoner som kommer for tidlig, venter på det de viser til.
  const a = new Replica('ada'), b = new Replica('bo');
  const ops = [...type(a, 0, 'hallo'), a.delete(0), ...type(a, 0, 'H')];
  deliver(b, [...ops].reverse());
  deliver(b, ops);
  assert.equal(b.text(), 'Hallo');
  assert.equal(b.pending.length, 0);
  assert.equal(b.signature(), a.signature());
}
{
  // receive() melder fra om hvor i den synlige teksten endringen skjedde (for å flytte markøren).
  const a = new Replica('ada'), b = new Replica('bo');
  deliver(b, type(a, 0, 'abc'));
  assert.deepEqual(b.receive(a.insert(1, 'X')), [{ type: 'insert', index: 1, ch: 'X' }]);
  assert.deepEqual(b.receive(a.delete(0)), [{ type: 'delete', index: 0 }]);
  assert.equal(b.text(), 'Xbc');
}
{
  // applyEdit: en endring i et tekstfelt blir til riktige operasjoner.
  const a = new Replica('ada'), b = new Replica('bo');
  let text = '';
  for (const next of ['Hei', 'Hei verden', 'Hei, verden', 'Hallo, verden', 'Hallo', '', 'aaa', 'aa', 'aaaa', 'abab', 'ab']) {
    deliver(b, applyEdit(a, text, next));
    text = next;
    assert.equal(a.text(), next);
    assert.equal(b.text(), next);
  }
}
{
  // Alle 720 rekkefølger av seks operasjoner fra tre forfattere gir samme resultat.
  const a = new Replica('ada'), b = new Replica('bo'), c = new Replica('cleo');
  const base = type(a, 0, 'xy');
  deliver(b, base); deliver(c, base);
  const ops = [...type(a, 1, 'A1'), ...type(b, 1, 'B'), b.delete(0), ...type(c, 2, 'C'), c.delete(0)];
  const results = new Set();
  const permute = (rest, chosen) => {
    if (!rest.length) {
      const fresh = new Replica('ny');
      deliver(fresh, base);
      deliver(fresh, chosen);
      assert.equal(fresh.pending.length, 0);
      results.add(fresh.signature());
      return;
    }
    rest.forEach((op, k) => permute(rest.filter((_, j) => j !== k), [...chosen, op]));
  };
  permute(ops, []);
  assert.equal(results.size, 1, 'alle rekkefølger skal gi samme tilstand');
}
console.log('OK: scenarier (samtidig skriving, sletting, omvendt rekkefølge, duplikater, alle 720 rekkefølger)');

/* ====================== 2. Tilfeldige forløp ====================== */
// Selve forløpet ligger i fuzz.js, slik at selvtesten på nettsiden kjører nøyaktig det samme.
let operations = 0, deliveries = 0;
for (let seed = 1; seed <= ROUNDS; seed++) {
  const run = randomRun(seed);
  operations += run.operations;
  deliveries += run.deliveries;
}
console.log(`OK: ${ROUNDS.toLocaleString('nb-NO')} tilfeldige forløp, ${operations.toLocaleString('nb-NO')} endringer, ${deliveries.toLocaleString('nb-NO')} leveringer. Alle kopier endte likt.`);
console.log(`Ferdig på ${Math.round(performance.now() - started)} ms`);
