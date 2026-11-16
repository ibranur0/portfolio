// Setter adressen til siden inn på alle sidene: node domene.mjs https://ditt-domene.no/
//
// Delingsbildet må ha full adresse for å vises når lenken deles.
// Skriptet lager også sitemap.xml og oppdaterer robots.txt.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg || !/^https?:\/\//.test(arg)) {
  console.error('Bruk: node domene.mjs https://ditt-domene.no/   (eller https://brukernavn.github.io/repo/)');
  process.exit(1);
}
const base = arg.endsWith('/') ? arg : `${arg}/`;

// Forsiden, selvtesten og hvert prosjekt. Hver side har sitt eget delingsbilde.
const pages = [
  { dir: '', image: 'assets/og.png' },
  { dir: 'tester/', image: 'assets/og.png' },
  ...readdirSync(join(root, 'projects'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, 'projects', d.name, 'index.html')))
    .map((d) => ({ dir: `projects/${d.name}/`, image: `assets/og/${d.name}.png` })),
];

const setTag = (html, pattern, tag, after) => {
  if (pattern.test(html)) return html.replace(pattern, tag);
  return html.replace(after, (line) => `${line}\n  ${tag}`);
};

for (const page of pages) {
  const file = join(root, page.dir, 'index.html');
  let html = readFileSync(file, 'utf8');
  const url = base + page.dir;
  const image = base + page.image;
  const description = /<meta name="description"[^>]*>/;
  html = setTag(html, /<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}">`, description);
  html = setTag(html, /<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${url}">`, description);
  html = setTag(html, /<meta property="og:image" [^>]*>/, `<meta property="og:image" content="${image}">`, /<meta property="og:locale"[^>]*>/);
  html = html.replace(/("@type": "Person",)(\n\s*"url": "[^"]*",)?/, `$1\n    "url": "${base}",`);
  writeFileSync(file, html);
  console.log(url);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${base + p.dir}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
writeFileSync(join(root, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}sitemap.xml\n`);
console.log(`\nOppdaterte ${pages.length} sider, sitemap.xml og robots.txt for ${base}`);
