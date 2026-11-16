/** Leksikalsk analyse: kildetekst inn, liste med symboler ut. */
export class KvistError extends Error {
  /** @param {'Syntaksfeil'|'Kompileringsfeil'|'Kjøretidsfeil'} kind */
  constructor(kind, message, line, col = 0) {
    super(message);
    this.kind = kind;
    this.line = line;
    this.col = col;
  }
}

export const KEYWORDS = new Set(['let', 'fn', 'if', 'else', 'while', 'for', 'in', 'return', 'break', 'continue', 'true', 'false', 'nil', 'and', 'or', 'not']);
const TWO_CHAR = new Set(['==', '!=', '<=', '>=']);
const ONE_CHAR = new Set('+-*/%=<>!(){}[],;');
const ESCAPES = { n: '\n', t: '\t', '"': '"', '\\': '\\' };

const isDigit = (c) => c >= '0' && c <= '9';
const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || 'æøåÆØÅ'.includes(c);

/** @returns {{ type: string, value: any, line: number, col: number }[]} */
export function tokenize(source) {
  const tokens = [];
  let i = 0, line = 1, lineStart = 0;
  const push = (type, value, start) => tokens.push({ type, value, line, col: start - lineStart + 1 });

  while (i < source.length) {
    const c = source[i];
    if (c === '\n') { line++; i++; lineStart = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    const start = i;
    if (isDigit(c)) {
      while (isDigit(source[i])) i++;
      if (source[i] === '.' && isDigit(source[i + 1])) { i++; while (isDigit(source[i])) i++; }
      push('num', Number(source.slice(start, i)), start);
    } else if (isIdentStart(c)) {
      while (i < source.length && (isIdentStart(source[i]) || isDigit(source[i]))) i++;
      const word = source.slice(start, i);
      push(KEYWORDS.has(word) ? 'keyword' : 'ident', word, start);
    } else if (c === '"') {
      let text = '';
      i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\n') throw new KvistError('Syntaksfeil', 'Teksten mangler avsluttende anførselstegn', line, start - lineStart + 1);
        if (source[i] === '\\') {
          const escaped = ESCAPES[source[i + 1]];
          if (escaped === undefined) throw new KvistError('Syntaksfeil', `Ukjent escape-sekvens \\${source[i + 1] ?? ''}`, line, i - lineStart + 1);
          text += escaped;
          i += 2;
        } else text += source[i++];
      }
      if (i >= source.length) throw new KvistError('Syntaksfeil', 'Teksten mangler avsluttende anførselstegn', line, start - lineStart + 1);
      i++;
      push('str', text, start);
    } else if (TWO_CHAR.has(source.slice(i, i + 2))) {
      i += 2;
      push('op', source.slice(start, i), start);
    } else if (ONE_CHAR.has(c)) {
      i++;
      push('op', c, start);
    } else {
      throw new KvistError('Syntaksfeil', `Uventet tegn "${c}"`, line, start - lineStart + 1);
    }
  }
  tokens.push({ type: 'eof', value: null, line, col: i - lineStart + 1 });
  return tokens;
}
