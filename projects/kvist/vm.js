/**
 * Den virtuelle maskinen. En stakkmaskin som kjører bytekoden fra kompilatoren.
 *
 * Den kan kjøre en instruksjon om gangen (step) eller mange (run).
 * Stakken, kallstakken og variablene ligger åpent, så siden kan vise dem.
 */
import { KvistError } from './lexer.js';
import { OP } from './opcodes.js';

const MAX_FRAMES = 1000;
const MAX_STACK = 100_000;

const typeName = (v) =>
  v === null ? 'nil' : typeof v === 'number' ? 'tall' : typeof v === 'string' ? 'tekst' : typeof v === 'boolean' ? 'sannhetsverdi' : Array.isArray(v) ? 'liste' : 'funksjon';

/** Tekstlig form, slik print viser verdien. Lister kan inneholde seg selv, derfor "seen". */
export function show(value, nested = false, seen = new Set()) {
  if (value === null) return 'nil';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10);
  if (typeof value === 'string') return nested ? JSON.stringify(value) : value;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[...]';
    seen.add(value);
    const text = `[${value.map((item) => show(item, true, seen)).join(', ')}]`;
    seen.delete(value);
    return text;
  }
  return `<fn ${value.proto ? value.proto.name : value.name}>`;
}

const expectType = (value, type, what) => {
  if (typeName(value) !== type) throw new Error(`${what} forventer ${type}, men fikk ${typeName(value)}`);
};

/** Innebygde funksjoner. arity -1 betyr vilkårlig antall argumenter. */
export const BUILTINS = {
  print: { arity: -1, fn: (args, vm) => { vm.output(args.map((a) => show(a)).join(' ')); return null; } },
  len: { arity: 1, fn: ([v]) => { if (typeof v !== 'string' && !Array.isArray(v)) throw new Error(`len forventer liste eller tekst, men fikk ${typeName(v)}`); return v.length; } },
  push: { arity: 2, fn: ([list, v]) => { expectType(list, 'liste', 'push'); list.push(v); return list; } },
  pop: { arity: 1, fn: ([list]) => { expectType(list, 'liste', 'pop'); if (!list.length) throw new Error('pop på en tom liste'); return list.pop(); } },
  str: { arity: 1, fn: ([v]) => show(v) },
  num: { arity: 1, fn: ([v]) => { const n = Number(v); if (typeof v !== 'string' || v.trim() === '' || Number.isNaN(n)) throw new Error(`num kan ikke tolke ${show(v, true)} som et tall`); return n; } },
  floor: { arity: 1, fn: ([v]) => { expectType(v, 'tall', 'floor'); return Math.floor(v); } },
  sqrt: { arity: 1, fn: ([v]) => { expectType(v, 'tall', 'sqrt'); if (v < 0) throw new Error('sqrt av et negativt tall'); return Math.sqrt(v); } },
  abs: { arity: 1, fn: ([v]) => { expectType(v, 'tall', 'abs'); return Math.abs(v); } },
  range: { arity: 1, fn: ([n]) => { expectType(n, 'tall', 'range'); if (n > 1e6) throw new Error('range er begrenset til en million elementer'); return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i); } },
  join: { arity: 2, fn: ([list, sep]) => { expectType(list, 'liste', 'join'); expectType(sep, 'tekst', 'join'); return list.map((item) => show(item)).join(sep); } },
  chars: { arity: 1, fn: ([text]) => { expectType(text, 'tekst', 'chars'); return [...text]; } },
};
for (const [name, builtin] of Object.entries(BUILTINS)) builtin.name = name;

export class VM {
  /**
   * @param {{ main: object, protos: object[] }} program  Resultatet fra compile()
   * @param {(line: string) => void} output               Kalles for hver print
   * @param {Record<string, object>} host                 Ekstra innebygde funksjoner (se compile)
   */
  constructor(program, output = () => {}, host = {}) {
    this.host = host;
    this.protos = program.protos;
    this.output = output;
    this.stack = [];
    this.frames = [];
    this.steps = 0;
    this.done = false;
    this.pushFrame({ proto: program.main, env: null }, 0);
  }

  get frame() { return this.frames.at(-1); }
  /** Kildelinjen til instruksjonen som står for tur. */
  get line() { return this.done ? 0 : this.frame.proto.lines[this.frame.ip]; }

  pushFrame(closure, argc) {
    if (this.frames.length >= MAX_FRAMES) throw new Error(`For dyp rekursjon (over ${MAX_FRAMES} kall). Mangler funksjonen et stoppunkt?`);
    const proto = closure.proto;
    // En plass per variabel i funksjonen, og en peker til omgivelsen der funksjonen ble laget.
    const slots = new Array(proto.slotNames.length).fill(null);
    for (let i = argc - 1; i >= 0; i--) slots[i] = this.stack.pop();
    this.frames.push({ proto, ip: 0, env: { slots, parent: closure.env } });
  }

  /** Kjører til programmet er ferdig eller maxSteps instruksjoner er utført. */
  run(maxSteps = Infinity) {
    const limit = this.steps + maxSteps;
    while (!this.done && this.steps < limit) this.step();
    return this.done;
  }

  /** Utfører nøyaktig en instruksjon. */
  step() {
    if (this.done) return;
    const frame = this.frame;
    const { code } = frame.proto;
    const at = frame.ip * 3;
    const op = code[at], a = code[at + 1], b = code[at + 2];
    const line = frame.proto.lines[frame.ip];
    const stack = this.stack;
    frame.ip++;
    this.steps++;

    try {
      switch (op) {
        case OP.CONST: stack.push(frame.proto.constants[a]); break;
        case OP.NIL: stack.push(null); break;
        case OP.TRUE: stack.push(true); break;
        case OP.FALSE: stack.push(false); break;
        case OP.POP: stack.pop(); break;
        case OP.LOAD: {
          let env = frame.env;
          for (let d = a; d > 0; d--) env = env.parent;
          stack.push(env.slots[b]);
          break;
        }
        case OP.STORE: {
          let env = frame.env;
          for (let d = a; d > 0; d--) env = env.parent;
          env.slots[b] = stack[stack.length - 1]; // verdien blir liggende: tilordning er et uttrykk
          break;
        }
        case OP.BUILTIN: { const name = frame.proto.constants[a]; stack.push(Object.hasOwn(this.host, name) ? this.host[name] : BUILTINS[name]); break; }
        case OP.CLOSURE: stack.push({ proto: this.protos[a], env: frame.env }); break;

        case OP.ADD: {
          const right = stack.pop(), left = stack.pop();
          if (typeof left === 'number' && typeof right === 'number') stack.push(left + right);
          else if (typeof left === 'string' || typeof right === 'string') stack.push(show(left) + show(right));
          else if (Array.isArray(left) && Array.isArray(right)) stack.push([...left, ...right]);
          else throw new Error(`Kan ikke legge sammen ${typeName(left)} og ${typeName(right)}`);
          break;
        }
        case OP.SUB: case OP.MUL: case OP.DIV: case OP.MOD: {
          const right = stack.pop(), left = stack.pop();
          if (typeof left !== 'number' || typeof right !== 'number') {
            throw new Error(`Regneoperasjonen forventer to tall, men fikk ${typeName(left)} og ${typeName(right)}`);
          }
          if ((op === OP.DIV || op === OP.MOD) && right === 0) throw new Error('Deling på null');
          stack.push(op === OP.SUB ? left - right : op === OP.MUL ? left * right : op === OP.DIV ? left / right : left - right * Math.floor(left / right));
          break;
        }
        case OP.NEG: {
          const value = stack.pop();
          if (typeof value !== 'number') throw new Error(`Kan ikke bytte fortegn på ${typeName(value)}`);
          stack.push(-value);
          break;
        }
        case OP.NOT: stack.push(!truthy(stack.pop())); break;
        case OP.EQ: { const right = stack.pop(); stack.push(stack.pop() === right); break; }
        case OP.NE: { const right = stack.pop(); stack.push(stack.pop() !== right); break; }
        case OP.LT: case OP.LE: case OP.GT: case OP.GE: {
          const right = stack.pop(), left = stack.pop();
          if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) {
            throw new Error(`Kan ikke sammenligne ${typeName(left)} med ${typeName(right)}`);
          }
          stack.push(op === OP.LT ? left < right : op === OP.LE ? left <= right : op === OP.GT ? left > right : left >= right);
          break;
        }

        case OP.JUMP: frame.ip = a; break;
        case OP.JUMP_IF_FALSE: if (!truthy(stack.pop())) frame.ip = a; break;
        // and/or: avgjør venstresiden svaret, blir den liggende som resultat og høyresiden hoppes over.
        case OP.AND: if (!truthy(stack[stack.length - 1])) frame.ip = a; else stack.pop(); break;
        case OP.OR: if (truthy(stack[stack.length - 1])) frame.ip = a; else stack.pop(); break;

        case OP.CALL: {
          const callee = stack[stack.length - 1 - a];
          if (callee && callee.proto) {
            if (callee.proto.arity !== a) throw new Error(`${callee.proto.name} tar ${callee.proto.arity} argumenter, men fikk ${a}`);
            this.pushFrame(callee, a);
            stack.pop(); // selve funksjonen
          } else if (callee && callee.fn) {
            if (callee.arity >= 0 && callee.arity !== a) throw new Error(`${callee.name} tar ${callee.arity} argumenter, men fikk ${a}`);
            const args = stack.splice(stack.length - a, a);
            stack.pop();
            stack.push(callee.fn(args, this));
          } else {
            throw new Error(`Kan ikke kalle ${typeName(callee)}: det er ikke en funksjon`);
          }
          break;
        }
        case OP.RETURN:
          this.frames.pop();
          if (!this.frames.length) { this.done = true; stack.length = 0; }
          break;

        case OP.ARRAY: stack.push(stack.splice(stack.length - a, a)); break;
        case OP.LEN: {
          const value = stack.pop();
          if (!Array.isArray(value) && typeof value !== 'string') throw new Error(`for... in forventer liste eller tekst, men fikk ${typeName(value)}`);
          stack.push(value.length);
          break;
        }
        case OP.INDEX: {
          const index = stack.pop(), object = stack.pop();
          stack.push(object[checkIndex(object, index)]);
          break;
        }
        case OP.STORE_INDEX: {
          const value = stack.pop(), index = stack.pop(), object = stack.pop();
          if (!Array.isArray(object)) throw new Error(`Kan ikke tilordne til et element i ${typeName(object)}`);
          object[checkIndex(object, index)] = value;
          stack.push(value);
          break;
        }
        default: throw new Error(`Ukjent instruksjon ${op}`);
      }
      if (stack.length > MAX_STACK) throw new Error('Stakken er full');
    } catch (error) {
      this.done = true;
      if (error instanceof KvistError) throw error;
      const trace = this.frames.map((f) => f.proto.name).reverse();
      const failure = new KvistError('Kjøretidsfeil', error.message, line);
      failure.trace = trace;
      throw failure;
    }
  }
}

const truthy = (value) => value !== null && value !== false;

function checkIndex(object, index) {
  if (!Array.isArray(object) && typeof object !== 'string') throw new Error(`Kan ikke indeksere ${typeName(object)}`);
  if (!Number.isInteger(index)) throw new Error(`Indeksen må være et heltall, men var ${show(index, true)}`);
  if (index < 0 || index >= object.length) throw new Error(`Indeks ${index} er utenfor ${typeName(object) === 'liste' ? 'listen' : 'teksten'} (lengde ${object.length})`);
  return index;
}
