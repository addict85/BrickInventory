import { todayIso } from './components.js';
import { tRaw } from '../i18n.js';
import { html, rawHtml } from './escaping.js';
import { ico, G, setzeHtml } from './dom.js';
import { fmtDatum, browserWritesDateHowApp } from './format.js';

// What the set's purchase price dialog and the dialog of manual entries share: the same window (#acq-modal),
// the same household list and the same table building blocks.
/** @typedef {import('../../frontend-types/contract').HouseholdMember} Konto */

/** Whose acquisitions are in the dialog and where closing leads back to. */
export const erfassung = {
  /** @type {string | null} */ sn: null,
  /** @type {number | null} */ besitzer: null,
  /** @type {Konto[]} */ mitglieder: [],
  /** Return from the dialog of a manual entry; null means "back to the set".
   * @type {(() => void) | null} */
  zurueck: null,
};

/**
 * Redraw without losing focus: saving on leaving a field redraws the table
 * when Tab is already in the next field — the focus then fell onto <body>, and the keyboard was out.
 * @param {HTMLElement} ziel
 * @param {import('./escaping.js').Markup} markup
 */
export function setWithFocus(ziel, markup) {
  const felder = () => /** @type {HTMLElement[]} */ ([...ziel.querySelectorAll('input, select, button')]);
  const place = felder().indexOf(/** @type {HTMLElement} */ (document.activeElement));
  setzeHtml(ziel, markup);
  if (place >= 0) felder()[place]?.focus({ preventScroll: true });
}

/**
 * YYYY-MM-DD in the local calendar for <input type="date">.
 * @param {string | null | undefined} v
 */
export function isoTag(v) {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : '';
}

/**
 * Date field with the date next to it in the UI language: the field itself shows the browser's form
 * ("06/01/2026"), not the app's. If the browser already writes like the app, the line is dropped.
 * @param {string} attrs
 * @param {string} iso
 * @param {string} textId
 */
export function dateField(attrs, iso, textId) {
  const text = browserWritesDateHowApp(iso) ? '' : fmtDatum(iso, 'lang');
  return html`<span class="acq-datum"><input class="acq-feld" type="date" max="${todayIso()}" value="${iso}" aria-label="${tRaw('detail.added')}"
      ${text ? html`aria-describedby="${textId}"` : ''} ${rawHtml(attrs)} />${text ? html`<span class="acq-datum-text" id="${textId}">${text}</span>` : ''}</span>`;
}

/** Rows whose last change is saved; the marker survives redrawing. */
export const gespeichert = new Set();
/** @param {number | string} id */
export function savedBrand(id) {
  return html`<span class="acq-ok" id="acq-ok-${id}" role="status"${gespeichert.has(String(id)) ? '' : ' hidden'}>${ico('ok')}<span>${tRaw('settings.saved')}</span></span>`;
}
/** @param {number | string} id */
export function showSaved(id) {
  gespeichert.add(String(id));
  const el = G(`acq-ok-${id}`);
  if (el) el.hidden = false;
}
