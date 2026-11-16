// Kjører nettleserens RegExp i en egen tråd. Den kan henge seg opp på disse mønstrene,
// og en tråd som henger kan bare stoppes utenfra med worker.terminate().
self.onmessage = ({ data }) => {
  const regex = new RegExp(data.pattern);
  // Raske kjøringer gjentas og tiden deles på antallet, fordi klokken bare er nøyaktig til rundt 0,1 ms.
  const started = performance.now();
  let runs = 0, elapsed = 0;
  do {
    regex.test(data.text);
    runs++;
    elapsed = performance.now() - started;
  } while (elapsed < 5 && runs < 200_000);
  self.postMessage({ id: data.id, ms: elapsed / runs });
};
