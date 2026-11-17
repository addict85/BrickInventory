// Zustand, den mehrere Ansichten lesen. Er liegt in einem eigenen Modul ganz unten, damit keine Ansicht eine
// andere importieren muss, nur um an ihn heranzukommen. Geschrieben wird über die Setter: Importierte
// Bindungen sind in ES-Modulen schreibgeschützt.
import { setzeZahlenWaehrung } from '../i18n.js';

/**
 * @typedef {object} Konto
 * @property {number} id
 * @property {string} username
 * @property {boolean} isAdmin
 * @property {boolean} [mustChangePassword]
 */

/** Das angemeldete Konto; null ohne Anmeldung. @type {Konto & Record<string, unknown> | null} */
export let angemeldetesKonto = null;
/** Währung aus den Einstellungen; 'EUR', solange sie nicht geladen sind. */
export let kontoWaehrung = 'EUR';
/** Die Einstellungen aus /v1/settings/raw (settings). @type {Record<string, string> | null} */
export let einstellungsStand = null;
/**
 * Ein Set der Galerie: die Zeile aus /v1/sets, dazu Kachelpreis, G&V und deren Quelle aus /v1/finance/pnl
 * (gesetzt in collection.js).
 * @typedef {import('../../frontend-typen/vertrag').SetItem & { _price?: number | null, _pnl_pct?: number | null, _quelle?: string | null }} Kachel
 */
/** Die geladenen Sets der Galerie. @type {Kachel[]} */
export let galerieSets = [];
/** Das Set im Detail-Dialog; null, wenn er zu ist. @type {Kachel | null} */
export let offenesSet = null;
/** Kachelpreis und G&V je Setnummer aus /v1/finance/pnl. @type {Record<string, { price?: number | null, pnl_pct?: number | null, quelle?: string | null }>} */
export let guvJeSet = {};
/** Der Marktwert der Finanz-Kopfzahl: Die Wertkurve endet auf ihm, damit beide dasselbe zeigen. */
export let finKopfWert = 0;
/** Zeitpunkt (ms) des letzten Set-Imports; die Auftragsanzeige wartet danach kurz. */
export let letzterImport = 0;

/** @param {number} v */
export function setzeFinKopfWert(v) {
  finKopfWert = v;
}
/** @param {typeof angemeldetesKonto} v */
export function setzeKonto(v) {
  angemeldetesKonto = v;
}
/** @param {string} v */
export function setzeKontoWaehrung(v) {
  kontoWaehrung = v;
  setzeZahlenWaehrung(v);
}
/** @param {typeof einstellungsStand} v */
export function setzeEinstellungsStand(v) {
  einstellungsStand = v;
}
/** @param {Kachel[]} v */
export function setzeGalerieSets(v) {
  galerieSets = v;
}
/** @param {Kachel | null} v */
export function setzeOffenesSet(v) {
  offenesSet = v;
}
/** @param {typeof guvJeSet} v */
export function setzeGuvJeSet(v) {
  guvJeSet = v;
}
/** @param {number} v */
export function setzeLetztenImport(v) {
  letzterImport = v;
}
