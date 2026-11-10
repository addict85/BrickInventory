// In ES-Modulen liegen Funktionen nicht auf window; data-click="name" findet seinen Handler deshalb hier. Ein
// Tippfehler im Namen fällt so im Test auf statt erst beim Klicken.
import { html } from './00-escapen.js';

/** name → Funktion. Wird von den einzelnen Modulen gefüllt. */
const _actions = new Map();

/**
 * Handler anmelden.
 *
 * Aufruf am Ende jedes Moduls mit einem Objektliteral aus den eigenen Handlern: `registerActions({
 * loadGallery, openModal })`. Die Kurzschreibweise sorgt dafür, dass Schlüssel und Funktionsname nicht
 * auseinanderlaufen können.
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

// Zufallsmarke je Seitenladung. Gefährliche Aktionen laufen nur von Elementen, die beim Laden schon im Markup
// standen oder deren Vorlage echt() trägt; eingeschleustes HTML kennt die Marke nicht.
const _marke = typeof crypto !== 'undefined' && crypto.getRandomValues
  ? [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, '0')).join('')
  : String(Math.random()).slice(2);
const _vonAnfang = new WeakSet();
if (typeof document !== 'undefined')
  for (const el of document.querySelectorAll('[data-click],[data-change],[data-input],[data-blur],[data-keydown]'))
    _vonAnfang.add(el);

/** Attribut für Vorlagen, die eine gefährliche Aktion auslösen. */
export function echt() { return html` data-echt="${_marke}"`; }

/** @param {Element} el  das Element mit dem data-*-Attribut */
export function istVertraut(el) {
  return _vonAnfang.has(el) || el.getAttribute('data-echt') === _marke;
}

/** Alle angemeldeten Namen — für Tests und die Fehlersuche. */
export function actionNames() { return [..._actions.keys()].sort(); }
