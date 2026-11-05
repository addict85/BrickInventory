// Zustand, den mehrere Ansichten lesen. Er liegt in einem eigenen Modul ganz
// unten, damit keine Ansicht eine andere importieren muss, nur um an ihn
// heranzukommen. Geschrieben wird über die Setter: Importierte Bindungen sind
// in ES-Modulen schreibgeschützt.

/**
 * @typedef {object} Konto
 * @property {number} id
 * @property {string} username
 * @property {boolean} isAdmin
 * @property {boolean} [mustChangePassword]
 */

/** Das angemeldete Konto; null ohne Anmeldung. @type {Konto & Record<string, any> | null} */
export let ME = null;
/** Währung aus den Einstellungen; 'EUR', solange sie nicht geladen sind. */
export let CURRENCY = 'EUR';
/** Antwort von /v1/settings/raw. @type {Record<string, any> | null} */
export let _settingsCache = null;
/** Die geladenen Sets der Galerie. @type {any[]} */
export let allSets = [];
/** Das Set im Detail-Dialog; null, wenn er zu ist. @type {any} */
export let curSet = null;
/** Kachelpreis und G&V je Setnummer aus /v1/finance/pnl. @type {Record<string, { price: any, pnl_pct: any, quelle?: string }>} */
export let _pnlCache = {};
/** Zeitpunkt (ms) des letzten Set-Imports; die Auftragsanzeige wartet danach kurz. */
export let _lastImportAt = 0;

/** @param {typeof ME} v */
export function set_ME(v) { ME = v; }
/** @param {string} v */
export function set_CURRENCY(v) { CURRENCY = v; }
/** @param {typeof _settingsCache} v */
export function set_settingsCache(v) { _settingsCache = v; }
/** @param {any[]} v */
export function setAllSets(v) { allSets = v; }
/** @param {any} v */
export function set_curSet(v) { curSet = v; }
/** @param {typeof _pnlCache} v */
export function set_pnlCache(v) { _pnlCache = v; }
/** @param {number} v */
export function set_lastImportAt(v) { _lastImportAt = v; }
