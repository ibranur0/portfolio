# Portefølje

Her ligger prosjektene jeg har laget og samlet på en nettside. Alle kan prøves rett i nettleseren. Siden er skrevet i HTML, CSS og JavaScript uten rammeverk, og den har ikke noe byggesteg.

## Prosjektene

**Raft**

En simulering av Raft, algoritmen som får flere servere til å bli enige om de samme dataene selv om noen av dem krasjer. Du kan slå av servere og dele nettverket og se hva som skjer. Testene kjører tusenvis av tilfeldige feilforløp og sjekker at ingen bekreftede data går tapt.

**Kvist**

Et lite programmeringsspråk jeg har laget selv, med funksjoner, closures og lister. Koden blir oversatt til bytekode og kjørt i en stakkmaskin, og du kan gå gjennom programmet steg for steg og se stakken og variablene.

**Sjakk**

En sjakkmotor du kan spille mot. Den bruker alfa-beta-søk med iterativ fordypning og transposisjonstabell, og viser hva den regner på mens den tenker. Trekkgeneratoren er sjekket med perft.

**SQL-lab**

En PostgreSQL-database som kjører i nettleseren med PGlite. Du kan skrive spørringer og se spørreplanen tegnet som et tre, for eksempel hva en indeks gjør med den.

**Strømsmart**

Henter dagens strømpriser og finner ut når det er billigst å lade elbilen eller kjøre oppvaskmaskinen. Utregningen er skrevet i Python og kjører i nettleseren med Pyodide. Jeg har også laget den som et [API i Java](https://github.com/ibranur0/stromsmart-api) med Spring Boot og PostgreSQL.

**Bro**

Et spill der du bygger en bru som må tåle trafikken, for minst mulig penger. Fysikken har jeg skrevet selv: brua er et fagverk av stive fjærer, og en bjelke ryker når kraften blir for stor.

**Robot**

Et spill der du programmerer en robot gjennom en bane. Programmene skrives i Kvist og kjøres av den samme kompilatoren og maskinen som i Kvist-prosjektet.

**Stråle**

En strålesporer som kjører i en GLSL-shader på WebGL 2. Den regner ut hvordan lyset spretter mellom kuler av glass og metall, og bildet blir renere jo lenger den får stå.

**Samskriv**

Viser hvordan flere kan skrive i samme tekst samtidig uten en server som bestemmer, og likevel ende opp med samme tekst. Det er en CRDT av typen RGA, og den synkroniserer også på ordentlig mellom faner i nettleseren.

**Regex**

En regex-motor som ikke kan henge seg opp, uansett hvilket mønster den får. Mønsteret blir gjort om til en automat som leser teksten en gang. Du kan måle den mot nettleserens egen motor.

**Nevralt**

Et lite nevralt nettverk skrevet uten biblioteker. Det lærer å skille to grupper med punkter mens du ser på.

**Stifinner**

Viser hvordan A*, Dijkstra og noen andre algoritmer leter seg frem til målet i samme labyrint.

## Kjøre siden lokalt

Siden trenger bare en enkel filserver. Det ligger en i repoet:

```bash
node serve.mjs 8000
```

## Tester

Testene kjøres automatisk her på GitHub ved hver push. De kan også kjøres for hånd, ett prosjekt om gangen:

```bash
node projects/raft/test.mjs
node projects/kvist/test.mjs
node projects/regex/test.mjs
node projects/samskriv/test.mjs
node projects/bro/test.mjs
node projects/robot/test.mjs
node projects/nevralt/test.mjs
cd projects/stromsmart && python -m unittest test_stromsmart
```

Noen av dem kjører også i nettleseren, på siden `/tester/`.

## Lisenser

Fontene er Instrument Serif, Geist og JetBrains Mono (SIL Open Font License). PGlite og Pyodide lastes fra jsDelivr og har sine egne lisenser.
