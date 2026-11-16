/**
 * Tegningene på prosjektkortene, laget som SVG.
 * Fargene kommer fra CSS-klasser i home.css, så de følger lyst og mørkt tema.
 * Teksten er fast, så det er trygt å sette den inn med innerHTML.
 */
const wrap = (inner) =>
  `<svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true">${inner}</svg>`;

/** Stråle: tre kuler på et gulv, og lysstråler som spretter fra kameraet via kulene til lyskilden. */
function rays() {
  let out = '<path class="art-stroke" d="M0 150 H320"/>';
  out += '<circle class="art-yellow" cx="268" cy="34" r="13"/>';
  out += '<path class="art-trail" d="M18 172 L118 104 L268 34"/>';
  out += '<path class="art-trail" d="M18 172 L176 122 L228 96 L268 34"/>';
  out += '<ellipse class="art-card" cx="126" cy="151" rx="46" ry="5"/><ellipse class="art-card" cx="188" cy="151" rx="30" ry="4"/><ellipse class="art-card" cx="248" cy="151" rx="38" ry="4.5"/>';
  out += '<circle class="art-accent" cx="118" cy="110" r="40"/>';
  out += '<circle class="art-node" cx="182" cy="126" r="24"/><path class="art-stroke-strong" d="M170 114 A18 18 0 0 1 188 108"/>';
  out += '<circle class="art-blue" cx="240" cy="118" r="32"/>';
  out += '<polygon class="art-muted" points="8,164 28,170 14,184"/>';
  return out;
}

/** Robot: en liten labyrint sett ovenfra, med roboten, sporet den har kjørt, en krystall og målet. */
function maze() {
  const rows = ['#########', '#>..#..M#', '#.#.#.#.#', '#.#...#.#', '#########'];
  const trail = new Set(['1,1', '2,1', '3,1', '3,2', '3,3', '4,3', '5,3', '5,2']);
  const size = 30, x0 = 25, y0 = 25;
  let out = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    const cls = c === '#' ? 'art-card' : trail.has(`${x},${y}`) ? 'art-area' : 'art-cell';
    out += `<rect class="${cls}" x="${x0 + x * size + 1.5}" y="${y0 + y * size + 1.5}" width="${size - 3}" height="${size - 3}" rx="4"/>`;
  }));
  const cx = (x) => x0 + (x + 0.5) * size, cy = (y) => y0 + (y + 0.5) * size;
  out += `<circle class="art-ring" cx="${cx(7)}" cy="${cy(1)}" r="8"/><circle class="art-accent" cx="${cx(7)}" cy="${cy(1)}" r="3.5"/>`;
  out += `<rect class="art-blue" x="${cx(7) - 6}" y="${cy(3) - 6}" width="12" height="12" transform="rotate(45 ${cx(7)} ${cy(3)})"/>`;
  out += `<rect class="art-accent" x="${cx(5) - 9}" y="${cy(1) - 9}" width="18" height="18" rx="4"/><circle class="art-hole" cx="${cx(5) - 4}" cy="${cy(1) - 4}" r="2"/><circle class="art-hole" cx="${cx(5) + 4}" cy="${cy(1) - 4}" r="2"/>`;
  return out;
}

/** Bro: et fagverk over et juv, med en lastebil på vei over og en bjelke under høy belastning. */
function bridge() {
  let out = '<path class="art-card" d="M0 118 H70 V200 H0 Z M250 118 H320 V200 H250 Z"/><path class="art-area" d="M70 176 H250 V200 H70 Z"/>';
  const top = [100, 130, 160, 190, 220];
  out += '<path class="art-stroke-strong" d="M0 118 H320"/>';
  out += `<path class="art-line" d="M70 118 L100 82 ${top.slice(1).map((x) => `L${x} 82`).join(' ')} L250 118"/>`;
  top.forEach((x, k) => { out += `<path class="${k === 2 ? 'art-link-hot' : 'art-stroke'}" d="M${x} 82 V118"/><path class="art-stroke" d="M${x} 82 L${k < 2 ? x + 30 : x - 30} 118"/>`; });
  for (const x of [70, ...top, 250]) out += `<circle class="art-node" cx="${x}" cy="118" r="4"/>`;
  for (const x of top) out += `<circle class="art-node" cx="${x}" cy="82" r="4"/>`;
  out += '<rect class="art-accent" x="118" y="96" width="34" height="14" rx="3"/><rect class="art-accent" x="154" y="100" width="13" height="10" rx="3"/><circle class="art-muted" cx="128" cy="113" r="5"/><circle class="art-muted" cx="158" cy="113" r="5"/>';
  return out;
}

/** Samskriv: tre kopier av samme tekst, tegn for tegn, med ulik forfatter per tegn. */
function replicas() {
  const authors = ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'a', 'a', 'c', 'c'];
  const cls = { a: 'art-accent', b: 'art-blue', c: 'art-rose' };
  let out = '';
  [28, 84, 140].forEach((y, row) => {
    out += `<rect class="art-panel" x="24" y="${y}" width="272" height="40" rx="8"/>`;
    out += `<circle class="${cls['abc'[row]]}" cx="42" cy="${y + 20}" r="5"/>`;
    authors.forEach((who, k) => {
      out += `<rect class="art-card" x="${58 + k * 21}" y="${y + 9}" width="17" height="18" rx="3"/><rect class="${cls[who]}" x="${58 + k * 21}" y="${y + 27}" width="17" height="3" rx="1.5"/>`;
    });
  });
  return out + '<path class="art-stroke" d="M160 68 V84 M160 124 V140" stroke-dasharray="2 4"/>';
}

/** Regex: mønsteret a(b|c)*d som automat, med to aktive tilstander. */
function automaton() {
  const pill = (x, y, label, hot) =>
    `<rect class="${hot ? 'art-accent' : 'art-node'}" x="${x}" y="${y - 15}" width="40" height="30" rx="8"/>`
    + `<text class="${hot ? 'art-code-on' : 'art-code'} art-big" x="${x + 20}" y="${y + 5}" text-anchor="middle">${label}</text>`;
  let out = '<path class="art-stroke" d="M20 100 H52 M92 100 H112 M208 100 H228 M268 100 H292"/>';
  out += '<path class="art-stroke" d="M112 100 C126 100 122 70 140 70 M180 70 C198 70 194 100 208 100 M112 100 C126 100 122 130 140 130 M180 130 C198 130 194 100 208 100"/>';
  out += '<path class="art-stroke" d="M200 100 V46 Q200 38 192 38 H128 Q120 38 120 46 V96"/>';
  out += '<circle class="art-accent" cx="16" cy="100" r="6"/><circle class="art-stroke" cx="300" cy="100" r="9"/><circle class="art-muted" cx="300" cy="100" r="4"/>';
  return out + pill(52, 100, 'a', false) + pill(140, 70, 'b', true) + pill(140, 130, 'c', true) + pill(228, 100, 'd', false);
}

function neural() {
  const layers = [2, 5, 5, 1];
  const pos = layers.map((n, l) =>
    Array.from({ length: n }, (_, i) => [50 + l * 73, 100 + (i - (n - 1) / 2) * 34]));
  let out = '';
  for (let l = 0; l < pos.length - 1; l++) {
    pos[l].forEach(([x1, y1], i) => pos[l + 1].forEach(([x2, y2], j) => {
      const cls = (i * 3 + j * 5 + l) % 4 === 0 ? 'art-link-hot' : 'art-link';
      out += `<path class="${cls}" d="M${x1} ${y1} L${x2} ${y2}"/>`;
    }));
  }
  pos.forEach((layer, l) => layer.forEach(([x, y], i) => {
    const cls = (l + i) % 3 === 0 ? 'art-accent' : l === 3 ? 'art-blue' : 'art-node';
    out += `<circle class="${cls}" cx="${x}" cy="${y}" r="8"/>`;
  }));
  return out;
}

function pathfinder() {
  const walls = new Set(['3,1', '3,2', '3,3', '3,4', '3,5', '7,3', '7,4', '7,5', '7,6', '7,7', '7,8', '11,0', '11,1', '11,2', '11,3', '11,4', '12,6', '13,6', '14,6']);
  const path = [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [5, 6], [5, 5], [5, 4], [5, 3], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2], [9, 3], [9, 4], [9, 5], [10, 5], [11, 5], [12, 5], [13, 5], [14, 5], [14, 4], [14, 3], [14, 2]];
  const onPath = new Set(path.map((p) => p.join(',')));
  let out = '';
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 10; y++) {
      const key = `${x},${y}`;
      let cls = 'art-cell';
      if (walls.has(key)) cls = 'art-wall';
      else if (onPath.has(key)) cls = 'art-path';
      else if (Math.abs(x - 5) + Math.abs(y - 5) < 6 || (x > 7 && x < 13 && y < 6)) cls = 'art-visited';
      out += `<rect class="${cls}" x="${x * 20 + 1}" y="${y * 20 + 1}" width="18" height="18" rx="3"/>`;
    }
  }
  out += '<circle class="art-accent" cx="30" cy="150" r="6"/><circle class="art-blue" cx="290" cy="50" r="6"/>';
  return out;
}

function chess() {
  // Stilling etter 1.e4 e5 2.Sf3 Sc6 3.Lb5 (spansk åpning)
  const rows = ['r1bqkbnr', 'pppp1ppp', '2n5', '1B2p3', '4P3', '5N2', 'PPPP1PPP', 'RNBQK2R'];
  const glyph = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
  const size = 19, x0 = 84, y0 = 24;
  const square = (r, f) =>
    `<rect class="${(r + f) % 2 ? 'art-wood' : 'art-light'}" x="${x0 + f * size}" y="${y0 + r * size}" width="${size}" height="${size}"/>`;
  let out = '';
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      const empty = ch >= '1' && ch <= '8' ? Number(ch) : 0;
      for (let k = 0; k < Math.max(empty, 1); k++) out += square(r, f + k);
      if (!empty) {
        out += `<text class="art-glyph ${ch === ch.toLowerCase() ? 'b' : 'w'}" x="${x0 + f * size + size / 2}" y="${y0 + r * size + 15}">${glyph[ch.toLowerCase()]}\uFE0E</text>`;
      }
      f += Math.max(empty, 1);
    }
  });
  return out;
}

function sqlPlan() {
  const node = (x, y, w, name, share, hot) =>
    `<rect class="art-panel" x="${x}" y="${y}" width="${w}" height="34" rx="6"/>`
    + `<text class="${hot ? 'art-code-hot' : 'art-code'}" x="${x + 9}" y="${y + 14}">${name}</text>`
    + `<rect class="art-card" x="${x + 9}" y="${y + 21}" width="${w - 18}" height="4" rx="2"/>`
    + `<rect class="art-accent" x="${x + 9}" y="${y + 21}" width="${(w - 18) * share}" height="4" rx="2"/>`;
  return '<path class="art-stroke" d="M40 56 V79 H58 M72 96 V119 H90 M72 119 V159 H90"/>'
    + node(24, 22, 272, 'Sort', 0.06) + node(58, 62, 238, 'HashAggregate', 0.18)
    + node(90, 102, 206, 'Hash Join', 0.62, true) + node(90, 142, 206, 'Seq Scan  tur', 0.3);
}

function power() {
  const prices = [52, 50, 48, 49, 55, 70, 92, 98, 86, 74, 66, 60, 58, 62, 70, 84, 100, 104, 92, 78, 64, 44, 40, 42];
  const chosen = new Set([1, 2, 3, 21, 22, 23]);
  let out = '<path class="art-stroke" d="M16 172 H304"/>';
  prices.forEach((p, i) => {
    const h = p * 1.3;
    out += `<rect class="${chosen.has(i) ? 'art-accent' : 'art-bar'}" x="${18 + i * 12}" y="${172 - h}" width="9" height="${h}" rx="2"/>`;
  });
  return out;
}

function raftCluster() {
  const pos = [0, 1, 2, 3, 4].map((i) => {
    const angle = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    return [160 + Math.cos(angle) * 62, 106 + Math.sin(angle) * 62];
  });
  let out = '';
  for (let a = 0; a < 5; a++) {
    for (let b = a + 1; b < 5; b++) out += `<path class="art-stroke" d="M${pos[a][0]} ${pos[a][1]} L${pos[b][0]} ${pos[b][1]}"/>`;
  }
  // Lederen (øverst) sender loggmeldinger til de fire følgerne.
  for (const [to, t] of [[1, 0.35], [2, 0.6], [3, 0.5], [4, 0.75]]) {
    out += `<circle class="art-accent" cx="${pos[0][0] + (pos[to][0] - pos[0][0]) * t}" cy="${pos[0][1] + (pos[to][1] - pos[0][1]) * t}" r="4"/>`;
  }
  pos.forEach(([x, y], i) => {
    out += `<circle class="${i === 0 ? 'art-accent' : 'art-node'}" cx="${x}" cy="${y}" r="15"/>`;
  });
  return out;
}

function compilerArt() {
  const source = ['fn fib(n) {', '  if n < 2 { return n; }', '  return fib(n - 1)', '       + fib(n - 2);', '}'];
  const code = ['LOAD   n', 'CONST  2', 'LT', 'JUMP_IF_FALSE', 'LOAD   n', 'RETURN'];
  let out = '<rect class="art-panel" x="14" y="24" width="150" height="152" rx="8"/><rect class="art-panel" x="176" y="24" width="130" height="152" rx="8"/>';
  source.forEach((line, i) => { out += `<text class="art-code" x="26" y="${52 + i * 20}" xml:space="preserve">${line.replace(/</g, '&lt;')}</text>`; });
  code.forEach((line, i) => {
    if (i === 2) out += '<rect class="art-accent" x="182" y="78" width="118" height="18" rx="4"/>';
    out += `<text class="${i === 2 ? 'art-code-on' : 'art-code'}" x="190" y="${51 + i * 20}" xml:space="preserve">${line}</text>`;
  });
  return out + '<path class="art-stroke-strong" d="M150 100 H172 M166 94 L172 100 L166 106"/>';
}

const ART = {
  raft: raftCluster,
  kvist: compilerArt,
  sjakk: chess,
  'sql-lab': sqlPlan,
  stromsmart: power,
  bro: bridge,
  robot: maze,
  straale: rays,
  samskriv: replicas,
  regex: automaton,
  nevralt: neural,
  stifinner: pathfinder,
};

/** Returnerer SVG-markup for et prosjekt, eller en nøytral standardillustrasjon. */
export function projectArt(slug) {
  const draw = ART[slug];
  return wrap(draw ? draw() : '<circle class="art-accent" cx="160" cy="100" r="40"/>');
}
