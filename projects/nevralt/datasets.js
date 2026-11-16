/** Syntetiske datasett i området [-1, 1] x [-1, 1]. label 0 = blå, 1 = rosa. */
const TAU = Math.PI * 2;
const gauss = () => {
  // Box-Muller: normalfordelt tilfeldig tall
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
};
const clamp = (v) => Math.max(-0.98, Math.min(0.98, v));
const point = (x, y, label, noise) => ({ x: clamp(x + gauss() * noise), y: clamp(y + gauss() * noise), label });

export const datasets = {
  sirkel: {
    name: 'Sirkel',
    generate(n, noise) {
      return Array.from({ length: n }, (_, i) => {
        const label = i % 2;
        const r = label ? Math.random() * 0.38 : 0.62 + Math.random() * 0.3;
        const a = Math.random() * TAU;
        return point(Math.cos(a) * r, Math.sin(a) * r, label, noise);
      });
    },
  },
  xor: {
    name: 'XOR',
    generate(n, noise) {
      return Array.from({ length: n }, () => {
        const x = (0.12 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
        const y = (0.12 + Math.random() * 0.8) * (Math.random() < 0.5 ? -1 : 1);
        return point(x, y, x * y > 0 ? 1 : 0, noise);
      });
    },
  },
  klynger: {
    name: 'Klynger',
    generate(n, noise) {
      return Array.from({ length: n }, (_, i) => {
        const label = i % 2;
        const c = label ? 0.42 : -0.42;
        return point(c + gauss() * 0.2, c + gauss() * 0.2, label, noise);
      });
    },
  },
  spiral: {
    name: 'Spiral',
    generate(n, noise) {
      return Array.from({ length: n }, (_, i) => {
        const label = i % 2;
        const t = (Math.floor(i / 2) / (n / 2)) * 1.6 * Math.PI + 0.35;
        const r = (t / (1.6 * Math.PI + 0.35)) * 0.9;
        const a = t + (label ? Math.PI : 0);
        return point(Math.cos(a) * r, Math.sin(a) * r, label, noise * 0.6);
      });
    },
  },
};
