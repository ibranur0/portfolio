/**
 * Søkealgoritmene og labyrinten. De tar et rutenett og gir besøksrekkefølge og sti,
 * så siden selv kan velge om den vil animere resultatet.
 *
 * Rutenettet er en Uint8Array (rad * cols + kolonne).
 */
export const EMPTY = 0;
export const WALL = 1;
export const MUD = 2;
export const COST = { [EMPTY]: 1, [MUD]: 5 };

export const ALGORITHMS = {
  astar: { name: 'A*', weighted: true, optimal: true, note: 'Bruker avstanden til målet som veiviser og finner alltid billigste vei.' },
  dijkstra: { name: 'Dijkstra', weighted: true, optimal: true, note: 'Utforsker jevnt i alle retninger etter kostnad. Garantert billigste vei.' },
  bfs: { name: 'Bredde først', weighted: false, optimal: false, note: 'Færrest mulig steg, men ser bort fra at gjørme koster mer.' },
  greedy: { name: 'Grådig', weighted: false, optimal: false, note: 'Går alltid mot målet. Rask, men finner ikke nødvendigvis beste vei.' },
  dfs: { name: 'Dybde først', weighted: false, optimal: false, note: 'Følger en vei til den stopper. Finner en vei, sjelden en god en.' },
};

/** Binær min-heap: gir O(log n) for å hente ruten med lavest prioritet. */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node, priority, tie = 0) {
    const items = this.items;
    items.push({ node, priority, tie });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let smallest = i;
        if (l < items.length && this.less(l, smallest)) smallest = l;
        if (r < items.length && this.less(r, smallest)) smallest = r;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest], items[i]];
        i = smallest;
      }
    }
    return top;
  }
  less(a, b) {
    const x = this.items[a], y = this.items[b];
    return x.priority < y.priority || (x.priority === y.priority && x.tie < y.tie);
  }
}

function neighbors(index, cols, rows, out) {
  const x = index % cols, y = (index - x) / cols;
  let n = 0;
  if (y > 0) out[n++] = index - cols;
  if (x < cols - 1) out[n++] = index + 1;
  if (y < rows - 1) out[n++] = index + cols;
  if (x > 0) out[n++] = index - 1;
  return n;
}

function buildPath(parent, start, goal) {
  if (parent[goal] === -1 && goal !== start) return [];
  const path = [];
  for (let at = goal; at !== -1; at = parent[at]) {
    path.push(at);
    if (at === start) break;
  }
  return path.reverse();
}

/**
 * Kjører valgt algoritme.
 * @returns {{ visited: number[], path: number[], cost: number }}
 */
export function search(algorithm, { cells, cols, rows }, start, goal) {
  const size = cols * rows;
  const parent = new Int32Array(size).fill(-1);
  const visited = [];
  const near = new Int32Array(4);
  const gx = goal % cols, gy = Math.floor(goal / cols);
  const heuristic = (i) => Math.abs((i % cols) - gx) + Math.abs(Math.floor(i / cols) - gy);
  let found = false;

  if (algorithm === 'bfs' || algorithm === 'dfs') {
    const seen = new Uint8Array(size);
    const frontier = [start];
    if (algorithm === 'bfs') seen[start] = 1;
    let head = 0;
    while (algorithm === 'bfs' ? head < frontier.length : frontier.length) {
      const current = algorithm === 'bfs' ? frontier[head++] : frontier.pop();
      if (algorithm === 'dfs') {
        if (seen[current]) continue;
        seen[current] = 1;
      }
      visited.push(current);
      if (current === goal) { found = true; break; }
      const count = neighbors(current, cols, rows, near);
      // DFS: legg naboene på stakken i motsatt rekkefølge, så "opp" utforskes først.
      for (let k = 0; k < count; k++) {
        const next = near[algorithm === 'dfs' ? count - 1 - k : k];
        if (cells[next] === WALL || seen[next]) continue;
        if (algorithm === 'bfs') seen[next] = 1;
        parent[next] = current;
        frontier.push(next);
      }
    }
  } else {
    // Dijkstra, A* og grådig søk skiller seg bare i hvordan køen prioriteres.
    const dist = new Float64Array(size).fill(Infinity);
    const closed = new Uint8Array(size);
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(start, 0);
    while (heap.size) {
      const { node: current } = heap.pop();
      if (closed[current]) continue;
      closed[current] = 1;
      visited.push(current);
      if (current === goal) { found = true; break; }
      const count = neighbors(current, cols, rows, near);
      for (let k = 0; k < count; k++) {
        const next = near[k];
        if (cells[next] === WALL || closed[next]) continue;
        const g = dist[current] + COST[cells[next]];
        if (algorithm === 'greedy') {
          if (dist[next] !== Infinity) continue; // allerede oppdaget
          dist[next] = g;
          parent[next] = current;
          heap.push(next, heuristic(next));
        } else if (g < dist[next]) {
          dist[next] = g;
          parent[next] = current;
          const h = algorithm === 'astar' ? heuristic(next) : 0;
          heap.push(next, g + h, h);
        }
      }
    }
  }

  const path = found ? buildPath(parent, start, goal) : [];
  const cost = path.slice(1).reduce((sum, i) => sum + COST[cells[i]], 0);
  return { visited, path, cost };
}

/** Lager en labyrint med tilbakesporing og egen stakk. Bredde og høyde må være oddetall. */
export function generateMaze(cols, rows) {
  const cells = new Uint8Array(cols * rows).fill(WALL);
  const stack = [cols + 1]; // celle (1, 1)
  cells[stack[0]] = EMPTY;
  while (stack.length) {
    const current = stack.at(-1);
    const x = current % cols, y = Math.floor(current / cols);
    const options = [];
    if (y > 2) options.push(-2 * cols);
    if (y < rows - 3) options.push(2 * cols);
    if (x > 2) options.push(-2);
    if (x < cols - 3) options.push(2);
    const open = options.filter((step) => cells[current + step] === WALL);
    if (!open.length) { stack.pop(); continue; }
    const step = open[Math.floor(Math.random() * open.length)];
    cells[current + step / 2] = EMPTY; // riv veggen mellom
    cells[current + step] = EMPTY;
    stack.push(current + step);
  }
  // Åpne noen ekstra vegger, så det finnes flere veier og algoritmene faktisk må velge.
  for (let i = 0; i < (cols * rows) / 14; i++) {
    const x = 1 + Math.floor(Math.random() * (cols - 2));
    const y = 1 + Math.floor(Math.random() * (rows - 2));
    if ((x + y) % 2 === 1) cells[y * cols + x] = EMPTY;
  }
  return cells;
}

/** Tilfeldig terreng: spredte vegger og flekker med gjørme. */
export function generateTerrain(cols, rows) {
  const cells = new Uint8Array(cols * rows);
  for (let i = 0; i < cells.length; i++) {
    const roll = Math.random();
    cells[i] = roll < 0.24 ? WALL : roll < 0.4 ? MUD : EMPTY;
  }
  return cells;
}
