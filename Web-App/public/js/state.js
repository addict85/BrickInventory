// State that several views read. It lives in its own module at the very bottom, so that no view
// has to import another just to get at it. Written only through the setters: imported bindings
// are read-only in ES modules.
import { setzeZahlenWaehrung } from '../i18n.js';

/**
 * @typedef {object} Account
 * @property {number} id
 * @property {string} username
 * @property {boolean} isAdmin
 * @property {boolean} [mustChangePassword]
 */

/** The logged-in account; null without a login. @type {Account & Record<string, unknown> | null} */
export let loggedInAccount = null;
/** Currency from the settings; 'EUR' as long as they are not loaded. */
export let accountCurrency = 'EUR';
/** The settings from /v1/settings/raw (settings). @type {Record<string, string> | null} */
export let settingsSnapshot = null;
/**
 * A set of the gallery: the row from /v1/sets, plus tile price, P&L and their source from
 * /v1/finance/pnl (set in collection.js).
 * @typedef {import('../../frontend-typen/vertrag').SetItem & { _price?: number | null, _pnl_pct?: number | null, _quelle?: string | null }} Tile
 */
/** The loaded sets of the gallery. @type {Tile[]} */
export let gallerySets = [];
/** The set in the detail dialog; null when it is closed. @type {Tile | null} */
export let openSet = null;
/** Tile price and P&L per set number from /v1/finance/pnl. @type {Record<string, { price?: number | null, pnl_pct?: number | null, quelle?: string | null }>} */
export let pnlBySet = {};
/** The market value for the finance header figure: the value curve ends on it, so both show the same. */
export let financeHeaderValue = 0;
/** Timestamp (ms) of the last set import; the order display waits briefly after it. */
export let lastImportAt = 0;

/** @param {number} v */
export function setFinanceHeaderValue(v) {
  financeHeaderValue = v;
}
/** @param {typeof loggedInAccount} v */
export function setAccount(v) {
  loggedInAccount = v;
}
/** @param {string} v */
export function setAccountCurrency(v) {
  accountCurrency = v;
  setzeZahlenWaehrung(v);
}
/** @param {typeof settingsSnapshot} v */
export function setSettingsSnapshot(v) {
  settingsSnapshot = v;
}
/** @param {Tile[]} v */
export function setGallerySets(v) {
  gallerySets = v;
}
/** @param {Tile | null} v */
export function setOpenSet(v) {
  openSet = v;
}
/** @param {typeof pnlBySet} v */
export function setPnlBySet(v) {
  pnlBySet = v;
}
/** @param {number} v */
export function setLastImportAt(v) {
  lastImportAt = v;
}
