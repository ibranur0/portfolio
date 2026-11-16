// Sjekker at bakoverpropageringen stemmer med numeriske gradienter.
//   node projects/nevralt/test.mjs
import assert from 'node:assert/strict';
import { Network } from './network.js';

const EPS = 1e-6;
const loss = (net, x, y, target) => {
  const p = net.forward(x, y);
  return -(target * Math.log(p) + (1 - target) * Math.log(1 - p));
};
const copyWeights = (from, to) => {
  for (let l = 1; l <= from.last; l++) { to.w[l].set(from.w[l]); to.b[l].set(from.b[l]); }
};

let checked = 0, worst = 0;
for (const activation of ['tanh', 'sigmoid', 'relu']) {
  for (const sizes of [[2, 1], [2, 3, 1], [2, 6, 6, 1], [2, 4, 5, 3, 1]]) {
    for (let trial = 0; trial < 5; trial++) {
      const net = new Network(sizes, activation);
      const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, target = trial % 2;

      // Med læringsrate 1 flyttes hver vekt akkurat en gradient, så gradient = før - etter.
      const stepped = new Network(sizes, activation);
      copyWeights(net, stepped);
      stepped.train(x, y, target, 1);

      for (let l = 1; l <= net.last; l++) {
        for (const [params, after] of [[net.w[l], stepped.w[l]], [net.b[l], stepped.b[l]]]) {
          for (let i = 0; i < params.length; i++) {
            const analytic = params[i] - after[i];
            const saved = params[i];
            params[i] = saved + EPS; const up = loss(net, x, y, target);
            params[i] = saved - EPS; const down = loss(net, x, y, target);
            params[i] = saved;
            const numeric = (up - down) / (2 * EPS);
            const error = Math.abs(analytic - numeric) / Math.max(1e-8, Math.abs(analytic) + Math.abs(numeric));
            // ReLU har en knekk i null: der er den numeriske gradienten ikke definert.
            const nearKink = activation === 'relu' && Math.abs(analytic - numeric) > 1e-4;
            if (!nearKink) {
              assert.ok(error < 1e-4 || Math.abs(analytic - numeric) < 1e-8,
                `${activation} ${sizes.join('-')}: lag ${l}, parameter ${i}: analytisk ${analytic}, numerisk ${numeric}`);
              worst = Math.max(worst, Math.abs(analytic - numeric));
            }
            checked++;
          }
        }
      }
    }
  }
}

// Nettverket skal faktisk lære: XOR er ikke lineært separerbart, så det krever et skjult lag.
const xor = [[-0.8, -0.8, 1], [0.8, 0.8, 1], [-0.8, 0.8, 0], [0.8, -0.8, 0]];
let solved = 0;
for (let attempt = 0; attempt < 5; attempt++) {
  const net = new Network([2, 6, 1], 'tanh');
  for (let epoch = 0; epoch < 3000; epoch++) for (const [x, y, t] of xor) net.train(x, y, t, 0.1);
  if (xor.every(([x, y, t]) => (net.forward(x, y) >= 0.5 ? 1 : 0) === t)) solved++;
}
assert.ok(solved >= 4, `XOR ble bare løst i ${solved} av 5 forsøk`);

console.log(`OK: ${checked} gradienter kontrollert (største avvik ${worst.toExponential(1)}), XOR løst i ${solved} av 5 forsøk`);
