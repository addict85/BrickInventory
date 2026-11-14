// Läuft blockierend im <head>, vor dem ersten Paint: Auch Anmelde- und Startseite tragen so sofort das
// richtige Design. Erst der letzte bekannte Wert, dann der Abgleich mit dem Server — so blinkt nichts und
// nichts veraltet.

(() => {
  var KEY = 'bim_theme';
  // Muss mit DESIGNS in src/vertrag/globaleRegeln.ts uebereinstimmen — eine Pruefung haelt beide zusammen
  // (theme.test.js).
  var ALLOWED = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];

  /**
   * Wendet ein Design an. Ein leerer Wert heisst „keine Auskunft“ und ändert nichts: Ein Rückfall auf classic
   * liess die Seite beim Anmelden umspringen und schrieb den falschen Wert in den Cache.
   * @param {string | null | undefined} theme
   * @param {boolean} [warten] erst umschalten, wenn die Stylesheets geladen sind
   */
  function apply(theme, warten) {
    if (!theme || ALLOWED.indexOf(theme) === -1) return null;
    serverDesign = theme;
    stileLaden(
      theme,
      () => {
        if (serverDesign === theme) document.documentElement.setAttribute('data-theme', wirksam(theme));
      },
      warten,
    );
    return theme;
  }

  /**
   * Holt die Stylesheets eines Designs aus <template id="design-stile">. Bei einem Wechsel schaltet `weiter` erst
   * um, wenn sie da sind — sonst stünde die Seite einen Augenblick ohne Gestaltung da.
   * @param {string} theme @param {() => void} weiter @param {boolean} [warten]
   */
  function stileLaden(theme, weiter, warten) {
    var el = document.getElementById('design-stile');
    var vorlage = el instanceof HTMLTemplateElement ? el : null;
    var offen = 0;
    var erledigt = false;
    var fertig = () => {
      if (--offen > 0 || erledigt) return;
      erledigt = true;
      weiter();
    };
    if (vorlage)
      vorlage.content.querySelectorAll('link[data-design]').forEach(link => {
        if ((link.getAttribute('data-design') || '').split(' ').indexOf(theme) === -1) return;
        if (warten) {
          offen++;
          link.addEventListener('load', fertig, { once: true });
          link.addEventListener('error', fertig, { once: true });
        }
        vorlage?.before(document.adoptNode(link));
      });
    if (!offen) weiter();
    // Ohne load-Ereignis (Netz hängt, jsdom) schaltet das Design trotzdem um, nur eben ohne Gestaltung.
    else
      setTimeout(() => {
        offen = 0;
        fertig();
      }, 1500);
  }

  // Stand das Rebrickable-Band beim letzten Start da, hält ihm das Startgerüst den Platz frei (js/konto.js).
  try {
    if (localStorage.getItem('bim_rb_band')) document.documentElement.setAttribute('data-rb-band', '');
  } catch (_) {
    /* ohne Speicher kein Platzhalter */
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
    try {
      const w = localStorage.getItem(DUNKEL_KEY);
      return w === 'server' || w === 'immer' ? w : 'system';
    } catch (_) {
      return 'system';
    }
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
    document.querySelectorAll('meta[name=theme-color]').forEach(m => {
      m.setAttribute('content', leiste);
    });
    return theme;
  }
  function neuAnwenden() {
    if (serverDesign) document.documentElement.setAttribute('data-theme', wirksam(serverDesign));
  }
  if (systemDunkel?.addEventListener) systemDunkel.addEventListener('change', neuAnwenden);
  window.__bimDunkel = wert => {
    try {
      localStorage.setItem(DUNKEL_KEY, wert === 'immer' || wert === 'server' ? wert : 'system');
    } catch (_) {}
    neuAnwenden();
  };
  window.__bimDunkelWert = wahl;
  // Hat ein Design keine helle Fassung? Die Einstellungen sagen es dann dazu.
  window.__bimNurDunkel = theme => theme === 'werkbank';

  /**
   * Setter für konto.js und den Admin-Speichern-Handler. Nur gültige Werte werden angewendet UND gecacht —
   * ein leerer oder fehlender Wert darf den Cache nicht überschreiben.
   * @param {string} theme
   */
  function applier(theme) {
    var val = apply(theme, true);
    if (!val) return null;
    try {
      localStorage.setItem(KEY, val);
    } catch (_) {}
    return val;
  }

  // 0) Hat der Server data-theme gesetzt (src/konto/indexHtml.ts), gilt es: nur den Cache nachführen, kein
  //    Abgleich — weder ein sichtbarer Sprung noch eine Anfrage mehr je Seitenaufruf.
  var served = document.documentElement.getAttribute('data-theme');
  if (served && ALLOWED.indexOf(served) !== -1) {
    try {
      localStorage.setItem(KEY, served);
    } catch (_) {}
    serverDesign = served;
    stileLaden(served, () => {});
    neuAnwenden();
    window.__bimApplyTheme = applier;
    return;
  }

  // 1) Fallback, wenn der Server nichts gesetzt hat (statisch ausgelieferte
  //    Datei, vorgelagerter Cache, Renderfehler): zuletzt bekanntes Design
  //    sofort anwenden, danach gegen den Server abgleichen.
  /** @type {string | null} */
  var cached = null;
  try {
    cached = localStorage.getItem(KEY);
  } catch (_) {}
  apply(cached);

  // 2) Serverwert nachziehen
  function sync() {
    fetch('/api/v1/settings/theme', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!d?.success || !d.theme) return;
        if (d.theme !== cached) {
          apply(d.theme, true);
          try {
            localStorage.setItem(KEY, d.theme);
          } catch (_) {}
        }
      })
      .catch(() => {
        /* offline oder Server startet noch — Cache bleibt gültig */
      });
  }

  // Der Server nimmt Anfragen erst nach initSchemaOnce() an; ein Fehlschlag hier ist unkritisch, weil
  // checkAuth() ohnehin auf den Startup wartet und applyTheme() nach dem Login den Serverwert erneut setzt.
  sync();

  window.__bimApplyTheme = applier;
})();
