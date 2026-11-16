// Tester for brubyggespillet:  node projects/bro/test.mjs
//
// Hvert nivå har en løsning her. Testene sjekker at nivået kan løses med tre stjerner,
// at stjernegrensene gir mening, at bare veidekke ikke holder, og at fysikken gir
// samme svar hver gang.
import assert from 'node:assert/strict';
import { LEVELS, MATERIALS, MAX_BEAM, Simulation, simulate, cost, roadPath, buildable, stars, budget, sameBeam } from './bridge.js';

const level = (id) => LEVELS.find((l) => l.id === id);
const deck = (from, to) => Array.from({ length: to - from }, (_, k) => [from + k, 0, from + k + 1, 0, 'road']);

/** Fagverk over veien: en overgurt i høyde 1, med stolper og diagonaler ned til dekket. */
function trussAbove(from, to, material = 'wood') {
  const beams = [];
  for (let x = from + 1; x < to; x++) {
    beams.push([x, 1, x, 0, material]);                                   // stolpe
    if (x + 1 < to) beams.push([x, 1, x + 1, 1, material]);               // overgurt
    if (x + 1 < to) beams.push(x < (from + to) / 2 ? [x, 1, x + 1, 0, material] : [x, 0, x + 1, 1, material]); // diagonal mot midten
  }
  beams.push([from, 0, from + 1, 1, material], [to - 1, 1, to, 0, material]);
  return beams;
}

/** Fagverk under veien: speilbildet av fagverket over. */
const trussBelow = (from, to, material) => trussAbove(from, to, material).map(([ax, ay, bx, by, m]) => [ax, -ay, bx, -by, m]);

/**
 * Bue under veien fra to fester i fjellveggen, med stolper opp til dekket.
 * pick(rolle, x) velger materiale: 'fot', 'ende', 'stolpe', 'gurt' eller 'diagonal'.
 */
function archBelow(from, to, pick = () => 'wood') {
  if (typeof pick === 'string') { const material = pick; pick = () => material; }
  const beams = [[from, -2, from + 1, -1, pick('fot', from)], [to, -2, to - 1, -1, pick('fot', to - 1)]];
  for (let x = from + 1; x < to; x++) {
    beams.push([x, -1, x, 0, pick('stolpe', x)]);
    if (x + 1 < to) beams.push([x, -1, x + 1, -1, pick('gurt', x)]);
    if (x + 1 < to) beams.push(x < (from + to) / 2 ? [x, -1, x + 1, 0, pick('diagonal', x)] : [x, 0, x + 1, -1, pick('diagonal', x)]);
  }
  beams.push([from, 0, from + 1, -1, pick('ende', from)], [to - 1, -1, to, 0, pick('ende', to - 1)]);
  return beams;
}

/** Stål bare nær festene, der kreftene er størst. Tre resten av veien. */
const steelNearSupports = (from, to) => (role, x) =>
  (['fot', 'ende'].includes(role) || (['gurt', 'diagonal'].includes(role) && (x <= from + 1 || x >= to - 2)) ? 'steel' : 'wood');

/** Referanseløsningene. Spillet viser dem ikke, men de beviser at nivåene kan løses. */
export const SOLUTIONS = {
  bekken: [...level('bekken').start, [5, 0, 6, 0, 'road'], [6, 0, 7, 0, 'road']],
  elva: [...deck(4, 10), ...trussAbove(4, 10)],
  juvet: [...deck(4, 12), ...archBelow(4, 12)],
  pilaren: [...deck(4, 16), ...archBelow(4, 10), ...archBelow(10, 16)],
  tungtransport: [...deck(4, 12), ...archBelow(4, 12, steelNearSupports(4, 12))],
};

/**
 * Bruer som skal gi akkurat så mange stjerner. En bru med for mye i seg skal
 * fortsatt godkjennes, bare med færre stjerner.
 */
const STIGEN = {
  bekken: [
    [2, 'ekstra trekanter under veien', [...SOLUTIONS.bekken, [5, 0, 5, -1, 'wood'], [5, -1, 6, 0, 'wood'], [6, 0, 6, -1, 'wood'], [6, -1, 7, 0, 'wood']]],
    [1, 'fagverk både over og under', [...SOLUTIONS.bekken, ...trussBelow(4, 8, 'wood')]],
  ],
  elva: [
    [2, 'fagverk over med overgurt i stål', [...deck(4, 10), ...trussAbove(4, 10).map((b) => (b[1] === 1 && b[3] === 1 ? [...b.slice(0, 4), 'steel'] : b))]],
    [1, 'fagverk både over og under', [...deck(4, 10), ...trussAbove(4, 10), ...trussBelow(4, 10, 'wood')]],
  ],
  juvet: [
    [1, 'fagverk både over og under', [...deck(4, 12), ...trussAbove(4, 12), ...trussBelow(4, 12, 'wood')]],
  ],
  tungtransport: [
    [2, 'stål overalt unntatt stolpene', [...deck(4, 12), ...archBelow(4, 12, (role) => (role === 'stolpe' ? 'wood' : 'steel'))]],
    [1, 'buen helt i stål', [...deck(4, 12), ...archBelow(4, 12, 'steel')]],
  ],
};

/* ---------- Nivåene er gyldige ---------- */
for (const l of LEVELS) {
  const [three, two, limit] = l.stars;
  assert.ok(three < two && two < limit, `${l.name}: stjernegrensene skal stige`);
  assert.equal(budget(l), limit);
  assert.deepEqual(l.anchors[0], [l.left, 0], `${l.name}: første feste er venstre brufeste`);
  assert.deepEqual(l.anchors[1], [l.right, 0], `${l.name}: andre feste er høyre brufeste`);
}

/* ---------- Referanseløsningene ---------- */
for (const l of LEVELS) {
  const design = SOLUTIONS[l.id];
  assert.ok(design, `${l.name} mangler referanseløsning`);
  for (const beam of design) {
    const [ax, ay, bx, by, material] = beam;
    assert.ok(MATERIALS[material], `${l.name}: ukjent materiale`);
    assert.ok(Math.hypot(bx - ax, by - ay) <= MAX_BEAM, `${l.name}: for lang bjelke`);
    assert.ok(buildable(l, ax, ay) && buildable(l, bx, by), `${l.name}: bjelke utenfor byggeområdet (${beam})`);
    assert.equal(design.filter((other) => sameBeam(other, beam)).length, 1, `${l.name}: dobbel bjelke (${beam})`);
  }
  assert.ok(roadPath(l, design), `${l.name}: veien henger ikke sammen`);
  const sim = simulate(l, design);
  const spent = cost(design);
  assert.equal(sim.status, 'won', `${l.name}: referanseløsningen holder ikke (${sim.reason}, belastning ${sim.maxStress.toFixed(2)})`);
  assert.equal(sim.broken, 0, `${l.name}: en bjelke røk i referanseløsningen`);
  assert.ok(spent <= l.stars[0], `${l.name}: referanseløsningen koster ${spent}, tre stjerner krever ${l.stars[0]}`);
  assert.equal(stars(l, design, true), 3);
  // Løsningen skal tåle 5 % tyngre trafikk, så tre stjerner ikke avhenger av flaks.
  const heavier = { ...l, vehicles: l.vehicles.map((v) => ({ ...v, mass: v.mass * 1.05 })) };
  assert.equal(simulate(heavier, design).status, 'won', `${l.name}: referanseløsningen tåler ikke 5 % tyngre last`);
  console.log(`OK: ${l.name.padEnd(14)} ★★★ ${String(spent).padStart(5)} kr (grenser ${l.stars.join(' / ')}), høyeste belastning ${Math.round(sim.maxStress * 100)} %`);
}

/* ---------- Stjernestigen ---------- */
for (const [id, rungs] of Object.entries(STIGEN)) {
  const l = level(id);
  for (const [expected, label, design] of rungs) {
    const sim = simulate(l, design);
    assert.equal(sim.status, 'won', `${l.name}, ${label}: skal holde (${sim.reason})`);
    assert.equal(stars(l, design, true), expected, `${l.name}, ${label}: ${cost(design)} kr skal gi ${expected} stjerner`);
    console.log(`OK: ${l.name.padEnd(14)} ${'★'.repeat(expected).padEnd(3, '☆')} ${String(cost(design)).padStart(5)} kr  ${label}`);
  }
}
{
  // Over budsjettet: brua holder, men godkjennes ikke. Og en bru som ryker, gir aldri stjerner.
  const l = level('elva');
  const gold = [...deck(4, 10), ...trussAbove(4, 10, 'steel'), ...trussBelow(4, 10, 'steel')];
  assert.equal(simulate(l, gold).status, 'won');
  assert.ok(cost(gold) > budget(l));
  assert.equal(stars(l, gold, true), 0, 'en bru over budsjettet gir ingen stjerner');
  assert.equal(stars(l, SOLUTIONS.elva, false), 0, 'en bru som ryker gir ingen stjerner');
}
console.log('OK: grensene gir en stige fra en til tre stjerner, og over budsjettet gir null');

/* ---------- Snarveier holder ikke ---------- */
for (const l of LEVELS) {
  const bare = simulate(l, deck(l.left, l.right));
  assert.equal(bare.status, 'failed', `${l.name}: bare veidekke skal ikke holde`);
  assert.ok(bare.broken > 0, `${l.name}: veidekket alene skal ryke`);
}
{
  // Uten hel vei starter ikke testen, og uten det siste veistykket på nivå 1 faller bilen.
  const l = level('bekken');
  assert.equal(roadPath(l, l.start), null);
  assert.equal(simulate(l, l.start).status, 'failed');
  // Tungtransporten er for tung for buen i tre som holder på "Juvet".
  const heavy = simulate(level('tungtransport'), SOLUTIONS.juvet);
  assert.equal(heavy.status, 'failed', 'trebuen skal ikke tåle tungtransporten');
  // Stål bare i selve buen er ikke nok: diagonalene nær festene må også være stål.
  const archOnly = [...deck(4, 12), ...archBelow(4, 12, (role) => (['gurt', 'fot'].includes(role) ? 'steel' : 'wood'))];
  assert.equal(simulate(level('tungtransport'), archOnly).status, 'failed', 'stål bare i buen skal ikke holde');
}
console.log('OK: veidekket alene ryker på alle nivåer, og trebuen tåler ikke tungtransporten');

/* ---------- Determinisme og energi ---------- */
{
  const l = level('juvet');
  const a = new Simulation(l, SOLUTIONS.juvet), b = new Simulation(l, SOLUTIONS.juvet);
  for (let k = 0; k < 600; k++) { a.step(); b.step(); }
  assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]), 'samme design skal gi samme forløp');
  // En bru som står i ro, skal falle til ro: ingen energi skapes av integrasjonen.
  const still = new Simulation({ ...l, vehicles: [{ mass: 0, speed: 0 }] }, SOLUTIONS.juvet); // et kjøretøy som aldri kjører
  for (let k = 0; k < 900; k++) still.step();
  const speed = Math.max(...still.nodes.map((n) => Math.hypot(n.vx, n.vy)));
  assert.ok(speed < 1e-3, `brua står ikke i ro (fart ${speed})`);
  const sag = Math.min(...still.nodes.map((n) => n.y - Math.round(n.y)));
  assert.ok(sag > -0.15, `brua synker urimelig mye under egen vekt (${sag.toFixed(3)} m)`);
}
console.log('OK: fysikken er deterministisk, og en ubelastet bru faller til ro');
