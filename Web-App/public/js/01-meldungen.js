import { tRaw } from '../i18n.js';
import { ME } from './00-zustand.js';
import { G, ico, setzeHtml } from './01-dom.js';

// Toasts: kurze Meldungen unten im Bild. Gleiche Meldungen zählen statt zu stapeln, damit eine
// wiederholte Störung nicht die Liste verdeckt.

/** Anzeigedauer je Art in ms. */
const TOAST_DAUER = { success: 3500, info: 5000, error: 9000 };

/** @type {WeakMap<Element, {schluessel: string, anzahl: number, frist: ReturnType<typeof setTimeout>}>} */
const _toastStand = new WeakMap();

/** Fehlertexte der 401-Antworten: Noch laufende Anfragen scheitern nach dem
 * Ende der Sitzung mit genau diesem Text. Als Toast widerspräche er dem einen
 * Hinweis in der Anmeldekarte; toast() lässt ihn deshalb weg. */
const _meldungenDerAbgelaufenenSitzung = new Set();

/** @param {{text: string, fn: () => unknown, bleibt?: boolean}} [aktion] Knopf in der Meldung, z. B. „Rückgängig";
 *  `bleibt` hält ihn über einen Ansichtswechsel (verwirfToasts).
 * @param {string} [details] aufklappbare Ursache unter der Meldung
 * @param {unknown} msg
 * @param {'info' | 'success' | 'error'} [type]
 */
export function toast(msg, type='info', aktion, details) {
  const c = G('toasts');
  if (type === 'error' && !ME && [..._meldungenDerAbgelaufenenSitzung].some(m => String(msg ?? '').startsWith(m))) return null;
  // Dieselbe Meldung noch einmal: zählen statt stapeln, und die Frist beginnt neu.
  const schluessel = `${type}|${String(msg ?? '')}`;
  const gleich = aktion ? null : [...c.children].find(x => _toastStand.get(x)?.schluessel === schluessel);
  if (gleich) {
    const stand = /** @type {{schluessel: string, anzahl: number, frist: ReturnType<typeof setTimeout>}} */ (_toastStand.get(gleich));
    stand.anzahl++;
    const zahl = /** @type {HTMLElement} */ (gleich.querySelector('.toast-anzahl'));
    zahl.textContent = `×${stand.anzahl}`; zahl.hidden = false;
    clearTimeout(stand.frist);
    stand.frist = setTimeout(() => gleich.remove(), TOAST_DAUER[type] ?? 4500);
    return /** @type {HTMLElement} */ (gleich);
  }
  const el = document.createElement('div');
  el.className=`toast ${type}`;
  if (type === 'error') el.setAttribute('role', 'alert');
  // textContent statt innerHTML: msg enthält regelmässig Server-Fehlermeldungen
  // und Set-/Teilenummern aus Nutzereingaben.
  const icon = document.createElement('span');
  icon.className = 'toast-ico';
  setzeHtml(icon, ico(type === 'success' ? 'ok' : type === 'error' ? 'fehler' : 'info'));
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = String(msg ?? '');
  const anzahl = document.createElement('span');
  anzahl.className = 'toast-anzahl'; anzahl.hidden = true;
  el.append(icon, text, anzahl);
  // Die Ursache aufklappbar: Sieben Zeilen Meldung verdeckten am Telefon die Liste.
  if (details) {
    const mehr = document.createElement('details');
    mehr.className = 'toast-details';
    const kopf = document.createElement('summary');
    kopf.textContent = tRaw('liste.details');
    const inhalt = document.createElement('p');
    inhalt.textContent = details;
    mehr.append(kopf, inhalt);
    text.append(mehr);
  }
  if (aktion) {
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'toast-aktion';
    knopf.textContent = aktion.text;
    knopf.onclick = () => { el.remove(); aktion.fn(); };
    el.append(knopf);
    if (aktion.bleibt) el.dataset.bleibt = '';
  }
  // Ein Fehler will gelesen werden, eine Bestätigung nur gesehen; mit Knopf
  // muss man ihn auch treffen. Ein Klick auf die Meldung räumt sie weg, damit
  // sie keine Karte verdeckt.
  el.addEventListener('click', e => { if (e.target === el || !(/** @type {Element} */ (e.target)).closest('button, details')) el.remove(); });
  c.appendChild(el);
  _toastStand.set(el, { schluessel, anzahl: 1, frist: setTimeout(() => el.remove(), Math.max(aktion ? 9000 : 0, TOAST_DAUER[type] ?? 4500)) });
  return el;
}

/**
 * Beim Wechsel der Ansicht: Meldungen gehören zu der Ansicht, in der sie
 * entstanden; nur solche mit Knopf (Rückgängig, Ändern) bleiben bis zur Frist.
 */
export function verwirfToasts() {
  for (const el of [...(G('toasts')?.children || [])]) if (!(/** @type {HTMLElement} */ (el)).hasAttribute('data-bleibt')) el.remove();
}

/** Merkt den Text einer 401-Antwort; toast() lässt ihn nach dem Ende der Sitzung weg. @param {string} text */
export function merkeSitzungsende(text) { _meldungenDerAbgelaufenenSitzung.add(text); }
