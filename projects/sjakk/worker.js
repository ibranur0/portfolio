// Web Worker: søket kjører her, så brettet aldri fryser mens motoren tenker.
import { Engine, moveToUci, moveFrom, moveTo, movePromo } from './engine.js';

const NORWEGIAN = ' PSLTDK'; // bonde, springer, løper, tårn, dronning, konge

self.onmessage = ({ data }) => {
  const { id, startFen, moves, timeMs } = data;
  const engine = new Engine(startFen);
  // Spill gjennom partiet på nytt, slik at motoren kjenner historikken (trekkgjentakelse).
  for (const uci of moves) {
    const move = engine.legalMoves().find((m) => moveToUci(m) === uci);
    engine.make(move);
  }
  const white = engine.side === 0;

  const describe = (info) => {
    // Hovedvarianten i lesbar notasjon
    const san = [];
    for (const m of info.pv) { san.push(engine.toSan(m, NORWEGIAN)); engine.make(m); }
    for (let i = 0; i < info.pv.length; i++) engine.unmake();
    return {
      id,
      depth: info.depth,
      nodes: info.nodes,
      ms: info.ms,
      // Alltid sett fra hvit, slik at evalueringssøylen ikke hopper mellom trekkene.
      score: white ? info.score : -info.score,
      mate: info.mate == null ? null : white ? info.mate : -info.mate,
      pv: san,
    };
  };

  const result = engine.search({ timeMs, onInfo: (info) => self.postMessage({ type: 'info', ...describe(info) }) });
  self.postMessage({
    type: 'done', ...describe(result),
    move: result.move ? { from: moveFrom(result.move), to: moveTo(result.move), promo: movePromo(result.move) } : null,
  });
};
