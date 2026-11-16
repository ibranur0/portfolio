// Tester for robotspillet:  node projects/robot/test.mjs
//
// Hvert nivå har en løsning i Kvist. Testene sjekker at den holder seg innenfor par
// på alle banene, at startkoden ikke løser nivået, og at feilmeldingene er forståelige.
import assert from 'node:assert/strict';
import { LEVELS, World, Attempt, solve, stars, programSize } from './robot.js';

/** Referanseløsningene. Spillet viser dem ikke. */
export const SOLUTIONS = {
  steg: 'frem(); frem(); frem();',
  hjornet: 'frem(); frem(); frem(); høyre(); frem(); frem(); frem();',
  gjenta: 'for i in range(8) { frem(); }',
  trappen: `
fn trinn() { frem(); venstre(); frem(); høyre(); }
for i in range(4) { trinn(); }`,
  veggen: 'while fri() { frem(); }',
  svingen: `
fn tilVeggen() { while fri() { frem(); } }
tilVeggen();
venstre();
tilVeggen();`,
  labyrinten: `
while not mål() {
  if friHøyre() { høyre(); frem(); }
  else if fri() { frem(); }
  else { venstre(); }
}`,
};

/* ---------- Banene er gyldige ---------- */
for (const level of LEVELS) {
  for (const rows of level.maps) {
    assert.ok(rows.every((row) => row.length === rows[0].length), `${level.name}: radene er ikke like lange`);
    const text = rows.join('');
    assert.equal((text.match(/[\^>v<]/g) ?? []).length, 1, `${level.name}: banen skal ha nøyaktig en robot`);
    assert.equal((text.match(/M/g) ?? []).length, 1, `${level.name}: banen skal ha nøyaktig ett mål`);
    const border = [rows[0], rows.at(-1), ...rows.map((row) => row[0] + row.at(-1))].join('');
    assert.match(border, /^#+$/, `${level.name}: banen skal ha vegg hele veien rundt`);
  }
}

/* ---------- Referanseløsningene ---------- */
for (const level of LEVELS) {
  const source = SOLUTIONS[level.id];
  assert.ok(source, `${level.name} mangler referanseløsning`);
  const result = solve(level, source);
  assert.ok(result.won, `${level.name}: referanseløsningen feiler på bane ${result.map + 1}: ${result.reason}`);
  assert.ok(result.size <= level.par, `${level.name}: referanseløsningen er på ${result.size} symboler, par er ${level.par}`);
  assert.equal(stars(level, result.size, true), 3);
  // Startkoden skal kompilere, men ikke løse nivået: ellers er det ingenting å gjøre.
  const starter = solve(level, level.starter);
  assert.equal(starter.won, false, `${level.name}: startkoden løser allerede nivået`);
  console.log(`OK: ${level.name.padEnd(14)} ${level.maps.length} ${level.maps.length === 1 ? 'bane ' : 'baner'}, løst med ${String(result.size).padStart(2)} symboler (par ${level.par}) og ${result.moves} bevegelser`);
}

/* ---------- Snarveier holder ikke ---------- */
{
  // Å telle rutene virker på en bane, men ikke på alle tre.
  const counted = solve(LEVELS.find((l) => l.id === 'veggen'), 'for i in range(3) { frem(); }');
  assert.equal(counted.won, false);
  assert.equal(counted.map, 1, 'telling skal klare første bane og feile på den andre');
  // Venstrehåndsregelen uten sensorer er ikke nok i labyrinten.
  assert.equal(solve(LEVELS.at(-1), 'while fri() { frem(); }').won, false);
}

/* ---------- Reglene ---------- */
{
  const world = new World(['#####', '#>*M#', '#####']);
  assert.equal(world.free(), true);
  assert.equal(world.free(-1), false);
  world.forward();
  assert.equal(world.crystals.size, 0, 'krystallen plukkes opp');
  world.forward();
  assert.equal(world.status, 'won');
  world.forward();
  assert.equal(world.moves, 2, 'ingenting skjer etter at banen er klart');
}
const outcome = (source, rows = ['#####', '#>.M#', '#####']) => {
  const attempt = new Attempt(source, rows);
  while (!attempt.outcome) attempt.advance();
  return attempt.outcome;
};
assert.match(outcome('frem(); frem(); frem();').reason, /^$/);                               // vinner på andre steg, resten ignoreres
assert.match(outcome('venstre(); frem();').reason, /kjørte i veggen/);
assert.match(outcome('frem();').reason, /står ikke på målet/);
assert.match(outcome('frem(); frem();', ['#####', '#>.M#', '#*..#', '#####']).reason, /en krystall ligger igjen/);
assert.match(outcome('while true { venstre(); }').reason, /Batteriet er tomt/);
assert.match(outcome('while true { }').reason, /står og spinner/);
assert.match(outcome('frem(1);').reason, /Kjøretidsfeil på linje 1: frem tar 0 argumenter/);
assert.throws(() => new Attempt('fram();', ['###', '#>#', '###']), (error) => error.kind === 'Kompileringsfeil' && /Ukjent navn "fram"/.test(error.message));
assert.throws(() => programSize('frem('), (error) => error.kind === 'Syntaksfeil');
// Roboten gjør nøyaktig en ting per advance(), slik at hver bevegelse kan animeres.
{
  const attempt = new Attempt('frem(); høyre(); venstre(); frem();', ['#####', '#>.M#', '#####']);
  assert.deepEqual(attempt.advance().map((e) => e.type), ['move']);
  assert.equal(attempt.line, 1);
  assert.deepEqual(attempt.advance().map((e) => e.type), ['turn']);
  assert.deepEqual(attempt.advance().map((e) => e.type), ['turn']);
  assert.deepEqual(attempt.advance().map((e) => e.type), ['move']);
  assert.equal(attempt.outcome.won, true);
}
console.log('OK: regler, feilmeldinger og snarveier som ikke holder');
