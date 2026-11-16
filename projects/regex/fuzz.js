/**
 * Lager tilfeldige mønstre og tekster. Brukes av test.mjs (mot V8 i Node)
 * og av selvtesten på siden (mot RegExp i nettleseren).
 */

/** mulberry32: samme frø gir samme rekke med tall. */
export function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lager et tilfeldig, gyldig mønster. "anchors" styrer om ^, $ og \b kan forekomme. */
export function randomPattern(random, anchors) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const atoms = ['a', 'b', 'c', 'a', 'b', '.', '[ab]', '[^a]', '[a-c]', '[^bc]', '\\d', '\\w', '\\s', '\\W', '1', ' '];
  const quantifiers = ['*', '+', '?', '{2}', '{1,2}', '{0,2}', '{2,}', '*?', '+?'];
  function sequence(depth) {
    let out = '';
    const count = Math.floor(random() * 4) + (depth === 0 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      let piece;
      const roll = random();
      if (depth < 3 && roll < 0.22) piece = `${pick(['(', '(?:'])}${alternation(depth + 1)})`;
      else if (anchors && roll < 0.3) { out += pick(['^', '$', '\\b', '\\B']); continue; }
      else piece = pick(atoms);
      if (random() < 0.35) piece += pick(quantifiers);
      out += piece;
    }
    return out;
  }
  function alternation(depth) {
    let out = sequence(depth);
    while (random() < 0.25) out += `|${sequence(depth)}`;
    return out;
  }
  return alternation(0);
}

/** En kort tekst over et lite alfabet, slik at treff faktisk forekommer. */
export function randomText(random) {
  const alphabet = 'aabbc1 _';
  let out = '';
  for (let length = Math.floor(random() * 11); length > 0; length--) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}
