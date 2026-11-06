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
export let ME = null;
/** Währung aus den Einstellungen; 'EUR', solange sie nicht geladen sind. */
export let CURRENCY = 'EUR';
/** Die Einstellungen aus /v1/settings/raw (settings). @type {Record<string, string> | null} */
export let _settingsCache = null;
/**
 * Ein Set der Galerie: die Zeile aus /v1/sets, dazu Kachelpreis, G&V und deren Quelle aus /v1/finance/pnl
 * (gesetzt in 02-gallery.js). letzter_kauf schickt der Server mit, der Vertrag (SetItem) nennt es noch nicht.
 * @typedef {import('../../frontend-typen/vertrag').SetItem & { _price?: number | null, _pnl_pct?: number | null, _quelle?: string | null, letzter_kauf?: string | null }} Kachel
 */
/** Die geladenen Sets der Galerie. @type {Kachel[]} */
export let allSets = [];
/** Das Set im Detail-Dialog; null, wenn er zu ist. @type {Kachel | null} */
export let curSet = null;
/** Kachelpreis und G&V je Setnummer aus /v1/finance/pnl. @type {Record<string, { price?: number | null, pnl_pct?: number | null, quelle?: string | null }>} */
export let _pnlCache = {};
/** Zeitpunkt (ms) des letzten Set-Imports; die Auftragsanzeige wartet danach kurz. */
export let _lastImportAt = 0;

/** @param {typeof ME} v */
export function set_ME(v) { ME = v; }
/** @param {string} v */
export function set_CURRENCY(v) { CURRENCY = v; setzeZahlenWaehrung(v); }
/** @param {typeof _settingsCache} v */
export function set_settingsCache(v) { _settingsCache = v; }
/** @param {Kachel[]} v */
export function setAllSets(v) { allSets = v; }
/** @param {Kachel | null} v */
export function set_curSet(v) { curSet = v; }
/** @param {typeof _pnlCache} v */
export function set_pnlCache(v) { _pnlCache = v; }
/** @param {number} v */
export function set_lastImportAt(v) { _lastImportAt = v; }
