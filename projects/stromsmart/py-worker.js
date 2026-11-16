// Python (Pyodide) kjører i en egen tråd, så siden ikke låser seg mens den starter.
//
// Meldinger inn:  { type: 'start', source }        stromsmart.py som tekst
//                 { type: 'analyze', id, request }  JSON inn til analyze()
// Meldinger ut:   { type: 'ready', version, seconds } eller { type: 'failed', message }
//                 { type: 'result', id, json }      JSON ut fra analyze()

// Pyodide: CPython kompilert til WebAssembly. Versjonen er låst.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/';

let analyze = null;

self.onmessage = async ({ data }) => {
  if (data.type === 'start') {
    try {
      const started = performance.now();
      const { loadPyodide } = await import(`${PYODIDE}pyodide.mjs`);
      const py = await loadPyodide({ indexURL: PYODIDE });
      // Filen skrives til Pyodides filsystem og importeres som en vanlig modul, helt uendret.
      py.FS.writeFile('stromsmart.py', data.source);
      analyze = py.pyimport('stromsmart').analyze;
      self.postMessage({
        type: 'ready',
        version: py.runPython('import platform; platform.python_version()'),
        seconds: (performance.now() - started) / 1000,
      });
    } catch (error) {
      self.postMessage({ type: 'failed', message: error.message });
    }
  } else if (data.type === 'analyze') {
    let json;
    try {
      json = analyze(data.request);
    } catch (error) {
      // En uventet feil i Python skal vises som en melding, ikke la siden vente for alltid.
      json = JSON.stringify({ error: `Python-koden feilet: ${error.message.split('\n').filter(Boolean).at(-1)}` });
    }
    self.postMessage({ type: 'result', id: data.id, json });
  }
};
