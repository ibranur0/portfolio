/**
 * Besøksstatistikk med GoatCounter, uten informasjonskapsler.
 * Jeg sender kallet selv, så siden slipper å laste et skript fra et annet domene.
 *
 * Besøk fra min egen maskin og fra tester telles ikke. Åpner jeg siden med #ikke-tell
 * i adressen, telles ikke besøkene mine der heller (#tell slår det på igjen).
 */
import { site } from './site.config.js';
import { store } from './ui.js';
import { findProject } from './projects.js';

const OFF_KEY = 'stats:av';

if (location.hash === '#ikke-tell' || location.hash === '#tell') {
  store.set(OFF_KEY, location.hash === '#ikke-tell');
  history.replaceState(null, '', location.pathname + location.search);
}

const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]$)/.test(location.hostname) || location.protocol === 'file:';
const enabled = Boolean(site.goatcounter) && !local && !navigator.webdriver && !store.get(OFF_KEY, false);

function send(params) {
  if (!enabled) return;
  const url = `https://${site.goatcounter}.goatcounter.com/count?${new URLSearchParams({ ...params, rnd: Math.random().toString(36).slice(2) })}`;
  try {
    if (!navigator.sendBeacon?.(url)) fetch(url, { method: 'POST', keepalive: true, mode: 'no-cors' }).catch(() => {});
  } catch { /* statistikk skal aldri kunne ødelegge siden */ }
}

/** Adressen besøket kom fra, men bare når det er en annen side enn denne. */
function referrer() {
  try {
    return document.referrer && new URL(document.referrer).host !== location.host ? document.referrer : '';
  } catch {
    return '';
  }
}

/** Teller en handling, for eksempel at noen kopierte e-postadressen. */
export function countEvent(name, title = name) {
  send({ p: name, t: title, e: 'true' });
}

// Sidevisningen telles når filen lastes.
send({ p: location.pathname, t: document.title, r: referrer(), s: [screen.width, screen.height, window.devicePixelRatio || 1].join(',') });

// Teller også klikk på GitHub-lenker og e-postadressen.
document.addEventListener('click', (e) => {
  const link = e.target.closest?.('a[href]');
  if (!link) return;
  if (link.protocol === 'mailto:') countEvent('e-post', 'Klikket på e-postadressen');
  else if (link.hostname === 'github.com') {
    const project = /\/projects\/([\w-]+)/.exec(link.pathname)?.[1];
    countEvent(project ? `github-${project}` : 'github-profil', project ? `Kildekoden til ${findProject(project)?.title ?? project}` : 'GitHub-profilen');
  }
});
