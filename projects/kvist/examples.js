/** Eksempelprogrammer. Testene kjører alle og sammenligner med "expected". */
export const EXAMPLES = [
  {
    title: 'Fibonacci',
    note: 'Rekursjon og kallstakk',
    source: `// Stegvis kjøring viser hvordan kallstakken vokser og krymper.
fn fib(n) {
  if n < 2 { return n; }
  return fib(n - 1) + fib(n - 2);
}

for i in range(10) {
  print("fib(" + i + ") =", fib(i));
}
`,
    expected: 'fib(0) = 0\nfib(1) = 1\nfib(2) = 1\nfib(3) = 2\nfib(4) = 3\nfib(5) = 5\nfib(6) = 8\nfib(7) = 13\nfib(8) = 21\nfib(9) = 34',
  },
  {
    title: 'Closures',
    note: 'Funksjoner som husker omgivelsen sin',
    source: `// lagTeller returnerer en funksjon som husker sin egen "n".
fn lagTeller(start) {
  let n = start;
  return fn() {
    n = n + 1;
    return n;
  };
}

let a = lagTeller(0);
let b = lagTeller(100);
print(a(), a(), a());
print(b(), b());
print(a());
`,
    expected: '1 2 3\n101 102\n4',
  },
  {
    title: 'Quicksort',
    note: 'Lister, løkker og rekursjon',
    source: `fn bytt(liste, i, j) {
  let midlertidig = liste[i];
  liste[i] = liste[j];
  liste[j] = midlertidig;
}

fn partisjoner(liste, lav, hoy) {
  let pivot = liste[hoy];
  let i = lav;
  let j = lav;
  while j < hoy {
    if liste[j] < pivot {
      bytt(liste, i, j);
      i = i + 1;
    }
    j = j + 1;
  }
  bytt(liste, i, hoy);
  return i;
}

fn sorter(liste, lav, hoy) {
  if lav >= hoy { return; }
  let p = partisjoner(liste, lav, hoy);
  sorter(liste, lav, p - 1);
  sorter(liste, p + 1, hoy);
}

let tall = [31, 4, 15, 92, 65, 35, 8, 97, 9, 3];
print("før: ", tall);
sorter(tall, 0, len(tall) - 1);
print("etter:", tall);
`,
    expected: 'før:  [31, 4, 15, 92, 65, 35, 8, 97, 9, 3]\netter: [3, 4, 8, 9, 15, 31, 35, 65, 92, 97]',
  },
  {
    title: 'Høyere ordens funksjoner',
    note: 'map, filter og reduce skrevet i språket selv',
    source: `fn map(liste, f) {
  let ut = [];
  for x in liste { push(ut, f(x)); }
  return ut;
}

fn filter(liste, test) {
  let ut = [];
  for x in liste {
    if test(x) { push(ut, x); }
  }
  return ut;
}

fn reduce(liste, f, start) {
  let sum = start;
  for x in liste { sum = f(sum, x); }
  return sum;
}

let tall = range(11);
let partall = filter(tall, fn(x) { return x % 2 == 0; });
let kvadrater = map(partall, fn(x) { return x * x; });
print(partall);
print(kvadrater);
print("sum:", reduce(kvadrater, fn(a, b) { return a + b; }, 0));
`,
    expected: '[0, 2, 4, 6, 8, 10]\n[0, 4, 16, 36, 64, 100]\nsum: 220',
  },
  {
    title: 'Primtall',
    note: 'Silen til Eratosthenes',
    source: `fn primtallOpptil(grense) {
  let erPrimtall = [];
  for i in range(grense + 1) { push(erPrimtall, i >= 2); }

  let p = 2;
  while p * p <= grense {
    if erPrimtall[p] {
      let multiplum = p * p;
      while multiplum <= grense {
        erPrimtall[multiplum] = false;
        multiplum = multiplum + p;
      }
    }
    p = p + 1;
  }

  let funnet = [];
  for i in range(grense + 1) {
    if erPrimtall[i] { push(funnet, i); }
  }
  return funnet;
}

let primtall = primtallOpptil(100);
print(len(primtall), "primtall under 100:");
print(join(primtall, " "));
`,
    expected: '25 primtall under 100:\n2 3 5 7 11 13 17 19 23 29 31 37 41 43 47 53 59 61 67 71 73 79 83 89 97',
  },
  {
    title: 'Mandelbrot',
    note: 'Rundt 700 000 instruksjoner',
    source: `// Tegner Mandelbrot-mengden med tegn. Trykk "Kjør" for å se hvor fort maskinen er.
let tegn = chars(" .:-=+*#%@");

for rad in range(25) {
  let y = -1.2 + rad * 0.1;
  let linje = "";
  for kolonne in range(61) {
    let x = -2.1 + kolonne * 0.05;
    let a = 0;
    let b = 0;
    let n = 0;
    while n < 27 and a * a + b * b < 4 {
      let neste = a * a - b * b + x;
      b = 2 * a * b + y;
      a = neste;
      n = n + 1;
    }
    linje = linje + tegn[floor(n / 3)];
  }
  print(linje);
}
`,
    expected: null, // kontrolleres på form (antall linjer) i testen
  },
  {
    title: 'En feil å finne',
    note: 'Slik ser en kjøretidsfeil ut',
    source: `// Programmet stopper på linjen der feilen oppstår, med kallstakken intakt.
fn snitt(liste) {
  let sum = 0;
  for x in liste { sum = sum + x; }
  return sum / len(liste);
}

print(snitt([4, 8, 15]));
print(snitt([]));
`,
    expected: null,
  },
];
