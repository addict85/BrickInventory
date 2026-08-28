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

/**
 * Handler nachschlagen.
 *
 * Rückfall auf window: Der Log-Betrachter (js/logviewer.js) wird zur Laufzeit
 * in ein eigenes Popup-Fenster geladen, ist kein Modul und meldet seine vier
 * Handler nicht an. Für ihn gilt weiterhin die alte Auflösung.
 *
 * @param {string} name
 * @returns {Function|null}
 */
export function resolveAction(name) {
  const fn = _actions.get(name) || (typeof window !== 'undefined' ? window[name] : null);
  return typeof fn === 'function' ? fn : null;
}

/** Alle angemeldeten Namen — für Tests und die Fehlersuche. */
export function actionNames() { return [..._actions.keys()].sort(); }
