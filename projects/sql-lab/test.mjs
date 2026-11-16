// Kjører alle eksempelspørringene mot en ekte PostgreSQL (PGlite) og tester setningsdeleren.
//   npm install --no-save @electric-sql/pglite@0.5.16 && node projects/sql-lab/test.mjs
import assert from 'node:assert/strict';
import { SCHEMA_SQL, EXAMPLES } from './data.js';
import { splitStatements } from './split.js';

/* ---------- Setningsdeleren ---------- */
assert.deepEqual(splitStatements('SELECT 1; SELECT 2;'), ['SELECT 1', 'SELECT 2']);
assert.deepEqual(splitStatements("SELECT 'a;b' AS x; -- kommentar; med semikolon\nSELECT 2"), ["SELECT 'a;b' AS x", 'SELECT 2']);
assert.deepEqual(splitStatements("SELECT 'det''s; her'"), ["SELECT 'det''s; her'"]);
assert.deepEqual(splitStatements('SELECT "rar;kolonne" FROM t /* blokk; kommentar */;'), ['SELECT "rar;kolonne" FROM t']);
assert.deepEqual(splitStatements('DO $$ BEGIN PERFORM 1; END $$; SELECT 1'), ['DO $$ BEGIN PERFORM 1; END $$', 'SELECT 1']);
assert.deepEqual(splitStatements('  -- bare en kommentar\n ;; '), []);
console.log('OK: setningsdeleren');

/* ---------- Eksemplene ---------- */
let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  console.log('Hopper over eksemplene: installer @electric-sql/pglite for å kjøre dem.');
  process.exit(0);
}
const db = new PGlite();
await db.exec(SCHEMA_SQL);
const count = async (table) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
assert.equal(await count('stasjon'), 24);
assert.equal(await count('medlem'), 3000);
assert.equal(await count('tur'), 40000);

for (const example of EXAMPLES) {
  const statements = splitStatements(example.sql);
  assert.equal(statements.length, 1, `${example.title}: skal være en setning`);
  const result = await db.query(statements[0]);
  assert.ok(result.rows.length > 0, `${example.title}: ga ingen rader`);
  const plan = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${statements[0]}`);
  assert.ok(plan.rows.length === 1, `${example.title}: ingen plan`);
  console.log(`OK: ${example.title} (${result.rows.length} rader)`);
}

// Indekseksemplet: planen skal bytte fra sekvensielt søk til indekssøk.
const lookup = splitStatements(EXAMPLES.at(-1).sql)[0];
const planText = async () => JSON.stringify((await db.query(`EXPLAIN (FORMAT JSON) ${lookup}`)).rows[0]);
assert.match(await planText(), /Seq Scan/);
await db.exec('CREATE INDEX IF NOT EXISTS tur_medlem_idx ON tur (medlem_id)');
assert.match(await planText(), /tur_medlem_idx/);
console.log('OK: indeksen tas i bruk');

const reise = await db.query(splitStatements(EXAMPLES.find((e) => e.topic.startsWith('Rekursiv')).sql)[0]);
assert.equal(reise.rows.length, 8);
assert.equal(new Set(reise.rows.map((r) => r.navn)).size, 8, 'reisen skal aldri besøke samme stasjon to ganger');
console.log(`OK: rekursjonen (${reise.rows.map((r) => r.navn).join(' → ')})`);
await db.close();
