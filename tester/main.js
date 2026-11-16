/**
 * Selvtesten. Kjører prosjektenes tester i nettleseren til den som besøker siden.
 * Testene bruker den samme koden som appene, og de samme tilfeldige scenariene
 * (fuzz.js) som kjøres fra kommandolinjen.
 */
import { el, initThemeToggle } from '../assets/js/ui.js';
import '../assets/js/stats.js';
import { chaosRun, mutationCaught } from '../projects/raft/fuzz.js';
import { compile } from '../projects/kvist/compiler.js';
import { VM } from '../projects/kvist/vm.js';
import { EXAMPLES } from '../projects/kvist/examples.js';
import { Engine } from '../projects/sjakk/engine.js';
import { Regex } from '../projects/regex/regex.js';
import { generator, randomPattern, randomText } from '../projects/regex/fuzz.js';
import { randomRun } from '../projects/samskriv/fuzz.js';
import { Network } from '../projects/nevralt/network.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('nb-NO');
const must = (condition, message) => { if (!condition) throw new Error(message); };

/** Slipper nettleseren til innimellom, så siden kan tegne fremdriften og ikke fryser. */
let lastPause = 0;
async function breathe() {
  if (performance.now() - lastPause < 30) return;
  await new Promise((resolve) => setTimeout(resolve));
  lastPause = performance.now();
}

/** Kjører et Kvist-program og returnerer det som ble skrevet ut. */
function runKvist(source) {
  const lines = [];
  const vm = new VM(compile(source), (line) => lines.push(line));
  vm.run(5_000_000);
  must(vm.done, 'programmet ble ikke ferdig');
  return lines.join('\n');
}

/**
 * Hver test får et frø og en funksjon for fremdrift, og gir { checks, text }.
 * Den kaster en feil hvis noe er galt.
 */
const SUITES = [
  {
    name: 'Raft', href: '../projects/raft/',
    what: 'Klynger på tre, fem og sju noder kjøres gjennom tilfeldige krasj, nettverksdelinger og pakketap. Fire sikkerhetsegenskaper kontrolleres hvert tikk, og etter reparasjon må alle nodene være enige.',
    async run(seed, progress) {
      const count = 300;
      let checks = 0;
      for (let k = 0; k < count; k++) {
        checks += chaosRun(seed + k);
        progress((k + 1) / (count + 8));
        await breathe();
      }
      // Mutasjonstest: med en av Rafts regler slått av, skal kontrollene slå alarm.
      const caught = mutationCaught();
      must(caught, 'kontrollene oppdaget ikke en ødelagt stemmeregel');
      return { checks: checks + count * 5000 + 1, text: `${count} kaosforløp (frø ${seed}-${seed + count - 1}), ${fmt(count * 5000)} tikk kontrollert. Mutasjonstesten ble fanget: "${caught}".` };
    },
  },
  {
    name: 'Kvist', href: '../projects/kvist/',
    what: 'Eksempelprogrammene kompileres til bytekode og kjøres i den virtuelle maskinen, og utskriften sammenlignes med fasit. I tillegg kontrolleres presedens, closures, skop og feilmeldinger.',
    async run(seed, progress) {
      const cases = [
        ['print(1 + 2 * 3, (1 + 2) * 3, 10 - 4 - 3, -7 % 3);', '7 9 3 2'],
        ['print(1 < 2 and 2 < 3, nil or "reserve", not true);', 'true reserve false'],
        ['let a = [3, 1, 2]; a[0] = 9; push(a, 4); print(a, len(a));', '[9, 1, 2, 4] 4'],
        ['fn lag() { let n = 0; return fn() { n = n + 1; return n; }; }\nlet t = lag(); t(); print(t(), lag()());', '2 1'],
        ['let x = 1; { let x = 2; print(x); } print(x);', '2\n1'],
        ['let s = 0; for i in range(10) { if i % 2 == 0 { continue; } if i > 7 { break; } s = s + i; } print(s);', '16'],
        ['fn fak(n) { if n < 2 { return 1; } return n * fak(n - 1); } print(fak(10));', '3628800'],
      ];
      const errors = [
        ['print(1 / 0);', 'Kjøretidsfeil', 1],
        ['let a = [1];\nprint(a[3]);', 'Kjøretidsfeil', 2],
        ['print(ukjent);', 'Kompileringsfeil', 1],
        ['let x = ;', 'Syntaksfeil', 1],
        ['fn f() { return f(); }\nf();', 'Kjøretidsfeil', 1],
      ];
      let checks = 0, instructions = 0;
      const total = EXAMPLES.length + cases.length + errors.length;
      for (const example of EXAMPLES) {
        if (example.expected) must(runKvist(example.source) === example.expected, `eksempelet "${example.title}" ga feil utskrift`);
        else if (example.title === 'Mandelbrot') must(runKvist(example.source).split('\n').length === 25, 'Mandelbrot skal gi 25 linjer');
        else {
          let failed = null;
          try { runKvist(example.source); } catch (error) { failed = error; }
          must(failed?.kind === 'Kjøretidsfeil' && failed.line === 5, `"${example.title}" skal stoppe med kjøretidsfeil på linje 5`);
        }
        const vm = new VM(compile(example.source));
        try { vm.run(5_000_000); } catch { /* feileksempelet */ }
        instructions += vm.steps;
        progress(++checks / total);
        await breathe();
      }
      for (const [source, expected] of cases) {
        must(runKvist(source) === expected, `feil utskrift fra: ${source.split('\n')[0]}`);
        progress(++checks / total);
      }
      for (const [source, kind, line] of errors) {
        let failed = null;
        try { runKvist(source); } catch (error) { failed = error; }
        must(failed?.kind === kind && failed.line === line, `forventet ${kind} på linje ${line} fra: ${source.split('\n')[0]}`);
        progress(++checks / total);
      }
      return { checks, text: `${EXAMPLES.length} eksempelprogrammer, ${cases.length} språktester og ${errors.length} feilmeldinger. ${fmt(instructions)} instruksjoner utført.` };
    },
  },
  {
    name: 'Sjakk', href: '../projects/sjakk/',
    what: 'Perft: alle lovlige trekkfølger telles til en gitt dybde og sammenlignes med kjente fasittall. En feil i rokade, en passant eller forvandling gir feil tall.',
    async run(seed, progress) {
      // [stilling, dybde, fasit]. Tallene er standardverdier som alle sjakkmotorer testes mot.
      const positions = [
        ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 4, 197281, 'utgangsstillingen'],
        ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862, '"Kiwipete" (rokade, en passant, bindinger)'],
        ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238, 'et sluttspill med en passant-feller'],
        ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467, 'forvandlinger og sjakker'],
      ];
      let nodes = 0;
      const started = performance.now();
      for (let k = 0; k < positions.length; k++) {
        const [fen, depth, expected, label] = positions[k];
        const count = new Engine(fen).perft(depth);
        must(count === expected, `perft(${depth}) fra ${label} ga ${fmt(count)}, fasit er ${fmt(expected)}`);
        nodes += count;
        progress((k + 1) / positions.length);
        await breathe();
      }
      const rate = nodes / ((performance.now() - started) / 1000);
      return { checks: positions.length, text: `${positions.length} stillinger, ${fmt(nodes)} trekkfølger talt riktig (${(rate / 1e6).toFixed(1).replace(".", ",")} millioner per sekund).` };
    },
  },
  {
    name: 'Regex', href: '../projects/regex/',
    what: 'Differensiell test: tilfeldige mønstre og tekster kjøres både i motoren min og i nettleserens egen RegExp, og svarene må være like. Til slutt et mønster som får nettleserens motor til å henge.',
    async run(seed, progress) {
      const random = generator(seed);
      const patterns = 5000;
      let comparisons = 0;
      // Safari og alle nettlesere på iPhone bruker JavaScriptCore, som gjør feil på noen
      // sjeldne mønstre, for eksempel /(^b)?a/ på "xa". Der kan ikke nettleseren være fasit,
      // så uenighetene telles og vises. I Chrome og Firefox er enhver uenighet en feil.
      const javascriptCore = /AppleWebKit/.test(navigator.userAgent) && !navigator.userAgentData;
      const deviations = [];
      for (let k = 0; k < patterns; k++) {
        const pattern = randomPattern(random, true);
        const native = new RegExp(pattern), mine = new Regex(pattern);
        for (let t = 0; t < 5; t++) {
          const text = randomText(random);
          const expected = mine.test(text);
          if (expected !== native.test(text)) {
            const where = `/${pattern}/ på ${JSON.stringify(text)}`;
            must(javascriptCore, `${where}: motorene er uenige (frø ${seed})`);
            deviations.push({ where, expected });
          }
          comparisons++;
        }
        if (k % 100 === 0) { progress(k / patterns); await breathe(); }
      }
      const evil = new Regex('(a+)+$'), long = `${'a'.repeat(100_000)}!`;
      const before = performance.now();
      must(evil.test(long) === false, '(a+)+$ skal ikke matche');
      const ms = performance.now() - before;
      must(ms < 2000, `(a+)+$ brukte ${Math.round(ms)} ms på 100 000 tegn`);
      const example = deviations[0];
      const note = example
        ? ` Nettleseren din svarte annerledes i ${fmt(deviations.length)} av sammenligningene. Den bruker JavaScriptCore, som avviker fra JavaScript-standarden på noen sjeldne mønstre. Testene på kommandolinjen sammenligner med V8, motoren i Chrome, på 20 000 mønstre uten avvik. Ett av dem herfra: ${example.where} skal gi ${example.expected ? 'treff' : 'ingen treff'}, og det kan du sjekke i Chrome.`
        : '';
      return { checks: comparisons + 1, text: `${fmt(patterns)} tilfeldige mønstre (frø ${seed}), ${fmt(comparisons)} sammenligninger med nettleserens RegExp. /(a+)+$/ på 100 000 tegn: ${ms < 1 ? 'under 1' : Math.round(ms)} ms.${note}` };
    },
  },
  {
    name: 'Samskriv', href: '../projects/samskriv/',
    what: 'To til fem kopier redigerer samtidig mens nettverket stokker om, forsinker og dupliserer meldingene, og kopier går av og på nett. Når alt er levert, må alle kopiene være helt like.',
    async run(seed, progress) {
      const runs = 2000;
      let operations = 0, deliveries = 0;
      for (let k = 0; k < runs; k++) {
        const result = randomRun(seed + k);
        operations += result.operations;
        deliveries += result.deliveries;
        if (k % 40 === 0) { progress(k / runs); await breathe(); }
      }
      return { checks: runs + deliveries, text: `${fmt(runs)} tilfeldige forløp (frø ${seed}-${seed + runs - 1}), ${fmt(operations)} endringer og ${fmt(deliveries)} leveringer. Alle kopier endte likt.` };
    },
  },
  {
    name: 'Nevralt', href: '../projects/nevralt/',
    what: 'Gradientkontroll: gradientene fra bakoverpropageringen sammenlignes med numeriske gradienter (liten endring i hver vekt, målt endring i tapet).',
    async run(seed, progress) {
      const EPS = 1e-6;
      const loss = (net, x, y, target) => { const p = net.forward(x, y); return -(target * Math.log(p) + (1 - target) * Math.log(1 - p)); };
      const shapes = [[2, 1], [2, 3, 1], [2, 6, 6, 1], [2, 4, 5, 3, 1]];
      let checked = 0, worst = 0, done = 0;
      for (const activation of ['tanh', 'sigmoid']) {
        for (const sizes of shapes) {
          for (let trial = 0; trial < 4; trial++) {
            const net = new Network(sizes, activation), stepped = new Network(sizes, activation);
            for (let l = 1; l <= net.last; l++) { stepped.w[l].set(net.w[l]); stepped.b[l].set(net.b[l]); }
            const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, target = trial % 2;
            stepped.train(x, y, target, 1); // læringsrate 1: hver vekt flyttes nøyaktig en gradient
            for (let l = 1; l <= net.last; l++) {
              for (const [params, after] of [[net.w[l], stepped.w[l]], [net.b[l], stepped.b[l]]]) {
                for (let i = 0; i < params.length; i++) {
                  const analytic = params[i] - after[i], saved = params[i];
                  params[i] = saved + EPS; const up = loss(net, x, y, target);
                  params[i] = saved - EPS; const down = loss(net, x, y, target);
                  params[i] = saved;
                  const difference = Math.abs(analytic - (up - down) / (2 * EPS));
                  must(difference < 1e-6, `${activation} ${sizes.join('-')}: gradienten avviker med ${difference.toExponential(1)}`);
                  worst = Math.max(worst, difference);
                  checked++;
                }
              }
            }
          }
          progress(++done / (shapes.length * 2));
          await breathe();
        }
      }
      return { checks: checked, text: `${fmt(checked)} gradienter i ${shapes.length * 2 * 4} tilfeldige nettverk. Største avvik fra numerisk gradient: ${worst.toExponential(1).replace('.', ',')}.` };
    },
  },
];

/* ====================== Kjøring og visning ====================== */
const rows = SUITES.map((suite) => {
  const row = {
    mark: el('span', { class: 'mark', 'aria-hidden': 'true' }),
    time: el('span', { class: 'suite-time' }),
    result: el('p', { class: 'suite-result', role: 'status' }),
    fill: el('i'),
  };
  row.item = el('li', { class: 'suite' },
    row.mark,
    el('h2', {}, el('a', { href: suite.href, text: suite.name })),
    row.time,
    el('p', { class: 'suite-what', text: suite.what }),
    el('div', { class: 'bar' }, row.fill),
    row.result);
  return row;
});
$('suites').replaceChildren(...rows.map((row) => row.item));

async function runAll() {
  // Nytt frø hver gang, så hver kjøring tester nye scenarier.
  const seed = 1 + Math.floor(Math.random() * 900_000);
  $('again').disabled = true;
  $('summary-label').textContent = 'Kjører...';
  document.querySelector('.summary').classList.remove('passed', 'failed');
  for (const row of rows) {
    row.item.className = 'suite';
    row.mark.textContent = '';
    row.time.textContent = '';
    row.result.textContent = '';
    row.fill.style.width = '0';
  }
  let passed = 0, checks = 0;
  const started = performance.now();
  const summarize = () => {
    $('summary-main').textContent = `${passed} av ${SUITES.length}`;
    $('summary-sub').textContent = `${fmt(checks)} kontroller så langt.`;
  };
  summarize();

  for (let k = 0; k < SUITES.length; k++) {
    const row = rows[k];
    row.item.classList.add('running');
    await new Promise((resolve) => setTimeout(resolve, 60)); // la markøren rekke å vises
    const before = performance.now();
    try {
      const outcome = await SUITES[k].run(seed, (share) => { row.fill.style.width = `${Math.min(100, share * 100).toFixed(1)}%`; });
      row.item.className = 'suite passed';
      row.mark.textContent = '✓';
      row.result.textContent = outcome.text;
      row.fill.style.width = '100%';
      passed++;
      checks += outcome.checks;
    } catch (error) {
      row.item.className = 'suite failed';
      row.mark.textContent = '✕';
      row.result.textContent = `Feilet: ${error.message}`;
    }
    row.time.textContent = `${fmt(performance.now() - before)} ms`;
    summarize();
  }

  const all = passed === SUITES.length;
  document.querySelector('.summary').classList.add(all ? 'passed' : 'failed');
  $('summary-label').textContent = all ? 'Alle testene besto' : 'Noe feilet';
  $('summary-sub').textContent = `${fmt(checks)} kontroller på ${(Math.round((performance.now() - started) / 100) / 10).toLocaleString('nb-NO')} sekunder, i din nettleser.`;
  $('again').disabled = false;
}

initThemeToggle($('theme-toggle'));
$('again').addEventListener('click', runAll);
runAll();
