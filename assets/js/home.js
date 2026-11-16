import { site, githubProfile, githubSource } from './site.config.js';
import { projects, categories, findProject } from './projects.js';
import { projectArt } from './art.js';
import {
  el, session, cssVar, prefersReducedMotion,
  initThemeToggle, fillCaseDialog, closeOnBackdrop, ICON_GITHUB,
} from './ui.js';
import { countEvent } from './stats.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const appUrl = (slug) => `projects/${slug}/`;

/* ---------- Innhold fra konfigurasjonen ---------- */
function bindConfig() {
  $$('[data-cfg]').forEach((node) => {
    const value = site[node.dataset.cfg];
    if (typeof value === 'string') node.textContent = value;
  });
  // Uten GitHub-brukernavn i konfigurasjonen skjules alt som viser dit.
  const profile = githubProfile();
  $$('[data-href="github"]').forEach((a) => { if (profile) a.href = profile; else a.hidden = true; });
  if (!profile) $$('[data-needs="github"]').forEach((node) => { node.hidden = true; });

  $('#about-text').replaceChildren(...site.about.map((t) => el('p', { text: t })));
  $('#about-languages').textContent = site.languages.join(', ').replace(/, (\S)/g, (_, c) => `, ${c.toLowerCase()}`);
  $('#year').textContent = new Date().getFullYear();

  $('#skills').replaceChildren(...site.skills.map((group) =>
    el('section', { class: 'skill-group' },
      el('h3', { class: 'eyebrow', text: group.group }),
      el('ul', {}, group.items.map((item) => {
        const project = item.project && findProject(item.project);
        return el('li', {}, project
          ? el('a', { href: appUrl(project.slug) }, el('span', { text: item.name }), el('span', { class: 'skill-where', text: project.title }))
          : el('span', {}, el('span', { text: item.name }), item.note && el('span', { class: 'skill-where', text: item.note })));
      })),
    )));
}

/* ---------- Kontakt ---------- */
function initContact() {
  const mail = $('#mail-link');
  mail.href = `mailto:${site.email}`;
  mail.textContent = site.email;

  const copy = $('#copy-mail');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(site.email);
      copy.textContent = 'Kopiert';
      countEvent('kopier-e-post', 'Kopierte e-postadressen');
    } catch {
      copy.textContent = 'Kunne ikke kopiere';
    }
    setTimeout(() => { copy.textContent = 'Kopier'; }, 1800);
  });

  const links = [
    githubProfile() && { label: 'GitHub', href: githubProfile() },
  ].filter(Boolean);
  $('#contact-links').replaceChildren(...links.map((link) =>
    el('li', {},
      el('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer' },
        el('span', { text: link.label }),
        el('span', { 'aria-hidden': 'true', text: '↗' })),
    )));
}

/* ---------- Prosjektgalleri ---------- */
function projectCard(project, dialog) {
  const art = el('div', { class: 'card-art' });
  art.innerHTML = projectArt(project.slug); // fast SVG fra art.js, ingen brukerdata

  const sourceUrl = githubSource(project.slug);
  const source = sourceUrl && el('a', {
    class: 'icon-btn card-source', href: sourceUrl,
    target: '_blank', rel: 'noopener noreferrer',
    'aria-label': `Kildekode for ${project.title} på GitHub`, title: 'Kildekode',
  });
  if (source) source.innerHTML = ICON_GITHUB; // statisk ikon

  const card = el('article', { class: 'card reveal', dataset: { category: project.category } },
    art,
    el('div', { class: 'card-body' },
      el('p', { class: 'eyebrow card-meta', text: `${categories[project.category]} · ${project.language}` }),
      el('h3', { class: 'card-title' },
        el('a', { class: 'card-link', href: appUrl(project.slug), text: project.title })),
      el('p', { class: 'card-tagline', text: project.tagline }),
      el('ul', { class: 'tags' }, project.tech.map((t) => el('li', { text: t }))),
      el('div', { class: 'card-foot' },
        el('span', { class: 'card-open', 'aria-hidden': 'true' }, 'Åpne ', el('span', { class: 'arrow', text: '→' })),
        el('div', { class: 'card-actions' },
          el('button', {
            class: 'btn btn-ghost btn-small', type: 'button', text: 'Detaljer',
            'aria-label': `Les mer om ${project.title}`,
            onclick: () => {
              fillCaseDialog(dialog, project, { sourceUrl, appUrl: appUrl(project.slug) });
              dialog.showModal();
            },
          }),
          source,
        ),
      ),
    ),
  );

  // Lyskjegle som følger pekeren
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
  return card;
}

function initProjects() {
  const dialog = $('#case-dialog');
  closeOnBackdrop(dialog);
  // Alle kortene er like store. Den lange beskrivelsen ligger under "Detaljer".
  $('#project-grid').replaceChildren(...projects.map((p, i) => {
    const card = projectCard(p, dialog);
    card.style.setProperty('--delay', `${(i % 3) * 70}ms`); // kortene i samme rad fases inn etter hverandre
    card.style.viewTransitionName = `kort-${p.slug}`;       // lar kortene gli til ny plass når filteret endres
    return card;
  }));

  const used = [...new Set(projects.map((p) => p.category))];
  const filters = [['alle', 'Alle'], ...used.map((key) => [key, categories[key]])];
  const bar = $('#filters');
  const cards = $$('.card');

  const apply = (active, animate = true) => {
    $$('button', bar).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === active)));
    const update = () => {
      cards.forEach((card) => { card.hidden = active !== 'alle' && card.dataset.category !== active; });
    };
    if (animate && document.startViewTransition && !prefersReducedMotion()) document.startViewTransition(update);
    else update();
    session.set('portfolio:filter', active);
  };

  bar.replaceChildren(...filters.map(([key, label]) => {
    const count = key === 'alle' ? projects.length : projects.filter((p) => p.category === key).length;
    return el('button', { class: 'chip', type: 'button', dataset: { filter: key }, 'aria-pressed': 'false', onclick: () => apply(key) },
      label, el('span', { class: 'chip-count', text: String(count) }));
  }));
  // Filteret huskes mens du er inne på siden, men starter på "Alle" neste gang.
  const saved = session.get('portfolio:filter', 'alle');
  apply(filters.some(([key]) => key === saved) ? saved : 'alle', false);
}

/* ---------- Navigasjon ---------- */
function initNav() {
  const nav = $('#nav');
  const burger = $('#nav-burger');
  const links = $$('#nav-links a');

  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Lukk meny' : 'Åpne meny');
  };
  burger.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  links.forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Marker aktiv seksjon i menyen
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach((a) => a.removeAttribute('aria-current'));
      byId.get(entry.target.id)?.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  byId.forEach((_, id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
}

/* ---------- Innfasing ved scroll ---------- */
function initReveal() {
  const items = $$('.reveal');
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((n) => n.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((n) => io.observe(n));
}

/* ---------- Hero: punktfelt som reagerer på pekeren ---------- */
function initHeroCanvas() {
  const canvas = $('#hero-canvas');
  const ctx = canvas.getContext('2d');
  const hero = canvas.parentElement;
  const GAP = 30;
  const RADIUS = 170;
  let w = 0, h = 0, dpr = 1;
  let colors = {};
  const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999 };
  let visible = true;
  let raf = 0;

  const readColors = () => { colors = { dot: cssVar('--line-strong'), accent: cssVar('--accent') }; };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = hero.clientWidth; h = hero.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = (time) => {
    pointer.x += (pointer.tx - pointer.x) * 0.14;
    pointer.y += (pointer.ty - pointer.y) * 0.14;
    ctx.clearRect(0, 0, w, h);
    const t = time / 1000;
    for (let y = GAP / 2; y < h; y += GAP) {
      for (let x = GAP / 2; x < w; x += GAP) {
        const dx = x - pointer.x, dy = y - pointer.y;
        const dist = Math.hypot(dx, dy);
        const pull = Math.max(0, 1 - dist / RADIUS);
        const wave = 0.5 + 0.5 * Math.sin(x * 0.012 + y * 0.018 + t * 0.9);
        const push = pull * pull * 16;
        const px = x + (dist ? (dx / dist) * push : 0);
        const py = y + (dist ? (dy / dist) * push : 0);
        if (pull > 0.02) {
          ctx.globalAlpha = 0.35 + pull * 0.65;
          ctx.fillStyle = colors.accent;
          ctx.beginPath(); ctx.arc(px, py, 1.1 + pull * 2.2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.globalAlpha = 0.45 + wave * 0.55;
          ctx.fillStyle = colors.dot;
          ctx.fillRect(px - 1, py - 1, 2, 2);
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  const loop = (time) => {
    draw(time);
    raf = visible ? requestAnimationFrame(loop) : 0;
  };
  const start = () => {
    if (prefersReducedMotion()) { draw(0); return; }
    if (!raf) raf = requestAnimationFrame(loop);
  };

  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    pointer.tx = e.clientX - r.left; pointer.ty = e.clientY - r.top;
    if (prefersReducedMotion()) { pointer.x = pointer.tx; pointer.y = pointer.ty; draw(0); }
  });
  hero.addEventListener('pointerleave', () => { pointer.tx = -9999; pointer.ty = -9999; });
  window.addEventListener('resize', () => { resize(); if (prefersReducedMotion()) draw(0); });
  window.addEventListener('themechange', () => { readColors(); if (prefersReducedMotion()) draw(0); });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
  }).observe(hero);

  readColors();
  resize();
  start();
}

/* ---------- Oppstart ---------- */
bindConfig();
initThemeToggle($('#theme-toggle'));
initNav();
initProjects();
initContact();
initReveal();
initHeroCanvas();
