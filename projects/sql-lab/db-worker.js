// PostgreSQL kjører i en egen tråd, så siden ikke låser seg mens databasen starter og fylles.
//
// Meldinger inn:  { id, method: 'open' | 'exec' | 'query', args }
// Meldinger ut:   { id, result, ms } eller { id, error: { message, download } }

// PostgreSQL kompilert til WebAssembly. Versjonen er låst, så siden ikke endrer seg under oss.
const PGLITE_URL = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.16/dist/index.js';

let PGlite = null;
let db = null;

self.onmessage = async ({ data: { id, method, args = [] } }) => {
  try {
    if (method === 'open') {
      try {
        PGlite ??= (await import(PGLITE_URL)).PGlite;
      } catch (error) {
        self.postMessage({ id, error: { message: error.message, download: true } });
        return;
      }
      db = new PGlite(); // i minnet: forsvinner når fanen lukkes
      await db.waitReady;
      self.postMessage({ id, result: true });
      return;
    }
    if (method !== 'exec' && method !== 'query') throw new Error(`Ukjent kall: ${method}`);
    const started = performance.now();
    const result = await db[method](...args);
    self.postMessage({ id, result, ms: performance.now() - started });
  } catch (error) {
    self.postMessage({ id, error: { message: error.message } });
  }
};
