import { heuteIso } from './01-bausteine.js';
import { tRaw } from '../i18n.js';
import { html, ungeprueft } from './00-escapen.js';
import { ico, G, setzeHtml } from './01-dom.js';
import { fmtDatum, browserSchreibtDatumWieApp } from './01-format.js';

// Was der Kaufpreis-Dialog des Sets und der Dialog manueller Einträge teilen: dasselbe Fenster (#acq-modal),
// dieselbe Haushaltsliste und dieselben Tabellenbausteine.
/** @typedef {import('../../frontend-typen/vertrag').HouseholdMember} Konto */

/** Wessen Erfassungen im Dialog stehen und wohin das Schliessen zurückführt. */
export const erfassung = {
  /** @type {string | null} */ sn: null,
  /** @type {number | null} */ besitzer: null,
  /** @type {Konto[]} */ mitglieder: [],
  /** Rückkehr aus dem Dialog eines manuellen Eintrags; null heisst „zurück zum Set“.
   * @type {(() => void) | null} */
  zurueck: null,
};

/**
 * Neu zeichnen, ohne den Fokus zu verlieren: Das Speichern beim Verlassen eines Feldes zeichnet die Tabelle
 * neu, wenn Tab schon im nächsten Feld steht — der Fokus fiel dann auf <body>, und die Tastatur war draussen.
 * @param {HTMLElement} ziel
 * @param {import('./00-escapen.js').Markup} markup
 */
export function setzeMitFokus(ziel, markup) {
  const felder = () => /** @type {HTMLElement[]} */ ([...ziel.querySelectorAll('input, select, button')]);
  const stelle = felder().indexOf(/** @type {HTMLElement} */ (document.activeElement));
  setzeHtml(ziel, markup);
  if (stelle >= 0) felder()[stelle]?.focus({ preventScroll: true });
}

/**
 * JJJJ-MM-TT im lokalen Kalender für <input type="date">.
 * @param {string | null | undefined} v
 */
export function isoTag(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : '';
}

/**
 * Datumsfeld mit dem Datum daneben in der Sprache der Oberfläche: Das Feld selbst zeigt die Form des Browsers
 * („06/01/2026“), nicht die der App. Schreibt der Browser schon wie die App, entfällt die Zeile.
 * @param {string} attrs
 * @param {string} iso
 * @param {string} textId
 */
export function datumFeld(attrs, iso, textId) {
  const text = browserSchreibtDatumWieApp(iso) ? '' : fmtDatum(iso, 'lang');
  return html`<span class="acq-datum"><input class="acq-feld" type="date" max="${heuteIso()}" value="${iso}" aria-label="${tRaw('detail.added')}"
      ${text ? html`aria-describedby="${textId}"` : ''} ${ungeprueft(attrs)} />${text ? html`<span class="acq-datum-text" id="${textId}">${text}</span>` : ''}</span>`;
}

/** Zeilen, deren letzte Änderung gespeichert ist; die Marke übersteht das Neuzeichnen. */
export const gespeichert = new Set();
/** @param {number | string} id */
export function gespeichertMarke(id) {
  return html`<span class="acq-ok" id="acq-ok-${id}" role="status"${gespeichert.has(String(id)) ? '' : ' hidden'}>${ico('ok')}<span>${tRaw('settings.saved')}</span></span>`;
}
/** @param {number | string} id */
export function zeigeGespeichert(id) {
  gespeichert.add(String(id));
  const el = G(`acq-ok-${id}`);
  if (el) el.hidden = false;
}
