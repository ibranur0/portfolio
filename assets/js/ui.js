/** Delte hjelpefunksjoner for forsiden og alle prosjekt-appene. */

/** Lager et DOM-element. Tekst settes alltid via textContent (aldri innerHTML). */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

/**
 * Som replaceChildren, men hopper over false, null og undefined.
 * Da kan jeg skrive "betingelse && element" uten at det står "false" på siden.
 */
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

/** Lagring med JSON. Feiler stille i privat modus eller når lagring er blokkert. */
const storage = (name) => ({
  get(key, fallback) {
    try {
      const raw = window[name].getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { window[name].setItem(key, JSON.stringify(value)); } catch { /* ignorer */ }
  },
});

/** Huskes til neste besøk. */
export const store = storage('localStorage');
/** Huskes bare så lenge fanen er åpen. */
export const session = storage('sessionStorage');

/** Setter inn tekst ved markøren i et tekstfelt, slik at Ctrl+Z fortsatt virker. */
export function insertText(field, text) {
  field.focus();
  if (!document.execCommand?.('insertText', false, text)) {
    field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Leser en CSS-variabel fra :root (brukes av canvas-tegning). */
export const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

/** Kobler en knapp til temabytte. Sender "themechange" slik at canvas kan tegne på nytt. */
export function initThemeToggle(button) {
  const root = document.documentElement;
  const render = () => {
    const dark = root.dataset.theme !== 'light';
    button.innerHTML = dark ? ICON_SUN : ICON_MOON; // statiske ikoner, ingen brukerdata
    button.setAttribute('aria-label', dark ? 'Bytt til lyst tema' : 'Bytt til mørkt tema');
    button.title = button.getAttribute('aria-label');
  };
  button.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('theme', root.dataset.theme); } catch { /* ignorer */ }
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => { meta.content = cssVar('--bg'); });
    render();
    window.dispatchEvent(new CustomEvent('themechange'));
  });
  render();
}

export const ICON_GITHUB =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z"/></svg>';

/** Lager "Slik er det bygget"-delen for et prosjekt. */
export function buildNotes(project, heading = 'h2') {
  return el('section', { class: 'build-notes' },
    el(heading, { class: 'build-heading', text: 'Slik er det bygget' }),
    el('div', { class: 'build-grid' }, project.build.map((note) =>
      el('article', { class: note.title === 'Ikke med' ? 'left-out' : '' },
        el(heading === 'h2' ? 'h3' : 'h4', { text: note.title }), el('p', { text: note.text })))));
}

/** Fyller en <dialog> med case-beskrivelsen for et prosjekt. */
export function fillCaseDialog(dialog, project, { sourceUrl, appUrl } = {}) {
  const row = (label, text) =>
    el('div', { class: 'case-row' }, el('dt', { text: label }), el('dd', { text }));
  const source = sourceUrl
    ? el('a', { class: 'btn btn-ghost', href: sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Kildekode på GitHub ↗' })
    : null;
  const open = appUrl ? el('a', { class: 'btn btn-primary', href: appUrl, text: 'Åpne appen →' }) : null;

  fill(dialog,
    el('form', { method: 'dialog', class: 'dialog-head' },
      el('div', {},
        el('p', { class: 'eyebrow', text: 'Om prosjektet' }),
        el('h2', { class: 'dialog-title', id: 'case-title', text: project.title }),
      ),
      el('button', { class: 'icon-btn', 'aria-label': 'Lukk', text: '✕' }),
    ),
    el('p', { class: 'dialog-lead', text: project.description }),
    el('ul', { class: 'tags' }, project.tech.map((t) => el('li', { text: t }))),
    el('dl', { class: 'case' },
      row('Utfordring', project.challenge),
      row('Løsning', project.solution),
      row('Lærdom', project.learned),
    ),
    project.build?.length ? buildNotes(project, 'h3') : null,
    el('div', { class: 'dialog-actions' }, open, source),
  );
}

/** Lukker en <dialog> når man klikker på bakteppet. */
export function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if (outside) dialog.close();
  });
}
