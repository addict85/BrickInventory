import { tRaw } from '../i18n.js';
import { alsHtml, esc, html, ungeprueft } from './escapen.js';

// Kleine DOM-Helfer, die jede Ansicht braucht: Elemente holen, Symbole, Leerzustand, besetzte Knöpfe. Ohne
// Abhängigkeit über Escaping und Sprache hinaus, damit jedes Modul sie laden kann.

// function statt const: Andere Module rufen G() & Co. schon beim eigenen Laden. Eine const-Pfeilfunktion läge
// dann noch in der Todeszone und würfe „G is not a function“.
/**
 * Als Formularelement typisiert: Die meisten Aufrufe lesen .value, .checked oder .disabled. Für ein anderes
 * Element sind diese Felder schlicht leer — die Typprüfung soll an den echten Fehlern hängen, nicht an jedem
 * Feldzugriff.
 * @param {string} id
 * @returns {Feld}
 */
export function G(id) { return /** @type {Feld} */ (document.getElementById(id)); }

/**
 * querySelectorAll als HTMLElement[]: Die Oberfläche fragt nur HTML-Elemente ab, und dataset, style und
 * hidden gehören zu HTMLElement, nicht zu Element.
 * @param {string} sel @param {ParentNode} [wurzel]
 * @returns {HTMLElement[]}
 */
export function alle(sel, wurzel = document) { return /** @type {HTMLElement[]} */ ([...wurzel.querySelectorAll(sel)]); }

/** querySelector als HTMLElement, siehe alle(). @param {string} sel @param {ParentNode} [wurzel] */
export function eins(sel, wurzel = document) { return /** @type {HTMLElement | null} */ (wurzel.querySelector(sel)); }

/** Der offene Reiter (data-tab des aktiven Knopfs in der Leiste). */
/** Weich rollen nur ohne Wunsch nach weniger Bewegung: Ein ausdrückliches 'smooth' übergeht die CSS-Regel. */
export function rollArt() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

export function aktiverReiter() { return eins('.ntab.active')?.dataset.tab; }

/**
 * Ein Symbol aus der Symbolfamilie (Sprite in index.html) als HTML.
 * @param {string} name
 */
export function ico(name) { return html`<svg class="ico" aria-hidden="true"><use href="#i-${name}"/></svg>`; }

/** @type {ReturnType<typeof setTimeout> | undefined} */
let _trefferUhr;

/**
 * Das Ergebnis einer Suche oder eines Filters für Vorleser (WCAG 4.1.3). Entprellt, damit nicht jeder
 * Tastendruck spricht; ein Zeichen wechselt, damit derselbe Text erneut angesagt wird.
 * @param {string} text
 */
export function meldeTreffer(text) {
  clearTimeout(_trefferUhr);
  _trefferUhr = setTimeout(() => {
    const el = G('treffer-live');
    if (el) el.textContent = el.textContent === text ? text + '\u00a0' : text;
  }, 700);
}

/**
 * Ein leerer Zustand: Symbol, ein Satz, und wenn es einen gibt, der nächste Schritt als Knopf. Texte kommen
 * fertig übersetzt oder als Schlüssel; maskiert wird hier.
 * @param {{ ico: string, titel?: string, text?: string, titelKey?: string, textKey?: string, knopf?: { text?: string, textKey?: string, click: string, arg?: string, ico?: string, art?: string } }} o
 */
export function leerZustand(o) {
  const knopfText = o.knopf?.textKey ? html`<span data-i18n="${o.knopf.textKey}">${tRaw(o.knopf.textKey)}</span>` : html`<span>${o.knopf?.text}</span>`;
  const knopf = o.knopf ? html`<button type="button" class="btn ${o.knopf.art || 'bp'}" data-click="${o.knopf.click}"${o.knopf.arg ? html` data-arg="${o.knopf.arg}"` : ''}>${ico(o.knopf.ico || 'plus')}${knopfText}</button>` : '';
  // Mit Schlüssel übersetzt applyLang den Text nach, wenn die Kontosprache erst später feststeht.
  const k = (/** @type {string | undefined} */ key) => key ? ` data-i18n="${esc(key)}"` : '';
  return html`<div class="empty leer"><div class="leer-ico">${ico(o.ico)}</div><h2${ungeprueft(k(o.titelKey))}>${o.titelKey ? tRaw(o.titelKey) : o.titel}</h2>${o.text || o.textKey ? html`<p${ungeprueft(k(o.textKey))}>${o.textKey ? tRaw(o.textKey) : o.text}</p>` : ''}${knopf}</div>`;
}

/**
 * Der Knopf „Filter zurücksetzen“ für einen Leerzustand ohne Treffer.
 * @param {string} ansicht
 */
export function zuruecksetzenKnopf(ansicht) {
  return { text: tRaw('common.reset_filter'), click: 'filterZuruecksetzen', arg: ansicht, ico: 'schliessen', art: 'bs' };
}

/**
 * Sperrt einen Knopf für die Dauer eines Aufrufs und merkt sich seine Beschriftung, statt sie danach neu zu
 * setzen: Fest eingetragene Texte waren falsch übersetzt, und ein kurz leerer Knopf sah wie ein Fehler aus.
 * @param {HTMLButtonElement | HTMLInputElement} btn
 * @param {string} [laeuft] Andere Beschriftung waehrend der Arbeit. NUR
 *   angeben, wenn der Knopf wirklich etwas anderes sagen soll: Die
 *   PDF-Erzeugung tut das, weil sie den Fortschritt hineinschreibt
 *   (erstellen → Bilder → Restzeit). Ohne dieses Argument bleibt die
 *   Beschriftung unangetastet.
 * @returns {(text?: string) => void} Freigabe. Ohne Argument kommt die
 *   urspruengliche Beschriftung zurueck; mit Argument eine andere — die
 *   QR-Erzeugung heisst danach absichtlich „Neu generieren".
 */
export function knopfBesetzt(btn, laeuft) {
  const vorher = btn.textContent;
  // Die Breite einfrieren, bevor sich etwas ändert: Ein kürzerer Wartetext liesse sonst die ganze flex-Zeile
  // daneben nachrutschen.
  const breite = btn.offsetWidth;
  const minVorher = btn.style.minWidth;
  if (breite) btn.style.minWidth = breite + 'px';
  btn.disabled = true;
  btn.classList.add('besetzt');
  if (laeuft !== undefined) btn.textContent = laeuft;
  return (text) => {
    btn.disabled = false;
    btn.classList.remove('besetzt');
    // Nur zuruecksetzen, was ueberhaupt gesetzt wurde — sonst schriebe die Freigabe eine Beschriftung neu,
    // die nie weg war.
    if (text !== undefined) btn.textContent = text;
    else if (laeuft !== undefined) btn.textContent = vorher;
    // Die eigene Vorgabe zurueckgeben, nicht blind leeren: Ein Knopf, der von sich aus eine min-width traegt,
    // behaelt sie.
    btn.style.minWidth = minVorher;
  };
}

/**
 * Symbol für die BrickLink-XML-Knöpfe: eine Datei mit spitzen Klammern zeigt, was der Knopf tut. Der
 * Ziegelstein stand schon für Teile und Sets, und das fremde BrickLink-Logo nachzuzeichnen wäre eine
 * Anmassung.
 */
export const XML_ICON_SVG = html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-stil="width:1.05em;height:1.05em;display:inline-block;vertical-align:-.18em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M10 12.5 8 14.5l2 2"/><path d="M14 12.5l2 2-2 2"/></svg>`;

/**
 * Papierkorb-Symbol für Löschknöpfe auf Kacheln und in Listenzeilen.
 *
 * `currentColor` statt fester Farbe: Der Knopf bestimmt die Farbe über sein
 * CSS (weiss auf rotem Grund bei .delbtn, rot auf hellem Grund bei .bd), das Symbol übernimmt sie. So passt
 * es in beide Umgebungen ohne zweite Fassung.
 */
export const TRASH_ICON_SVG = html`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-stil="width:1em;height:1em;display:block" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

/**
 * Die eine Stelle, die Markup in die Seite schreibt. Sie nimmt nur fertiges Markup (html``, ungeprueft() oder
 * Listen davon), damit die Typprüfung eine Zeichenkette mit Daten zurückweist, statt sie einzusetzen.
 * @param {Element | null | undefined} el
 * @param {import('./escapen.js').Markup} inhalt
 */
export function setzeHtml(el, inhalt) {
  if (typeof inhalt === 'string' && inhalt !== '') throw new TypeError('setzeHtml: nur html`` oder ungeprueft()');
  if (el) el.innerHTML = alsHtml(inhalt);
}

/**
 * insertAdjacentHTML mit derselben Regel wie setzeHtml().
 * @param {Element | null | undefined} el
 * @param {InsertPosition} wo
 * @param {import('./escapen.js').Markup} inhalt
 */
export function fuegeHtmlEin(el, wo, inhalt) {
  if (typeof inhalt === 'string' && inhalt !== '') throw new TypeError('fuegeHtmlEin: nur html`` oder ungeprueft()');
  el?.insertAdjacentHTML(wo, alsHtml(inhalt));
}
