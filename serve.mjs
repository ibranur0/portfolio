// Enkel lokal server: node serve.mjs [port] [--lan]
//
// Uten --lan svarer den bare på denne maskinen. Med --lan kan en telefon
// på samme nett åpne siden via maskinens IP-adresse.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const args = process.argv.slice(2);
const port = Number(args.find((a) => /^\d+$/.test(a))) || 8000;
const lan = args.includes('--lan');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.py': 'text/plain; charset=utf-8', '.png': 'image/png', '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

createServer((req, res) => {
  let path;
  try {
    path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; } // ikke ut av mappen

  let stat;
  try {
    stat = statSync(path);
    if (stat.isDirectory()) { path = join(path, 'index.html'); stat = statSync(path); }
  } catch {
    // Samme oppførsel som GitHub Pages og Netlify: 404.html med statuskode 404.
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    createReadStream(join(root, '404.html')).on('error', () => res.end('Fant ikke filen')).pipe(res);
    return;
  }

  const headers = {
    'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    // Ingenting lagres i nettleseren, så endringer vises med en gang (også i Safari på iPhone).
    'Cache-Control': 'no-store',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end(); else createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') res.end(); else createReadStream(path).pipe(res);
}).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Porteføljen kjører på http://127.0.0.1:${port}/`);
  if (!lan) return;
  // Adressene andre enheter på nettverket kan bruke (bare IPv4, uten interne adresser).
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) console.log(`På samme nettverk: http://${net.address}:${port}/`);
    }
  }
});
