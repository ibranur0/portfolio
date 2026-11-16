// Tester for regex-motoren:  node projects/regex/test.mjs [antall mønstre]
//
// Det meste er sammenligning med V8. Tusenvis av tilfeldige mønstre og tekster kjøres
// både her og i V8s RegExp, og svarene må være like. Da slipper jeg å skrive fasit for hånd.
import assert from 'node:assert/strict';
import { Regex, RegexError } from './regex.js';
import { generator, randomPattern, randomText } from './fuzz.js';

const started = performance.now();
const ROUNDS = Number(process.argv[2]) || 20_000;

/* ====================== 1. Håndskrevne tilfeller ====================== */
// [mønster, tekst, forventet treff som [start, slutt] eller null]
const CASES = [
  ['abc', 'xxabcxx', [2, 5]],
  ['abc', 'ab', null],
  ['', 'abc', [0, 0]],
  ['a*', 'baaa', [0, 0]],
  ['a+', 'baaa', [1, 4]],
  ['a?b', 'aab', [1, 3]],
  ['a|ab|abc', 'abcd', [0, 3]],                 // lengste treff, ikke første alternativ
  ['(a|b)*c', 'ababc', [0, 5]],
  ['x(a|)y', 'xy', [0, 2]],
  ['.', '\n', null],
  ['.', '\na', [1, 2]],
  ['[abc]+', 'xxbcaxx', [2, 5]],
  ['[^abc]+', 'abxyzc', [2, 5]],
  ['[a-c0-2]+', 'zz1b2az', [2, 6]],
  ['[]', 'abc', null],                           // tom klasse matcher ingenting
  ['[^]', '\n', [0, 1]],                         // negert tom klasse matcher alt
  ['[a-]+', 'a-a', [0, 3]],                      // bindestrek sist er et vanlig tegn
  ['[\\d-z]+', '1-z', [0, 3]],
  ['[\\]]', 'a]', [1, 2]],
  ['\\d+', 'abc 2026 def', [4, 8]],
  ['\\w+', '  hei_du9!', [2, 9]],
  ['\\s+', 'a \t\nb', [1, 4]],
  ['\\D+', '12ab34', [2, 4]],
  ['[\\W\\d]+', 'ab1 2cd', [2, 5]],
  ['\\.', 'a.b', [1, 2]],
  ['\\x41\\u00e5', 'xAå', [1, 3]],
  ['^abc', 'abc', [0, 3]],
  ['^abc', 'xabc', null],
  ['abc$', 'xabc', [1, 4]],
  ['abc$', 'abcx', null],
  ['^$', '', [0, 0]],
  ['^$', 'a', null],
  ['$', 'ab', [2, 2]],
  ['\\bord\\b', 'et ord her', [3, 6]],
  ['\\bord\\b', 'ordet', null],
  ['\\Bd', 'd ad', [3, 4]],
  ['a{3}', 'aaaa', [0, 3]],
  ['a{2,3}', 'aaaa', [0, 3]],
  ['a{2,}', 'baaaa', [1, 5]],
  ['a{0}b', 'ab', [1, 2]],
  ['(ab){2,3}', 'abababab', [0, 6]],
  ['a{,2}', 'a{,2}', [0, 5]],                    // ugyldig kvantor er vanlige tegn
  ['a{', 'a{', [0, 2]],
  ['(?:ab)+', 'ababx', [0, 4]],
  ['(?<navn>ab)+', 'ababx', [0, 4]],
  ['a+?', 'aaa', [0, 3]],                        // lat kvantor godtas, men lengste treff gjelder
  ['(a*)*', 'aaa', [0, 3]],                      // tom løkke i løkke må ikke henge
  ['(a*)*b', 'aaac', null],
  ['(a|a?)+', 'aaaa', [0, 4]],
  ['(|a)+b', 'aab', [0, 3]],
  ['[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+', 'skriv til ola.nordmann@eksempel.no i dag', [10, 34]],
  ['\\d{1,2}\\.\\d{1,2}\\.\\d{4}', 'frist 17.05.2026 kl. 12', [6, 16]],
];
for (const [pattern, text, expected] of CASES) {
  const match = new Regex(pattern).exec(text);
  assert.deepEqual(match && [match.start, match.end], expected, `/${pattern}/ på ${JSON.stringify(text)}`);
  assert.equal(new Regex(pattern).test(text), expected !== null, `test(): /${pattern}/ på ${JSON.stringify(text)}`);
}

assert.deepEqual(new Regex('a*').matchAll('baac').map((m) => [m.start, m.end]), [[0, 0], [1, 3], [3, 3], [4, 4]]);
assert.deepEqual(new Regex('\\d+').matchAll('1 22 333').map((m) => [m.start, m.end]), [[0, 1], [2, 4], [5, 8]]);
assert.equal(new Regex('ab|cd').matchAll('abcdab').length, 3);

// [mønster, posisjonen feilen skal peke på]
const ERRORS = [
  ['(ab', 0], ['ab)', 2], ['[ab', 0], ['*a', 0], ['a**', 2], ['a{2}{3}', 4], ['a+??', 3], ['^*', 1], ['\\b+', 2],
  ['a{3,2}', 1], ['a{2000}', 1], ['(a)\\1', 3], ['(?=a)b', 0], ['(?<!a)b', 0], ['(?x)', 0], ['a\\', 1], ['[z-a]', 1],
  ['{2}', 0], ['(a{1000}){1000}', 0],
];
for (const [pattern, index] of ERRORS) {
  assert.throws(() => new Regex(pattern), (error) => error instanceof RegexError && error.index === index, `/${pattern}/ skal gi feil på posisjon ${index}`);
}
console.log(`OK: ${CASES.length} håndskrevne tilfeller og ${ERRORS.length} feilmeldinger`);

/* ====================== 2. Differensiell testing mot V8 ====================== */
let comparisons = 0;
const random = generator(20261111);
for (let round = 0; round < ROUNDS; round++) {
  // 2a. Finnes det et treff? Alle konstruksjoner, også ^, $ og \b.
  const pattern = randomPattern(random, true);
  const native = new RegExp(pattern);
  const mine = new Regex(pattern);
  for (let k = 0; k < 6; k++) {
    const text = randomText(random);
    assert.equal(mine.test(text), native.test(text), `test(): /${pattern}/ på ${JSON.stringify(text)} (runde ${round})`);
    comparisons++;
  }

  // 2b. Hvor er treffet? Fasiten finner jeg ved å prøve alle delstrenger mot V8.
  // Uten ankre, siden de betyr noe annet når teksten klippes opp.
  const plain = randomPattern(random, false);
  const whole = new RegExp(`^(?:${plain})$`);
  const engine = new Regex(plain);
  for (let k = 0; k < 3; k++) {
    const text = randomText(random);
    let expected = null;
    for (let i = 0; i <= text.length && !expected; i++) {
      for (let j = text.length; j >= i; j--) {
        if (whole.test(text.slice(i, j))) { expected = { start: i, end: j }; break; }
      }
    }
    assert.deepEqual(engine.exec(text), expected, `exec(): /${plain}/ på ${JSON.stringify(text)} (runde ${round})`);
    comparisons++;
  }
}
console.log(`OK: ${ROUNDS.toLocaleString('nb-NO')} tilfeldige mønstre, ${comparisons.toLocaleString('nb-NO')} sammenligninger med V8`);

/* ====================== 3. Lineær kjøretid ====================== */
// Mønstre som tar evig tid med tilbakesporing. Her skal de ta millisekunder.
const EVIL = [
  ['(a+)+$', 'a'.repeat(100_000) + '!'],
  ['(a|a)*b', 'a'.repeat(100_000)],
  ['(a*)*b', 'a'.repeat(100_000)],
  ['^(\\w+\\s?)*$', 'ord '.repeat(25_000) + '!'],
  ['(x+x+)+y', 'x'.repeat(100_000)],
];
for (const [pattern, text] of EVIL) {
  const regex = new Regex(pattern);
  const before = performance.now();
  assert.equal(regex.test(text), false);
  const ms = performance.now() - before;
  assert.ok(ms < 1500, `/${pattern}/ brukte ${ms.toFixed(0)} ms på ${text.length} tegn`);
  console.log(`OK: /${pattern}/ på ${text.length.toLocaleString('nb-NO')} tegn: ${ms.toFixed(1)} ms`);
}

// Dobbelt så lang tekst skal ta omtrent dobbelt så lang tid (ikke fire ganger).
const regex = new Regex('(a+)+$');
const time = (n) => {
  const text = 'a'.repeat(n) + '!';
  let best = Infinity;
  for (let k = 0; k < 5; k++) { const t = performance.now(); regex.test(text); best = Math.min(best, performance.now() - t); }
  return best;
};
time(50_000); // varm opp
const ratio = time(400_000) / time(200_000);
assert.ok(ratio < 3, `kjøretiden vokste med en faktor ${ratio.toFixed(2)} da teksten ble doblet`);
console.log(`OK: dobbelt så lang tekst tok ${ratio.toFixed(2).replace('.', ',')} ganger så lang tid`);

console.log(`Ferdig på ${Math.round(performance.now() - started)} ms`);
