/**
 * Kompilatoren gjør syntakstreet om til bytekode.
 *
 * Hver funksjon får sin egen liste med instruksjoner. Variabler slås opp her og
 * blir til (dybde, plass): hvor mange funksjoner utover den ligger, og hvilken
 * plass den har der. Da trenger ikke maskinen å lete etter navn mens den kjører.
 */
import { KvistError } from './lexer.js';
import { parse } from './parser.js';
import { BUILTINS } from './vm.js';
import { OP, OP_NAMES } from './opcodes.js';

export { OP, OP_NAMES };
const BINARY_OPS = { '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV, '%': OP.MOD, '==': OP.EQ, '!=': OP.NE, '<': OP.LT, '<=': OP.LE, '>': OP.GT, '>=': OP.GE };

/** Tilstanden mens en funksjon kompileres. */
class FunctionState {
  constructor(name, params, parent) {
    this.parent = parent;
    this.proto = { name, arity: params.length, code: [], lines: [], constants: [], slotNames: [] };
    this.scopes = [new Map()];
    this.loops = [];
    for (const param of params) this.declare(param);
  }

  declare(name) {
    const scope = this.scopes.at(-1);
    if (scope.has(name)) return -1;
    scope.set(name, this.proto.slotNames.length);
    this.proto.slotNames.push(name);
    return this.proto.slotNames.length - 1;
  }

  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return -1;
  }
}

/**
 * @param {string} source
 * @param {Record<string, object>} host  Ekstra innebygde funksjoner fra programmet som bruker språket
 *   (samme form som BUILTINS i vm.js). Robotspillet gir for eksempel språket frem() og venstre().
 * @returns {{ main: object, protos: object[] }}
 */
export function compile(source, host = {}) {
  const program = parse(source);
  const protos = [];
  let fs = null; // funksjonen som kompileres akkurat nå

  const fail = (message, node) => { throw new KvistError('Kompileringsfeil', message, node.line, node.col ?? 0); };

  const emit = (op, a, b, line) => {
    fs.proto.code.push(op, a ?? 0, b ?? 0);
    fs.proto.lines.push(line);
    return fs.proto.code.length / 3 - 1;
  };
  const here = () => fs.proto.code.length / 3;
  const patch = (instruction, target = here()) => { fs.proto.code[instruction * 3 + 1] = target; };
  const constant = (value) => {
    let index = fs.proto.constants.indexOf(value);
    if (index < 0) index = fs.proto.constants.push(value) - 1;
    return index;
  };

  /** Finner variabelen i denne funksjonen eller en omsluttende. */
  function resolve(name) {
    let depth = 0;
    for (let state = fs; state; state = state.parent, depth++) {
      const slot = state.lookup(name);
      if (slot >= 0) return { depth, slot };
    }
    return null;
  }

  function declare(name, node) {
    const slot = fs.declare(name);
    if (slot < 0) fail(`"${name}" er allerede deklarert i denne blokken`, node);
    return slot;
  }

  function compileFunction(node) {
    fs = new FunctionState(node.name ?? 'anonym', node.params, fs);
    statements(node.body.body);
    emit(OP.NIL, 0, 0, node.body.line);
    emit(OP.RETURN, 0, 0, node.body.line);
    const proto = fs.proto;
    fs = fs.parent;
    const index = protos.push(proto) - 1;
    emit(OP.CLOSURE, index, 0, node.line);
  }

  /** Funksjoner deklareres før blokken kompileres, så de kan kalle hverandre uansett rekkefølge. */
  function statements(list) {
    for (const node of list) if (node.type === 'FnDecl') declare(node.name, node);
    for (const node of list) statement(node);
  }

  function block(node) {
    fs.scopes.push(new Map());
    statements(node.body);
    fs.scopes.pop();
  }

  function statement(node) {
    switch (node.type) {
      case 'Let': {
        expression(node.init); // høyresiden ser ikke den nye variabelen
        emit(OP.STORE, 0, declare(node.name, node), node.line);
        emit(OP.POP, 0, 0, node.line);
        break;
      }
      case 'FnDecl':
        compileFunction(node.fn);
        emit(OP.STORE, 0, fs.lookup(node.name), node.line);
        emit(OP.POP, 0, 0, node.line);
        break;
      case 'ExprStmt':
        expression(node.expr);
        emit(OP.POP, 0, 0, node.line);
        break;
      case 'Block':
        block(node);
        break;
      case 'If': {
        expression(node.cond);
        const skipThen = emit(OP.JUMP_IF_FALSE, 0, 0, node.line);
        block(node.then);
        if (node.otherwise) {
          const skipElse = emit(OP.JUMP, 0, 0, node.line);
          patch(skipThen);
          statement(node.otherwise);
          patch(skipElse);
        } else patch(skipThen);
        break;
      }
      case 'While': {
        const start = here();
        expression(node.cond);
        const exit = emit(OP.JUMP_IF_FALSE, 0, 0, node.line);
        loop(node.body, start);
        emit(OP.JUMP, start, 0, node.line);
        patch(exit);
        endLoop();
        break;
      }
      case 'ForIn': {
        // for x in liste {... } blir en tellende løkke over to skjulte variabler.
        fs.scopes.push(new Map());
        expression(node.iterable);
        const list = declare(' liste', node), counter = declare(' indeks', node), item = declare(node.name, node);
        emit(OP.STORE, 0, list, node.line); emit(OP.POP, 0, 0, node.line);
        emit(OP.CONST, constant(0), 0, node.line);
        emit(OP.STORE, 0, counter, node.line); emit(OP.POP, 0, 0, node.line);
        const start = here();
        emit(OP.LOAD, 0, counter, node.line);
        emit(OP.LOAD, 0, list, node.line); emit(OP.LEN, 0, 0, node.line);
        emit(OP.LT, 0, 0, node.line);
        const exit = emit(OP.JUMP_IF_FALSE, 0, 0, node.line);
        emit(OP.LOAD, 0, list, node.line); emit(OP.LOAD, 0, counter, node.line); emit(OP.INDEX, 0, 0, node.line);
        emit(OP.STORE, 0, item, node.line); emit(OP.POP, 0, 0, node.line);
        loop(node.body, -1);
        const step = here();
        for (const jump of fs.loops.at(-1).continues) patch(jump, step);
        emit(OP.LOAD, 0, counter, node.line); emit(OP.CONST, constant(1), 0, node.line); emit(OP.ADD, 0, 0, node.line);
        emit(OP.STORE, 0, counter, node.line); emit(OP.POP, 0, 0, node.line);
        emit(OP.JUMP, start, 0, node.line);
        patch(exit);
        endLoop();
        fs.scopes.pop();
        break;
      }
      case 'Break':
      case 'Continue': {
        const current = fs.loops.at(-1);
        if (!current) fail(`"${node.type === 'Break' ? 'break' : 'continue'}" kan bare brukes inne i en løkke`, node);
        if (node.type === 'Break') current.breaks.push(emit(OP.JUMP, 0, 0, node.line));
        else if (current.start >= 0) emit(OP.JUMP, current.start, 0, node.line);
        else current.continues.push(emit(OP.JUMP, 0, 0, node.line));
        break;
      }
      case 'Return':
        if (!fs.parent) fail('"return" kan bare brukes inne i en funksjon', node);
        if (node.value) expression(node.value); else emit(OP.NIL, 0, 0, node.line);
        emit(OP.RETURN, 0, 0, node.line);
        break;
      default:
        fail(`Ukjent setning: ${node.type}`, node);
    }
  }

  function loop(body, start) {
    fs.loops.push({ start, breaks: [], continues: [] });
    block(body);
  }

  function endLoop() {
    for (const jump of fs.loops.pop().breaks) patch(jump);
  }

  function expression(node) {
    switch (node.type) {
      case 'Num':
      case 'Str':
        emit(OP.CONST, constant(node.value), 0, node.line);
        break;
      case 'Bool': emit(node.value ? OP.TRUE : OP.FALSE, 0, 0, node.line); break;
      case 'Nil': emit(OP.NIL, 0, 0, node.line); break;
      case 'Ident': {
        const found = resolve(node.name);
        if (found) emit(OP.LOAD, found.depth, found.slot, node.line);
        else if (Object.hasOwn(host, node.name) || Object.hasOwn(BUILTINS, node.name)) emit(OP.BUILTIN, constant(node.name), 0, node.line);
        else fail(`Ukjent navn "${node.name}"`, node);
        break;
      }
      case 'Assign':
        if (node.target.type === 'Ident') {
          const found = resolve(node.target.name);
          if (!found) fail(`Kan ikke tilordne til "${node.target.name}": variabelen er ikke deklarert med let`, node.target);
          expression(node.value);
          emit(OP.STORE, found.depth, found.slot, node.line);
        } else {
          expression(node.target.object);
          expression(node.target.index);
          expression(node.value);
          emit(OP.STORE_INDEX, 0, 0, node.line);
        }
        break;
      case 'Binary':
        expression(node.left);
        expression(node.right);
        emit(BINARY_OPS[node.op], 0, 0, node.line);
        break;
      case 'Logical': {
        // Kortslutning: høyresiden evalueres bare når venstresiden ikke avgjør svaret.
        expression(node.left);
        const skip = emit(node.op === 'and' ? OP.AND : OP.OR, 0, 0, node.line);
        expression(node.right);
        patch(skip);
        break;
      }
      case 'Unary':
        expression(node.operand);
        emit(node.op === '-' ? OP.NEG : OP.NOT, 0, 0, node.line);
        break;
      case 'Call':
        expression(node.callee);
        node.args.forEach(expression);
        emit(OP.CALL, node.args.length, 0, node.line);
        break;
      case 'Index':
        expression(node.object);
        expression(node.index);
        emit(OP.INDEX, 0, 0, node.line);
        break;
      case 'Array':
        node.items.forEach(expression);
        emit(OP.ARRAY, node.items.length, 0, node.line);
        break;
      case 'Fn':
        compileFunction(node);
        break;
      default:
        fail(`Ukjent uttrykk: ${node.type}`, node);
    }
  }

  fs = new FunctionState('hovedprogram', [], null);
  statements(program.body);
  const lastLine = program.body.at(-1)?.line ?? 1;
  emit(OP.NIL, 0, 0, lastLine);
  emit(OP.RETURN, 0, 0, lastLine);
  return { main: fs.proto, protos };
}

/** Lesbar utskrift av en funksjons bytekode. */
export function disassemble(proto, protos) {
  const rows = [];
  for (let i = 0; i < proto.code.length / 3; i++) {
    const op = proto.code[i * 3], a = proto.code[i * 3 + 1], b = proto.code[i * 3 + 2];
    let operand = '';
    if (op === OP.CONST) operand = JSON.stringify(proto.constants[a]);
    else if (op === OP.BUILTIN) operand = proto.constants[a];
    else if (op === OP.LOAD || op === OP.STORE) operand = a === 0 ? proto.slotNames[b].trim() : `↑${a} plass ${b}`;
    else if (op === OP.JUMP || op === OP.JUMP_IF_FALSE || op === OP.AND || op === OP.OR) operand = `→ ${a}`;
    else if (op === OP.CALL || op === OP.ARRAY) operand = String(a);
    else if (op === OP.CLOSURE) operand = protos[a].name;
    rows.push({ index: i, op: OP_NAMES[op], operand, line: proto.lines[i] });
  }
  return rows;
}
