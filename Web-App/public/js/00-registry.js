// ── Handler-Registrierung für den Ereignis-Dispatcher ────────────────────────
//
// ── Warum es das gibt ───────────────────────────────────────────────────────
// js/11-actions.js löst die Handler aus data-click="name" auf. Bisher tat es
// das über `window[name]` — was funktionierte, weil alle Handler klassische
// Funktionsdeklarationen auf oberster Ebene und damit global waren.
//
// Genau diese Annahme fällt mit der Umstellung auf ES-Module: Top-Level-
// Deklarationen eines Moduls liegen NICHT auf window. Ohne Ersatz wären
// schlagartig alle 73 Handler tot — und zwar nicht beim Laden, sondern erst
// beim Klicken, also genau dort, wo es niemand vorher bemerkt.
//
// Die Registrierung macht die Verbindung zwischen Markup-Attribut und Funktion
// explizit. Nebeneffekt: `data-click="etwasTippfehler"` fällt jetzt beim
// Prüfen auf (test/dom-ids.test.js gleicht die Namen gegen die Registry ab),
// statt still nichts zu tun.

/** name → Funktion. Wird von den einzelnen Modulen gefüllt. */
const _actions = new Map();

/**
 * Handler anmelden.
 *
 * Aufruf am Ende jedes Moduls mit einem Objektliteral aus den eigenen
 * Handlern: `registerActions({ loadGallery, openModal })`. Die Kurzschreibweise
 * sorgt dafür, dass Schlüssel und Funktionsname nicht auseinanderlaufen können.
 *
 * @param {Record<string, Function>} map
 */
export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (typeof fn !== 'function') { console.warn('[actions] kein Funktionswert:', name); continue; }
    if (_actions.has(name)) console.warn('[actions] Handler doppelt angemeldet:', name);
    _actions.set(name, fn);
  }
}

/** Nur angemeldete Handler, kein Rückfall auf window: Sonst wäre jede globale
 * Funktion (open, close, print …) aus eingeschleustem Markup aufrufbar. Der
 * Log-Betrachter im Popup löst seine Handler selbst auf (js/logviewer.js).
 * @param {string} name
 * @returns {Function|null} */
export function resolveAction(name) {
  const fn = _actions.get(name);
  return typeof fn === 'function' ? fn : null;
}

// Zufallsmarke je Seitenladung. Gefährliche Aktionen laufen nur von Elementen,
// die beim Laden schon im Markup standen oder deren Vorlage echt() trägt;
// eingeschleustes HTML kennt die Marke nicht.
const _marke = typeof crypto !== 'undefined' && crypto.getRandomValues
  ? [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('')
  : String(Math.random()).slice(2);
const _vonAnfang = new WeakSet();
if (typeof document !== 'undefined')
  for (const el of document.querySelectorAll('[data-click],[data-change],[data-input],[data-blur],[data-keydown]'))
    _vonAnfang.add(el);

/** Attribut für Vorlagen, die eine gefährliche Aktion auslösen. */
export function echt() { return ` data-echt="${_marke}"`; }

/** @param {Element} el  das Element mit dem data-*-Attribut */
export function istVertraut(el) {
  return _vonAnfang.has(el) || el.getAttribute('data-echt') === _marke;
}

/** Alle angemeldeten Namen — für Tests und die Fehlersuche. */
export function actionNames() { return [..._actions.keys()].sort(); }
