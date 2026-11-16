/**
 * Raft, og en simulering av klyngen den kjører i. Brukes av siden og av test.mjs.
 *
 * Følger "In Search of an Understandable Consensus Algorithm" (Ongaro og Ousterhout, 2014):
 * ledervalg, loggreplikering og commit-regelen. Snapshots og endring av medlemmer er ikke med.
 *
 * Alt som er tilfeldig kommer fra en generator med frø. Samme frø gir samme kjøring,
 * så en test som feiler kan kjøres på nytt.
 */
export const HEARTBEAT_INTERVAL = 60;
export const ELECTION_TIMEOUT = [220, 440];
export const LATENCY = [15, 35];
const MAX_ENTRIES_PER_MESSAGE = 6;
const MAX_EVENTS = 60;
const LOG_WINDOW = 12;

/** mulberry32 (Tommy Ettinger). Liten og rask, og god nok til en simulering. */
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

const sameEntry = (a, b) => a.term === b.term && a.command === b.command;

/** En server. Kjenner ikke klokke eller nettverk: alt slikt går gjennom simuleringen. */
class Node {
  constructor(id, size, sim) {
    this.id = id;
    this.size = size;
    this.sim = sim;
    this.alive = true;

    // Varig tilstand: overlever krasj (ville ligget på disk i et ekte system).
    this.currentTerm = 0;
    this.votedFor = -1;
    this.log = []; // { term, command }. Indeks 1 i Raft er log[0].

    // Flyktig tilstand: nullstilles ved omstart.
    this.role = 'FOLLOWER';
    this.leaderId = -1;
    this.commitIndex = 0;
    this.lastApplied = 0;
    this.votes = new Set();
    this.nextIndex = new Array(size).fill(1);
    this.matchIndex = new Array(size).fill(0);
    this.heartbeatDue = 0;
    this.store = new Map(); // tilstandsmaskinen: nøkkel -> verdi
    this.resetElectionTimer();
  }

  /* ------------------------------------------------------------ Tid */
  onTick() {
    if (this.role === 'LEADER') {
      if (this.sim.tick >= this.heartbeatDue) this.broadcastAppend();
    } else if (this.sim.tick >= this.electionDeadline) {
      this.startElection();
    }
  }

  resetElectionTimer() {
    this.electionStarted = this.sim.tick;
    this.electionDeadline = this.sim.tick + this.sim.between(ELECTION_TIMEOUT);
  }

  /* ------------------------------------------------------ Ledervalg */
  startElection() {
    this.role = 'CANDIDATE';
    this.currentTerm++;
    this.votedFor = this.id;
    this.votes = new Set([this.id]);
    this.leaderId = -1;
    this.resetElectionTimer();
    this.sim.event('valg', `S${this.id} fikk ikke livstegn fra lederen og stiller til valg i termin ${this.currentTerm}`);
    if (this.hasMajority(this.votes.size)) { this.becomeLeader(); return; }
    for (let peer = 0; peer < this.size; peer++) {
      if (peer === this.id) continue;
      this.sim.send({ type: 'REQUEST_VOTE', from: this.id, to: peer, term: this.currentTerm, lastLogIndex: this.log.length, lastLogTerm: this.lastLogTerm() });
    }
  }

  onRequestVote(m) {
    if (m.term > this.currentTerm) this.stepDown(m.term);
    // En node stemmer bare på en kandidat som har en logg minst like oppdatert som sin egen.
    // Uten den regelen kan bekreftede oppføringer gå tapt når lederen byttes.
    const upToDate = this.sim.faultSkipVoteCheck
      || m.lastLogTerm > this.lastLogTerm()
      || (m.lastLogTerm === this.lastLogTerm() && m.lastLogIndex >= this.log.length);
    const granted = m.term === this.currentTerm && (this.votedFor === -1 || this.votedFor === m.from) && upToDate;
    if (granted) {
      this.votedFor = m.from;
      this.resetElectionTimer();
    }
    this.sim.send({ type: 'VOTE_REPLY', from: this.id, to: m.from, term: this.currentTerm, success: granted });
  }

  onVoteReply(m) {
    if (m.term > this.currentTerm) { this.stepDown(m.term); return; }
    if (this.role !== 'CANDIDATE' || m.term !== this.currentTerm || !m.success) return;
    this.votes.add(m.from);
    if (this.hasMajority(this.votes.size)) this.becomeLeader();
  }

  becomeLeader() {
    this.role = 'LEADER';
    this.leaderId = this.id;
    this.nextIndex.fill(this.log.length + 1);
    this.matchIndex.fill(0);
    this.sim.leaderElected(this);
    // En tom oppføring i den nye terminen. Lederen kan ikke bekrefte eldre oppføringer
    // direkte, men når denne er bekreftet, er alt før den det også.
    this.log.push({ term: this.currentTerm, command: '' });
    this.matchIndex[this.id] = this.log.length;
    this.broadcastAppend();
  }

  stepDown(term) {
    const wasLeader = this.role === 'LEADER';
    this.currentTerm = term;
    this.role = 'FOLLOWER';
    this.votedFor = -1;
    this.votes = new Set();
    if (wasLeader) {
      this.sim.event('valg', `S${this.id} oppdaget termin ${term} og går av som leder`);
      this.leaderId = -1;
      this.resetElectionTimer();
    }
  }

  /* ------------------------------------------------ Loggreplikering */
  /** Tar imot en kommando fra en klient. Returnerer false hvis noden ikke er leder. */
  propose(command) {
    if (this.role !== 'LEADER') return false;
    this.log.push({ term: this.currentTerm, command });
    this.matchIndex[this.id] = this.log.length;
    this.broadcastAppend();
    return true;
  }

  broadcastAppend() {
    this.heartbeatDue = this.sim.tick + HEARTBEAT_INTERVAL;
    for (let peer = 0; peer < this.size; peer++) if (peer !== this.id) this.sendAppend(peer);
    this.advanceCommit(); // klynge med en node
  }

  sendAppend(peer) {
    const prevLogIndex = this.nextIndex[peer] - 1;
    this.sim.send({
      type: 'APPEND_ENTRIES', from: this.id, to: peer, term: this.currentTerm,
      prevLogIndex, prevLogTerm: this.termAt(prevLogIndex), leaderCommit: this.commitIndex,
      entries: this.log.slice(prevLogIndex, prevLogIndex + MAX_ENTRIES_PER_MESSAGE),
    });
  }

  onAppendEntries(m) {
    if (m.term > this.currentTerm) this.stepDown(m.term);
    const reply = { type: 'APPEND_REPLY', from: this.id, to: m.from, term: this.currentTerm, success: false, matchIndex: 0, hintIndex: 0 };
    if (m.term < this.currentTerm) { // utdatert leder
      reply.hintIndex = this.log.length + 1;
      this.sim.send(reply);
      return;
    }
    this.role = 'FOLLOWER';
    this.leaderId = m.from;
    this.resetElectionTimer();

    // Konsistenssjekk: loggen vår må inneholde oppføringen rett før de nye.
    if (m.prevLogIndex > this.log.length || this.termAt(m.prevLogIndex) !== m.prevLogTerm) {
      reply.hintIndex = Math.min(m.prevLogIndex, this.log.length + 1);
      this.sim.send(reply);
      return;
    }
    m.entries.forEach((incoming, i) => {
      const index = m.prevLogIndex + 1 + i;
      if (index <= this.log.length && this.log[index - 1].term !== incoming.term) {
        // Konflikt: lederens logg vinner. Fjern denne og alt etter.
        this.sim.truncated(this, index);
        this.log.length = index - 1;
      }
      if (index > this.log.length) this.log.push(incoming);
    });
    const lastNew = m.prevLogIndex + m.entries.length;
    if (m.leaderCommit > this.commitIndex) {
      this.commitIndex = Math.max(this.commitIndex, Math.min(m.leaderCommit, lastNew));
      this.applyCommitted();
    }
    reply.success = true;
    reply.matchIndex = lastNew;
    this.sim.send(reply);
  }

  onAppendReply(m) {
    if (m.term > this.currentTerm) { this.stepDown(m.term); return; }
    if (this.role !== 'LEADER' || m.term !== this.currentTerm) return;
    if (m.success) {
      this.matchIndex[m.from] = Math.max(this.matchIndex[m.from], m.matchIndex);
      this.nextIndex[m.from] = this.matchIndex[m.from] + 1;
      this.advanceCommit();
      if (this.nextIndex[m.from] <= this.log.length) this.sendAppend(m.from); // følgeren mangler fortsatt noe
    } else {
      // Følgerens logg avviker. Gå bakover til vi finner et felles punkt, og prøv igjen.
      this.nextIndex[m.from] = Math.max(1, Math.min(this.nextIndex[m.from] - 1, m.hintIndex));
      this.sendAppend(m.from);
    }
  }

  /**
   * En oppføring er bekreftet når et flertall har den OG den er fra lederens egen termin.
   * Uten det siste kravet kan en bekreftet oppføring bli overskrevet (figur 8 i artikkelen).
   */
  advanceCommit() {
    for (let n = this.log.length; n > this.commitIndex; n--) {
      if (this.log[n - 1].term !== this.currentTerm) break;
      const stored = this.matchIndex.filter((match) => match >= n).length;
      if (this.hasMajority(stored)) {
        this.commitIndex = n;
        this.applyCommitted();
        break;
      }
    }
  }

  applyCommitted() {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++;
      const entry = this.log[this.lastApplied - 1];
      this.sim.applied(this, this.lastApplied, entry);
      if (entry.command) {
        const space = entry.command.indexOf(' ');
        this.store.set(entry.command.slice(0, space), entry.command.slice(space + 1));
      }
    }
  }

  /* ------------------------------------------------ Krasj og omstart */
  restart() {
    this.alive = true;
    this.role = 'FOLLOWER';
    this.leaderId = -1;
    this.commitIndex = 0;
    this.lastApplied = 0;
    this.votes = new Set();
    this.store.clear(); // bygges opp igjen fra loggen etter hvert som lederen bekrefter den
    this.resetElectionTimer();
  }

  receive(m) {
    if (m.type === 'REQUEST_VOTE') this.onRequestVote(m);
    else if (m.type === 'VOTE_REPLY') this.onVoteReply(m);
    else if (m.type === 'APPEND_ENTRIES') this.onAppendEntries(m);
    else this.onAppendReply(m);
  }

  hasMajority(count) { return count * 2 > this.size; }
  lastLogTerm() { return this.termAt(this.log.length); }
  termAt(index) { return index === 0 || index > this.log.length ? 0 : this.log[index - 1].term; }
}

/** Klokke, nettverk, feilinjeksjon og løpende kontroll av Rafts sikkerhetsegenskaper. */
export class Sim {
  constructor(size, seed) {
    if (!Number.isInteger(size) || size < 1 || size > 7) throw new RangeError('Klyngen må ha mellom 1 og 7 noder');
    this.random = generator(seed);
    this.tick = 0;
    this.inFlight = [];
    this.committed = [];            // fasit: det klyngen har bekreftet
    this.leaderOfTerm = new Map();
    this.events = [];
    this.nextMessageId = 0;
    this.nextEventId = 0;
    this.delivered = 0;
    this.lost = 0;
    this.dropRate = 0;
    this.violation = null;
    this.strict = false;            // tester: kontroller loggsamsvar hvert tikk
    this.faultSkipVoteCheck = false; // tester: slå av en av Rafts regler for å vise at kontrollene fanger det
    this.cut = Array.from({ length: size }, () => new Array(size).fill(false));
    this.nodes = Array.from({ length: size }, (_, id) => new Node(id, size, this));
    // Kort første frist, så klyngen velger leder raskt etter oppstart.
    for (const node of this.nodes) node.electionDeadline = 40 + Math.floor(this.random() * 160);
    this.event('info', `Klyngen starter med ${size} noder. Ingen er leder ennå.`);
  }

  between([min, max]) { return min + Math.floor(this.random() * (max - min)); }

  send(message) {
    const latency = this.between(LATENCY);
    message.id = this.nextMessageId++;
    message.sentAt = this.tick;
    message.deliverAt = this.tick + latency;
    message.lost = this.cut[message.from][message.to] || this.random() < this.dropRate;
    if (message.lost) message.deliverAt = this.tick + (latency >> 1); // forsvinner halvveis
    this.inFlight.push(message);
  }

  event(kind, text) {
    this.events.push({ id: this.nextEventId++, tick: this.tick, kind, text });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  fail(message) {
    if (this.violation) return;
    this.violation = message;
    this.event('feil', message);
  }

  /* --------------------------------------------- Sikkerhetsegenskaper */
  leaderElected(leader) {
    this.event('leder', `S${leader.id} fikk flertall og er leder for termin ${leader.currentTerm}`);
    // Valgsikkerhet: høyst en leder per termin.
    const previous = this.leaderOfTerm.get(leader.currentTerm);
    if (previous !== undefined && previous !== leader.id) {
      this.fail(`Valgsikkerhet brutt: både S${previous} og S${leader.id} ble leder i termin ${leader.currentTerm}`);
    }
    this.leaderOfTerm.set(leader.currentTerm, leader.id);
    // Lederfullstendighet: en ny leder har alle oppføringer som er bekreftet.
    const missing = this.committed.findIndex((entry, i) => !leader.log[i] || !sameEntry(leader.log[i], entry));
    if (missing >= 0) this.fail(`Lederfullstendighet brutt: S${leader.id} mangler bekreftet oppføring ${missing + 1}`);
  }

  applied(node, index, entry) {
    // Tilstandsmaskinsikkerhet: alle noder utfører samme kommando på samme indeks.
    if (index <= this.committed.length) {
      if (!sameEntry(this.committed[index - 1], entry)) this.fail(`Tilstandsmaskinsikkerhet brutt: S${node.id} utførte en annen kommando på indeks ${index}`);
    } else if (index === this.committed.length + 1) {
      this.committed.push(entry);
      this.event('bekreftet', entry.command
        ? `Indeks ${index} bekreftet av et flertall: ${entry.command.replace(' ', ' = ')}`
        : `Indeks ${index} bekreftet av et flertall (tom oppføring fra ny leder)`);
    } else {
      this.fail(`S${node.id} hoppet over en indeks ved utføring`);
    }
  }

  truncated(node, index) {
    if (index <= node.commitIndex) this.fail(`S${node.id} forkastet en bekreftet oppføring (indeks ${index})`);
    this.event('konflikt', `S${node.id} forkaster ubekreftede oppføringer fra indeks ${index}. Lederens logg gjelder.`);
  }

  /** Loggsamsvar: har to logger samme termin på en indeks, er de like til og med den indeksen. */
  checkLogMatching() {
    for (let a = 0; a < this.nodes.length; a++) {
      for (let b = a + 1; b < this.nodes.length; b++) {
        const x = this.nodes[a].log, y = this.nodes[b].log;
        let last = Math.min(x.length, y.length);
        while (last > 0 && x[last - 1].term !== y[last - 1].term) last--;
        for (let i = 0; i < last; i++) {
          if (!sameEntry(x[i], y[i])) { this.fail(`Loggsamsvar brutt mellom S${a} og S${b} på indeks ${i + 1}`); return; }
        }
      }
    }
  }

  /* ---------------------------------------------------- Simulering */
  step() {
    this.tick++;
    const due = [], waiting = [];
    for (const message of this.inFlight) (message.deliverAt <= this.tick ? due : waiting).push(message);
    this.inFlight = waiting;
    for (const message of due) {
      // Forbindelsen kan ha blitt brutt, eller mottakeren krasjet, mens meldingen var underveis.
      if (message.lost || !this.nodes[message.to].alive || this.cut[message.from][message.to]) { this.lost++; continue; }
      this.delivered++;
      this.nodes[message.to].receive(message);
    }
    for (const node of this.nodes) if (node.alive) node.onTick();
    if (this.strict || this.tick % 25 === 0) this.checkLogMatching();
  }

  run(ticks) {
    for (let i = 0; i < ticks; i++) this.step();
  }

  /* ------------------------------------------------- Feilinjeksjon */
  crash(id) {
    const node = this.nodes[id];
    if (!node.alive) return;
    node.alive = false;
    this.event('krasj', `S${id} krasjet${node.role === 'LEADER' ? ' mens den var leder' : ''}`);
  }

  restart(id) {
    if (this.nodes[id].alive) return;
    this.nodes[id].restart();
    this.event('info', `S${id} startet på nytt med loggen fra disk`);
  }

  isolate(id) {
    for (let other = 0; other < this.nodes.length; other++) {
      if (other !== id) { this.cut[id][other] = true; this.cut[other][id] = true; }
    }
    this.event('nett', `S${id} er avskåret fra resten av klyngen`);
  }

  /** Deler nettverket i to grupper. group er id-ene i den ene gruppen. */
  split(group) {
    const inGroup = this.nodes.map((node) => group.includes(node.id));
    for (let a = 0; a < this.nodes.length; a++) {
      for (let b = 0; b < this.nodes.length; b++) this.cut[a][b] = a !== b && inGroup[a] !== inGroup[b];
    }
    const names = (wanted) => this.nodes.filter((node) => inGroup[node.id] === wanted).map((node) => `S${node.id}`).join(' ');
    this.event('nett', `Nettverket er delt: ${names(true)} | ${names(false)}`);
  }

  heal() {
    for (const row of this.cut) row.fill(false);
    this.event('nett', 'Alle forbindelser er gjenopprettet');
  }

  setDropRate(rate) {
    this.dropRate = Math.max(0, Math.min(0.9, rate));
  }

  /** Den levende lederen med høyest termin, eller null. */
  leader() {
    return this.nodes.filter((node) => node.alive && node.role === 'LEADER').sort((a, b) => b.currentTerm - a.currentTerm)[0] ?? null;
  }

  /** Sender en klientkommando. target = -1 betyr "den som er leder". */
  propose(target, key, value) {
    const chosen = target >= 0 ? this.nodes[target] : this.leader();
    if (!chosen) { this.event('avvist', 'Ingen leder akkurat nå. Kommandoen ble ikke tatt imot.'); return false; }
    if (!chosen.alive) { this.event('avvist', `S${chosen.id} er nede og svarer ikke`); return false; }
    if (!chosen.propose(`${key} ${value}`)) {
      this.event('avvist', `S${chosen.id} er ikke leder og avviser kommandoen${chosen.leaderId >= 0 ? ` (den tror S${chosen.leaderId} er leder)` : ''}`);
      return false;
    }
    this.event('klient', `S${chosen.id} tok imot ${key} = ${value} og sender den til følgerne`);
    return true;
  }

  /** Øyeblikksbilde for visning. Inneholder ingen referanser inn i simuleringen. */
  snapshot() {
    return {
      tick: this.tick,
      violation: this.violation,
      delivered: this.delivered,
      lost: this.lost,
      committed: this.committed.length,
      nodes: this.nodes.map((n) => ({
        id: n.id,
        alive: n.alive,
        role: n.role,
        term: n.currentTerm,
        votedFor: n.votedFor,
        commit: n.commitIndex,
        timer: n.role === 'LEADER' || !n.alive ? 0 : Math.min(1, (this.tick - n.electionStarted) / Math.max(1, n.electionDeadline - n.electionStarted)),
        logSize: n.log.length,
        log: n.log.slice(-LOG_WINDOW).map((entry, k) => ({ i: Math.max(0, n.log.length - LOG_WINDOW) + k + 1, t: entry.term, c: entry.command })),
        store: Object.fromEntries([...n.store].sort()),
        cut: this.cut[n.id].flatMap((isCut, other) => (isCut ? [other] : [])),
      })),
      messages: this.inFlight.map((m) => ({ id: m.id, type: m.type, from: m.from, to: m.to, sent: m.sentAt, due: m.deliverAt, lost: m.lost, ok: m.success === true, entries: m.entries?.length ?? 0 })),
      events: this.events.map((e) => ({ ...e })),
    };
  }
}
