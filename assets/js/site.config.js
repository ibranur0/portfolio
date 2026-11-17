/** Navn, e-post og annet som vises på forsiden, samlet på ett sted. */
export const site = {
  name: 'Ibrahim Nur',
  initials: 'IN',
  title: 'Utvikler',
  location: 'Oslo',
  email: 'ibrahimnur003@gmail.com',
  seeking: 'IT-stillinger',

  // Uten brukernavn vises ingen GitHub-lenker.
  github: { user: 'ibranur0', repo: 'portfolio', branch: 'main' },
  // Navnet på siden i GoatCounter (navn.goatcounter.com). Tomt = ingen besøksstatistikk.
  goatcounter: 'ibra',
  // Adressen til Strømsmart-API-et. Tom betyr at Strømsmart bare regner i nettleseren.
  // Bytter jeg adresse, må den også inn i connect-src i projects/stromsmart/index.html.
  stromsmartApi: 'https://stromsmart-api-285601901583.europe-west2.run.app',

  // En setning under navnet på forsiden.
  tagline: 'Jeg bygger ting fra bunnen av for å forstå hvordan de virker.',

  about: [
    'Jeg lærer best ved å bygge noe selv. Jeg lagde Raft fordi jeg ville skjønne hvordan databaser kan kjøre på flere servere uten at dataene blir forskjellige når en server går ned. Kvist lagde jeg for å finne ut hva en kompilator egentlig gjør, og Stråle fordi jeg var nysgjerrig på hvordan man regner ut lys og skygger i et bilde.',
    'Jeg har valgt prosjekter som var vanskelige å få helt riktige, og skrevet tester som viser at de virker.',
    'Nå leter jeg etter min første jobb i IT, et sted der jeg kan fortsette å lære.',
  ],

  // Teknologiene på forsiden. project er prosjektet der den er brukt, og forsiden lenker dit.
  skills: [
    {
      group: 'Språk',
      items: [
        { name: 'JavaScript', project: 'kvist' },
        { name: 'Java', project: 'stromsmart' }, // API-et bak Strømsmart
        { name: 'Python', project: 'stromsmart' },
        { name: 'SQL', project: 'sql-lab' },
        { name: 'GLSL', project: 'straale' },
      ],
    },
    {
      group: 'Verktøy',
      items: [
        { name: 'PostgreSQL', project: 'sql-lab' },
        { name: 'Spring Boot', project: 'stromsmart' },
        { name: 'REST-API', project: 'stromsmart' },
        { name: 'WebGL 2', project: 'straale' },
        { name: 'WebAssembly', project: 'sql-lab' },
        { name: 'Web Workers', project: 'sjakk' },
      ],
    },
    {
      group: 'Algoritmer',
      items: [
        { name: 'Konsensus i klynger', project: 'raft' },
        { name: 'CRDT og samtidig redigering', project: 'samskriv' },
        { name: 'Kompilator og virtuell maskin', project: 'kvist' },
        { name: 'Automater og regex', project: 'regex' },
        { name: 'Søk i spilltrær', project: 'sjakk' },
        { name: 'Fysikksimulering', project: 'bro' },
        { name: 'Nevrale nettverk', project: 'nevralt' },
      ],
    },
    {
      group: 'Testing',
      items: [
        { name: 'Egenskapstester med feilinjeksjon', project: 'raft' },
        { name: 'Differensiell testing', project: 'regex' },
        { name: 'Enhetstester', project: 'kvist' },
        { name: 'Gradientkontroll', project: 'nevralt' },
        { name: 'Perft', project: 'sjakk' },
      ],
    },
  ],

  languages: ['Norsk', 'Engelsk'],
};

const hasGithub = () => Boolean(site.github.user);

/** Lenke til GitHub-profilen, eller null hvis brukernavnet ikke er satt. */
export const githubProfile = () => (hasGithub() ? `https://github.com/${site.github.user}` : null);

/** Lenke til kildekoden for ett prosjekt (mappen i porteføljerepoet), eller null. */
export const githubSource = (slug) =>
  (hasGithub() ? `https://github.com/${site.github.user}/${site.github.repo}/tree/${site.github.branch}/projects/${slug}` : null);
