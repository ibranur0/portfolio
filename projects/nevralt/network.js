/**
 * Et lite nevralt nettverk skrevet uten biblioteker.
 * To innganger (x, y), noen skjulte lag og en sigmoid-utgang.
 * Trenes med stokastisk gradientnedstigning og binær kryssentropi.
 */
const ACTIVATIONS = {
  tanh: { f: Math.tanh, derivative: (a) => 1 - a * a },
  relu: { f: (z) => (z > 0 ? z : 0), derivative: (a) => (a > 0 ? 1 : 0) },
  sigmoid: { f: (z) => 1 / (1 + Math.exp(-z)), derivative: (a) => a * (1 - a) },
};
const sigmoid = ACTIVATIONS.sigmoid.f;

export class Network {
  /**
   * @param {number[]} sizes  Antall nevroner per lag, f.eks. [2, 6, 6, 1]
   * @param {'tanh'|'relu'|'sigmoid'} activation  Aktivering i de skjulte lagene
   */
  constructor(sizes, activation = 'tanh') {
    this.sizes = sizes;
    this.activation = ACTIVATIONS[activation];
    this.last = sizes.length - 1;
    // Aktiveringer og feilledd per lag gjenbrukes, så ingenting allokeres under trening.
    this.a = sizes.map((n) => new Float64Array(n));
    this.delta = sizes.map((n) => new Float64Array(n));
    this.w = [null];
    this.b = [null];
    for (let l = 1; l < sizes.length; l++) {
      const nIn = sizes[l - 1], nOut = sizes[l];
      // He-initialisering for ReLU, Xavier for de andre.
      const limit = activation === 'relu' ? Math.sqrt(6 / nIn) : Math.sqrt(6 / (nIn + nOut));
      this.w.push(Float64Array.from({ length: nIn * nOut }, () => (Math.random() * 2 - 1) * limit));
      this.b.push(new Float64Array(nOut).fill(activation === 'relu' ? 0.01 : 0));
    }
  }

  /** Foroverpropagering. Returnerer sannsynligheten for klasse 1. */
  forward(x, y) {
    const { a, w, b, last } = this;
    a[0][0] = x; a[0][1] = y;
    for (let l = 1; l <= last; l++) {
      const prev = a[l - 1], cur = a[l], weights = w[l], bias = b[l];
      const nIn = prev.length;
      for (let j = 0; j < cur.length; j++) {
        let z = bias[j];
        const row = j * nIn;
        for (let i = 0; i < nIn; i++) z += weights[row + i] * prev[i];
        cur[j] = l === last ? sigmoid(z) : this.activation.f(z);
      }
    }
    return a[last][0];
  }

  /** Ett treningssteg på ett eksempel. Returnerer tapet før oppdateringen. */
  train(x, y, target, learningRate) {
    const { a, w, b, delta, last } = this;
    const p = this.forward(x, y);

    // Bakoverpropagering: sigmoid + kryssentropi gir det enkle feilleddet (p - mål).
    delta[last][0] = p - target;
    for (let l = last - 1; l >= 1; l--) {
      const next = delta[l + 1], weights = w[l + 1], n = a[l].length;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < next.length; j++) sum += weights[j * n + i] * next[j];
        delta[l][i] = sum * this.activation.derivative(a[l][i]);
      }
    }

    // Gradientsteg
    for (let l = 1; l <= last; l++) {
      const prev = a[l - 1], weights = w[l], bias = b[l], nIn = prev.length;
      for (let j = 0; j < bias.length; j++) {
        const g = delta[l][j] * learningRate;
        bias[j] -= g;
        const row = j * nIn;
        for (let i = 0; i < nIn; i++) weights[row + i] -= g * prev[i];
      }
    }

    const eps = 1e-12;
    return -(target * Math.log(p + eps) + (1 - target) * Math.log(1 - p + eps));
  }

  get parameterCount() {
    let count = 0;
    for (let l = 1; l <= this.last; l++) count += this.w[l].length + this.b[l].length;
    return count;
  }
}
