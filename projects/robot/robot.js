/**
 * Robotspillet. Roboten styres med Kvist, språket fra et av de andre prosjektene.
 *
 * Koden kompileres av den vanlige Kvist-kompilatoren og kjøres i den samme maskinen.
 * Spillet legger til noen funksjoner: frem(), venstre() og høyre() flytter roboten,
 * og fri(), friVenstre(), friHøyre() og mål() er sensorer. Hver bevegelse bruker batteri.
 */
import { compile } from '../kvist/compiler.js';
import { VM } from '../kvist/vm.js';
import { tokenize } from '../kvist/lexer.js';

const DIRECTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]];           // opp, høyre, ned, venstre
const START = { '^': 0, '>': 1, v: 2, '<': 3 };
const MAX_IDLE = 200_000;   // instruksjoner uten en eneste bevegelse: programmet står og spinner

/**
 * Banene tegnes med tegn: # er vegg, . er gulv, ^ > v < er roboten, * er krystall og M er mål.
 * Et nivå kan ha flere baner, og da må samme program klare alle.
 */
export const LEVELS = [
  {
    id: 'steg', name: 'Første steg', par: 12,
    text: 'Roboten forstår tre kommandoer: frem(), venstre() og høyre(). Få den bort til målet. Hver kommando avsluttes med semikolon.',
    starter: '// Roboten ser mot høyre.\n// Målet er tre ruter unna.\nfrem();\n',
    maps: [['#######', '#>..M.#', '#######']],
  },
  {
    id: 'hjornet', name: 'Rundt hjørnet', par: 28,
    text: 'venstre() og høyre() snur roboten på stedet uten å flytte den. Plukk opp krystallen på veien: den tas med når roboten kjører over den.',
    starter: '// Snu med venstre()\n// og høyre().\nfrem();\nfrem();\n',
    maps: [['######', '#>.*.#', '####.#', '####.#', '####M#', '######']],
  },
  {
    id: 'gjenta', name: 'Gjenta', par: 14,
    text: 'Ti kommandoer på rad blir fort kjedelig. En løkke gjentar det som står inni: for i in range(4) {... } kjører innholdet fire ganger.',
    starter: '// Kjør frem åtte ganger,\n// uten å skrive frem()\n// åtte ganger.\nfor i in range(2) {\n  frem();\n}\n',
    maps: [['###########', '#>*.*.*.*M#', '###########']],
  },
  {
    id: 'trappen', name: 'Trappen', par: 36,
    text: 'Mønsteret "frem, venstre, frem, høyre" gjentar seg fire ganger. Gi mønsteret et navn med fn, og kall det i en løkke.',
    starter: '// Lag en funksjon for ett\n// trinn, og kall den flere\n// ganger.\nfn trinn() {\n  frem();\n}\n\ntrinn();\n',
    maps: [['#######', '#####M#', '####*.#', '###*.##', '##*.###', '#>.####', '#######']],
  },
  {
    id: 'veggen', name: 'Til veggen', par: 10,
    text: 'Nå må det samme programmet klare tre baner med ulik lengde. Du kan ikke telle rutene, men sensoren fri() sier om ruta foran er ledig: while fri() {... }.',
    starter: '// fri() er sann så lenge\n// ruta foran er ledig.\nwhile fri() {\n  \n}\n',
    maps: [
      ['######', '#>..M#', '######'],
      ['#########', '#>.....M#', '#########'],
      ['############', '#>*.*.*..*M#', '############'],
    ],
  },
  {
    id: 'svingen', name: 'Svingen', par: 28,
    text: 'Gangen svinger til venstre et ukjent sted. Kjør til veggen, snu, og kjør til veggen igjen. Tre baner, ett program.',
    starter: '// Hint: en funksjon som\n// kjører til veggen, kan\n// brukes to ganger.\n',
    maps: [
      ['#####', '###M#', '###.#', '#>..#', '#####'],
      ['########', '######M#', '######*#', '######.#', '######.#', '#>*....#', '########'],
      ['######', '####M#', '#>.*.#', '######'],
    ],
  },
  {
    id: 'labyrinten', name: 'Labyrinten', par: 40,
    text: 'Tre labyrinter, ett program. Et gammelt triks: hold høyre hånd på veggen og gå. Sensorene friHøyre(), fri() og friVenstre() ser i hver sin retning, og mål() er sann når roboten står på målet.',
    starter: '// while not mål() {... }\n// gjentar til roboten\n// er fremme.\n//\n// if friHøyre() {... }\n// else if fri() {... }\n// else {... }\n',
    maps: [
      ['#######', '#>..#M#', '#.#.#.#', '#.#...#', '#######'],
      ['#########', '#>#...#M#', '#.#.#.#.#', '#.#.#.#.#', '#...#...#', '#########'],
      ['#########', '#.....#.#', '#.###.#.#', '#>#M#...#', '#.#.###.#', '#.#.....#', '#########'],
    ],
  },
];

/** En bane med en robot i. Reglene: kjører roboten i en vegg, er forsøket over. */
export class World {
  constructor(rows, battery = 120) {
    this.width = rows[0].length;
    this.height = rows.length;
    this.walls = rows.map((row) => [...row].map((c) => c === '#'));
    this.crystals = new Set();
    this.battery = battery;
    this.moves = 0;
    this.status = 'running';   // 'running' | 'won' | 'crashed' | 'empty'
    this.log = [];             // hendelser for visningen: { type: 'move' | 'turn' | 'bump' | 'pick', x, y, dir }
    rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (c in START) { this.x = x; this.y = y; this.dir = START[c]; }
      else if (c === '*') this.crystals.add(`${x},${y}`);
      else if (c === 'M') this.goal = [x, y];
    }));
    this.trail = [[this.x, this.y]];
  }

  /** Er ruta i retningen "turn" (0 = rett frem, -1 = venstre, 1 = høyre) ledig? */
  free(turn = 0) {
    const [dx, dy] = DIRECTIONS[(this.dir + turn + 4) % 4];
    return !this.walls[this.y + dy]?.[this.x + dx];
  }

  atGoal() { return this.x === this.goal[0] && this.y === this.goal[1]; }

  /** Bruker en enhet batteri. Returnerer false hvis forsøket allerede er over. */
  spend() {
    if (this.status !== 'running') return false;
    if (this.moves >= this.battery) { this.status = 'empty'; return false; }
    this.moves++;
    return true;
  }

  forward() {
    if (!this.spend()) return;
    if (!this.free()) {
      this.status = 'crashed';
      this.log.push({ type: 'bump', x: this.x, y: this.y, dir: this.dir });
      return;
    }
    const [dx, dy] = DIRECTIONS[this.dir];
    this.x += dx; this.y += dy;
    this.trail.push([this.x, this.y]);
    this.log.push({ type: 'move', x: this.x, y: this.y, dir: this.dir });
    if (this.crystals.delete(`${this.x},${this.y}`)) this.log.push({ type: 'pick', x: this.x, y: this.y, dir: this.dir });
    if (this.atGoal() && this.crystals.size === 0) this.status = 'won';
  }

  turn(by) {
    if (!this.spend()) return;
    this.dir = (this.dir + by + 4) % 4;
    this.log.push({ type: 'turn', x: this.x, y: this.y, dir: this.dir, by });
  }
}

/** Funksjonene spillet gir språket. Samme form som de innebygde funksjonene i Kvist. */
export function hostFunctions(world) {
  const host = {
    frem: { arity: 0, fn: () => { world.forward(); return null; } },
    venstre: { arity: 0, fn: () => { world.turn(-1); return null; } },
    høyre: { arity: 0, fn: () => { world.turn(1); return null; } },
    fri: { arity: 0, fn: () => world.free(0) },
    friVenstre: { arity: 0, fn: () => world.free(-1) },
    friHøyre: { arity: 0, fn: () => world.free(1) },
    mål: { arity: 0, fn: () => world.atGoal() },
    krystaller: { arity: 0, fn: () => world.crystals.size },
  };
  for (const [name, entry] of Object.entries(host)) entry.name = name;
  return host;
}
const HOST_NAMES = hostFunctions(null);

/**
 * Størrelsen på programmet er antall symboler i koden. Kommentarer og mellomrom
 * teller ikke. Kaster en feil hvis programmet ikke kompilerer.
 */
export function programSize(source) {
  compile(source, HOST_NAMES);
  return tokenize(source).length - 1; // det siste symbolet markerer slutten av teksten
}

/**
 * Et forsøk på en bane. Siden kaller advance() om og om igjen, og hvert kall
 * kjører maskinen til roboten har gjort en ting, så den kan animeres.
 */
export class Attempt {
  constructor(source, rows) {
    this.world = new World(rows);
    this.host = hostFunctions(this.world);
    this.vm = new VM(compile(source, this.host), () => {}, this.host);
    this.outcome = null;   // null mens det kjører, ellers { won, reason }
    this.lastLine = 0;     // kildelinjen til kommandoen roboten utførte sist
  }

  /** Kildelinjen som kjøres akkurat nå. */
  get line() { return this.vm.done ? 0 : this.vm.line; }

  /** Kjører til neste bevegelse og gir hendelsene som skjedde. Setter outcome når forsøket er over. */
  advance() {
    if (this.outcome) return [];
    const { world, vm } = this;
    const before = world.log.length;
    let idle = 0;
    try {
      while (!vm.done && world.status === 'running' && world.log.length === before) {
        this.lastLine = vm.line;
        vm.step();
        if (++idle > MAX_IDLE) { this.outcome = { won: false, reason: 'Programmet står og spinner uten å flytte roboten. Mangler løkka noe som endrer seg?' }; break; }
      }
    } catch (error) {
      if (!error.kind) throw error;
      this.outcome = { won: false, reason: `${error.kind} på linje ${error.line}: ${error.message}.`, line: error.line };
    }
    if (!this.outcome) {
      if (world.status === 'won') this.outcome = { won: true, reason: '' };
      else if (world.status === 'crashed') this.outcome = { won: false, reason: 'Roboten kjørte i veggen.' };
      else if (world.status === 'empty') this.outcome = { won: false, reason: `Batteriet er tomt etter ${world.battery} bevegelser.` };
      else if (vm.done) {
        const left = world.crystals.size;
        this.outcome = { won: false, reason: !world.atGoal() ? 'Programmet er ferdig, men roboten står ikke på målet.' : `Roboten står på målet, men ${left === 1 ? 'en krystall' : `${left} krystaller`} ligger igjen.` };
      }
    }
    return world.log.slice(before);
  }
}

/** Kjører et program på alle banene i et nivå uten visning. Brukes av testene. */
export function solve(level, source) {
  const size = programSize(source);
  let moves = 0;
  for (let k = 0; k < level.maps.length; k++) {
    const attempt = new Attempt(source, level.maps[k]);
    while (!attempt.outcome) attempt.advance();
    moves += attempt.world.moves;
    if (!attempt.outcome.won) return { won: false, map: k, reason: attempt.outcome.reason, size, moves };
  }
  return { won: true, size, moves };
}

/** En stjerne for å klare nivået, to for høyst 1,5 x par, og tre for par eller mindre. */
export const stars = (level, size, won) => (!won ? 0 : size <= level.par ? 3 : size <= Math.ceil(level.par * 1.5) ? 2 : 1);
