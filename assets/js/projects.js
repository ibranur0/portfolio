/**
 * Listen over prosjektene. Forsiden og "Om prosjektet" leser herfra.
 * Rekkefølgen her er rekkefølgen på forsiden.
 */
export const categories = {
  spill: 'Spill',
  verktoy: 'Verktøy',
  data: 'Data',
  visualisering: 'Visualisering',
  systemer: 'Systemer',
};

export const projects = [
  {
    slug: 'raft',
    title: 'Raft',
    category: 'systemer',
    language: 'JavaScript',
    tagline: 'Fem servere som blir enige, også når du ødelegger nettverket.',
    description:
      'En interaktiv simulering av Raft, konsensusalgoritmen bak etcd og Consul. En omvisning i seks kapitler tar deg gjennom ledervalg, replikering, krasj og nettverksdeling. Etterpå kan du prøve å ødelegge klyngen selv.',
    tech: ['Raft', 'Deterministisk simulering', 'Egenskapstester', 'SVG'],
    challenge:
      'Feil i distribuerte algoritmer viser seg bare i sjeldne rekkefølger av krasj og forsinkede meldinger. De er nesten umulige å finne ved å prøve seg frem.',
    solution:
      'Hele klyngen kjører i en deterministisk simulering der klokke, nettverk og tilfeldighet styres av ett frø. Testene har kjørt 20\u00a0000 tilfeldige feilscenarier og kontrollerer fire sikkerhetsegenskaper hvert tikk. En mutasjonstest fjerner en av Rafts regler og bekrefter at kontrollene oppdager det.',
    learned:
      'Deterministisk simulering gjør feil i distribuerte systemer mulige å teste. Når en test feiler, gir frøet nøyaktig samme kjøring på nytt, og feilen kan studeres steg for steg.',
  },
  {
    slug: 'kvist',
    title: 'Kvist',
    category: 'systemer',
    language: 'JavaScript',
    tagline: 'Et eget programmeringsspråk med kompilator, virtuell maskin og feilsøker.',
    description:
      'Kvist er et lite språk med funksjoner, closures og lister. Kildekoden kompileres til bytekode og kjøres i en stakkmaskin. Du kan gå gjennom programmet en instruksjon om gangen og se stakken, kallstakken og variablene endre seg.',
    tech: ['Kompilator', 'Pratt-parser', 'Bytekode', 'Stakkmaskin'],
    challenge:
      'En closure må virke også etter at funksjonen som laget den har returnert. Og feilmeldingene må peke på riktig kildelinje, selv om maskinen bare ser tall.',
    solution:
      'Kompilatoren løser hver variabel til en fast posisjon (dybde og plass), så maskinen aldri slår opp et navn. Hver funksjon husker omgivelsen den ble laget i, og hver instruksjon bærer med seg kildelinjen. 76 tester dekker presedens, skop, closures og 23 ulike feilmeldinger.',
    learned:
      'Hvor mye som kan avgjøres før programmet kjører. Jo mer kompilatoren løser på forhånd, jo enklere og raskere blir maskinen.',
  },
  {
    slug: 'sjakk',
    title: 'Sjakk',
    category: 'spill',
    language: 'JavaScript',
    tagline: 'En sjakkmotor som regner rundt en million stillinger i sekundet.',
    description:
      'Spill mot en egenutviklet sjakkmotor. Den bruker alfa-beta-søk med iterativ fordypning, transposisjonstabell og hvilesøk, og viser dybde, vurdering og hovedvariant mens den tenker.',
    tech: ['JavaScript', 'Web Workers', 'Alfa-beta-søk', 'Zobrist-hashing'],
    challenge:
      'Sjakkreglene er fulle av unntak: rokade, en passant, bondeforvandling og bundne brikker. En feil i trekkgeneratoren gir en motor som spiller ulovlige trekk eller overser matt.',
    solution:
      'Trekkgeneratoren er testet med perft. Den teller alle stillinger til en gitt dybde og sammenligner med kjente fasitverdier, for eksempel 4\u00a0865\u00a0609 stillinger fem trekk ut fra utgangsstillingen. Søket ble bygget først da alle tallene stemte.',
    learned:
      'En god test gjør det trygt å optimalisere. Med perft på plass kunne jeg legge til beskjæring og trekksortering uten å lure på om reglene fortsatt var riktige.',
  },
  {
    slug: 'sql-lab',
    title: 'SQL-lab',
    category: 'data',
    language: 'SQL',
    tagline: 'Ekte PostgreSQL i nettleseren, med spørreplanen tegnet som et tre.',
    description:
      'En fullverdig PostgreSQL-database som kjører i nettleseren via WebAssembly. Skriv spørringer mot et datasett med 40\u00a0000 bysykkelturer, se resultatet som tabell eller diagram, og få spørreplanen forklart visuelt.',
    tech: ['PostgreSQL', 'SQL', 'WebAssembly', 'PGlite'],
    challenge:
      'EXPLAIN ANALYZE forteller hvorfor en spørring er treg, men utskriften er tung å lese når planen har mange nivåer.',
    solution:
      'Appen henter planen som JSON og tegner den som et tre. Hver node viser tidsbruk, antall rader og hvor langt unna planleggerens estimat var. Eksemplene dekker vindusfunksjoner, CTE-er, rekursjon og effekten av en indeks.',
    learned:
      'Å lese spørreplaner: forskjellen på sekvensielt søk og indekssøk, hvorfor join-rekkefølgen betyr noe, og hvor mye en indeks på riktig kolonne hjelper.',
  },
  {
    slug: 'stromsmart',
    title: 'Strømsmart',
    category: 'verktoy',
    language: 'Python',
    tagline: 'Når er strømmen billigst? Python regner på dagens spotpriser.',
    description:
      'Henter dagens og morgendagens spotpriser for ditt prisområde og regner ut når det lønner seg å lade elbilen eller kjøre vaskemaskinen. Analysen er skrevet i Python og kjører i nettleseren med Pyodide. Den samme planleggingen finnes som et API i Java med Spring Boot og PostgreSQL.',
    tech: ['Python', 'Pyodide', 'Java', 'Spring Boot', 'PostgreSQL'],
    challenge:
      'Elbillading kan deles opp i de billigste timene, mens en oppvaskmaskin må gå sammenhengende. Det er to ulike optimeringsproblemer, og begge må ta hensyn til når du må være ferdig.',
    solution:
      'Python-modulen har en funksjon for sammenhengende vindu og en for fleksibel lading. Den samme filen testes med unittest på kommandolinjen og lastes uendret inn i nettleseren.',
    learned:
      'Rene funksjoner uten avhengigheter er lette å teste og lette å flytte. Den samme koden kjører nå tre steder: i testene, i terminalen og i nettleseren.',
  },
  {
    slug: 'bro',
    title: 'Bro',
    category: 'spill',
    language: 'JavaScript',
    tagline: 'Bygg en bru som holder, og se kreftene i hver bjelke før den ryker.',
    description:
      'Et brubyggespill med egen fysikkmotor. Du bygger et fagverk av vei, tre og stål over fem stadig vanskeligere juv, og sender trafikken over. Under testen fargelegges hver bjelke etter belastningen, så du ser hvor det kommer til å ryke.',
    tech: ['Fysikksimulering', 'Canvas 2D', 'Spilldesign', 'Pointer Events'],
    challenge:
      'En fysikkmotor som er stiv nok til at en bru står stille, men ikke eksploderer numerisk. Og nivåer som er vanskelige nok til å kreve en ide, uten å være umulige.',
    solution:
      'Bjelkene er dempede fjærer som integreres i seksten delsteg per bilde. Hvert nivå har en referanseløsning i testene, som beviser at det kan løses innenfor budsjettet, og at snarveien med bare veidekke ryker.',
    learned:
      'Mye av spilldesignet handler om å finne riktige tall, og de tallene bør stå i tester. Da jeg endret hvor mye tre tåler, så jeg med en gang i testene hvilke nivåer som ble for lette.',
  },
  {
    slug: 'robot',
    title: 'Robot',
    category: 'spill',
    language: 'Kvist',
    tagline: 'Et programmeringsspill der roboten styres med språket jeg laget selv.',
    description:
      'Skriv et program som får roboten gjennom sju nivåer, fra tre kommandoer på rad til en algoritme som løser enhver labyrint. Koden kompileres og kjøres av Kvist, språket fra et annet prosjekt her, og du kan følge den linje for linje mens roboten kjører.',
    tech: ['Kvist', 'Spilldesign', 'Canvas 2D', 'Vertsfunksjoner'],
    challenge:
      'Et språk er ikke ferdig før noe annet enn eksempelprogrammer bruker det. Spillet trengte egne kommandoer i språket, og en robot som beveger seg i takt med programmet, en kommando om gangen.',
    solution:
      'Kompilatoren og maskinen fikk støtte for vertsfunksjoner: programmet som bruker språket, kan gi det egne innebygde funksjoner. Spillet kjører maskinen frem til roboten har gjort en ting, animerer den, og fortsetter. De siste nivåene kjører samme program på tre baner, så løsningen må være en algoritme.',
    learned:
      'Jeg så ikke hva språket manglet før jeg brukte det til noe annet enn eksempler. Vertsfunksjonene var noen få linjer i kompilatoren og maskinen, men uten spillet hadde jeg aldri sett behovet.',
  },
  {
    slug: 'straale',
    title: 'Stråle',
    category: 'visualisering',
    language: 'GLSL',
    tagline: 'En strålesporer som regner ut lyset på skjermkortet, i sanntid.',
    description:
      'Bildet blir til ved å følge lysstråler baklengs fra kameraet og la dem sprette rundt i scenen. Glass bryter lyset, metall speiler det, og skyggene blir myke av seg selv. Dra for å flytte kameraet og se bildet bygge seg opp.',
    tech: ['WebGL 2', 'GLSL', 'Monte Carlo', 'Strålesporing'],
    challenge:
      'Ett bilde krever millioner av tilfeldige lysstråler. Få stråler gir støy, og mange nok tar for lang tid til at kameraet kan flyttes.',
    solution:
      'Hele beregningen ligger i en fragmentshader, så skjermkortet regner alle pikslene parallelt. Hvert bilde legger en ny stråle per piksel til et løpende snitt i en flyttallstekstur. Bildet er grovt mens du drar, og blir rent i løpet av sekunder når du slipper.',
    learned:
      'Fysikken er enkel: refleksjon, brytning og energibevaring. Det vanskelige er tallene. En dårlig tilfeldighetsgenerator gir synlige mønstre, og en stråle som starter en hårsbredd feil gir svarte prikker.',
  },
  {
    slug: 'samskriv',
    title: 'Samskriv',
    category: 'systemer',
    language: 'JavaScript',
    tagline: 'Tre personer skriver i samme tekst samtidig, uten en server i midten.',
    description:
      'En tekst-CRDT, datastrukturen bak samtidig redigering i verktøy som Figma og Notion. Tre redaktører skriver hver for seg, også frakoblet. Når endringene til slutt når frem, ender alle med nøyaktig samme tekst.',
    tech: ['CRDT', 'Distribuerte systemer', 'Egenskapstester'],
    challenge:
      'To personer skriver på samme sted samtidig, og meldingene kommer frem i ulik rekkefølge hos hver av dem. Likevel må alle ende med samme tekst, uten en server som bestemmer.',
    solution:
      'Hvert tegn får en unik id og husker hvilket tegn det ble satt inn etter. Samtidige innsettinger på samme sted sorteres etter id, likt hos alle. Slettede tegn blir liggende som gravsteiner, så sene meldinger alltid finner stedet sitt. Testene kjører 5\u00a0000 tilfeldige forløp med forsinkelser, omstokking og frakobling, og krever at alle ender likt.',
    learned:
      'At flere kan skrive samtidig uten å låse noe, så lenge alle følger samme regel for rekkefølgen. Prisen er plass: hvert tegn må ha med seg en id og en nabo, og det tar mer plass enn selve tegnet.',
  },
  {
    slug: 'regex',
    title: 'Regex',
    category: 'verktoy',
    language: 'JavaScript',
    tagline: 'En regex-motor som ikke kan henge, målt mot nettleserens egen.',
    description:
      'Mønsteret parses og gjøres om til en automat som leser teksten nøyaktig en gang. Du kan se automaten, følge den tegn for tegn, og måle den mot nettleserens innebygde motor på mønstre som får den til å bruke eksponentiell tid.',
    tech: ['Automater', 'Parser', 'Differensiell testing', 'Web Workers'],
    challenge:
      'Vanlige regex-motorer prøver en vei om gangen og går tilbake når den ikke fører frem. På mønstre som (a+)+$ dobles kjøretiden for hvert tegn i teksten. Slike mønstre har tatt ned store nettsteder.',
    solution:
      'Motoren bygger en ikke-deterministisk automat (Thompsons konstruksjon) og holder rede på alle tilstandene den kan være i samtidig. Kjøretiden er lineær uansett mønster. Testene sammenligner motoren med V8 på 20\u00a0000 tilfeldige mønstre.',
    learned:
      'Differensiell testing: i stedet for å skrive fasiten selv, brukte jeg en motor som allerede er riktig. Da dekker testene kombinasjoner jeg aldri ville kommet på å skrive for hånd.',
  },
  {
    slug: 'nevralt',
    title: 'Nevralt',
    category: 'visualisering',
    language: 'JavaScript',
    tagline: 'Et nevralt nettverk som trener mens du ser på.',
    description:
      'Velg datasett, bygg nettverket lag for lag og se beslutningsgrensen forme seg i sanntid. Forover- og bakoverpropagering er skrevet for hånd, uten ML-bibliotek.',
    tech: ['Maskinlæring', 'Backpropagation', 'Canvas 2D', 'Typed Arrays'],
    challenge:
      'Nettverket skal trenes og beslutningsflaten tegnes for flere tusen punkter, 60 ganger i sekundet, uten at siden hakker.',
    solution:
      'Vektene ligger i Float64Array, treningen gjøres i små bolker per bilde, og beslutningsflaten rendres i lav oppløsning før den skaleres opp.',
    learned:
      'Gradientnedstigning sitter bedre når man har implementert kjerneregelen selv og kontrollert den mot numeriske gradienter.',
  },
  {
    slug: 'stifinner',
    title: 'Stifinner',
    category: 'visualisering',
    language: 'JavaScript',
    tagline: 'A*, Dijkstra og bredde først, side om side i samme labyrint.',
    description:
      'Tegn vegger og tungt terreng, generer labyrinter og sammenlign hvordan algoritmene utforsker rutenettet. Dra start eller mål etter et søk, og ruten regnes ut på nytt med en gang.',
    tech: ['Algoritmer', 'Prioritetskø', 'Canvas 2D'],
    challenge:
      'Algoritmene skal kunne animeres steg for steg, men også kjøres øyeblikkelig når brukeren drar start eller mål.',
    solution:
      'Hver algoritme er en ren funksjon som returnerer besøksrekkefølge og sti. Visningen velger selv om resultatet spilles av over tid eller tegnes direkte.',
    learned:
      'Verdien av å skille algoritme fra presentasjon, og hvordan heuristikken avgjør hvor mye A* må utforske.',
  },
];

/** Tekstene til "Slik er det bygget", som vises nederst på hver prosjektside. */
const BUILD = {
  raft: [
    { title: 'Algoritmen er skilt fra visningen', text: 'raft.js kjenner verken DOM, klokke eller nettverk. Simuleringen eier tiden og meldingene, og siden tegner bare øyeblikksbilder av tilstanden. Derfor kjører nøyaktig samme kode i testene og i nettleseren.' },
    { title: 'All tilfeldighet kommer fra ett frø', text: 'Valgfrister, forsinkelser og pakketap kommer fra en tilfeldighetsgenerator. Når en test feiler, oppgir den frøet, og kjøringen kan spilles av på nytt, tikk for tikk.' },
    { title: 'Testene fanger feil', text: 'Valgsikkerhet, lederfullstendighet, loggsamsvar og tilstandsmaskinsikkerhet kontrolleres fortløpende. En mutasjonstest slår av stemmeregelen og bekrefter at kontrollene oppdager det.' },
    { title: 'Ikke med', text: 'Loggkomprimering med snapshots og endring av klyngemedlemmer er ikke med. Begge er egne kapitler i Raft-artikkelen og ville vært neste steg.' },
  ],
  kvist: [
    { title: 'Fire steg, fire filer', text: 'Lekseren lager symboler, Pratt-parseren et syntakstre, kompilatoren bytekode, og stakkmaskinen kjører den. Hvert steg kan testes for seg.' },
    { title: 'Navn finnes ikke ved kjøring', text: 'Kompilatoren løser hver variabel til (dybde, plass): hvor mange funksjonsnivåer ut den bor, og hvilken plass den har der. En closure er bare en funksjon pluss en peker til omgivelsen den ble laget i.' },
    { title: 'Feilsøkeren fulgte med på kjøpet', text: 'Maskinen kan utføre en instruksjon om gangen og har all tilstand i åpne felt. Hver instruksjon bærer kildelinjen sin. Grensesnittet trenger derfor bare å lese stakken, kallstakken og variablene.' },
    { title: 'Ikke med', text: 'Variabler i en blokk deler funksjonens omgivelse, så closures laget i en løkke deler variabel. Språket har heller ingen egen minnehåndtering: det lener seg på JavaScript sin.' },
  ],
  sjakk: [
    { title: '0x88-brettet', text: 'Et felt er rad * 16 + linje. Da forteller en bitoperasjon (felt & 0x88) om et trekk havner utenfor brettet, uten kanttester.' },
    { title: 'Søket', text: 'Iterativ fordypning med alfa-beta, nullvindu for alle trekk etter det første, nulltrekk-beskjæring, reduserte sene trekk, hvilesøk og en transposisjonstabell med Zobrist-nøkler på 64 bit (to 32-bits tall).' },
    { title: 'Ingen allokering under søk', text: 'Trekklister, angrestakk og tabeller er forhåndsallokerte typed arrays. Et trekk er ett heltall. Det er dette som gir rundt en million stillinger i sekundet i ren JavaScript.' },
    { title: 'Ikke med', text: 'Evalueringen er enkel: materiell, brikke-felt-tabeller og løperpar. Motoren har ingen åpningsbok og ingen sluttspilltabeller, så den spiller taktisk godt og strategisk middels.' },
  ],
  'sql-lab': [
    { title: 'Ekte PostgreSQL', text: 'PGlite er PostgreSQL kompilert til WebAssembly. Datasettet lages med generate_series og et fast frø, så alle som åpner siden får de samme 40\u00a0000 turene.' },
    { title: 'Planen som et tre', text: 'EXPLAIN (ANALYZE, FORMAT JSON) gir et nøstet tre. Tiden i hver node er nodens total minus barnas, ganget med antall gjennomløp. Noden som bruker mest tid markeres, og estimater som bommer med en faktor ti flagges.' },
    { title: 'Databasen i egen tråd', text: 'PostgreSQL starter og fyller tabellene i en Web Worker, så siden kan brukes mens det skjer. Siden snakker med den gjennom et lite grensesnitt med de samme kallene som PGlite, exec og query.' },
    { title: 'En liten setningsdeler', text: 'For å vise planen etter en CREATE INDEX må teksten deles på semikolon uten å la seg lure av tekststrenger, kommentarer og $$-blokker. Den ligger i split.js og har egne tester.' },
  ],
  stromsmart: [
    { title: 'Samme Python-fil overalt', text: 'stromsmart.py bruker bare standardbiblioteket og har ingen sideeffekter. Den samme filen testes med unittest, kjøres fra terminalen og lastes uendret inn i nettleseren med Pyodide.' },
    { title: 'To ulike problemer', text: 'Et apparat som må gå sammenhengende: det billigste vinduet starter eller slutter alltid på en intervallgrense, så det holder å prøve dem. Lading som kan deles opp: fyll de billigste intervallene først, som er optimalt fordi timene er uavhengige.' },
    { title: 'JavaScript og Python snakker via JSON', text: 'Python kjører i en egen tråd (Web Worker), og JavaScript snakker med den gjennom en funksjon: JSON inn, JSON ut. Prisene vises med en gang, og planen kommer når Python har startet et par sekunder senere.' },
    { title: 'Et API i Java ved siden av', text: 'Planleggingen er også skrevet i Java, som et API med Spring Boot og PostgreSQL. Det henter prisene hver halvtime og lagrer dem. Siden spør API-et mens Python lastes ned, og viser svaret derfra hvis det kommer først. Testene bruker de samme tilfellene i begge språk, så de to regner likt.' },
  ],
  bro: [
    { title: 'Fagverk av fjærer', text: 'Knutepunktene har masse, og hver bjelke er en stiv fjær med demping som bare virker langs sin egen lengde. Leddene er frie. Derfor holder en trekant formen sin, mens en firkant klapper sammen, akkurat som i en ekte fagverksbru.' },
    { title: 'Små tidssteg', text: 'Stive fjærer og store tidssteg gir en simulering som eksploderer. Hvert bilde deles derfor i seksten delsteg med semi-implisitt Euler, og tyngden trappes opp det første halve sekundet så brua ikke får et slag.' },
    { title: 'Nivåene er bevist løsbare', text: 'Testene bygger en referansebru for hvert nivå og kjører hele simuleringen. De krever at den holder innenfor "par", at veidekket alene ryker, og at samme design alltid gir nøyaktig samme forløp.' },
    { title: 'Ikke med', text: 'Bjelkene knekker ikke ut til siden under trykk, og kjøretøyet er en punktlast som følger veien, ikke et legeme med hjul og fjæring. Begge deler hadde gjort fysikken mer realistisk, men spillet trenger det ikke.' },
  ],
  robot: [
    { title: 'Kvist kjører spillet', text: 'Koden du skriver, går gjennom den samme lekseren, parseren, kompilatoren og stakkmaskinen som i Kvist-prosjektet. Spillet legger bare til noen funksjoner: tre som flytter roboten, og sensorer som ser etter vegger og mål.' },
    { title: 'En kommando om gangen', text: 'Maskinen kjøres instruksjon for instruksjon til roboten har flyttet seg, og stopper der. Slik kan hver bevegelse animeres og linjen i programmet markeres. Et program som går i ring uten å flytte roboten, oppdages og stoppes.' },
    { title: 'Samme program på flere baner', text: 'De tre siste nivåene kjører programmet på tre ulike baner. Det skiller et program som teller ruter fra et som faktisk løser oppgaven, og er grunnen til at sensorene finnes.' },
    { title: 'Kortere er bedre', text: 'Stjernene avhenger av hvor mange symboler programmet består av. Å gjenta seg selv koster, mens løkker og funksjoner lønner seg. Testene løser hvert nivå med et referanseprogram og kontrollerer at det er innenfor "par".' },
  ],
  straale: [
    { title: 'Hele beregningen i en shader', text: 'Skjæring mellom stråle og kule, materialene og tilfeldighetsgeneratoren ligger i en fragmentshader. Hvert bilde legger en stråle per piksel til et løpende snitt i en flyttallstekstur, og to teksturer bytter på å være kilde og mål.' },
    { title: 'Sikte på sola', text: 'En tilfeldig sprett treffer nesten aldri en liten lyskilde. Matte flater sender derfor en egen stråle rett mot sola og sjekker om noe står i veien. For ikke å telle sollyset to ganger, regnes solskiva bare med for stråler som kommer via speil eller glass.' },
    { title: 'Tilfeldige tall og støy', text: 'Hver piksel har sin egen PCG-generator, sådd fra posisjon og bildenummer. Stråler som bærer lite lys avsluttes tilfeldig (russisk rulett), og ekstreme enkeltverdier dempes så de ikke blir stående som lyse prikker.' },
    { title: 'Ikke med', text: 'Scenen består av kuler, et gulv og fire vegger. Trekanter og en akselerasjonsstruktur (BVH) er det som mangler for å kunne vise vilkårlige modeller.' },
  ],
  samskriv: [
    { title: 'Identitet i stedet for posisjon', text: 'Algoritmen er RGA. Hvert tegn har en id (Lamport-teller, forfatter) og husker tegnet det ble satt inn etter. Ved innsetting går vi forbi alle tegn med høyere id, og stopper ved det første med lavere. Samme regel hos alle gir samme rekkefølge.' },
    { title: 'Tåler forsinkede og doble meldinger', text: 'En operasjon som viser til et tegn kopien ikke har sett ennå, legges på vent til tegnet kommer. Duplikater ignoreres. Rekkefølgen meldingene kommer i, spiller derfor ingen rolle.' },
    { title: 'Samme kode i simuleringen og mellom faner', text: 'Den samme crdt.js brukes av det simulerte nettverket øverst og av synkroniseringen mellom ekte faner (BroadcastChannel) nederst. CRDT-en vet ikke forskjellen.' },
    { title: 'Ikke med', text: 'Slettede tegn fjernes aldri, og tegnene ligger i en vanlig liste, så innsetting koster mer jo lengre teksten er. Det er fint for et notat, men en ekte editor ville trengt et tre og opprydding av gravsteiner.' },
  ],
  regex: [
    { title: 'Tre steg', text: 'Parseren (rekursiv nedstigning) lager et syntakstre. Kompilatoren gjør treet om til en automat med fem slags tilstander. Simuleringen leser teksten en gang og holder rede på alle tilstandene automaten kan være i.' },
    { title: 'Lengst til venstre, så lengst', text: 'Hvert forsøk husker hvor i teksten det startet, og tilstandene ligger sortert etter startpunkt. Møtes to forsøk i samme tilstand, vinner det tidligste. Slik finner ett gjennomløp både hvor treffet starter og hvor langt det rekker.' },
    { title: 'Fasit fra en annen motor', text: 'Testene lager tilfeldige mønstre og tekster og krever at motoren svarer det samme som V8. Selvtesten gjør det samme mot nettleseren du sitter i.' },
    { title: 'Ikke med', text: 'Tilbakereferanser og lookaround kan ikke uttrykkes som en endelig automat, og fangstgrupper er ikke med. Late kvantorer godtas, men gir samme treff som grådige.' },
  ],
  nevralt: [
    { title: 'Fra bunnen', text: 'Forover- og bakoverpropagering er skrevet for hånd over flate Float64Array-er. Ingenting allokeres under trening, så nettverket kan trenes mange ganger per bilde uten at siden hakker.' },
    { title: 'Kontrollert mot numeriske gradienter', text: 'Testen endrer en vekt om gangen ørlite, måler hvor mye tapet endrer seg, og sammenligner med gradienten fra bakoverpropageringen. Avviket er mindre enn en milliarddel.' },
    { title: 'Flaten tegnes grovt', text: 'Beslutningsflaten regnes ut i 72 x 72 punkter og skaleres opp med utjevning. Det ser likt ut, men koster en åttidel av å regne ut hver piksel.' },
  ],
  stifinner: [
    { title: 'En søkefunksjon', text: 'Dijkstra, A* og grådig søk deler kode og skiller seg bare i hvordan køen prioriteres: kostnad hittil, kostnad pluss anslått rest, eller bare anslått rest. Køen er en binær heap.' },
    { title: 'Algoritme og visning hver for seg', text: 'Søket er en ren funksjon som returnerer besøksrekkefølgen og stien. Visningen velger selv om resultatet spilles av steg for steg eller tegnes med en gang, for eksempel når du drar målet.' },
    { title: 'A* og Dijkstra finner like gode veier', text: 'A* og Dijkstra finner alltid like billige veier. Forskjellen ligger i hvor mye av kartet de må utforske, og den ser du direkte i tallene under rutenettet.' },
  ],
};
for (const project of projects) project.build = BUILD[project.slug] ?? [];

export const findProject = (slug) => projects.find((p) => p.slug === slug);
