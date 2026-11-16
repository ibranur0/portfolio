import { SCHEMA_SQL, EXAMPLES, NODE_HELP } from './data.js';
import { splitStatements } from './split.js';
import { el, fill, insertText } from '../../assets/js/ui.js';

const MAX_ROWS = 500;
const NUMERIC_TYPES = new Set([20, 21, 23, 26, 700, 701, 1700]); // int8, int2, int4, oid, float4, float8, numeric

const $ = (id) => document.getElementById(id);
const editor = $('editor');
const fmtMs = (ms) => `${ms < 10 ? ms.toFixed(1).replace('.', ',') : Math.round(ms)} ms`;
const fmtInt = (n) => Math.round(n).toLocaleString('nb-NO');

let db = null;
let busy = false;

/* ====================== Database ====================== */
/**
 * Databasen kjører i db-worker.js. Dette er et lite lag med de samme kallene
 * som PGlite (exec og query), som sender dem dit og venter på svaret.
 */
function connect() {
  const worker = new Worker(new URL('./db-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let next = 0;
  const fail = (message) => {
    for (const { reject } of pending.values()) reject(new Error(message));
    pending.clear();
  };
  worker.onmessage = ({ data }) => {
    const call = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) call?.reject(Object.assign(new Error(data.error.message), { download: data.error.download }));
    else { connection.ms = data.ms ?? 0; call?.resolve(data.result); }
  };
  worker.onerror = (event) => { event.preventDefault(); fail('Databasetråden stoppet uventet'); };
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
  const connection = {
    ms: 0, // hvor lenge det siste kallet brukte inne i databasen
    open: () => call('open'),
    exec: (sql, options) => call('exec', sql, options),
    query: (sql, params) => call('query', sql, params),
    close: () => { worker.terminate(); fail('Databasen ble lukket'); },
  };
  return connection;
}

async function boot() {
  setState('Starter PostgreSQL (laster ned ca. 5 MB første gang)...');
  db?.close();
  db = null;
  const next = connect();
  try {
    await next.open();
    setState('Fyller databasen med 40\u00a0000 turer...');
    await next.exec(SCHEMA_SQL);
    db = next;
    await renderSchema();
    setState('');
    setBusy(false);
    return true;
  } catch (error) {
    next.close();
    setState('');
    // Nettverksfeil fra nettleseren er på engelsk og sier lite, så vi skriver en egen forklaring.
    showError(error.download
      ? 'Klarte ikke å laste ned PostgreSQL fra cdn.jsdelivr.net. Sjekk nettforbindelsen, eller om en utvidelse i nettleseren blokkerer siden, og last siden på nytt.'
      : `Klarte ikke å starte PostgreSQL: ${error.message}. Last siden på nytt for å prøve igjen.`);
    return false;
  }
}

function setBusy(next) {
  busy = next;
  for (const id of ['run', 'plan', 'reset']) $(id).disabled = next || !db;
}

function setState(text) {
  $('state').hidden = !text;
  $('state').textContent = text;
}

function showError(message) {
  $('error').hidden = !message;
  $('error').textContent = message;
}


async function run({ plan = false } = {}) {
  if (busy || !db) return;
  setBusy(true);
  showError('');
  const sql = editor.value;
  try {
    const statements = splitStatements(sql);
    if (!statements.length) throw new Error('Skriv en spørring først.');
    if (plan) {
      // Planen gjelder den siste setningen. Det som står foran (f.eks. CREATE INDEX) kjøres først.
      const target = statements.pop();
      for (const statement of statements) await db.exec(statement);
      const result = await db.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${target}`);
      const raw = Object.values(result.rows[0])[0];
      renderPlan((typeof raw === 'string' ? JSON.parse(raw) : raw)[0]);
      selectView('plan');
      $('meta').textContent = statements.length
        ? `Kjørte ${statements.length} ${statements.length === 1 ? 'setning' : 'setninger'} først. Planen gjelder den siste.`
        : 'Spørringen ble kjørt for å måle faktisk tidsbruk.';
      if (statements.length) await renderSchema();
    } else {
      const results = await db.exec(sql, { rowMode: 'array' });
      const ms = db.ms;
      // Flere setninger: vis den siste som returnerte rader.
      const last = results.findLast((r) => r.fields?.length) ?? results.at(-1);
      renderTable(last);
      renderChart(last);
      $('view-plan').replaceChildren(el('p', { class: 'hint', text: 'Trykk "Vis plan" for å se hvordan PostgreSQL utfører spørringen.' }));
      if (document.querySelector('input[name="view"]:checked').value === 'plan') selectView('table');
      const rows = last?.fields?.length ? `${fmtInt(last.rows.length)} ${last.rows.length === 1 ? 'rad' : 'rader'}` : `${fmtInt(last?.affectedRows ?? 0)} rader endret`;
      $('meta').textContent = `${rows} · ${fmtMs(ms)}`;
      if (/\b(create|drop|alter)\b/i.test(sql)) await renderSchema();
    }
    $('result').hidden = false;
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

/* ====================== Tabell ====================== */
function formatValue(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    const iso = new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const isNumericColumn = (result, c) =>
  NUMERIC_TYPES.has(result.fields[c].dataTypeID) || result.rows.every((r) => r[c] == null || typeof r[c] === 'number' || typeof r[c] === 'bigint');

function renderTable(result) {
  const host = $('view-table');
  if (!result?.fields?.length) {
    host.replaceChildren(el('p', { class: 'hint', text: 'Setningen ble utført. Den returnerte ingen rader.' }));
    return;
  }
  const numeric = result.fields.map((_, c) => isNumericColumn(result, c));
  const shown = result.rows.slice(0, MAX_ROWS);
  fill(host,
    el('div', { class: 'table-scroll', tabindex: '0' },
      el('table', {},
        el('thead', {}, el('tr', {}, result.fields.map((f, c) => el('th', { scope: 'col', class: numeric[c] ? 'num' : '', text: f.name })))),
        el('tbody', {}, shown.map((row) => el('tr', {}, row.map((value, c) => {
          const text = formatValue(value);
          return el('td', { class: text == null ? 'null' : numeric[c] ? 'num' : '', text: text ?? 'null' });
        })))),
      )),
    result.rows.length > MAX_ROWS && el('p', { class: 'hint', text: `Viser de første ${MAX_ROWS} av ${fmtInt(result.rows.length)} rader.` }),
  );
}

/* ====================== Diagram ====================== */
function renderChart(result) {
  const host = $('view-chart');
  const fields = result?.fields ?? [];
  const numeric = fields.map((_, c) => isNumericColumn(result, c));
  // Første tallkolonne som ikke er etiketten blir verdi; første kolonne blir etikett.
  const valueCol = numeric.findIndex((n, c) => n && c > 0);
  if (valueCol < 0 || !result.rows.length) {
    host.replaceChildren(el('p', { class: 'hint', text: 'Diagrammet trenger en etikettkolonne først og minst en tallkolonne etter den.' }));
    return;
  }
  const rows = result.rows.slice(0, 30).map((r) => ({ label: formatValue(r[0]) ?? 'null', value: Number(r[valueCol]) || 0 }));
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  host.replaceChildren(
    el('p', { class: 'chart-title', text: `${fields[valueCol].name} per ${fields[0].name}${result.rows.length > 30 ? ' (de 30 første radene)' : ''}` }),
    el('div', { class: 'bars' }, rows.map((r) => {
      const fill = el('div', { class: `bar-fill${r.value < 0 ? ' negative' : ''}` });
      fill.style.width = `${(Math.abs(r.value) / max) * 100}%`;
      return el('div', { class: 'bar-row' },
        el('span', { title: r.label, text: r.label }),
        el('div', { class: 'bar-track' }, fill),
        el('span', { text: r.value.toLocaleString('nb-NO', { maximumFractionDigits: 2 }) }),
      );
    })),
  );
}

/* ====================== Spørreplan ====================== */
/** Tid brukt i selve noden: total tid minus barnas tid. */
function ownTime(node) {
  const total = (node['Actual Total Time'] ?? 0) * (node['Actual Loops'] ?? 1);
  const children = (node.Plans ?? []).reduce((sum, c) => sum + (c['Actual Total Time'] ?? 0) * (c['Actual Loops'] ?? 1), 0);
  return Math.max(0, total - children);
}

function planNode(node, totalMs, hottest) {
  const own = ownTime(node);
  const actual = (node['Actual Rows'] ?? 0) * (node['Actual Loops'] ?? 1);
  const planned = (node['Plan Rows'] ?? 0) * (node['Actual Loops'] ?? 1);
  const off = Math.max(actual, 1) / Math.max(planned, 1);
  const target = node['Index Name'] ?? node['Relation Name'] ?? node['CTE Name'] ?? '';
  const type = node['Join Type'] && node['Join Type'] !== 'Inner' ? `${node['Node Type']} (${node['Join Type']})` : node['Node Type'];
  const condition = node['Index Cond'] ?? node['Hash Cond'] ?? node['Merge Cond'] ?? node.Filter ?? (node['Sort Key'] ? `Sorterer på ${node['Sort Key'].join(', ')}` : null);
  const meter = el('i');
  meter.style.width = `${Math.min(100, (own / Math.max(totalMs, 1e-6)) * 100)}%`;

  return el('li', {},
    el('div', { class: `node${node === hottest ? ' hot' : ''}` },
      el('div', { class: 'node-head' },
        el('span', { class: 'node-name' }, type, target && el('small', { text: target })),
        el('span', { class: 'node-time', text: `${fmtMs(own)} · ${Math.round((own / Math.max(totalMs, 1e-6)) * 100)} %` }),
      ),
      NODE_HELP[node['Node Type']] && el('p', { class: 'node-help', text: NODE_HELP[node['Node Type']] }),
      el('div', { class: 'node-meter' }, meter),
      el('div', { class: 'node-facts' },
        el('span', { text: `${fmtInt(actual)} rader` }),
        el('span', { class: off >= 10 || off <= 0.1 ? 'warn' : '', text: `estimert ${fmtInt(planned)}` }),
        node['Rows Removed by Filter'] ? el('span', { text: `${fmtInt(node['Rows Removed by Filter'] * (node['Actual Loops'] ?? 1))} forkastet av filter` }) : null,
        (node['Actual Loops'] ?? 1) > 1 ? el('span', { text: `kjørt ${fmtInt(node['Actual Loops'])} ganger` }) : null,
      ),
      condition && el('p', { class: 'node-cond', text: condition }),
    ),
    node.Plans?.length ? el('ul', {}, node.Plans.map((child) => planNode(child, totalMs, hottest))) : null,
  );
}

function renderPlan(explain) {
  const root = explain.Plan;
  const total = explain['Execution Time'] ?? root['Actual Total Time'];
  const all = [];
  (function collect(node) { all.push(node); (node.Plans ?? []).forEach(collect); })(root);
  const hottest = all.reduce((a, b) => (ownTime(b) > ownTime(a) ? b : a));
  const scans = all.filter((n) => n['Node Type'] === 'Seq Scan').map((n) => n['Relation Name']);

  $('view-plan').replaceChildren(
    el('div', { class: 'plan-summary' },
      el('span', {}, el('strong', { text: fmtMs(total) }), 'kjøretid'),
      el('span', {}, el('strong', { text: fmtMs(explain['Planning Time'] ?? 0) }), 'planlegging'),
      el('span', {}, el('strong', { text: String(all.length) }), all.length === 1 ? 'steg' : 'steg i planen'),
    ),
    el('p', { class: 'hint', text: `Mest tid går med i ${hottest['Node Type']}${hottest['Relation Name'] ? ` på ${hottest['Relation Name']}` : ''} (markert).${scans.length ? ` Sekvensielt søk på ${[...new Set(scans)].join(', ')}.` : ''} Les treet nedenfra og opp: de innerste stegene kjøres først.` }),
    el('ul', { class: 'plan-tree' }, planNode(root, total, hottest)),
  );
}

/* ====================== Skjema og eksempler ====================== */
async function renderSchema() {
  const { rows } = await db.query(`
    SELECT c.table_name, c.column_name, c.data_type,
           (SELECT reltuples::bigint FROM pg_class WHERE oid = (quote_ident(c.table_name))::regclass) AS antall
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position`);
  const tables = new Map();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) ?? []), row]);
  $('schema').replaceChildren(...[...tables].map(([name, columns]) =>
    el('details', { open: name === 'tur' },
      el('summary', {}, name, el('span', { text: Number(columns[0].antall) >= 0 ? `${fmtInt(Number(columns[0].antall))} rader` : '' })),
      el('ul', {}, columns.map((c) => el('li', {}, el('span', { text: c.column_name }), el('span', { text: c.data_type.replace('timestamp without time zone', 'timestamp') })))),
      el('button', {
        class: 'peek', type: 'button', text: 'Se de første radene',
        onclick: () => { setEditor(`SELECT *\nFROM ${name}\nLIMIT 20;`); run(); },
      }),
    )));
}

function setEditor(sql, index = -1) {
  editor.value = sql;
  [...$('examples').children].forEach((li, i) => li.firstChild.setAttribute('aria-current', String(i === index)));
}

function selectView(name) {
  document.querySelector(`input[name="view"][value="${name}"]`).checked = true;
  for (const view of ['table', 'chart', 'plan']) $(`view-${view}`).hidden = view !== name;
}

$('examples').replaceChildren(...EXAMPLES.map((example, i) =>
  el('li', {}, el('button', { type: 'button', onclick: () => { setEditor(example.sql, i); run(); } },
    el('strong', { text: example.title }), el('small', { text: example.topic })))));

/* ====================== Hendelser ====================== */
$('run').addEventListener('click', () => run());
$('plan').addEventListener('click', () => run({ plan: true }));
$('reset').addEventListener('click', async () => {
  setBusy(true);
  $('result').hidden = true;
  showError('');
  if (await boot()) run();
});
$('view').addEventListener('change', (e) => selectView(e.target.value));
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run({ plan: e.shiftKey }); }
  else if (e.key === 'Tab' && !e.shiftKey && !e.altKey) {
    // Tab rykker inn i stedet for å flytte fokus. Esc etterfulgt av Tab går videre som vanlig.
    if (editor.dataset.escape) { delete editor.dataset.escape; return; }
    e.preventDefault();
    insertText(editor, '  ');
  } else if (e.key === 'Escape') editor.dataset.escape = '1';
  if (e.key !== 'Escape') delete editor.dataset.escape; // gjelder bare neste tastetrykk
});

setEditor(EXAMPLES[0].sql, 0);
// Har brukeren slått på "Spar data", lastes databasen først ned når brukeren ber om det.
if (navigator.connection?.saveData) {
  setState('PostgreSQL må lastes ned før du kan kjøre spørringer (ca. 5 MB).');
  $('state').append(' ', el('button', {
    class: 'btn btn-ghost btn-small', type: 'button', text: 'Last ned',
    onclick: async () => { if (await boot()) run(); },
  }));
} else if (await boot()) run();
