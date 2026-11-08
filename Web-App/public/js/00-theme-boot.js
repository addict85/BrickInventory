// Läuft blockierend im <head>, vor dem ersten Paint: Auch Anmelde- und Startseite tragen so sofort das
// richtige Design. Erst der letzte bekannte Wert, dann der Abgleich mit dem Server — so blinkt nichts und
// nichts veraltet.
// Ausführlich: docs/begruendungen/public/js/00-theme-boot.js.md#laeuft-als-blockierendes-skript-im-head

(function () {
  var KEY = 'bim_theme';
  // Muss mit DESIGNS in src/konto/settings.ts uebereinstimmen — eine Pruefung haelt beide zusammen
  // (theme.test.js).
  var ALLOWED = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

  /**
   * Wendet ein Design an. Ein leerer Wert heisst „keine Auskunft“ und ändert nichts: Ein Rückfall auf classic
   * liess die Seite beim Anmelden umspringen und schrieb den falschen Wert in den Cache.
   * Ausführlich: docs/begruendungen/public/js/00-theme-boot.js.md#apply
   * @param {string | null | undefined} theme
   */
  function apply(theme) {
    if (!theme || ALLOWED.indexOf(theme) === -1) return null;
    serverDesign = theme;
    document.documentElement.setAttribute('data-theme', wirksam(theme));
    return theme;
  }

  // ── Dunkel nach System, je Gerät (Profil-Einstellungen) ────────────────────
  // Ob ein GERÄT dunkel will, weiss nur das Gerät. Vorgabe ist „system“: Bei dunklem System die dunkle
  // Variante DESSELBEN Designs (data-dunkel, Farben aus tokens.css). Wer „server“ wählt, behält das Design
  // ohne Variante.
  var DUNKEL_KEY = 'bim_dunkel';
  var systemDunkel = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  /** @type {string | null} */
  var serverDesign = null;
  /** 'system', 'server' (nie dunkel) oder 'immer'. */
  function wahl() {
    try { var w = localStorage.getItem(DUNKEL_KEY); return w === 'server' || w === 'immer' ? w : 'system'; } catch (_) { return 'system'; }
  }
  /** @param {string} theme */
  function wirksam(theme) {
    var w = wahl();
    // „Immer dunkel“ auch bei hellem System: Sonst bekam den Dunkelmodus nur, wer Werkbank wählte.
    var dunkel = theme !== 'werkbank' && (w === 'immer' || (w === 'system' && !!systemDunkel && systemDunkel.matches));
    if (dunkel) document.documentElement.setAttribute('data-dunkel', '');
    else document.documentElement.removeAttribute('data-dunkel');
    // Die media-Attribute der Meta-Tags kennen „immer“ und „nie dunkel“ nicht; Werkbank ist ohne Variante dunkel.
    var leiste = dunkel || theme === 'werkbank' ? '#14181d' : '#f8fafc';
    document.querySelectorAll('meta[name=theme-color]').forEach((m) => { m.setAttribute('content', leiste); });
    return theme;
  }
  function neuAnwenden() {
    if (serverDesign) document.documentElement.setAttribute('data-theme', wirksam(serverDesign));
  }
  if (systemDunkel && systemDunkel.addEventListener) systemDunkel.addEventListener('change', neuAnwenden);
  window.__bimDunkel = function (wert) {
    try { localStorage.setItem(DUNKEL_KEY, wert === 'immer' || wert === 'server' ? wert : 'system'); } catch (_) {}
    neuAnwenden();
  };
  window.__bimDunkelWert = wahl;
  // Hat ein Design keine helle Fassung? Die Einstellungen sagen es dann dazu.
  window.__bimNurDunkel = function (theme) { return theme === 'werkbank'; };

  /**
   * Setter für 01-konto.js und den Admin-Speichern-Handler. Nur gültige Werte werden angewendet UND gecacht —
   * ein leerer oder fehlender Wert darf den Cache nicht überschreiben.
   * @param {string} theme
   */
  function applier(theme) {
    var val = apply(theme);
    if (!val) return null;
    try { localStorage.setItem(KEY, val); } catch (_) {}
    return val;
  }

  // 0) Hat der Server data-theme schon gesetzt (src/konto/indexHtml.ts), ist das
  //    der autoritative Wert zum Zeitpunkt des Ladens. Dann nur noch den Cache
  //    nachführen — kein Anwenden, kein Abgleich, also weder ein sichtbarer
  //    Sprung noch eine zusätzliche Anfrage pro Seitenaufruf.
  var served = document.documentElement.getAttribute('data-theme');
  if (served && ALLOWED.indexOf(served) !== -1) {
    try { localStorage.setItem(KEY, served); } catch (_) {}
    serverDesign = served;
    neuAnwenden();
    window.__bimApplyTheme = applier;
    return;
  }

  // 1) Fallback, wenn der Server nichts gesetzt hat (statisch ausgelieferte
  //    Datei, vorgelagerter Cache, Renderfehler): zuletzt bekanntes Design
  //    sofort anwenden, danach gegen den Server abgleichen.
  /** @type {string | null} */
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

  // Der Server nimmt Anfragen erst nach initSchemaOnce() an; ein Fehlschlag hier ist unkritisch, weil
  // checkAuth() ohnehin auf den Startup wartet und applyTheme() nach dem Login den Serverwert erneut setzt.
  sync();

  window.__bimApplyTheme = applier;
})();
