/**
 * Ett tilfeldig forløp for Raft-klyngen. Brukes av test.mjs og av selvtesten på siden.
 *
 * Klyngen kjører 5000 tikk med tilfeldige krasj, omstarter, nettverksdelinger og
 * pakketap, og reglene sjekkes hvert tikk. Så repareres alt, og nodene skal bli
 * enige igjen. Kaster en feil med frøet hvis noe er galt.
 */
import { Sim } from './raft.js';

/** En liten tilfeldighetsgenerator for feilinjeksjonen, uavhengig av simuleringens egen. */
const dice = (seed) => {
  let s = seed >>> 0;
  return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 4294967296) * n); };
};

const must = (condition, message) => { if (!condition) throw new Error(message); };

/** @returns {number} antall kontroller som ble gjort etter reparasjonen */
export function chaosRun(seed) {
  const size = 3 + 2 * (seed % 3); // 3, 5 eller 7 noder
  const sim = Object.assign(new Sim(size, seed), { strict: true }); // strict: loggsamsvar kontrolleres hvert tikk
  const roll = dice(seed * 7919);
  let commands = 0;

  for (let step = 0; step < 5000; step++) {
    sim.step();
    const r = roll(1000), target = roll(size);
    if (r < 4) sim.crash(target);
    else if (r < 10) sim.restart(target);
    else if (r < 12) sim.isolate(target);
    else if (r < 14) sim.split(sim.nodes.filter(() => roll(2) === 0).map((n) => n.id));
    else if (r < 19) sim.heal();
    else if (r < 21) sim.setDropRate(roll(35) / 100);
    else if (r < 60) sim.propose(target, `k${roll(6)}`, String(commands++));
    must(!sim.violation, `Frø ${seed}, tikk ${step}: ${sim.violation}`);
  }

  // Livskraft: når feilene opphører, skal klyngen bli enig igjen.
  sim.heal();
  sim.setDropRate(0);
  for (let i = 0; i < size; i++) sim.restart(i);
  sim.run(2500);
  must(!sim.violation, `Frø ${seed}: ${sim.violation}`);
  must(sim.propose(-1, 'slutt', '1'), `Frø ${seed}: klyngen har ingen leder etter reparasjon`);
  sim.run(800);
  must(!sim.violation, `Frø ${seed}: ${sim.violation}`);
  const reference = JSON.stringify([...sim.nodes[0].store].sort());
  for (const node of sim.nodes) {
    must(node.commitIndex === sim.committed.length, `Frø ${seed}: S${node.id} er ikke oppdatert`);
    must(JSON.stringify([...node.store].sort()) === reference, `Frø ${seed}: S${node.id} har en annen tilstand enn S0`);
  }
  return 1 + 2 * size;
}

/**
 * Slår av regelen om at velgere krever en oppdatert logg, og leter etter et frø
 * der testene oppdager at data går tapt. Gir meldingen, eller null.
 */
export function mutationCaught(maxSeeds = 300) {
  for (let seed = 1; seed <= maxSeeds; seed++) {
    const sim = Object.assign(new Sim(5, seed), { strict: true, faultSkipVoteCheck: true });
    const roll = dice(seed);
    for (let step = 0; step < 6000 && !sim.violation; step++) {
      sim.step();
      const r = roll(1000);
      if (r < 6) sim.crash(roll(5));
      else if (r < 14) sim.restart(roll(5));
      else if (r < 60) sim.propose(-1, 'k', String(step));
    }
    if (sim.violation) return sim.violation;
  }
  return null;
}
