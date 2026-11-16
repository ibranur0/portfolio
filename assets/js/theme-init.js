// Kjøres synkront i <head> for å unngå blink av feil tema ved lasting.
(function () {
  var stored = null;
  try { stored = localStorage.getItem('theme'); } catch (e) {}
  var theme = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.add('js');
  // Appene bygger mye med JavaScript. Klassen ready settes når skriptene er ferdige,
  // og app.css viser ikke appen før det, så den ikke hopper mens den bygges.
  document.addEventListener('DOMContentLoaded', function () { document.documentElement.classList.add('ready'); });
  // Nettleserlinjen på mobil skal ha samme farge som siden, også når temaet er valgt for hånd.
  if (stored) {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].content = theme === 'light' ? '#f3f5f2' : '#0a0c0b';
  }
})();
