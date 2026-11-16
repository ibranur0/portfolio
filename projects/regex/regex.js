/**
 * En regex-motor uten tilbakesporing. Brukes av siden og av testene.
 *
 * Mønsteret går gjennom tre steg:
 *   1. parse()    tekst -> syntakstre
 *   2. compile()  syntakstre -> automat (Thompsons konstruksjon)
 *   3. Regex#run  følger alle tilstandene automaten kan være i samtidig
 *
 * De fleste regex-motorer prøver en vei om gangen og går tilbake når den ikke fører frem.
 * På mønstre som (a+)+$ blir det veldig tregt. Her leses hvert tegn en gang,
 * så kjøretiden er O(tekstlengde x mønsterstørrelse).
 *
 * Ulempen er at tilbakereferanser (\1) og lookaround ikke støttes.
 * Det tidligste treffet vinner, og av dem det lengste.
 */
export class RegexError extends Error {
  /** @param {number} index  Posisjonen i mønsteret der feilen ble oppdaget */
  constructor(message, index) {
    super(message);
    this.index = index;
  }
}

const MAX_STATES = 20_000;
const MAX_REPEAT = 1000;

/* ------------------------------------------------------------ Tegnmengder */
// En tegnmengde er en flat liste med sorterte intervaller: [fra, til, fra, til, ...].
function normalize(pairs) {
  pairs.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [lo, hi] of pairs) {
    if (out.length && lo <= out[out.length - 1] + 1) out[out.length - 1] = Math.max(out[out.length - 1], hi);
    else out.push(lo, hi);
  }
  return out;
}

function invert(ranges) {
  const out = [];
  let next = 0;
  for (let k = 0; k < ranges.length; k += 2) {
    if (ranges[k] > next) out.push(next, ranges[k] - 1);
    next = ranges[k + 1] + 1;
  }
  if (next <= 0xffff) out.push(next, 0xffff);
  return out;
}

const pairsOf = (ranges) => {
  const pairs = [];
  for (let k = 0; k < ranges.length; k += 2) pairs.push([ranges[k], ranges[k + 1]]);
  return pairs;
};

function inRanges(ranges, code) {
  for (let k = 0; k < ranges.length; k += 2) {
    if (code < ranges[k]) return false;
    if (code <= ranges[k + 1]) return true;
  }
  return false;
}

const DIGIT = [48, 57];
const WORD = normalize([[48, 57], [65, 90], [95, 95], [97, 122]]);
// Samme tegn som \s i JavaScript.
const SPACE = normalize([[9, 13], [32, 32], [160, 160], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]]);
const NOT_NEWLINE = invert(normalize([[10, 10], [13, 13], [0x2028, 0x2029]]));
const CLASSES = { d: DIGIT, w: WORD, s: SPACE, D: invert(DIGIT), W: invert(WORD), S: invert(SPACE) };
const CONTROLS = { n: 10, t: 9, r: 13, f: 12, v: 11, 0: 0 };
const ASSERTIONS = { bol: 0, eol: 1, boundary: 2, notBoundary: 3 };

/* ---------------------------------------------------------------- Parser */
/**
 * Rekursiv nedstigning. Grammatikken, fra svakest til sterkest binding:
 *   alternativ  =  sekvens ( '|' sekvens )*
 *   sekvens     =  gjentak*
 *   gjentak     =  atom ( '*' | '+' | '?' | '{n}' | '{n,}' | '{n,m}' )?
 *   atom        =  tegn | '.' | '[...]' | '(' alternativ ')' | '^' | '$' | '\...'
 */
export function parse(pattern) {
  let i = 0;
  let leaves = 0;
  const fail = (message, at = i) => { throw new RegexError(message, at); };
  const peek = () => pattern[i];
  const more = () => i < pattern.length;
  const leaf = (ranges, start) => ({ type: 'char', ranges, id: leaves++, label: pattern.slice(start, i) });
  const assertion = (kind, start) => ({ type: 'assert', kind, label: pattern.slice(start, i) });

  function alternation() {
    const options = [sequence()];
    while (peek() === '|') { i++; options.push(sequence()); }
    return options.length === 1 ? options[0] : { type: 'alt', options };
  }

  function sequence() {
    const items = [];
    while (more() && peek() !== '|' && peek() !== ')') items.push(repetition());
    return items.length === 1 ? items[0] : { type: 'cat', items };
  }

  /** Leser en kvantor hvis det står en her. Returnerer { min, max } eller null. */
  function quantifier() {
    const c = peek();
    if (c === '*') { i++; return { min: 0, max: Infinity }; }
    if (c === '+') { i++; return { min: 1, max: Infinity }; }
    if (c === '?') { i++; return { min: 0, max: 1 }; }
    if (c !== '{') return null;
    const found = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(i));
    if (!found) return null; // "{" uten gyldig innhold er et vanlig tegn, som i JavaScript
    const at = i;
    i += found[0].length;
    const min = Number(found[1]);
    const max = found[2] ? (found[3] === '' ? Infinity : Number(found[3])) : min;
    if (max < min) fail(`Kvantoren ${found[0]} har større minimum enn maksimum`, at);
    if (min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) fail(`Kvantorer er begrenset til ${MAX_REPEAT} gjentakelser`, at);
    return { min, max };
  }

  function repetition() {
    const node = atom();
    const at = i;
    const q = quantifier();
    if (!q) return node;
    if (node.type === 'assert') fail(`"${node.label}" matcher ingen tegn og kan ikke gjentas`, at);
    // "Lat" kvantor (a+?) godtas, men endrer ingenting: motoren finner alltid det lengste treffet.
    if (peek() === '?') i++;
    const label = pattern.slice(at, i);
    const again = i;
    if (quantifier()) fail('To kvantorer på rad. Sett parentes rundt det som skal gjentas', again);
    return { type: 'repeat', min: q.min, max: q.max, node, label };
  }

  function atom() {
    const start = i;
    const c = pattern[i++];
    switch (c) {
      case '(': {
        if (peek() === '?') {
          const rest = pattern.slice(i);
          if (rest.startsWith('?:')) i += 2;
          else if (/^\?<[A-Za-z_$][\w$]*>/.test(rest)) i = pattern.indexOf('>', i) + 1; // navngitt gruppe
          else if (/^\?<?[=!]/.test(rest)) fail('Lookaround, som (?=...) og (?<!...), støttes ikke', start);
          else fail('Ukjent gruppetype etter "(?"', start);
        }
        const node = alternation();
        if (peek() !== ')') fail('Gruppen som starter her, mangler ")"', start);
        i++;
        return { type: 'group', node };
      }
      case '[': return charClass(start);
      case '.': return leaf(NOT_NEWLINE, start);
      case '^': return assertion('bol', start);
      case '$': return assertion('eol', start);
      case '*': case '+': case '?':
        return fail(`Ingenting å gjenta foran "${c}"`, start);
      case '{':
        if (/^\{\d+(,\d*)?\}/.test(pattern.slice(start))) fail('Ingenting å gjenta foran kvantoren', start);
        return leaf([123, 123], start);
      case '\\': {
        if (!more()) fail('Mønsteret slutter med en enslig "\\"', start);
        const e = pattern[i++];
        if (Object.hasOwn(CLASSES, e)) return leaf(CLASSES[e], start);
        if (e === 'b') return assertion('boundary', start);
        if (e === 'B') return assertion('notBoundary', start);
        if (e >= '1' && e <= '9') fail('Tilbakereferanser (\\1) støttes ikke. Det er de som gjør at regex generelt ikke kan kjøres i lineær tid', start);
        const code = escaped(e);
        return leaf([code, code], start);
      }
      default: {
        const code = c.charCodeAt(0);
        return leaf([code, code], start);
      }
    }
  }

  /** Tegnkoden for \n, \t, \x41, å og "\tegn" (som betyr tegnet selv). */
  function escaped(e) {
    if (Object.hasOwn(CONTROLS, e)) return CONTROLS[e];
    const digits = e === 'x' ? 2 : e === 'u' ? 4 : 0;
    const hex = pattern.slice(i, i + digits);
    if (digits && hex.length === digits && /^[0-9a-fA-F]+$/.test(hex)) { i += digits; return parseInt(hex, 16); }
    return e.charCodeAt(0);
  }

  function charClass(start) {
    const negated = peek() === '^';
    if (negated) i++;
    const pairs = [];
    /** Ett element i klassen: en tegnkode, eller en hel mengde for \d, \w og \s. */
    const item = () => {
      const c = pattern[i++];
      if (c !== '\\') return c.charCodeAt(0);
      if (!more()) fail('Tegnklassen som starter her, mangler "]"', start);
      const e = pattern[i++];
      if (Object.hasOwn(CLASSES, e)) return CLASSES[e];
      return e === 'b' ? 8 : escaped(e); // \b inne i en klasse er tegnet "backspace"
    };
    for (;;) {
      if (!more()) fail('Tegnklassen som starter her, mangler "]"', start);
      if (peek() === ']') { i++; break; }
      const at = i;
      const lo = item();
      if (typeof lo !== 'number') { pairs.push(...pairsOf(lo)); continue; }
      // "a-z" er et intervall. En bindestrek først, sist eller ved siden av \d er et vanlig tegn.
      if (peek() === '-' && i + 1 < pattern.length && pattern[i + 1] !== ']') {
        i++;
        const hi = item();
        if (typeof hi !== 'number') { pairs.push([lo, lo], [45, 45], ...pairsOf(hi)); continue; }
        if (hi < lo) fail(`Intervallet "${pattern.slice(at, i)}" er i feil rekkefølge`, at);
        pairs.push([lo, hi]);
      } else pairs.push([lo, lo]);
    }
    const ranges = normalize(pairs);
    return leaf(negated ? invert(ranges) : ranges, start);
  }

  const ast = alternation();
  if (more()) fail('")" uten en åpen gruppe'); // det eneste som stopper alternation() før slutten
  return { ast, leaves };
}

/* ------------------------------------------------------------ Kompilator */
const CHAR = 0, SPLIT = 1, JUMP = 2, MATCH = 3, ASSERT = 4;

/**
 * Thompsons konstruksjon. Hvert ledd i treet blir en liten bit av automaten med en
 * inngang og noen løse utganger, og bitene kobles sammen etter hvert.
 *
 *   CHAR    bruker ett tegn hvis det er i mengden, og går til out
 *   SPLIT   går til både out og out1 uten å bruke noe tegn (valg og løkker)
 *   JUMP    går til out uten å bruke noe tegn
 *   ASSERT  går til out hvis betingelsen stemmer her (^, $, \b)
 *   MATCH   mønsteret har truffet
 */
export function compile(ast) {
  const op = [], arg = [], out = [], out1 = [], leaf = [];
  const emit = (code, argument = null, leafId = -1) => {
    if (op.length >= MAX_STATES) throw new RegexError(`Mønsteret gir en automat med over ${MAX_STATES.toLocaleString('nb-NO')} tilstander. Bruk mindre kvantorer`, 0);
    op.push(code); arg.push(argument); out.push(-1); out1.push(-1); leaf.push(leafId);
    return op.length - 1;
  };
  // En løs utgang er kodet som tilstand * 2 (+ 1 for "out1").
  const patch = (ends, target) => {
    for (const end of ends) { if (end & 1) out1[end >> 1] = target; else out[end >> 1] = target; }
  };
  const single = (state) => ({ start: state, ends: [state * 2] });

  function build(node) {
    switch (node.type) {
      case 'char': return single(emit(CHAR, node.ranges, node.id));
      case 'assert': return single(emit(ASSERT, ASSERTIONS[node.kind]));
      case 'group': return build(node.node);
      case 'cat': {
        if (!node.items.length) return single(emit(JUMP)); // tom sekvens, f.eks. "a|"
        const first = build(node.items[0]);
        let ends = first.ends;
        for (let k = 1; k < node.items.length; k++) {
          const next = build(node.items[k]);
          patch(ends, next.start);
          ends = next.ends;
        }
        return { start: first.start, ends };
      }
      case 'alt': {
        const fragments = node.options.map(build);
        let start = fragments.at(-1).start;
        const ends = [...fragments.at(-1).ends];
        for (let k = fragments.length - 2; k >= 0; k--) {
          const split = emit(SPLIT);
          out[split] = fragments[k].start;
          out1[split] = start;
          start = split;
          ends.push(...fragments[k].ends);
        }
        return { start, ends };
      }
      case 'repeat': return repeat(node);
      default: throw new Error(`Ukjent node: ${node.type}`);
    }
  }

  /** x{min,max}: først min kopier som må være med, så en løkke eller noen valgfrie kopier. */
  function repeat({ node, min, max }) {
    let start = -1, ends = [], lastStart = -1;
    const append = (fragment) => {
      if (start < 0) start = fragment.start; else patch(ends, fragment.start);
      ends = fragment.ends;
    };
    for (let k = 0; k < min; k++) {
      const copy = build(node);
      lastStart = copy.start;
      append(copy);
    }
    if (max === Infinity) {
      const split = emit(SPLIT);
      if (min === 0) {
        // x*: split -> x -> tilbake til split. Den andre utgangen går videre.
        const body = build(node);
        out[split] = body.start;
        patch(body.ends, split);
        append({ start: split, ends: [split * 2 + 1] });
      } else {
        // x+: etter den siste obligatoriske kopien kan vi gå tilbake til starten av den.
        patch(ends, split);
        out[split] = lastStart;
        ends = [split * 2 + 1];
      }
    } else {
      // x{2,4} = x x (x (x)?)? : hver valgfri kopi kan hoppes over, og da hoppes resten over også.
      const skips = [];
      for (let k = min; k < max; k++) {
        const split = emit(SPLIT);
        const body = build(node);
        out[split] = body.start;
        skips.push(split * 2 + 1);
        append({ start: split, ends: body.ends });
      }
      ends = [...ends, ...skips];
    }
    return start < 0 ? single(emit(JUMP)) : { start, ends }; // x{0} matcher den tomme teksten
  }

  const whole = build(ast);
  patch(whole.ends, emit(MATCH));
  return {
    size: op.length, start: whole.start,
    op: Uint8Array.from(op), arg, out: Int32Array.from(out), out1: Int32Array.from(out1), leaf: Int32Array.from(leaf),
  };
}

/* ------------------------------------------------------------- Simulering */
/**
 * Tilstandene automaten er i akkurat nå, lagret som et "sparse set".
 * Innsetting, oppslag og tømming er O(1), og rekkefølgen beholdes.
 * Hver tilstand husker også hvor i teksten forsøket startet (from).
 */
class StateSet {
  constructor(capacity) {
    this.dense = new Int32Array(capacity);
    this.sparse = new Int32Array(capacity);
    this.from = new Int32Array(capacity);
    this.size = 0;
  }
  has(state) {
    const k = this.sparse[state];
    return k < this.size && this.dense[k] === state;
  }
  add(state, from) {
    this.sparse[state] = this.size;
    this.dense[this.size] = state;
    this.from[this.size++] = from;
  }
}

const isWordAt = (text, index) => index >= 0 && index < text.length && inRanges(WORD, text.charCodeAt(index));

export class Regex {
  /** @throws {RegexError} hvis mønsteret er ugyldig eller bruker noe motoren ikke støtter */
  constructor(pattern) {
    this.source = pattern;
    const { ast, leaves } = parse(pattern);
    this.ast = ast;
    this.leafCount = leaves;
    this.program = compile(ast);
    this.current = new StateSet(this.program.size);
    this.next = new StateSet(this.program.size);
    this.stack = new Int32Array(this.program.size * 2 + 2);
  }

  /** Antall tilstander i automaten. */
  get stateCount() { return this.program.size; }

  /**
   * Legger til en tilstand og alt som kan nås fra den uten å bruke et tegn.
   * En tilstand som allerede er med, legges ikke til igjen, så mengden blir aldri
   * større enn automaten.
   */
  follow(set, state, from, pos, text) {
    const { op, arg, out, out1 } = this.program;
    const stack = this.stack;
    let top = 0;
    stack[top++] = state;
    while (top) {
      const s = stack[--top];
      if (set.has(s)) continue;
      set.add(s, from);
      const code = op[s];
      if (code === JUMP) stack[top++] = out[s];
      else if (code === SPLIT) { stack[top++] = out1[s]; stack[top++] = out[s]; }
      else if (code === ASSERT) {
        const kind = arg[s];
        const holds = kind === 0 ? pos === 0
          : kind === 1 ? pos === text.length
            : (isWordAt(text, pos - 1) !== isWordAt(text, pos)) === (kind === 2);
        if (holds) stack[top++] = out[s];
      }
    }
  }

  /**
   * Leser teksten en gang fra fromIndex og gir treffet lengst til venstre, eller null.
   * Med firstOnly stopper søket ved første treff.
   */
  run(text, fromIndex, firstOnly) {
    const { op, arg, out, start } = this.program;
    const length = text.length;
    let current = this.current, next = this.next;
    current.size = 0;
    let bestStart = -1, bestEnd = -1;

    for (let pos = fromIndex; pos <= length; pos++) {
      // Et nytt forsøk starter på hver posisjon til vi har et treff. Tilstandene er sortert
      // etter startpunkt, så det tidligste forsøket vinner.
      if (bestStart < 0) this.follow(current, start, pos, pos, text);
      if (current.size === 0) break;
      const code = pos < length ? text.charCodeAt(pos) : -1;
      next.size = 0;
      for (let k = 0; k < current.size; k++) {
        const from = current.from[k];
        if (bestStart >= 0 && from > bestStart) break; // senere startpunkt enn treffet vi har: uinteressant
        const s = current.dense[k];
        if (op[s] === MATCH) {
          if (firstOnly) return { start: from, end: pos };
          if (bestStart < 0 || from < bestStart || pos > bestEnd) { bestStart = from; bestEnd = pos; }
        } else if (op[s] === CHAR && code >= 0 && inRanges(arg[s], code)) {
          this.follow(next, out[s], from, pos + 1, text);
        }
      }
      const swap = current; current = next; next = swap;
    }
    return bestStart < 0 ? null : { start: bestStart, end: bestEnd };
  }

  /** Finnes det et treff noe sted i teksten? */
  test(text) { return this.run(text, 0, true) !== null; }

  /** Første treff fra og med fromIndex: { start, end } eller null. */
  exec(text, fromIndex = 0) { return this.run(text, fromIndex, false); }

  /** Alle treff som ikke overlapper, fra venstre mot høyre. */
  matchAll(text, limit = 5000) {
    const matches = [];
    let pos = 0;
    while (pos <= text.length && matches.length < limit) {
      const match = this.exec(text, pos);
      if (!match) break;
      matches.push(match);
      pos = match.end > match.start ? match.end : match.end + 1; // et tomt treff må ikke gi evig løkke
    }
    return matches;
  }

  /**
   * Til tegningen: hvilke tilstander er aktive før hvert tegn leses?
   * Gir ett element per posisjon: { leaves, threads, matched }.
   * leaves er id-ene til tegnene i mønsteret som automaten kan ta imot nå.
   */
  trace(text) {
    const { op, arg, out, leaf, start } = this.program;
    let current = this.current, next = this.next;
    current.size = 0;
    const steps = [];
    for (let pos = 0; pos <= text.length; pos++) {
      this.follow(current, start, pos, pos, text);
      const leaves = new Set();
      let threads = 0, matched = false;
      const code = pos < text.length ? text.charCodeAt(pos) : -1;
      next.size = 0;
      for (let k = 0; k < current.size; k++) {
        const s = current.dense[k];
        if (op[s] === MATCH) matched = true;
        else if (op[s] === CHAR) {
          threads++;
          leaves.add(leaf[s]);
          if (code >= 0 && inRanges(arg[s], code)) this.follow(next, out[s], current.from[k], pos + 1, text);
        }
      }
      steps.push({ leaves: [...leaves], threads, matched });
      const swap = current; current = next; next = swap;
    }
    return steps;
  }
}
