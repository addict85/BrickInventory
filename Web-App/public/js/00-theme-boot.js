// ═══ Theme-Boot ═══════════════════════════════════════════════════════════
// Läuft als blockierendes Skript im <head>, also VOR dem ersten Paint — und
// bewusst vor 01-core.js.
//
// Vorher wurde applyTheme() ausschliesslich aus showApp() heraus aufgerufen,
// also erst NACH erfolgreichem Login. Login- und Startup-Screen bekamen
// dadurch nie ein data-theme und blieben im Standard-Design, obwohl das Design
// global (global_settings.app_theme) für alle gilt.
//
// Zwei Stufen, damit es weder blinkt noch veraltet:
//   1. Sofort: der zuletzt bekannte Wert aus localStorage. Kein Netzwerk, kein
//      Aufblitzen des falschen Designs.
//   2. Gleich danach asynchron: GET /api/v1/settings/theme (öffentlich, siehe
//      routes/settings.ts). Weicht der Serverwert ab — anderer Browser, anderes
//      Gerät, Admin hat gerade umgestellt — wird korrigiert und gecacht.
//
// Der Cache-Key ist bewusst nicht nutzerbezogen: Das Design ist eine globale
// Einstellung, kein persönliches Merkmal.

(function () {
  var KEY = 'bim_theme';
  var ALLOWED = ['classic', 'brick'];

  /**
   * Wendet ein Design an. Unbekannte Werte (null, '', undefined) bedeuten
   * "keine Information" und ändern NICHTS.
   *
   * Vorher fielen sie auf 'classic' zurück. Das war die Ursache des Flackerns
   * beim Login: showApp() ruft applyTheme(d.settings.app_theme) auf, und wenn
   * dieser Wert fehlte oder leer war, schaltete die Seite sichtbar von 'brick'
   * auf 'classic' zurück — und schrieb 'classic' obendrein in den Cache, sodass
   * der nächste Seitenaufruf schon falsch startete und beim Server-Abgleich
   * erneut umsprang.
   */
  function apply(theme) {
    if (ALLOWED.indexOf(theme) === -1) return null;
    document.documentElement.setAttribute('data-theme', theme);
    return theme;
  }

  /**
   * Setter für 01-core.js und den Admin-Speichern-Handler. Nur gültige Werte
   * werden angewendet UND gecacht — ein leerer oder fehlender Wert darf den
   * Cache nicht überschreiben.
   */
  function applier(theme) {
    var val = apply(theme);
    if (!val) return null;
    try { localStorage.setItem(KEY, val); } catch (_) {}
    return val;
  }

  // 0) Hat der Server data-theme schon gesetzt (utils/indexHtml.ts), ist das
  //    der autoritative Wert zum Zeitpunkt des Ladens. Dann nur noch den Cache
  //    nachführen — kein Anwenden, kein Abgleich, also weder ein sichtbarer
  //    Sprung noch eine zusätzliche Anfrage pro Seitenaufruf.
  var served = document.documentElement.getAttribute('data-theme');
  if (ALLOWED.indexOf(served) !== -1) {
    try { localStorage.setItem(KEY, served); } catch (_) {}
    window.__bimApplyTheme = applier;
    return;
  }

  // 1) Fallback, wenn der Server nichts gesetzt hat (statisch ausgelieferte
  //    Datei, vorgelagerter Cache, Renderfehler): zuletzt bekanntes Design
  //    sofort anwenden, danach gegen den Server abgleichen.
  var cached = null;
  try { cached = localStorage.getItem(KEY); } catch (_) {}
  apply(cached);

  // 2) Serverwert nachziehen
  function sync() {
    fetch('/api/v1/settings/theme', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.success || !d.theme) return;
        if (d.theme !== cached) {
          apply(d.theme);
          try { localStorage.setItem(KEY, d.theme); } catch (_) {}
        }
      })
      .catch(function () { /* offline oder Server startet noch — Cache bleibt gültig */ });
  }

  // Der Server nimmt Anfragen erst nach initSchemaOnce() an; ein Fehlschlag hier
  // ist unkritisch, weil checkAuth() ohnehin auf den Startup wartet und
  // applyTheme() nach dem Login den Serverwert erneut setzt.
  sync();

  window.__bimApplyTheme = applier;
})();
