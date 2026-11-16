// Tester for Raft-simuleringen. Kjør med: node test.mjs [antall frø]
//
// For hvert frø kjøres klyngen gjennom tilfeldige krasj, omstarter, nettverksdelinger
// og pakketap, og reglene sjekkes hvert tikk. Så repareres alt, og nodene skal bli
// enige igjen.
import assert from 'node:assert/strict';
import { Sim } from './raft.js';
import { chaosRun, mutationCaught } from './fuzz.js';

const seeds = Number(process.argv[2]) || 1500;
const started = performance.now();
let checks = 0;
const check = (condition, what) => { checks++; assert.ok(condition, what); };

const cluster = (size, seed) => Object.assign(new Sim(size, seed), { strict: true });
const run = (sim, ticks) => { sim.run(ticks); assert.equal(sim.violation, null); };
const storeOf = (sim, id) => sim.nodes[id].store;
/** Antall ledere i den høyeste terminen blant levende noder. */
const leaders = (sim) => {
  const alive = sim.nodes.filter((n) => n.alive);
  const top = Math.max(...alive.map((n) => n.currentTerm));
  return alive.filter((n) => n.role === 'LEADER' && n.currentTerm === top).length;
};
/** En liten tilfeldighetsgenerator for testene, uavhengig av simuleringens egen. */
const dice = (seed) => {
  let s = seed >>> 0;
  return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 4294967296) * n); };
};

/* ---------------------------------------------------------- Scenarier */
for (let size = 1; size <= 7; size++) {
  const sim = cluster(size, 7 + size);
  run(sim, 1500);
  check(leaders(sim) === 1, `en leder i klynge med ${size} noder`);
}

{ // Replikering til alle
  const sim = cluster(5, 1);
  run(sim, 1000);
  check(sim.propose(-1, 'x', '1'), 'lederen tar imot kommandoen');
  run(sim, 400);
  for (let i = 0; i < 5; i++) check(storeOf(sim, i).get('x') === '1', `S${i} har utført x = 1`);
}

{ // Lederen krasjer
  const sim = cluster(5, 2);
  run(sim, 1000);
  sim.propose(-1, 'a', '1');
  run(sim, 300);
  const old = sim.leader().id;
  sim.crash(old);
  run(sim, 1500);
  const next = sim.leader();
  check(next && next.id !== old, 'ny leder etter krasj');
  check(sim.propose(-1, 'b', '2'), 'ny leder tar imot kommandoer');
  run(sim, 400);
  check(next.store.get('a') === '1', 'bekreftet verdi overlever lederbyttet');
}

{ // Et mindretall kan ikke bekrefte noe
  const sim = cluster(5, 3);
  run(sim, 1000);
  const old = sim.leader();
  const before = sim.committed.length;
  sim.isolate(old.id);
  check(sim.propose(old.id, 'tapt', '1'), 'isolert leder tar fortsatt imot kommandoer');
  run(sim, 2000);
  check(old.commitIndex <= before, 'isolert leder får ikke bekreftet noe uten flertall');
  check(!old.store.has('tapt'), 'ubekreftet kommando er ikke utført');
}

{ // Avvikende logg overskrives når nettverket repareres
  const sim = cluster(5, 4);
  run(sim, 1000);
  const old = sim.leader();
  sim.isolate(old.id);
  sim.propose(old.id, 'tapt', '1');
  run(sim, 1500);
  const next = sim.nodes.find((n) => n.id !== old.id && n.role === 'LEADER');
  check(next && sim.propose(next.id, 'vinner', '2'), 'flertallet har valgt ny leder');
  run(sim, 400);
  sim.heal();
  run(sim, 1500);
  check(!old.store.has('tapt'), 'den gamle lederens ubekreftede oppføring er forkastet');
  check(old.store.get('vinner') === '2', 'den gamle lederen har tatt til seg flertallets logg');
  check(leaders(sim) === 1, 'bare en leder etter reparasjon');
}

{ // Omstart: tilstanden bygges opp igjen fra loggen
  const sim = cluster(3, 5);
  run(sim, 1000);
  sim.propose(-1, 'k', 'v');
  run(sim, 300);
  const victim = (sim.leader().id + 1) % 3;
  sim.crash(victim);
  run(sim, 200);
  sim.restart(victim);
  check(storeOf(sim, victim).size === 0, 'tilstandsmaskinen er tom rett etter omstart');
  run(sim, 600);
  check(storeOf(sim, victim).get('k') === 'v', 'tilstanden bygges opp igjen fra loggen');
}

{ // Determinisme
  const a = cluster(5, 99), b = cluster(5, 99), c = cluster(5, 100);
  for (const sim of [a, b, c]) { sim.run(1200); sim.crash(1); sim.run(1800); }
  check(JSON.stringify(a.snapshot()) === JSON.stringify(b.snapshot()), 'samme frø gir identisk kjøring');
  check(JSON.stringify(a.snapshot()) !== JSON.stringify(c.snapshot()), 'ulikt frø gir ulik kjøring');
}

/* ------------------------------------------------------- Egenskapstest */
// Selve kaosforløpet ligger i fuzz.js, slik at selvtesten på nettsiden kjører nøyaktig det samme.
for (let seed = 1; seed <= seeds; seed++) checks += chaosRun(seed);

/* -------------------------------------------------------- Mutasjonstest */
// Uten regelen om oppdatert logg skal testene oppdage at data går tapt.
// Da vet jeg at testene faktisk fanger feil.
{
  const caught = mutationCaught();
  check(caught, 'kontrollene fanger en ødelagt stemmeregel');
  console.log(`Mutasjonstest: "${caught}"`);
}

console.log(`OK: ${checks} kontroller, ${seeds} kaosfrø, ${Math.round(performance.now() - started)} ms`);
