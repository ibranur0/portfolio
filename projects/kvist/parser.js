/**
 * Parseren gjør symbolene om til et syntakstre.
 * Uttrykk parses med Pratt-parsing, setninger med rekursiv nedstigning.
 */
import { KvistError, tokenize } from './lexer.js';

// Høyere tall binder sterkere.
const BINARY = {
  or: 2, and: 3,
  '==': 4, '!=': 4,
  '<': 5, '<=': 5, '>': 5, '>=': 5,
  '+': 6, '-': 6,
  '*': 7, '/': 7, '%': 7,
};
const UNARY_PRECEDENCE = 8;

export function parse(source) {
  const tokens = tokenize(source);
  let pos = 0;

  const peek = () => tokens[pos];
  const at = (value) => peek().value === value && (peek().type === 'op' || peek().type === 'keyword');
  const describe = (t) => (t.type === 'eof' ? 'slutten av programmet' : `"${t.type === 'str' ? `"${t.value}"` : t.value}"`);
  const fail = (message, token = peek()) => { throw new KvistError('Syntaksfeil', message, token.line, token.col); };
  const eat = (value) => (at(value) ? tokens[pos++] : null);
  const expect = (value, context) => eat(value) ?? fail(`Forventet "${value}" ${context}, men fant ${describe(peek())}`);
  const identifier = (context) => (peek().type === 'ident' ? tokens[pos++] : fail(`Forventet et navn ${context}, men fant ${describe(peek())}`));

  /* ------------------------------------------------------------ Setninger */
  function block() {
    const open = expect('{', 'for å starte en blokk');
    const body = [];
    while (!at('}')) {
      if (peek().type === 'eof') fail('Blokken som starter her, mangler "}"', open);
      body.push(statement());
    }
    pos++;
    return { type: 'Block', body, line: open.line };
  }

  function functionLiteral(name, line) {
    expect('(', 'etter funksjonsnavnet');
    const params = [];
    if (!at(')')) {
      do { params.push(identifier('som parameter').value); } while (eat(','));
    }
    expect(')', 'etter parameterne');
    if (new Set(params).size !== params.length) fail(`Funksjonen ${name ?? ''} har to parametere med samme navn`);
    return { type: 'Fn', name, params, body: block(), line };
  }

  function statement() {
    const t = peek();
    if (eat('let')) {
      const name = identifier('etter let');
      expect('=', `etter "${name.value}"`);
      const init = expression();
      expect(';', 'etter setningen');
      return { type: 'Let', name: name.value, init, line: t.line };
    }
    // "fn navn(...)" er en deklarasjon. "fn(...)" uten navn er et uttrykk og håndteres lenger ned.
    if (at('fn') && tokens[pos + 1].type === 'ident') {
      pos++;
      const name = tokens[pos++].value;
      return { type: 'FnDecl', name, fn: functionLiteral(name, t.line), line: t.line };
    }
    if (eat('if')) {
      const cond = expression();
      const then = block();
      let otherwise = null;
      if (eat('else')) otherwise = at('if') ? statement() : block();
      return { type: 'If', cond, then, otherwise, line: t.line };
    }
    if (eat('while')) return { type: 'While', cond: expression(), body: block(), line: t.line };
    if (eat('for')) {
      const name = identifier('etter for').value;
      expect('in', 'i for-løkken');
      return { type: 'ForIn', name, iterable: expression(), body: block(), line: t.line };
    }
    if (eat('return')) {
      const value = at(';') ? null : expression();
      expect(';', 'etter return');
      return { type: 'Return', value, line: t.line };
    }
    if (eat('break')) { expect(';', 'etter break'); return { type: 'Break', line: t.line }; }
    if (eat('continue')) { expect(';', 'etter continue'); return { type: 'Continue', line: t.line }; }
    if (at('{')) return block();
    const expr = expression();
    expect(';', 'etter setningen');
    return { type: 'ExprStmt', expr, line: t.line };
  }

  /* -------------------------------------------------------------- Uttrykk */
  function expression() {
    const left = binary(0);
    if (at('=')) {
      const equals = tokens[pos++];
      if (left.type !== 'Ident' && left.type !== 'Index') fail('Venstre side av "=" må være en variabel eller et listeelement', equals);
      return { type: 'Assign', target: left, value: expression(), line: equals.line }; // høyreassosiativ
    }
    return left;
  }

  function binary(minPrecedence) {
    let left = unary();
    for (;;) {
      const t = peek();
      const precedence = t.type === 'op' || t.type === 'keyword' ? BINARY[t.value] : undefined;
      if (precedence === undefined || precedence <= minPrecedence) return left;
      pos++;
      const right = binary(precedence); // venstreassosiativ: høyre side må binde sterkere
      left = { type: t.value === 'and' || t.value === 'or' ? 'Logical' : 'Binary', op: t.value, left, right, line: t.line };
    }
  }

  function unary() {
    const t = peek();
    if (eat('-') || eat('not') || eat('!')) {
      return { type: 'Unary', op: t.value === '-' ? '-' : 'not', operand: binary(UNARY_PRECEDENCE - 1), line: t.line };
    }
    return postfix();
  }

  function postfix() {
    let expr = primary();
    for (;;) {
      const t = peek();
      if (eat('(')) {
        const args = [];
        if (!at(')')) {
          do { args.push(expression()); } while (eat(','));
        }
        expect(')', 'etter argumentene');
        expr = { type: 'Call', callee: expr, args, line: t.line };
      } else if (eat('[')) {
        const index = expression();
        expect(']', 'etter indeksen');
        expr = { type: 'Index', object: expr, index, line: t.line };
      } else return expr;
    }
  }

  function primary() {
    const t = tokens[pos++];
    switch (t.type) {
      case 'num': return { type: 'Num', value: t.value, line: t.line };
      case 'str': return { type: 'Str', value: t.value, line: t.line };
      case 'ident': return { type: 'Ident', name: t.value, line: t.line, col: t.col };
      case 'keyword':
        if (t.value === 'true' || t.value === 'false') return { type: 'Bool', value: t.value === 'true', line: t.line };
        if (t.value === 'nil') return { type: 'Nil', line: t.line };
        if (t.value === 'fn') return functionLiteral(null, t.line);
        break;
      case 'op':
        if (t.value === '(') {
          const inner = expression();
          expect(')', 'for å lukke parentesen');
          return inner;
        }
        if (t.value === '[') {
          const items = [];
          if (!at(']')) {
            do { items.push(expression()); } while (eat(',') && !at(']'));
          }
          expect(']', 'for å avslutte listen');
          return { type: 'Array', items, line: t.line };
        }
        break;
      default:
    }
    pos--;
    return fail(`Forventet et uttrykk, men fant ${describe(t)}`, t);
  }

  const body = [];
  while (peek().type !== 'eof') body.push(statement());
  return { type: 'Program', body, line: 1 };
}
