/**
 * Scenene. Alt er kuler, pluss bakken (y = 0) og noen ganger fire vegger.
 * Materialer: diffuse (matt), metal (param = ruhet), glass (param = brytningsindeks) og light (param = lysstyrke).
 */
export const TYPES = { diffuse: 0, metal: 1, glass: 2, light: 3 };

const sphere = (x, y, z, r, type, color, param = 0) => ({ center: [x, y, z], radius: r, type, color, param });

/** mulberry32: småkulene ligger likt hver gang. */
function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Farge fra kulør (0-1), mettet og lys nok til å se godt ut som matt flate. */
function hue(h) {
  const channel = (offset) => 0.5 + 0.42 * Math.cos(2 * Math.PI * (h + offset));
  return [channel(0), channel(0.33), channel(0.67)];
}

/** Strør småkuler rundt de store, uten at noen overlapper. */
function scatter(big, count, seed) {
  const random = generator(seed);
  const placed = [...big];
  for (let tries = 0; placed.length < big.length + count && tries < 2000; tries++) {
    const radius = 0.22 + random() * 0.2;
    const angle = random() * Math.PI * 2, distance = 1.6 + random() * 4.2;
    const candidate = [Math.cos(angle) * distance, radius, Math.sin(angle) * distance];
    const free = placed.every((s) => Math.hypot(s.center[0] - candidate[0], s.center[1] - candidate[1], s.center[2] - candidate[2]) > s.radius + radius + 0.08);
    if (!free) continue;
    const roll = random();
    placed.push(roll < 0.58 ? sphere(...candidate, radius, 'diffuse', hue(random()))
      : roll < 0.84 ? sphere(...candidate, radius, 'metal', hue(random()).map((v) => 0.5 + v * 0.5), random() * 0.25)
        : sphere(...candidate, radius, 'glass', [1, 1, 1], 1.5));
  }
  return placed;
}

export const SCENES = [
  {
    name: 'Dagslys',
    note: 'Glass, metall og matte flater under åpen himmel. Se etter lyset som samler seg under glasskula.',
    sky: { top: [0.12, 0.24, 0.52], horizon: [0.5, 0.58, 0.68], sun: [-0.62, 0.6, 0.5], sunColor: [150, 128, 96] },
    ground: { a: [0.62, 0.6, 0.56], b: [0.2, 0.2, 0.22], roughness: -1 },
    room: false,
    exposure: 0.62,
    camera: { yaw: 0.55, pitch: 0.2, distance: 9, target: [0, 0.8, 0], fov: 36, aperture: 0.05 },
    spheres: scatter([
      sphere(0, 1, 0, 1, 'glass', [1, 1, 1], 1.5),
      sphere(2.25, 1, -0.5, 1, 'metal', [0.96, 0.76, 0.42], 0.04),
      sphere(-2.25, 1, 0.4, 1, 'diffuse', [0.16, 0.46, 0.33]),
    ], 15, 7),
  },
  {
    name: 'Lysrom',
    note: 'En lampe i taket er eneste lyskilde. Den røde og blå veggen farger alt i nærheten: lyset spretter videre med fargen til flaten det traff.',
    sky: { top: [0, 0, 0], horizon: [0, 0, 0], sun: [0, 1, 0], sunColor: [0, 0, 0] },
    ground: { a: [0.74, 0.74, 0.74], b: [0.74, 0.74, 0.74], roughness: -1 },
    room: true,
    exposure: 0.8,
    camera: { yaw: 0, pitch: 0.06, distance: 11.5, target: [0, 2.35, 0], fov: 34, aperture: 0 },
    spheres: [
      sphere(0, 4.02, 0, 0.95, 'light', [1, 0.86, 0.66], 8), // en stor lampe gir mindre støy enn en liten
      sphere(-1.25, 1.1, -0.9, 1.1, 'metal', [0.95, 0.95, 0.95], 0),
      sphere(1.35, 0.8, 0.8, 0.8, 'glass', [1, 1, 1], 1.5),
      sphere(-0.2, 0.42, 1.5, 0.42, 'diffuse', [0.85, 0.72, 0.2]),
    ],
  },
  {
    name: 'Neon',
    note: 'Ingen himmel og ingen sol. Alt lyset kommer fra de tre lysende kulene, og bakken er blank.',
    sky: { top: [0.004, 0.005, 0.012], horizon: [0.012, 0.012, 0.02], sun: [0, 1, 0], sunColor: [0, 0, 0] },
    ground: { a: [0.5, 0.5, 0.52], b: [0.3, 0.3, 0.32], roughness: 0.12 },
    room: false,
    exposure: 1.0,
    camera: { yaw: -0.5, pitch: 0.2, distance: 8, target: [0, 0.8, 0], fov: 38, aperture: 0.07 },
    spheres: [
      sphere(-2.2, 0.75, -0.2, 0.75, 'light', [1, 0.16, 0.5], 7),
      sphere(2.3, 0.95, -1.1, 0.95, 'light', [0.15, 0.75, 1], 6),
      sphere(0.4, 0.45, 2.2, 0.45, 'light', [0.3, 1, 0.5], 8),
      sphere(0, 1.25, -0.4, 1.25, 'metal', [0.97, 0.97, 0.97], 0),
      sphere(-1.0, 0.5, 1.5, 0.5, 'glass', [1, 1, 1], 1.5),
      sphere(1.5, 0.4, 1.1, 0.4, 'diffuse', [0.9, 0.9, 0.9]),
      sphere(-0.6, 0.3, -2.4, 0.3, 'diffuse', [0.9, 0.9, 0.9]),
      sphere(3.2, 0.35, 1.2, 0.35, 'metal', [0.9, 0.7, 0.4], 0.2),
      sphere(-3.3, 0.4, 1.6, 0.4, 'glass', [1, 1, 1], 1.5),
    ],
  },
];
