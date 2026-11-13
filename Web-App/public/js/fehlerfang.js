import { tRaw } from '../i18n.js';
import { toast } from './meldungen.js';

/**
 * Auffangnetz für Fehler, die niemand behandelt: api() wirft nicht mehr, aber ein Programmierfehler in einem
 * Rückruf endete sonst nur in der Konsole — man klickt, nichts passiert, und niemand erfährt es.
 */
let _letzteFehlermeldung = 0;
/** @param {string} quelle @param {unknown} fehler */
function meldeUnerwartet(quelle, fehler) {
  console.error(`[${quelle}]`, fehler);
  const jetzt = Date.now();
  if (jetzt - _letzteFehlermeldung < 5000) return;
  _letzteFehlermeldung = jetzt;
  // tRaw statt t: Das Ergebnis geht über toast() nach textContent — t() maskiert die eingesetzten Werte und
  // die Maskierung würde dort WÖRTLICH erscheinen (siehe frontend-escaping.test.js).
  toast(tRaw('api.unexpected'), 'error');
}

/**
 * Stammt der Fehler aus unserem Code? Das Netz hört am Fenster und fängt auch Ablehnungen von
 * Browser-Erweiterungen (MetaMask); als „Unerwarteter Fehler“ gemeldet, suchte man den Fehler bei uns.
 * @param {unknown} fehler
 */
function vonUns(fehler) {
  const roh = /** @type {{ stack?: unknown } | null | undefined} */ (fehler)?.stack;
  const stapel = typeof roh === 'string' ? roh : '';
  const adressen = stapel.match(/\b[a-z][\w.+-]*:\/\/[^\s)]+/gi) || [];
  if (!adressen.length) return true;
  return adressen.some((/** @type {string} */ a) => a.startsWith(location.origin + '/'));
}

export function bindGlobalErrorHandlers() {
  window.addEventListener('unhandledrejection', ev => {
    if (vonUns(ev.reason)) meldeUnerwartet('promise', ev.reason);
  });
  // Ressourcenfehler (Bilder) laufen ebenfalls über 'error', blubbern aber nicht bis window hoch — hier
  // kommen nur echte Skriptfehler an.
  // Ohne Fehlerobjekt meldet der Browser selbst, etwa „ResizeObserver loop …“ bei grosser Schrift: Daran kann
  // der Nutzer nichts tun, und ein roter Toast liesse ihn einen Fehler suchen, der keiner ist.
  window.addEventListener('error', ev => {
    if (!ev.error || /^ResizeObserver loop/.test(ev.message || '')) {
      console.warn('[script]', ev.message);
      return;
    }
    if (vonUns(ev.error)) meldeUnerwartet('script', ev.error);
  });
}
