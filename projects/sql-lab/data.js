/**
 * Skjema, data og eksempelspørringer for SQL-laben.
 * Stedsnavnene er ekte, men turene er laget med generate_series og et fast frø,
 * så alle får de samme tallene.
 */
export const SCHEMA_SQL = `
CREATE TABLE stasjon (
  id        int PRIMARY KEY,
  navn      text NOT NULL,
  bydel     text NOT NULL,
  kapasitet int  NOT NULL CHECK (kapasitet > 0)
);

CREATE TABLE medlem (
  id         int PRIMARY KEY,
  type       text NOT NULL CHECK (type IN ('sesong', 'måned', 'dag')),
  fodt_aar   int  NOT NULL,
  registrert date NOT NULL
);

CREATE TABLE tur (
  id           int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medlem_id    int NOT NULL REFERENCES medlem (id),
  fra_stasjon  int NOT NULL REFERENCES stasjon (id),
  til_stasjon  int NOT NULL REFERENCES stasjon (id),
  startet      timestamp NOT NULL,
  varighet_sek int NOT NULL CHECK (varighet_sek > 0)
);

INSERT INTO stasjon (id, navn, bydel, kapasitet) VALUES
  (1, 'Jernbanetorget', 'Sentrum', 30), (2, 'Aker Brygge', 'Sentrum', 27), (3, 'Youngstorget', 'Sentrum', 24),
  (4, 'Nationaltheatret', 'Sentrum', 24), (5, 'Olaf Ryes plass', 'Grünerløkka', 21), (6, 'Majorstuen', 'Frogner', 24),
  (7, 'Bislett stadion', 'St. Hanshaugen', 18), (8, 'Tøyenparken', 'Gamle Oslo', 18), (9, 'Bjørvika', 'Gamle Oslo', 27),
  (10, 'Birkelunden', 'Grünerløkka', 18), (11, 'Solli plass', 'Frogner', 15), (12, 'St. Hanshaugen park', 'St. Hanshaugen', 15),
  (13, 'Sofienbergparken', 'Grünerløkka', 18), (14, 'Frognerparken', 'Frogner', 21), (15, 'Grønlands torg', 'Gamle Oslo', 18),
  (16, 'Alexander Kiellands plass', 'St. Hanshaugen', 15), (17, 'Tjuvholmen', 'Sentrum', 18), (18, 'Carl Berners plass', 'Grünerløkka', 15),
  (19, 'Skøyen', 'Ullern', 18), (20, 'Sagene', 'Sagene', 12), (21, 'Torshov', 'Sagene', 12),
  (22, 'Ensjø', 'Gamle Oslo', 12), (23, 'Vigelandsparken sør', 'Frogner', 12), (24, 'Nydalen', 'Nordre Aker', 15);

SELECT setseed(0.42);

INSERT INTO medlem (id, type, fodt_aar, registrert)
SELECT n,
       (ARRAY['sesong', 'sesong', 'sesong', 'måned', 'måned', 'dag'])[1 + floor(random() * 6)::int],
       1955 + floor(random() * 52)::int,
       date '2023-03-01' + floor(random() * 900)::int
FROM generate_series(1, 3000) AS n;

-- 40 000 turer fra april til oktober 2025. Populære stasjoner og rushtid trekkes oftere.
INSERT INTO tur (medlem_id, fra_stasjon, til_stasjon, startet, varighet_sek)
SELECT 1 + floor(3000 * power(random(), 1.6))::int,
       f, t,
       date '2025-04-01' + floor(random() * 214)::int + make_interval(hours => h, mins => floor(random() * 60)::int),
       180 + abs(f - t) * 75 + floor(random() * 600)::int
FROM (
  SELECT 1 + floor(24 * power(random(), 1.7))::int AS f,
         1 + floor(24 * power(random(), 1.7))::int AS t,
         (ARRAY[7, 8, 8, 8, 9, 12, 13, 15, 16, 16, 16, 17, 17, 18, 19, 21, 23, 1, 10, 11, 14, 20, 6, 22])[1 + floor(random() * 24)::int] AS h
  FROM generate_series(1, 40000)
) AS s;

ANALYZE;
`;

export const EXAMPLES = [
  {
    title: 'Mest brukte startstasjoner',
    topic: 'JOIN og GROUP BY',
    sql: `SELECT s.navn,
       s.bydel,
       count(*) AS turer
FROM tur t
JOIN stasjon s ON s.id = t.fra_stasjon
GROUP BY s.id
ORDER BY turer DESC
LIMIT 10;`,
  },
  {
    title: 'Rushtid: hverdag mot helg',
    topic: 'FILTER og date_part',
    sql: `SELECT date_part('hour', startet)::int AS time,
       count(*) FILTER (WHERE extract(isodow FROM startet) < 6)  AS hverdag,
       count(*) FILTER (WHERE extract(isodow FROM startet) >= 6) AS helg
FROM tur
GROUP BY time
ORDER BY time;`,
  },
  {
    title: 'Topp tre stasjoner i hver bydel',
    topic: 'Vindusfunksjon: RANK',
    sql: `WITH per_stasjon AS (
  SELECT s.bydel, s.navn, count(*) AS turer
  FROM tur t
  JOIN stasjon s ON s.id = t.fra_stasjon
  GROUP BY s.bydel, s.navn
),
rangert AS (
  SELECT *, rank() OVER (PARTITION BY bydel ORDER BY turer DESC) AS plass
  FROM per_stasjon
)
SELECT bydel, plass, navn, turer
FROM rangert
WHERE plass <= 3
ORDER BY bydel, plass;`,
  },
  {
    title: 'Turer per uke med løpende sum',
    topic: 'CTE og SUM() OVER',
    sql: `WITH per_uke AS (
  SELECT date_trunc('week', startet)::date AS uke,
         count(*) AS turer
  FROM tur
  GROUP BY uke
)
SELECT uke,
       turer,
       sum(turer) OVER (ORDER BY uke) AS hittil,
       round(avg(turer) OVER (ORDER BY uke ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)) AS snitt_4_uker
FROM per_uke
ORDER BY uke;`,
  },
  {
    title: 'Stasjoner som tømmes',
    topic: 'To CTE-er og LEFT JOIN',
    sql: `-- Positiv netto betyr at flere sykler forlater stasjonen enn det kommer inn.
WITH ut AS (
  SELECT fra_stasjon AS id, count(*) AS antall FROM tur GROUP BY fra_stasjon
),
inn AS (
  SELECT til_stasjon AS id, count(*) AS antall FROM tur GROUP BY til_stasjon
)
SELECT s.navn,
       coalesce(ut.antall, 0)  AS ut,
       coalesce(inn.antall, 0) AS inn,
       coalesce(ut.antall, 0) - coalesce(inn.antall, 0) AS netto
FROM stasjon s
LEFT JOIN ut  ON ut.id = s.id
LEFT JOIN inn ON inn.id = s.id
ORDER BY netto DESC;`,
  },
  {
    title: 'Lengste rekke av sykkeldager',
    topic: 'Gaps and islands',
    sql: `-- Trekker du radnummeret fra datoen, får sammenhengende dager samme verdi.
WITH dager AS (
  SELECT DISTINCT medlem_id, startet::date AS dag
  FROM tur
),
grupper AS (
  SELECT medlem_id,
         dag,
         dag - (row_number() OVER (PARTITION BY medlem_id ORDER BY dag))::int AS gruppe
  FROM dager
)
SELECT medlem_id,
       min(dag) AS fra,
       max(dag) AS til,
       count(*) AS dager_paa_rad
FROM grupper
GROUP BY medlem_id, gruppe
ORDER BY dager_paa_rad DESC, fra
LIMIT 10;`,
  },
  {
    title: 'Median og persentiler for turlengde',
    topic: 'percentile_cont',
    sql: `SELECT m.type,
       count(*) AS turer,
       round(avg(t.varighet_sek) / 60.0, 1) AS snitt_min,
       round((percentile_cont(0.5)  WITHIN GROUP (ORDER BY t.varighet_sek) / 60)::numeric, 1) AS median_min,
       round((percentile_cont(0.95) WITHIN GROUP (ORDER BY t.varighet_sek) / 60)::numeric, 1) AS p95_min
FROM tur t
JOIN medlem m ON m.id = t.medlem_id
GROUP BY m.type
ORDER BY turer DESC;`,
  },
  {
    title: 'Følg strømmen fra Nydalen',
    topic: 'Rekursiv CTE og LATERAL',
    sql: `-- Start i Nydalen. Sykle hver gang dit flest andre sykler, men aldri til et sted du har vært.
WITH RECURSIVE rute AS (
  SELECT fra_stasjon, til_stasjon, count(*) AS turer
  FROM tur
  GROUP BY fra_stasjon, til_stasjon
),
reise AS (
  SELECT 1 AS stopp, id AS stasjon, ARRAY[id] AS besokt, NULL::bigint AS turer_hit
  FROM stasjon
  WHERE navn = 'Nydalen'
  UNION ALL
  SELECT r.stopp + 1, neste.til_stasjon, r.besokt || neste.til_stasjon, neste.turer
  FROM reise r
  CROSS JOIN LATERAL (
    SELECT til_stasjon, turer
    FROM rute
    WHERE fra_stasjon = r.stasjon
      AND til_stasjon <> ALL (r.besokt)
    ORDER BY turer DESC, til_stasjon
    LIMIT 1
  ) AS neste
  WHERE r.stopp < 8
)
SELECT r.stopp, s.navn, s.bydel, r.turer_hit
FROM reise r
JOIN stasjon s ON s.id = r.stasjon
ORDER BY r.stopp;`,
  },
  {
    title: 'Hva gjør en indeks?',
    topic: 'Vis planen før og etter CREATE INDEX',
    sql: `-- 1. Trykk "Vis plan". PostgreSQL må lese alle 40 000 radene (Seq Scan).
-- 2. Fjern "--" foran CREATE INDEX og trykk "Vis plan" igjen. Nå brukes indeksen.
-- CREATE INDEX IF NOT EXISTS tur_medlem_idx ON tur (medlem_id);

SELECT startet, fra_stasjon, til_stasjon, varighet_sek
FROM tur
WHERE medlem_id = 42
ORDER BY startet;`,
  },
];

/** Korte forklaringer til de vanligste nodene i en spørreplan. */
export const NODE_HELP = {
  'Seq Scan': 'Leser hele tabellen rad for rad.',
  'Index Scan': 'Slår opp radene via en indeks.',
  'Index Only Scan': 'Svarer rett fra indeksen uten å lese tabellen.',
  'Bitmap Heap Scan': 'Henter radene som bitmap-indekssøket pekte ut.',
  'Bitmap Index Scan': 'Samler treff fra indeksen i et bitmap.',
  'Hash Join': 'Slår opp i en hashtabell bygget av den ene siden.',
  'Hash': 'Bygger hashtabellen som joinen slår opp i.',
  'Merge Join': 'Fletter to sorterte innganger.',
  'Nested Loop': 'For hver rad i den ytre: slå opp i den indre.',
  'Sort': 'Sorterer radene.',
  'Incremental Sort': 'Sorterer bolker som allerede er delvis sortert.',
  'Aggregate': 'Regner ut aggregatene (count, sum, avg...).',
  'HashAggregate': 'Grupperer med en hashtabell.',
  'GroupAggregate': 'Grupperer sorterte rader.',
  'WindowAgg': 'Regner ut vindusfunksjonene.',
  'Limit': 'Stopper etter de første radene.',
  'CTE Scan': 'Leser resultatet av en WITH-spørring.',
  'Subquery Scan': 'Leser resultatet av en delspørring.',
  'Unique': 'Fjerner duplikater.',
  'Result': 'Returnerer en konstant eller et uttrykk.',
  'Materialize': 'Mellomlagrer radene for gjenbruk.',
};
