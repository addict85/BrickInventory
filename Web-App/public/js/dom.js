import { tRaw } from '../i18n.js';
import { asHtml, esc, html, rawHtml } from './escaping.js';

// Small DOM helpers every view needs: get elements, icons, empty state, busy buttons. Without
// dependencies beyond escaping and language, so that every module can load them.

// function instead of const: other modules call G() & co. already while loading themselves. A const arrow function would
// then still be in the temporal dead zone and throw "G is not a function".
/**
 * Typed as a form element: most calls read .value, .checked or .disabled. For another
 * element these fields are simply empty — type checking should catch the real errors, not every
 * field access.
 * @param {string} id
 * @returns {Feld}
 */
export function G(id) {
  return /** @type {Feld} */ (document.getElementById(id));
}

/**
 * querySelectorAll as HTMLElement[]: the UI only queries HTML elements, and dataset, style and
 * hidden belong to HTMLElement, not to Element.
 * @param {string} sel @param {ParentNode} [wurzel]
 * @returns {HTMLElement[]}
 */
export function alle(sel, wurzel = document) {
  return /** @type {HTMLElement[]} */ ([...wurzel.querySelectorAll(sel)]);
}

/** querySelector as HTMLElement, see alle(). @param {string} sel @param {ParentNode} [wurzel] */
export function eins(sel, wurzel = document) {
  return /** @type {HTMLElement | null} */ (wurzel.querySelector(sel));
}

/** The open tab (data-tab of the active button in the bar). */
/** Smooth scrolling only without a wish for reduced motion: an explicit 'smooth' overrides the CSS rule. */
export function rollArt() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

export function activeTab() {
  return eins('.ntab.active')?.dataset.tab;
}

const PHONE = '(max-width: 640px)';
/** Phone width as in mobile.css: there is no table view there, the rows would be one screen height tall. */
export const telefonBreite = () => !!globalThis.matchMedia?.(PHONE).matches;
/** @param {() => void} fn runs when the window reaches or leaves the phone width */
export function atPhoneSwitch(fn) {
  globalThis.matchMedia?.(PHONE).addEventListener?.('change', fn);
}

/**
 * An icon from the icon family (sprite in index.html) as HTML.
 * @param {string} name
 */
export function ico(name) {
  return html`<svg class="ico" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

/**
 * Periodic queries rest in hidden tabs: each counts against the account's budget (src/http/apiThrottle.ts),
 * even if nobody is looking. `fn` runs immediately or the next time the tab becomes visible.
 * @param {() => unknown} fn
 */
export function ifVisible(fn) {
  if (!document.hidden) {
    fn();
    return;
  }
  document.addEventListener('visibilitychange', function weiter() {
    if (document.hidden) return;
    document.removeEventListener('visibilitychange', weiter);
    fn();
  });
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let _hitsClock;

/**
 * The result of a search or a filter for screen readers (WCAG 4.1.3). Debounced, so that not every
 * key press speaks; a character alternates, so that the same text is announced again.
 * @param {string} text
 */
export function reportHits(text) {
  clearTimeout(_hitsClock);
  _hitsClock = setTimeout(() => {
    const el = G('treffer-live');
    if (el) el.textContent = el.textContent === text ? text + '\u00a0' : text;
  }, 700);
}

/**
 * An empty state: icon, one sentence and, if there is one, the next step as a button. Texts come
 * already translated or as keys; escaping happens here.
 * @param {{ ico: string, titel?: string, text?: string, titleKey?: string, textKey?: string, knopf?: { text?: string, textKey?: string, click: string, arg?: string, ico?: string, art?: string } }} o
 */
export function emptyState(o) {
  const buttonText = o.knopf?.textKey
    ? html`<span data-i18n="${o.knopf.textKey}">${tRaw(o.knopf.textKey)}</span>`
    : html`<span>${o.knopf?.text}</span>`;
  const knopf = o.knopf
    ? html`<button type="button" class="btn ${o.knopf.art || 'bp'}" data-click="${o.knopf.click}"${o.knopf.arg ? html` data-arg="${o.knopf.arg}"` : ''}>${ico(o.knopf.ico || 'plus')}${buttonText}</button>`
    : '';
  // With a key, applyLang retranslates the text if the account language is only determined later.
  const k = (/** @type {string | undefined} */ key) => (key ? ` data-i18n="${esc(key)}"` : '');
  return html`<div class="empty leer"><div class="leer-ico">${ico(o.ico)}</div><h2${rawHtml(k(o.titleKey))}>${o.titleKey ? tRaw(o.titleKey) : o.titel}</h2>${o.text || o.textKey ? html`<p${rawHtml(k(o.textKey))}>${o.textKey ? tRaw(o.textKey) : o.text}</p>` : ''}${knopf}</div>`;
}

/**
 * The button "reset filter" for an empty state without hits.
 * @param {string} ansicht
 */
export function resetButton(ansicht) {
  return {
    text: tRaw('common.reset_filter'),
    click: 'filterZuruecksetzen',
    arg: ansicht,
    ico: 'schliessen',
    art: 'bs',
  };
}

/**
 * Locks a button for the duration of a call and remembers its label instead of setting it anew
 * afterwards: hard-coded texts were translated wrongly, and a briefly empty button looked like an error.
 * @param {HTMLButtonElement | HTMLInputElement} btn
 * @param {string} [laeuft] A different label during the work. ONLY
 *   pass it if the button really should say something else: the
 *   PDF generation does that because it writes the progress into it
 *   (create → images → remaining time). Without this argument the
 *   label stays untouched.
 * @returns {(text?: string) => void} Release. Without an argument the
 *   original label comes back; with an argument a different one — the
 *   QR generation is then deliberately called "regenerate".
 */
export function knopfBesetzt(btn, laeuft) {
  const vorher = btn.textContent;
  // Freeze the width before anything changes: a shorter waiting text would otherwise make the whole flex row
  // next to it slide along.
  const breite = btn.offsetWidth;
  const minBefore = btn.style.minWidth;
  if (breite) btn.style.minWidth = breite + 'px';
  btn.disabled = true;
  btn.classList.add('besetzt');
  if (laeuft !== undefined) btn.textContent = laeuft;
  return text => {
    btn.disabled = false;
    btn.classList.remove('besetzt');
    // Only reset what was set at all — otherwise the release would rewrite a label
    // that was never gone.
    if (text !== undefined) btn.textContent = text;
    else if (laeuft !== undefined) btn.textContent = vorher;
    // Give back the own default, do not blindly clear: a button that carries a min-width by itself
    // keeps it.
    btn.style.minWidth = minBefore;
  };
}

/**
 * Icon for the BrickLink XML buttons: a file with angle brackets shows what the button does. The
 * brick already stood for parts and sets, and redrawing the foreign BrickLink logo would be
 * presumptuous.
 */
export const XML_ICON_SVG = html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-stil="width:1.05em;height:1.05em;display:inline-block;vertical-align:-.18em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 12.5 8 14.5l2 2"/><path d="M14 12.5l2 2-2 2"/></svg>`;

/**
 * Trash icon for delete buttons on tiles and in list rows.
 *
 * `currentColor` instead of a fixed color: the button determines the color via its
 * CSS (white on red background for .delbtn, red on light background for .bd), the icon adopts it. That way it fits
 * into both environments without a second version.
 */
export const TRASH_ICON_SVG = html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-stil="width:1em;height:1em;display:block" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

/**
 * The one place that writes markup into the page. It only accepts finished markup (html``, rawHtml() or
 * lists of it), so that type checking rejects a string with data instead of inserting it.
 * @param {Element | null | undefined} el
 * @param {import('./escaping.js').Markup} inhalt
 */
export function setzeHtml(el, inhalt) {
  if (typeof inhalt === 'string' && inhalt !== '') throw new TypeError('setzeHtml: nur html`` oder rawHtml()');
  if (el) el.innerHTML = asHtml(inhalt);
}

/**
 * insertAdjacentHTML with the same rule as setzeHtml().
 * @param {Element | null | undefined} el
 * @param {InsertPosition} wo
 * @param {import('./escaping.js').Markup} inhalt
 */
export function fuegeHtmlEin(el, wo, inhalt) {
  if (typeof inhalt === 'string' && inhalt !== '') throw new TypeError('fuegeHtmlEin: nur html`` oder rawHtml()');
  el?.insertAdjacentHTML(wo, asHtml(inhalt));
}
