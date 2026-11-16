/**
 * Fysikken i brubyggespillet. Brukes av spillet og av testene.
 *
 * Brua er et fagverk. Knutepunktene har masse, og bjelkene mellom dem tar bare
 * strekk og trykk langs seg selv. Leddene er frie, så en firkant klapper sammen
 * mens en trekant holder.
 *
 * Hver bjelke er en stiv fjær med demping. Blir kraften større enn materialet tåler,
 * ryker den. Jeg bruker semi-implisitt Euler i små delsteg, og samme bru gir alltid
 * samme resultat.
 *
 * En bru er en liste med bjelker: [ax, ay, bx, by, materiale].
 */
export const GRAVITY = 9.81;
export const MAX_BEAM = 2.3;          // lengste tillatte bjelke (dekker 1, rot 2, 2 og rot 5 i rutenettet)
const SUBSTEPS = 16;
const DRAG = 0.6;                     // luftmotstand, så svingninger dør ut
const SETTLE = 1.2;                   // sekunder brua får stå med egenvekten før første kjøretøy
const TIME_LIMIT = 45;

/** cost: kroner per meter, density: masse per meter, ea: stivhet, max: kraften bjelken tåler */
export const MATERIALS = {
  road: { name: 'Vei', cost: 200, density: 2.2, ea: 42_000, max: 620 },
  wood: { name: 'Tre', cost: 90, density: 0.7, ea: 30_000, max: 520 },
  steel: { name: 'Stål', cost: 260, density: 1.4, ea: 70_000, max: 1150 },
};

/**
 * Nivåene. Alt måles i meter, y peker opp, og veien ligger i y = 0.
 * anchors er punkter i fjellet som brua kan festes i. De to første er der veien
 * starter og slutter.
 *
 * stars er tre prisgrenser: [tre stjerner, to stjerner, budsjett].
 * Jeg satte dem etter bruene i test.mjs. Over budsjettet gir ingen stjerner.
 */
export const LEVELS = [
  {
    id: 'bekken', name: 'Bekken', width: 12, left: 4, right: 8, stars: [1700, 2200, 2800],
    text: 'En liten bekk og en lett varebil. Brua er nesten ferdig: veidekket mangler på midten, der den stiplede linjen går. Dra fra ett knutepunkt til det neste for å legge en vei-bjelke, og trykk "Test brua".',
    anchors: [[4, 0], [8, 0]],
    vehicles: [{ mass: 14, speed: 2.2 }],
    start: [[4, 0, 5, 0, 'road'], [7, 0, 8, 0, 'road'], [4, 0, 5, 1, 'wood'], [5, 1, 5, 0, 'wood'], [5, 1, 6, 1, 'wood'], [6, 1, 7, 1, 'wood'], [7, 1, 7, 0, 'wood'], [7, 1, 8, 0, 'wood'], [5, 0, 6, 1, 'wood'], [6, 1, 7, 0, 'wood']],
  },
  {
    id: 'elva', name: 'Elva', width: 14, left: 4, right: 10, stars: [2800, 3500, 4400],
    text: 'Seks meter, og ingenting å stå på. Veidekket alene henger som en kjetting og ryker. Bygg trekanter over eller under veien: en trekant kan ikke klappe sammen, en firkant kan.',
    anchors: [[4, 0], [10, 0]],
    vehicles: [{ mass: 15, speed: 2.2 }],
  },
  {
    id: 'juvet', name: 'Juvet', width: 16, left: 4, right: 12, stars: [4100, 5000, 6200],
    text: 'Åtte meter. Lenger nede i fjellveggen er det to ekstra fester. En bue som spenner mellom dem, bærer mye mer enn en rett bjelke.',
    anchors: [[4, 0], [12, 0], [4, -2], [12, -2]],
    vehicles: [{ mass: 18, speed: 2.2 }],
  },
  {
    id: 'pilaren', name: 'Pilaren', width: 20, left: 4, right: 16, stars: [6100, 7200, 8400],
    text: 'Tolv meter er for langt for ett spenn med dette budsjettet. Midt i elva står en gammel pilar. Bruk den.',
    anchors: [[4, 0], [16, 0], [10, -2], [4, -2], [16, -2]],
    vehicles: [{ mass: 18, speed: 2.2 }],
  },
  {
    id: 'tungtransport', name: 'Tungtransport', width: 16, left: 4, right: 12, stars: [6600, 8000, 9400],
    text: 'Samme juv, men nå kommer en lastebil på 38 tonn med en varebil rett bak. Tre holder ikke lenger overalt. Stål tåler over dobbelt så mye, men koster nesten tre ganger så mye: bruk det bare der kreftene er størst.',
    anchors: [[4, 0], [12, 0], [4, -2], [12, -2]],
    vehicles: [{ mass: 38, speed: 1.8 }, { mass: 14, speed: 1.8, delay: 2.2 }],
  },
];

const key = (x, y) => `${x},${y}`;

/** Går de to bjelkene mellom de samme punktene (uansett retning og materiale)? */
export const sameBeam = (a, b) =>
  (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]) || (a[0] === b[2] && a[1] === b[3] && a[2] === b[0] && a[3] === b[1]);

/** Hva designet koster. */
export function cost(design) {
  let total = 0;
  for (const [ax, ay, bx, by, material] of design) total += Math.hypot(bx - ax, by - ay) * MATERIALS[material].cost;
  return Math.round(total);
}

/** Kan det stå et knutepunkt her? Ikke inne i fjellet, og ikke utenfor byggeområdet. */
export function buildable(level, x, y) {
  if (level.anchors.some(([ax, ay]) => ax === x && ay === y)) return true;
  return x > level.left && x < level.right && y >= -4 && y <= 3;
}

/**
 * Veien fra venstre til høyre feste som en liste med punkter [x, y].
 * Gir null hvis veien ikke henger sammen.
 */
export function roadPath(level, design) {
  const next = new Map();
  for (const [ax, ay, bx, by, material] of design) {
    if (material !== 'road') continue;
    for (const [from, to] of [[key(ax, ay), [bx, by]], [key(bx, by), [ax, ay]]]) next.set(from, [...(next.get(from) ?? []), to]);
  }
  const start = level.anchors[0], goal = key(...level.anchors[1]);
  const parent = new Map([[key(...start), null]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (key(...at) === goal) {
      const path = [];
      for (let node = at; node; node = parent.get(key(...node))) path.push(node);
      return path.reverse();
    }
    for (const to of next.get(key(...at)) ?? []) {
      if (parent.has(key(...to))) continue;
      parent.set(key(...to), at);
      queue.push(to);
    }
  }
  return null;
}

export class Simulation {
  constructor(level, design) {
    this.level = level;
    this.time = 0;
    this.status = 'running';   // 'running' | 'won' | 'failed'
    this.reason = '';
    this.maxStress = 0;
    this.broken = 0;
    this.events = [];          // brudd siden sist: { x, y } (for effekter i visningen)
    this.firstBreak = null;    // der det første bruddet skjedde, i hvileposisjon: { x, y }

    // Knutepunkter: ett per unikt endepunkt. De som ligger i et feste, står fast.
    const index = new Map();
    this.nodes = [];
    const node = (x, y) => {
      const k = key(x, y);
      if (!index.has(k)) {
        index.set(k, this.nodes.length);
        this.nodes.push({ x, y, vx: 0, vy: 0, fx: 0, fy: 0, mass: 0.3, fixed: level.anchors.some(([ax, ay]) => ax === x && ay === y) });
      }
      return index.get(k);
    };
    this.beams = design.map(([ax, ay, bx, by, material]) => {
      const a = node(ax, ay), b = node(bx, by), rest = Math.hypot(bx - ax, by - ay), spec = MATERIALS[material];
      // Bjelkens masse fordeles likt på de to endene.
      this.nodes[a].mass += (spec.density * rest) / 2;
      this.nodes[b].mass += (spec.density * rest) / 2;
      return { a, b, rest, material, ea: spec.ea, max: spec.max, stress: 0, peak: 0, tension: true, broken: false, damping: 0, at: [ax, ay, bx, by] };
    });
    for (const beam of this.beams) {
      // Demping valgt som en andel av kritisk demping for bjelken og massene den forbinder.
      const mass = (this.nodes[beam.a].mass + this.nodes[beam.b].mass) / 2;
      beam.damping = 2 * 0.22 * Math.sqrt((beam.ea / beam.rest) * mass);
    }

    // Kjørebanen: bjelkene kjøretøyene følger, i rekkefølge, med avstanden fra start.
    const path = roadPath(level, design);
    this.path = [];
    this.length = 0;
    if (path) {
      for (let k = 0; k + 1 < path.length; k++) {
        const candidate = [...path[k], ...path[k + 1], 'road'];
        const beam = this.beams[design.findIndex((b) => sameBeam(b, candidate))];
        const forward = this.nodes[beam.a].x === path[k][0] && this.nodes[beam.a].y === path[k][1];
        this.path.push({ beam, from: forward ? beam.a : beam.b, to: forward ? beam.b : beam.a, at: this.length });
        this.length += beam.rest;
      }
    }
    if (!path) this.fail('Veien henger ikke sammen fra bredd til bredd.');
    this.vehicles = level.vehicles.map((v, k) => ({
      mass: v.mass, speed: v.speed, startsAt: SETTLE + (v.delay ?? 0) * k, s: -1.5 - k * 0.2,
      state: 'waiting', x: level.left - 1.5, y: 0, angle: 0, vx: 0, vy: 0,
    }));
  }

  /** Flytter simuleringen ett bilde (1/60 s) frem. */
  step(dt = 1 / 60) {
    if (this.status !== 'running') return;
    const h = dt / SUBSTEPS;
    for (let sub = 0; sub < SUBSTEPS; sub++) this.substep(h);
    this.time += dt;
    this.moveVehicles(dt);
    if (this.status === 'running' && this.time > TIME_LIMIT) this.fail('Tiden gikk ut.');
  }

  substep(h) {
    const { nodes, beams } = this;
    // Tyngden trappes opp det første halve sekundet, så brua ikke får et slag idet testen starter.
    const g = GRAVITY * Math.min(1, this.time / 0.5 + 0.2);
    for (const n of nodes) { n.fx = 0; n.fy = -n.mass * g; }

    // Kjøretøyene trykker på de to knutepunktene i bjelken de står på, mest på det nærmeste.
    for (const v of this.vehicles) {
      if (v.state !== 'driving' || v.s < 0 || v.s >= this.length) continue;
      const segment = this.segmentAt(v.s);
      if (segment.beam.broken) continue;
      const t = (v.s - segment.at) / segment.beam.rest;
      nodes[segment.from].fy -= v.mass * GRAVITY * (1 - t);
      nodes[segment.to].fy -= v.mass * GRAVITY * t;
    }

    for (const beam of beams) {
      if (beam.broken) continue;
      const a = nodes[beam.a], b = nodes[beam.b];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1e-9;
      const ux = dx / length, uy = dy / length;
      const elastic = beam.ea * ((length - beam.rest) / beam.rest);
      const force = elastic + beam.damping * ((b.vx - a.vx) * ux + (b.vy - a.vy) * uy);
      a.fx += force * ux; a.fy += force * uy;
      b.fx -= force * ux; b.fy -= force * uy;
      // Belastningen glattes litt, så ett enkelt rykk i ett delsteg ikke knekker en bjelke.
      beam.stress += (Math.abs(elastic) / beam.max - beam.stress) * 0.08;
      beam.tension = elastic >= 0;
      if (beam.stress > beam.peak) beam.peak = beam.stress;
      if (beam.stress > this.maxStress) this.maxStress = beam.stress;
      if (beam.stress > 1) {
        beam.broken = true;
        this.broken++;
        this.events.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        this.firstBreak ??= { x: (beam.at[0] + beam.at[2]) / 2, y: (beam.at[1] + beam.at[3]) / 2 };
      }
    }

    const keep = 1 - DRAG * h;
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx = (n.vx + (n.fx / n.mass) * h) * keep;
      n.vy = (n.vy + (n.fy / n.mass) * h) * keep;
      n.x += n.vx * h;
      n.y += n.vy * h;
    }
  }

  segmentAt(s) {
    let found = this.path[0];
    for (const segment of this.path) { if (segment.at <= s) found = segment; else break; }
    return found;
  }

  moveVehicles(dt) {
    const { level } = this;
    let done = 0;
    for (const v of this.vehicles) {
      if (v.state === 'waiting' && this.time >= v.startsAt) v.state = 'driving';
      if (v.state === 'driving') {
        v.s += v.speed * dt;
        if (v.s < 0) { v.x = level.left + v.s; v.y = 0; v.angle = 0; }               // på venstre bredd
        else if (v.s >= this.length) {                                               // trygt over
          v.x = level.right + (v.s - this.length); v.y = 0; v.angle = 0;
          if (v.s > this.length + 1.2) v.state = 'done';
        } else {
          const segment = this.segmentAt(v.s);
          const a = this.nodes[segment.from], b = this.nodes[segment.to];
          const t = (v.s - segment.at) / segment.beam.rest;
          if (segment.beam.broken) {
            // Veien under kjøretøyet er borte: det faller fritt herfra.
            v.state = 'falling';
            v.vx = v.speed; v.vy = 0;
          } else {
            v.x = a.x + (b.x - a.x) * t; v.y = a.y + (b.y - a.y) * t;
            v.angle = Math.atan2(b.y - a.y, b.x - a.x);
          }
        }
      }
      if (v.state === 'falling') {
        v.vy -= GRAVITY * dt;
        v.x += v.vx * dt; v.y += v.vy * dt;
        v.angle -= 1.6 * dt;
        if (v.y < -5.5) this.fail('Kjøretøyet havnet i elva.');
      }
      if (v.state === 'done') done++;
    }
    if (this.status === 'running' && done === this.vehicles.length) this.status = 'won';
  }

  fail(reason) {
    if (this.status !== 'running') return;
    this.status = 'failed';
    this.reason = reason;
  }
}

/** Kjører en hel test uten visning. Brukes av testene og til å gi stjerner. */
export function simulate(level, design) {
  const sim = new Simulation(level, design);
  while (sim.status === 'running') sim.step();
  return sim;
}

/** Budsjettet er den høyeste prisgrensen: dyrere enn dette godkjennes ikke. */
export const budget = (level) => level.stars[2];

/** Stjerner for en bru som holdt: 3, 2 eller 1 etter prisgrensene, og 0 over budsjettet. */
export function stars(level, design, won) {
  if (!won) return 0;
  const spent = cost(design);
  const [three, two, limit] = level.stars;
  return spent <= three ? 3 : spent <= two ? 2 : spent <= limit ? 1 : 0;
}
