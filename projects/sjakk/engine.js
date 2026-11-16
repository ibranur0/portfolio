/**
 * Sjakkmotoren. Brukes av brettet (regler og notasjon) og av workeren (søk),
 * og kan testes direkte i Node.
 *
 * Brettet er en 0x88-tabell: felt = rad * 16 + linje, der rad 0 er åttende rad.
 * Da er a8 = 0, h8 = 7 og a1 = 112, og (felt & 0x88) !== 0 betyr utenfor brettet.
 * Brikker er 1-6 (bonde, springer, løper, tårn, dronning, konge), og svart har bit 8 satt.
 */
export const WHITE = 0, BLACK = 1;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FLAG_DOUBLE = 1, FLAG_EP = 2, FLAG_CASTLE_K = 3, FLAG_CASTLE_Q = 4;
const KNIGHT_STEPS = [-33, -31, -18, -14, 14, 18, 31, 33];
const BISHOP_STEPS = [-17, -15, 15, 17];
const ROOK_STEPS = [-16, -1, 1, 16];
const ALL_STEPS = [-17, -16, -15, -1, 1, 15, 16, 17];
const STEPS = [null, null, KNIGHT_STEPS, BISHOP_STEPS, ROOK_STEPS, ALL_STEPS, ALL_STEPS];
const LETTERS = ' pnbrqk';

const MATE = 30000;
const MAX_PLY = 64;
const VALUE = [0, 100, 320, 330, 500, 900, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0];

// Brikke-felt-tabeller (sett fra hvit, åttende rad først).
const PST = [null,
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
];
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

// Rokaderetter som mistes når en brikke flytter fra eller til et felt.
// 1 = hvit kort, 2 = hvit lang, 4 = svart kort, 8 = svart lang.
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[112] = 13; CASTLE_MASK[119] = 14; CASTLE_MASK[116] = 12;
CASTLE_MASK[0] = 7; CASTLE_MASK[7] = 11; CASTLE_MASK[4] = 3;

// Zobrist-nøkler: 64-bits hash lagret som to 32-bits tall. Fast frø gir reproduserbare søk.
let seed = 0x9e3779b9;
const rand32 = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed | 0;
};
const Z_PIECE_LO = new Int32Array(16 * 128).map(rand32);
const Z_PIECE_HI = new Int32Array(16 * 128).map(rand32);
const Z_CASTLE_LO = new Int32Array(16).map(rand32);
const Z_CASTLE_HI = new Int32Array(16).map(rand32);
const Z_EP_LO = new Int32Array(8).map(rand32);
const Z_EP_HI = new Int32Array(8).map(rand32);
const Z_SIDE_LO = rand32(), Z_SIDE_HI = rand32();

export const moveFrom = (m) => m & 127;
export const moveTo = (m) => (m >> 7) & 127;
export const movePromo = (m) => (m >> 14) & 7;
const moveFlag = (m) => (m >> 17) & 7;
const makeMove = (from, to, promo = 0, flag = 0) => from | (to << 7) | (promo << 14) | (flag << 17);

export const squareName = (sq) => 'abcdefgh'[sq & 7] + (8 - (sq >> 4));
export const parseSquare = (name) => (8 - Number(name[1])) * 16 + name.charCodeAt(0) - 97;
/** Trekk i UCI-format, f.eks. "e2e4" eller "e7e8q". */
export const moveToUci = (m) => squareName(moveFrom(m)) + squareName(moveTo(m)) + (movePromo(m) ? LETTERS[movePromo(m)] : '');

const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
const STACK = 2048;

export class Engine {
  constructor(fen = START_FEN) {
    this.board = new Int8Array(128);
    this.kings = [0, 0];
    // Angrestakk (parallelle tabeller, ingen allokering under søk)
    this.uMove = new Int32Array(STACK); this.uCaptured = new Int8Array(STACK);
    this.uCastling = new Int8Array(STACK); this.uEp = new Int16Array(STACK); this.uHalf = new Int16Array(STACK);
    this.uLo = new Int32Array(STACK); this.uHi = new Int32Array(STACK);
    // Transposisjonstabell
    this.ttKey = new Int32Array(TT_SIZE); this.ttMove = new Int32Array(TT_SIZE);
    this.ttScore = new Int16Array(TT_SIZE); this.ttDepth = new Int8Array(TT_SIZE); this.ttFlag = new Int8Array(TT_SIZE);
    // Søketabeller
    this.moves = Array.from({ length: MAX_PLY + 1 }, () => new Int32Array(256));
    this.scores = Array.from({ length: MAX_PLY + 1 }, () => new Int32Array(256));
    this.killers = new Int32Array((MAX_PLY + 1) * 2);
    this.history = new Int32Array(2 * 128 * 128);
    this.nodes = 0;
    this.setFen(fen);
  }

  /* ------------------------------------------------------------------ FEN */
  setFen(fen) {
    const [placement, side = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
    const rows = placement.split('/');
    if (rows.length !== 8) throw new Error('Ugyldig FEN: forventet åtte rader');
    this.board.fill(0);
    const kingCount = [0, 0];
    rows.forEach((row, r) => {
      let file = 0;
      for (const ch of row) {
        if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
        const type = LETTERS.indexOf(ch.toLowerCase());
        if (type < 1 || file > 7) throw new Error(`Ugyldig FEN: "${ch}"`);
        if (type === PAWN && (r === 0 || r === 7)) throw new Error('Ugyldig FEN: en bonde kan ikke stå på første eller åttende rad');
        const color = ch === ch.toLowerCase() ? BLACK : WHITE;
        this.board[r * 16 + file] = type | (color << 3);
        if (type === KING) { this.kings[color] = r * 16 + file; kingCount[color]++; }
        file++;
      }
      if (file !== 8) throw new Error('Ugyldig FEN: feil antall felt i en rad');
    });
    if (kingCount[0] !== 1 || kingCount[1] !== 1) throw new Error('Ugyldig FEN: hver side må ha en konge');
    if (side !== 'w' && side !== 'b') throw new Error('Ugyldig FEN: siden i trekket må være "w" eller "b"');
    this.side = side === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (castling.includes('K') && this.board[116] === KING && this.board[119] === ROOK) this.castling |= 1;
    if (castling.includes('Q') && this.board[116] === KING && this.board[112] === ROOK) this.castling |= 2;
    if (castling.includes('k') && this.board[4] === (KING | 8) && this.board[7] === (ROOK | 8)) this.castling |= 4;
    if (castling.includes('q') && this.board[4] === (KING | 8) && this.board[0] === (ROOK | 8)) this.castling |= 8;
    this.ep = /^[a-h][36]$/.test(ep) ? parseSquare(ep) : -1;
    this.halfmove = Number(half) || 0;
    this.fullmove = Number(full) || 1;
    this.ply = 0;
    this.computeHash();
    if (this.attacked(this.kings[this.side ^ 1], this.side)) throw new Error('Ugyldig FEN: siden som ikke er i trekket står i sjakk');
    return this;
  }

  fen() {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const piece = this.board[r * 16 + f];
        if (!piece) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        const letter = LETTERS[piece & 7];
        out += piece & 8 ? letter : letter.toUpperCase();
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    const c = this.castling;
    const rights = (c & 1 ? 'K' : '') + (c & 2 ? 'Q' : '') + (c & 4 ? 'k' : '') + (c & 8 ? 'q' : '') || '-';
    return `${out} ${this.side ? 'b' : 'w'} ${rights} ${this.ep >= 0 ? squareName(this.ep) : '-'} ${this.halfmove} ${this.fullmove}`;
  }

  computeHash() {
    let lo = 0, hi = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) continue;
      const piece = this.board[sq];
      if (piece) { lo ^= Z_PIECE_LO[piece * 128 + sq]; hi ^= Z_PIECE_HI[piece * 128 + sq]; }
    }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
    if (this.side) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    this.hashLo = lo; this.hashHi = hi;
  }

  /* ------------------------------------------------------- Angrep og trekk */
  /** Er feltet angrepet av en brikke med fargen "by"? */
  attacked(sq, by) {
    const b = this.board, tag = by << 3;
    // Bønder angriper diagonalt fremover: en hvit bonde som truer sq står en rad under.
    const p1 = by === WHITE ? sq + 15 : sq - 15, p2 = by === WHITE ? sq + 17 : sq - 17;
    if (!(p1 & 0x88) && b[p1] === (PAWN | tag)) return true;
    if (!(p2 & 0x88) && b[p2] === (PAWN | tag)) return true;
    for (let i = 0; i < 8; i++) {
      const n = sq + KNIGHT_STEPS[i];
      if (!(n & 0x88) && b[n] === (KNIGHT | tag)) return true;
      const k = sq + ALL_STEPS[i];
      if (!(k & 0x88) && b[k] === (KING | tag)) return true;
    }
    for (let i = 0; i < 4; i++) {
      for (let t = sq + BISHOP_STEPS[i]; !(t & 0x88); t += BISHOP_STEPS[i]) {
        const piece = b[t];
        if (!piece) continue;
        if (piece === (BISHOP | tag) || piece === (QUEEN | tag)) return true;
        break;
      }
      for (let t = sq + ROOK_STEPS[i]; !(t & 0x88); t += ROOK_STEPS[i]) {
        const piece = b[t];
        if (!piece) continue;
        if (piece === (ROOK | tag) || piece === (QUEEN | tag)) return true;
        break;
      }
    }
    return false;
  }

  inCheck() { return this.attacked(this.kings[this.side], this.side ^ 1); }

  /** Genererer pseudolovlige trekk (kongen kan stå i sjakk etterpå). Returnerer antallet. */
  generate(list, capturesOnly = false) {
    const b = this.board, us = this.side, them = us ^ 1;
    let n = 0;
    const forward = us === WHITE ? -16 : 16;
    const startRow = us === WHITE ? 6 : 1, promoRow = us === WHITE ? 0 : 7;

    for (let from = 0; from < 120; from++) {
      if (from & 0x88) { from += 7; continue; }
      const piece = b[from];
      if (!piece || (piece >> 3) !== us) continue;
      const type = piece & 7;

      if (type === PAWN) {
        const one = from + forward;
        const promotes = (one >> 4) === promoRow;
        if (!b[one] && (!capturesOnly || promotes)) {
          if (promotes) {
            list[n++] = makeMove(from, one, QUEEN);
            if (!capturesOnly) { list[n++] = makeMove(from, one, ROOK); list[n++] = makeMove(from, one, BISHOP); list[n++] = makeMove(from, one, KNIGHT); }
          } else {
            list[n++] = makeMove(from, one);
            if ((from >> 4) === startRow && !b[one + forward]) list[n++] = makeMove(from, one + forward, 0, FLAG_DOUBLE);
          }
        }
        for (const side of [-1, 1]) {
          const to = one + side;
          if (to & 0x88) continue;
          const target = b[to];
          if (target && (target >> 3) === them) {
            if (promotes) {
              list[n++] = makeMove(from, to, QUEEN);
              if (!capturesOnly) { list[n++] = makeMove(from, to, ROOK); list[n++] = makeMove(from, to, BISHOP); list[n++] = makeMove(from, to, KNIGHT); }
            } else list[n++] = makeMove(from, to);
          } else if (to === this.ep) list[n++] = makeMove(from, to, 0, FLAG_EP);
        }
        continue;
      }

      const steps = STEPS[type];
      const slides = type === BISHOP || type === ROOK || type === QUEEN;
      for (let i = 0; i < steps.length; i++) {
        for (let to = from + steps[i]; !(to & 0x88); to += steps[i]) {
          const target = b[to];
          if (!target) { if (!capturesOnly) list[n++] = makeMove(from, to); }
          else { if ((target >> 3) === them) list[n++] = makeMove(from, to); break; }
          if (!slides) break;
        }
      }

      if (type === KING && !capturesOnly) {
        const home = us === WHITE ? 116 : 4;
        const kingside = us === WHITE ? 1 : 4, queenside = us === WHITE ? 2 : 8;
        if (from === home && (this.castling & (kingside | queenside)) && !this.attacked(home, them)) {
          if ((this.castling & kingside) && !b[home + 1] && !b[home + 2] && !this.attacked(home + 1, them)) {
            list[n++] = makeMove(home, home + 2, 0, FLAG_CASTLE_K);
          }
          if ((this.castling & queenside) && !b[home - 1] && !b[home - 2] && !b[home - 3] && !this.attacked(home - 1, them)) {
            list[n++] = makeMove(home, home - 2, 0, FLAG_CASTLE_Q);
          }
        }
      }
    }
    return n;
  }

  /** Utfører trekket. Returnerer false (og angrer) hvis egen konge blir stående i sjakk. */
  make(m) {
    const b = this.board, us = this.side, them = us ^ 1;
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = (m >> 17) & 7;
    const piece = b[from], type = piece & 7;
    let captured = b[to];
    let lo = this.hashLo, hi = this.hashHi;
    const i = this.ply;
    this.uMove[i] = m; this.uCastling[i] = this.castling; this.uEp[i] = this.ep; this.uHalf[i] = this.halfmove;
    this.uLo[i] = lo; this.uHi[i] = hi;

    lo ^= Z_PIECE_LO[piece * 128 + from]; hi ^= Z_PIECE_HI[piece * 128 + from];
    if (captured) { lo ^= Z_PIECE_LO[captured * 128 + to]; hi ^= Z_PIECE_HI[captured * 128 + to]; }
    const placed = promo ? promo | (us << 3) : piece;
    b[from] = 0; b[to] = placed;
    lo ^= Z_PIECE_LO[placed * 128 + to]; hi ^= Z_PIECE_HI[placed * 128 + to];

    if (flag === FLAG_EP) {
      const capSq = to - (us === WHITE ? -16 : 16);
      captured = b[capSq]; b[capSq] = 0;
      lo ^= Z_PIECE_LO[captured * 128 + capSq]; hi ^= Z_PIECE_HI[captured * 128 + capSq];
    } else if (flag === FLAG_CASTLE_K || flag === FLAG_CASTLE_Q) {
      const rookFrom = flag === FLAG_CASTLE_K ? to + 1 : to - 2, rookTo = flag === FLAG_CASTLE_K ? to - 1 : to + 1;
      const rook = b[rookFrom];
      b[rookFrom] = 0; b[rookTo] = rook;
      lo ^= Z_PIECE_LO[rook * 128 + rookFrom] ^ Z_PIECE_LO[rook * 128 + rookTo];
      hi ^= Z_PIECE_HI[rook * 128 + rookFrom] ^ Z_PIECE_HI[rook * 128 + rookTo];
    }
    this.uCaptured[i] = captured;
    if (type === KING) this.kings[us] = to;

    if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
    this.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
    if (this.ep >= 0) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }

    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];

    this.halfmove = type === PAWN || captured ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.side = them;
    this.hashLo = lo ^ Z_SIDE_LO; this.hashHi = hi ^ Z_SIDE_HI;
    this.ply++;

    if (this.attacked(this.kings[us], them)) { this.unmake(); return false; }
    return true;
  }

  unmake() {
    const b = this.board;
    const i = --this.ply;
    const m = this.uMove[i];
    const them = this.side, us = them ^ 1;
    this.side = us;
    if (us === BLACK) this.fullmove--;
    this.castling = this.uCastling[i]; this.ep = this.uEp[i]; this.halfmove = this.uHalf[i];
    this.hashLo = this.uLo[i]; this.hashHi = this.uHi[i];
    if (m === 0) return; // nulltrekk

    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = (m >> 17) & 7;
    const captured = this.uCaptured[i];
    const piece = promo ? PAWN | (us << 3) : b[to];
    b[from] = piece;
    if (flag === FLAG_EP) {
      b[to] = 0;
      b[to - (us === WHITE ? -16 : 16)] = captured;
    } else {
      b[to] = captured;
      if (flag === FLAG_CASTLE_K) { b[to + 1] = b[to - 1]; b[to - 1] = 0; }
      else if (flag === FLAG_CASTLE_Q) { b[to - 2] = b[to + 1]; b[to + 1] = 0; }
    }
    if ((piece & 7) === KING) this.kings[us] = from;
  }

  /** Nulltrekk: siden i trekket står over. Brukes til beskjæring i søket. */
  makeNull() {
    const i = this.ply;
    this.uMove[i] = 0; this.uCastling[i] = this.castling; this.uEp[i] = this.ep; this.uHalf[i] = this.halfmove;
    this.uLo[i] = this.hashLo; this.uHi[i] = this.hashHi;
    if (this.ep >= 0) { this.hashLo ^= Z_EP_LO[this.ep & 7]; this.hashHi ^= Z_EP_HI[this.ep & 7]; }
    this.ep = -1;
    if (this.side === BLACK) this.fullmove++;
    this.side ^= 1;
    this.hashLo ^= Z_SIDE_LO; this.hashHi ^= Z_SIDE_HI;
    this.ply++;
  }

  /** Alle lovlige trekk i stillingen. */
  legalMoves() {
    const list = new Int32Array(256);
    const count = this.generate(list);
    const out = [];
    for (let i = 0; i < count; i++) {
      if (this.make(list[i])) { this.unmake(); out.push(list[i]); }
    }
    return out;
  }

  /** Teller bladnoder til gitt dybde. Standardtesten for at trekkgeneratoren er korrekt. */
  perft(depth) {
    if (depth === 0) return 1;
    const list = new Int32Array(256);
    const count = this.generate(list);
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (!this.make(list[i])) continue;
      total += this.perft(depth - 1);
      this.unmake();
    }
    return total;
  }

  /* ---------------------------------------------------------- Spillstatus */
  /** Har stillingen forekommet "times" ganger før (innenfor trekk som kan gjentas)? */
  repetitions() {
    let count = 0;
    const limit = Math.max(0, this.ply - this.halfmove);
    for (let i = this.ply - 2; i >= limit; i -= 2) {
      if (this.uLo[i] === this.hashLo && this.uHi[i] === this.hashHi) count++;
    }
    return count;
  }

  insufficientMaterial() {
    let minors = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) continue;
      const type = this.board[sq] & 7;
      if (type === PAWN || type === ROOK || type === QUEEN) return false;
      if (type === KNIGHT || type === BISHOP) minors++;
    }
    return minors <= 1;
  }

  /** 'checkmate' | 'stalemate' | 'repetition' | 'fifty' | 'material' | null */
  status() {
    if (!this.legalMoves().length) return this.inCheck() ? 'checkmate' : 'stalemate';
    if (this.repetitions() >= 2) return 'repetition';
    if (this.halfmove >= 100) return 'fifty';
    if (this.insufficientMaterial()) return 'material';
    return null;
  }

  /** Standard algebraisk notasjon (f.eks. "Sf3", "exd5", "O-O", "Dxf7#"). */
  toSan(m, pieceLetters = ' PNBRQK') {
    const from = moveFrom(m), to = moveTo(m), flag = moveFlag(m);
    const type = this.board[from] & 7;
    let san;
    if (flag === FLAG_CASTLE_K) san = 'O-O';
    else if (flag === FLAG_CASTLE_Q) san = 'O-O-O';
    else {
      const capture = this.board[to] !== 0 || flag === FLAG_EP;
      if (type === PAWN) {
        san = (capture ? `${squareName(from)[0]}x` : '') + squareName(to);
        if (movePromo(m)) san += `=${pieceLetters[movePromo(m)]}`;
      } else {
        // Flertydighet: en annen brikke av samme type kan gå til samme felt.
        const rivals = this.legalMoves().filter((o) => o !== m && moveTo(o) === to && (this.board[moveFrom(o)] & 7) === type);
        let hint = '';
        if (rivals.length) {
          const sameFile = rivals.some((o) => (moveFrom(o) & 7) === (from & 7));
          const sameRank = rivals.some((o) => (moveFrom(o) >> 4) === (from >> 4));
          hint = !sameFile ? squareName(from)[0] : !sameRank ? squareName(from)[1] : squareName(from);
        }
        san = pieceLetters[type] + hint + (capture ? 'x' : '') + squareName(to);
      }
    }
    this.make(m);
    if (this.inCheck()) san += this.legalMoves().length ? '+' : '#';
    this.unmake();
    return san;
  }

  /* ------------------------------------------------------------ Evaluering */
  /** Statisk vurdering i centibønder, sett fra siden som er i trekket. */
  evaluate() {
    const b = this.board;
    let score = 0, phase = 0, kingMid = 0, kingEnd = 0;
    let whiteBishops = 0, blackBishops = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = b[sq];
      if (!piece) continue;
      const type = piece & 7, row = sq >> 4, file = sq & 7;
      phase += PHASE[type];
      if (piece & 8) {
        const index = (7 - row) * 8 + file;
        if (type === KING) { kingMid -= PST[KING][index]; kingEnd -= KING_END[index]; }
        else score -= VALUE[type] + PST[type][index];
        if (type === BISHOP) blackBishops++;
      } else {
        const index = row * 8 + file;
        if (type === KING) { kingMid += PST[KING][index]; kingEnd += KING_END[index]; }
        else score += VALUE[type] + PST[type][index];
        if (type === BISHOP) whiteBishops++;
      }
    }
    if (whiteBishops >= 2) score += 30;
    if (blackBishops >= 2) score -= 30;
    // Glidende overgang: kongen skal gjemme seg i midtspillet og være aktiv i sluttspillet.
    if (phase > 24) phase = 24;
    score += ((kingMid * phase + kingEnd * (24 - phase)) / 24) | 0;
    return (this.side === WHITE ? score : -score) + 10;
  }

  hasNonPawnMaterial(color) {
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = this.board[sq];
      if (piece && (piece >> 3) === color && (piece & 7) > PAWN && (piece & 7) < KING) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ Søk */
  scoreMoves(list, scores, count, ttMove, ply) {
    const b = this.board;
    const k1 = this.killers[ply * 2], k2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < count; i++) {
      const m = list[i];
      const victim = b[(m >> 7) & 127] & 7;
      if (m === ttMove) scores[i] = 1 << 28;
      else if (victim || ((m >> 17) & 7) === FLAG_EP) scores[i] = (1 << 24) + (victim || PAWN) * 16 - (b[m & 127] & 7); // mest verdifulle offer, minst verdifulle angriper
      else if ((m >> 14) & 7) scores[i] = (1 << 23) + ((m >> 14) & 7);
      else if (m === k1) scores[i] = (1 << 22) + 1;
      else if (m === k2) scores[i] = 1 << 22;
      else scores[i] = this.history[(this.side << 14) | (m & 16383)];
    }
  }

  /** Flytter det best rangerte gjenværende trekket til posisjon i (utvalgssortering, ett steg). */
  pickMove(list, scores, i, count) {
    let best = i;
    for (let j = i + 1; j < count; j++) if (scores[j] > scores[best]) best = j;
    if (best !== i) {
      const m = list[i]; list[i] = list[best]; list[best] = m;
      const s = scores[i]; scores[i] = scores[best]; scores[best] = s;
    }
    return list[i];
  }

  /** Hvilesøk: spill ut slag til stillingen er rolig, så vi ikke evaluerer midt i en avbytting. */
  quiesce(alpha, beta, ply) {
    this.nodes++;
    const stand = this.evaluate();
    if (ply >= MAX_PLY) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    const list = this.moves[ply], scores = this.scores[ply];
    const count = this.generate(list, true);
    this.scoreMoves(list, scores, count, 0, ply);
    for (let i = 0; i < count; i++) {
      const m = this.pickMove(list, scores, i, count);
      if (!this.make(m)) continue;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.unmake();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  negamax(depth, alpha, beta, ply, allowNull) {
    if ((this.nodes & 2047) === 0 && this.deadline && performance.now() > this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    if (ply > 0 && (this.halfmove >= 100 || this.repetitions() > 0 || this.insufficientMaterial())) return 0;
    if (ply >= MAX_PLY) return this.evaluate();

    const check = this.inCheck();
    if (check) depth++; // sjakkforlengelse
    if (depth <= 0) return this.quiesce(alpha, beta, ply);
    this.nodes++;

    // Transposisjonstabell: har vi sett stillingen før, på minst denne dybden?
    const slot = this.hashLo & (TT_SIZE - 1);
    let ttMove = 0;
    if (this.ttKey[slot] === this.hashHi && this.ttFlag[slot]) {
      ttMove = this.ttMove[slot];
      if (ply > 0 && this.ttDepth[slot] >= depth) {
        let score = this.ttScore[slot];
        if (score > MATE - MAX_PLY) score -= ply; else if (score < -MATE + MAX_PLY) score += ply;
        const flag = this.ttFlag[slot];
        if (flag === TT_EXACT) return score;
        if (flag === TT_LOWER && score >= beta) return score;
        if (flag === TT_UPPER && score <= alpha) return score;
      }
    }

    // Nulltrekk: står vi fortsatt godt etter å ha stått over, er stillingen så god at vi kan kutte her.
    if (allowNull && !check && depth >= 3 && ply > 0 && beta < MATE - MAX_PLY && this.hasNonPawnMaterial(this.side)) {
      this.makeNull();
      const score = -this.negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
      this.unmake();
      if (this.stopped) return 0;
      if (score >= beta) return beta;
    }

    const list = this.moves[ply], scores = this.scores[ply];
    const count = this.generate(list);
    this.scoreMoves(list, scores, count, ttMove, ply);

    const alphaStart = alpha;
    let best = -MATE * 2, bestMove = 0, legal = 0;
    for (let i = 0; i < count; i++) {
      const m = this.pickMove(list, scores, i, count);
      const quiet = !(this.board[(m >> 7) & 127]) && !((m >> 14) & 7) && ((m >> 17) & 7) !== FLAG_EP;
      if (!this.make(m)) continue;
      legal++;
      let score;
      if (legal === 1) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        // Sene, rolige trekk søkes grunnere først (LMR), og alle etter det første med nullvindu (PVS).
        const reduce = depth >= 3 && legal > 4 && quiet && !check ? 1 : 0;
        score = -this.negamax(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && (reduce || score < beta)) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      this.unmake();
      if (this.stopped) return 0;

      if (score > best) { best = score; bestMove = m; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (quiet) {
          if (this.killers[ply * 2] !== m) { this.killers[ply * 2 + 1] = this.killers[ply * 2]; this.killers[ply * 2] = m; }
          const h = (this.side << 14) | (m & 16383);
          this.history[h] = Math.min(this.history[h] + depth * depth, 1 << 20);
        }
        break;
      }
    }

    if (!legal) return check ? -MATE + ply : 0;

    let stored = best;
    if (stored > MATE - MAX_PLY) stored += ply; else if (stored < -MATE + MAX_PLY) stored -= ply;
    this.ttKey[slot] = this.hashHi; this.ttMove[slot] = bestMove; this.ttScore[slot] = stored; this.ttDepth[slot] = depth;
    this.ttFlag[slot] = best <= alphaStart ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    return best;
  }

  /** Henter hovedvarianten ved å følge beste trekk i transposisjonstabellen. */
  principalVariation(maxLength) {
    const line = [];
    while (line.length < maxLength) {
      const slot = this.hashLo & (TT_SIZE - 1);
      const m = this.ttMove[slot];
      if (this.ttKey[slot] !== this.hashHi || !m || !this.legalMoves().includes(m)) break;
      line.push(m);
      this.make(m);
      if (this.repetitions() > 0) break;
    }
    const moves = [...line];
    while (line.length) { this.unmake(); line.pop(); }
    return moves;
  }

  /**
   * Iterativ fordypning: søk dybde 1, 2, 3 og så videre til tiden er ute.
   * Hver runde gir bedre trekksortering til den neste, og vi har alltid et svar klart.
   * @param {{ timeMs?: number, maxDepth?: number, onInfo?: (info: object) => void }} options
   */
  search({ timeMs = 1000, maxDepth = MAX_PLY - 1, onInfo } = {}) {
    const started = performance.now();
    this.deadline = timeMs ? started + timeMs : 0;
    this.stopped = false;
    this.nodes = 0;
    this.killers.fill(0);
    for (let i = 0; i < this.history.length; i++) this.history[i] >>= 3;

    const rootMoves = this.legalMoves();
    let result = { move: rootMoves[0] ?? 0, score: 0, depth: 0, nodes: 0, ms: 0, pv: [] };
    if (rootMoves.length <= 1) return result;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const score = this.negamax(depth, -MATE * 2, MATE * 2, 0, false);
      if (this.stopped) break; // ufullstendig runde forkastes
      const pv = this.principalVariation(depth);
      const ms = performance.now() - started;
      result = { move: pv[0] ?? result.move, score, depth, nodes: this.nodes, ms, pv, mate: mateDistance(score) };
      onInfo?.(result);
      if (Math.abs(score) > MATE - MAX_PLY) break; // matt funnet
      if (timeMs && ms > timeMs * 0.55) break;      // neste dybde rekker vi neppe
    }
    result.nodes = this.nodes;
    result.ms = performance.now() - started;
    return result;
  }
}

/** Antall trekk til matt (positivt: vi matter), eller null. */
function mateDistance(score) {
  if (score > MATE - MAX_PLY) return Math.ceil((MATE - score) / 2);
  if (score < -MATE + MAX_PLY) return -Math.ceil((MATE + score) / 2);
  return null;
}
