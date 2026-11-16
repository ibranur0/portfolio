// Tester for Kvist. Kjør med: node test.mjs
import assert from 'node:assert/strict';
import { compile, disassemble } from './compiler.js';
import { VM } from './vm.js';
import { parse } from './parser.js';
import { EXAMPLES } from './examples.js';

let count = 0;
const test = (name, fn) => {
  try { fn(); count++; } catch (error) { console.error(`FEILET: ${name}\n  ${error.message}`); process.exitCode = 1; }
};

/** Kjører et program og returnerer det som ble skrevet ut. */
function run(source) {
  const lines = [];
  const vm = new VM(compile(source), (line) => lines.push(line));
  vm.run(5_000_000);
  assert.ok(vm.done, 'programmet ble ikke ferdig');
  assert.equal(vm.stack.length, 0, 'stakken skal være tom når programmet er ferdig');
  return lines.join('\n');
}
const out = (source, expected) => test(source.split('\n')[0], () => assert.equal(run(source), expected));
const fails = (source, kind, pattern, line) => test(`feil: ${source.split('\n')[0]}`, () => {
  assert.throws(() => run(source), (error) => {
    assert.equal(error.kind, kind);
    assert.match(error.message, pattern);
    if (line) assert.equal(error.line, line);
    return true;
  });
});

/* ---------- Uttrykk og presedens ---------- */
out('print(1 + 2 * 3);', '7');
out('print((1 + 2) * 3);', '9');
out('print(10 - 4 - 3);', '3');
out('print(2 * 3 % 4);', '2');
out('print(-2 * -3);', '6');
out('print(7 / 2, floor(7 / 2), -7 % 3);', '3.5 3 2');
out('print(1 < 2, 2 <= 2, 3 > 4, 1 == 1, 1 != 1);', 'true true false true false');
out('print(1 + 2 == 3 and 2 < 3);', 'true');
out('print(not true, !false, not nil, not 0);', 'false true true false');
out('print("a" + 1 + 2, 1 + 2 + "a");', 'a12 3a');
out('print("abc" < "abd", "b" > "a");', 'true true');
out('print(0.1 + 0.2);', '0.3');

/* ---------- Kortslutning ---------- */
out('fn bom() { print("kalt"); return true; }\nprint(false and bom());\nprint(true or bom());', 'false\ntrue');
out('print(nil or "standard", 0 and "ja");', 'standard ja');

/* ---------- Variabler og skop ---------- */
out('let a = 1; { let a = 2; print(a); } print(a);', '2\n1');
out('let a = 1; let b = a = 5; print(a, b);', '5 5');
out('let x = 1; fn f() { x = x + 1; } f(); f(); print(x);', '3');
out('fn ytre() { let x = "ytre"; fn indre() { return x; } return indre(); }\nprint(ytre());', 'ytre');

/* ---------- Kontrollflyt ---------- */
out('let i = 0; while i < 3 { print(i); i = i + 1; }', '0\n1\n2');
out('if 1 > 2 { print("a"); } else if 2 > 1 { print("b"); } else { print("c"); }', 'b');
out('for x in [1, 2, 3, 4, 5] { if x == 2 { continue; } if x == 4 { break; } print(x); }', '1\n3');
out('let i = 0; while true { i = i + 1; if i % 2 == 0 { continue; } if i > 5 { break; } print(i); }', '1\n3\n5');
out('for a in [1, 2] { for b in ["x", "y"] { print(a, b); } }', '1 x\n1 y\n2 x\n2 y');
out('for c in "hei" { print(c); }', 'h\ne\ni');
out('fn f() { for x in [1, 2, 3] { if x == 2 { return x * 10; } } return 0; }\nprint(f());', '20');

/* ---------- Funksjoner og closures ---------- */
out('fn f() {} print(f());', 'nil');
out('fn erPartall(n) { if n == 0 { return true; } return erOddetall(n - 1); }\nfn erOddetall(n) { if n == 0 { return false; } return erPartall(n - 1); }\nprint(erPartall(10), erOddetall(7));', 'true true');
out('fn lag() { let n = 0; return [fn() { n = n + 1; return n; }, fn() { return n; }]; }\nlet par = lag(); par[0](); par[0](); print(par[1]());', '2');
out('fn adder(a) { return fn(b) { return fn(c) { return a + b + c; }; }; }\nprint(adder(1)(2)(3));', '6');
out('fn fakultet(n) { if n <= 1 { return 1; } return n * fakultet(n - 1); }\nprint(fakultet(20));', '2432902008176640000');
out('let f = fn(x) { return x * 2; }; print(f(21), f);', '42 <fn anonym>');
out('fn dyp(n) { if n == 0 { return 0; } return 1 + dyp(n - 1); }\nprint(dyp(900));', '900');

/* ---------- Lister ---------- */
out('let a = [1, [2, 3], "x"]; print(a, len(a), a[1][0]);', '[1, [2, 3], "x"] 3 2');
out('let a = []; push(a, 1); push(a, 2); print(pop(a), a, [1] + [2]);', '2 [1] [1, 2]');
out('let a = [1, 2]; let b = a; b[0] = 9; print(a, a == b, [1] == [1]);', '[9, 2] true false');
out('let a = [0]; a[0] = a; print(a);', '[[...]]');
out('print(range(4), join(["a", 1, nil], "-"), chars("ab"), str(12) + 1, num("3.5") + 1);', '[0, 1, 2, 3] a-1-nil ["a", "b"] 121 4.5');
out('print([1, 2,]);', '[1, 2]');

/* ---------- Kommentarer og tekst ---------- */
out('// kommentar\nprint("a\\tb\\n\\"c\\""); // slutt', 'a\tb\n"c"');
out('let ærlig = "æøå"; print(ærlig, len(ærlig));', 'æøå 3');

/* ---------- Feilmeldinger ---------- */
fails('print(1 +);', 'Syntaksfeil', /Forventet et uttrykk/, 1);
fails('let x = 1\nprint(x);', 'Syntaksfeil', /Forventet ";"/, 2);
fails('fn f( { }', 'Syntaksfeil', /Forventet et navn/);
fails('if true { print(1);', 'Syntaksfeil', /mangler "}"/);
fails('print("abc);', 'Syntaksfeil', /anførselstegn/, 1);
fails('let a = 1 @ 2;', 'Syntaksfeil', /Uventet tegn "@"/);
fails('1 = 2;', 'Syntaksfeil', /Venstre side/);
fails('print(ukjent);', 'Kompileringsfeil', /Ukjent navn "ukjent"/, 1);
fails('x = 1;', 'Kompileringsfeil', /ikke deklarert/);
fails('let a = 1; let a = 2;', 'Kompileringsfeil', /allerede deklarert/);
fails('break;', 'Kompileringsfeil', /inne i en løkke/);
fails('return 1;', 'Kompileringsfeil', /inne i en funksjon/);
fails('let a = a;', 'Kompileringsfeil', /Ukjent navn/);
fails('\n\nprint(1 + nil);', 'Kjøretidsfeil', /legge sammen tall og nil/, 3);
fails('print(1 / 0);', 'Kjøretidsfeil', /Deling på null/);
fails('let a = [1]; print(a[1]);', 'Kjøretidsfeil', /utenfor listen/);
fails('let a = [1]; print(a[0.5]);', 'Kjøretidsfeil', /heltall/);
fails('let a = 5; a();', 'Kjøretidsfeil', /ikke en funksjon/);
fails('fn f(a) {} f(1, 2);', 'Kjøretidsfeil', /tar 1 argumenter, men fikk 2/);
fails('len(1, 2);', 'Kjøretidsfeil', /len tar 1 argumenter/);
fails('print(1 < "a");', 'Kjøretidsfeil', /sammenligne/);
fails('fn evig(n) { return evig(n + 1); }\nevig(0);', 'Kjøretidsfeil', /For dyp rekursjon/, 1);
fails('for x in 5 { }', 'Kjøretidsfeil', /forventer liste eller tekst/);

/* ---------- Kallstakk ved feil ---------- */
test('kjøretidsfeil har kallstakk', () => {
  try { run('fn a() { return b(); }\nfn b() { return 1 + nil; }\na();'); assert.fail('skulle feilet'); } catch (error) {
    assert.deepEqual(error.trace, ['b', 'a', 'hovedprogram']);
    assert.equal(error.line, 2);
  }
});

/* ---------- Stegvis kjøring ---------- */
test('step utfører en instruksjon og sporer linjen', () => {
  const vm = new VM(compile('let a = 1;\nlet b = a + 2;\nprint(b);'), () => {});
  const lines = [];
  while (!vm.done) { lines.push(vm.line); vm.step(); }
  assert.deepEqual([...new Set(lines)], [1, 2, 3]);
  assert.equal(vm.steps, lines.length);
});

test('run kan avbrytes og fortsettes', () => {
  const lines = [];
  const vm = new VM(compile('let i = 0; while i < 1000 { i = i + 1; } print(i);'), (l) => lines.push(l));
  assert.equal(vm.run(100), false);
  assert.equal(vm.steps, 100);
  assert.equal(vm.run(), true);
  assert.deepEqual(lines, ['1000']);
});

/* ---------- Kompilatoren ---------- */
test('variabler løses til (dybde, plass)', () => {
  // f får plass 0 fordi funksjoner deklareres først. x får plass 1.
  const program = compile('let x = 1; fn f() { return x; }');
  const rows = disassemble(program.protos[0], program.protos);
  assert.deepEqual(rows[0], { index: 0, op: 'LOAD', operand: '↑1 plass 1', line: 1 });
});

test('like konstanter deles', () => {
  const program = compile('print(7, 7, "a", "a", 7);');
  assert.deepEqual(program.main.constants, ['print', 7, 'a']);
});

test('parseren bygger riktig tre for presedens', () => {
  const tree = parse('1 + 2 * 3;').body[0].expr;
  assert.equal(tree.op, '+');
  assert.equal(tree.right.op, '*');
});

/* ---------- Eksemplene på nettsiden ---------- */
for (const example of EXAMPLES) {
  test(`eksempel: ${example.title}`, () => {
    if (example.expected !== null) assert.equal(run(example.source), example.expected);
    else if (example.title === 'Mandelbrot') {
      const lines = run(example.source).split('\n');
      assert.equal(lines.length, 25);
      assert.ok(lines.every((l) => l.length === 61));
      assert.ok(lines[12].includes('@'));
    } else {
      assert.throws(() => run(example.source), (error) => error.kind === 'Kjøretidsfeil' && error.line === 5);
    }
  });
}

if (!process.exitCode) console.log(`OK: ${count} tester`);
