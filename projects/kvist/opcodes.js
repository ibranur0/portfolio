/** Instruksjonssettet til den virtuelle maskinen. Hver instruksjon er tre tall: kode, a, b. */
export const OP = Object.freeze({
  CONST: 0, NIL: 1, TRUE: 2, FALSE: 3, POP: 4,
  LOAD: 5, STORE: 6, BUILTIN: 7, CLOSURE: 8,
  ADD: 9, SUB: 10, MUL: 11, DIV: 12, MOD: 13, NEG: 14, NOT: 15,
  EQ: 16, NE: 17, LT: 18, LE: 19, GT: 20, GE: 21,
  JUMP: 22, JUMP_IF_FALSE: 23, AND: 24, OR: 25,
  CALL: 26, RETURN: 27,
  ARRAY: 28, INDEX: 29, STORE_INDEX: 30, LEN: 31,
});
export const OP_NAMES = Object.keys(OP);
