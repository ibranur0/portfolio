/**
 * Rammen rundt alle prosjektsidene: topplinje, tilbakelenke, "Om prosjektet" og temaknapp.
 * Siden sier hvilket prosjekt den er med <body data-project="slug">.
 */
import { githubSource } from './site.config.js';
import { findProject } from './projects.js';
import { el, initThemeToggle, fillCaseDialog, buildNotes, closeOnBackdrop, ICON_GITHUB } from './ui.js';
import './stats.js';

const project = findProject(document.body.dataset.project);
const home = '../../';

const dialog = el('dialog', { id: 'case-dialog', 'aria-labelledby': 'case-title' });
closeOnBackdrop(dialog);

const themeButton = el('button', { class: 'icon-btn', type: 'button' });
const sourceUrl = githubSource(project.slug); // null til GitHub-brukernavnet er fylt inn i site.config.js
const source = sourceUrl && el('a', {
  class: 'icon-btn', href: sourceUrl, target: '_blank', rel: 'noopener noreferrer',
  'aria-label': 'Kildekode på GitHub', title: 'Kildekode på GitHub',
});
if (source) source.innerHTML = ICON_GITHUB; // statisk ikon

const bar = el('header', { class: 'app-bar' },
  el('a', { class: 'app-back', href: `${home}#prosjekter`, 'aria-label': 'Tilbake til porteføljen' },
    el('span', { class: 'arrow', 'aria-hidden': 'true', text: '←' }),
    el('span', { text: 'Portefølje' })),
  el('p', { class: 'app-name', text: project.title }),
  el('div', { class: 'app-bar-actions' },
    el('button', {
      class: 'btn btn-ghost btn-small', type: 'button', text: 'Om prosjektet',
      onclick: () => {
        fillCaseDialog(dialog, project, { sourceUrl });
        dialog.showModal();
      },
    }),
    source,
    themeButton,
  ),
);

document.body.prepend(
  el('a', { class: 'skip-link', href: '#app', text: 'Hopp til appen' }),
  bar,
);
document.body.append(dialog);
// De tekniske valgene står nederst på siden, etter selve appen.
if (project.build?.length) document.querySelector('main.app')?.append(buildNotes(project));
initThemeToggle(themeButton);
