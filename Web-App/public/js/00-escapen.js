// Eine einzige Fassung des Maskierens, ohne Zugriff auf document: Auch das DOM-freie 19-bricklink-xml.js
// braucht sie, und ein zweiter Maskierer daneben ist genau die Doppelung, die schon einmal
// auseinandergelaufen ist.
// Ausführlich: docs/begruendungen/public/js/00-escapen.js.md#hier-stand-esc-bis-zum-20-10-in-js-01-co

/**
 * Text für HTML und XML sicher machen: die fünf Entitäten.
 *
 * `&` ZUERST, sonst verdoppelt es die folgenden: aus `<` würde erst `&lt;`
 * und daraus `&amp;lt;` — angezeigt würde wörtlich „&lt;".
 *
 * `&#39;` statt `&apos;` für den Apostroph: Beides ist in XML gültig, die
 * numerische Form zusätzlich in HTML 4. Eine Form, beide Verwendungen.
 * @param {unknown} s
 */
export function esc(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Ansichten entstehen per innerHTML aus Vorlagen; jeder Wert aus Datenbank, CSV oder Fremd-API muss durch
// einen dieser Helfer, sonst ist jedes freie Textfeld ein gespeichertes XSS. esc() für Text, escJs() in
// data-arg, escUrl() für src/href, escHex() für Farben.
// Ausführlich: docs/begruendungen/public/js/00-escapen.js.md#alle-listen-und-detailansichten-werden-p

/**
 * Wert in einem einfach-gequoteten JS-String innerhalb eines doppelt-gequoteten HTML-Attributs. Erst
 * JS-escapen (Backslash, Apostroph), dann HTML: esc() allein liesse den Apostroph als &#39; stehen, der
 * Browser dekodiert ihn vor dem JS-Parsen zurück, und der String bricht auf.
 * @param {unknown} s
 */
export function escJs(s){
  return String(s ?? '')
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'")
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * src/href: nur relative Pfade und http(s) durchlassen. Manuell erfasste Teile und Minifiguren dürfen eine
 * Bild-URL mitbringen — ohne diese Prüfung landet "javascript:…" ungefiltert in einem href.
 * @param {unknown} u
 */
export function escUrl(u){
  return esc(sichereUrl(u));
}

/** Wie escUrl(), aber unmaskiert: für html``, das selbst maskiert. @param {unknown} u */
export function sichereUrl(u){
  const v = String(u ?? '').trim();
  return /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(v) ? v : '';
}

/**
 * Farbwert für data-farbe="…" (js/00-stile.js) — alles ausser 6 Hex-Ziffern fliegt raus.
 * @param {unknown} hex
 * @param {string} fallback
 */
export function escHex(hex, fallback){
  const v = String(hex ?? '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? '#' + v : (fallback || 'var(--s300)');
}

/**
 * Wie escHex(), aber ohne „#“: für Attribute, deren Leser das Doppelkreuz selbst ergänzen (data-hex).
 * escHex() dort ergäbe „##RRGGBB“.
 * Ausführlich: docs/begruendungen/public/js/00-escapen.js.md#hexziffern
 * @param {unknown} hex
 */
export function hexZiffern(hex){
  const v = String(hex ?? '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v : '';
}

/**
 * @param {string} v
 */
export function escHtmlAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Trusted Types (CSP `require-trusted-types-for 'script'`): Der Browser nimmt Markup nur als TrustedHTML.
// Das prägt allein die Richtlinie `app` über alsHtml(), die nur setzeHtml()/fuegeHtmlEin() und das
// Protokollfenster benutzen; jede andere Zuweisung an innerHTML landet bei `default` und scheitert.
const tt = /** @type {{ trustedTypes?: { createPolicy(n: string, r: object): { createHTML(s: string): unknown } } }} */ (
  /** @type {unknown} */ (globalThis)).trustedTypes;
const richtlinie = tt?.createPolicy('app', { createHTML: (/** @type {string} */ s) => s });
/** Skripte nur aus der eigenen Herkunft: Sprachdateien und der Worker von pdf.js (auch als blob:). @param {string} u */
function eigenesSkript(u) {
  const url = new URL(u, globalThis.location?.href);
  if (url.origin !== globalThis.location?.origin) return false;
  return url.protocol === 'blob:' || /^\/(locales|vendor\/pdfjs|js)\//.test(url.pathname);
}
tt?.createPolicy('default', {
  createHTML: (/** @type {string} */ s) => { if (s === '') return s; throw new TypeError('Trusted Types: Markup nur über die Richtlinie app'); },
  createScriptURL: (/** @type {string} */ u) => { if (eigenesSkript(u)) return u; throw new TypeError(`Trusted Types: fremdes Skript ${u}`); },
  createScript: () => { throw new TypeError('Trusted Types: kein Skript aus Text'); },
});

/** Ein fertiges, schon maskiertes Markup für den Browser (TrustedHTML, ohne Trusted Types der Text).
 * Nur für die Stellen, die test/ratschen.test.js als Markup-Senken zulässt. @param {string} s @returns {string} */
export function alsHtml(s) { return richtlinie ? /** @type {string} */ (richtlinie.createHTML(s)) : s; }

/** Fertiges Markup: aus html`` oder ungeprueft(). Nur so nimmt setzeHtml() (01-dom.js) Text als Markup an. */
export class SicheresHtml {
  /** Macht die Klasse für tsc nominal: ein Objekt mit `text` ist noch kein SicheresHtml. */
  #marke = true;
  /** @param {string} text */
  constructor(text) { this.text = text; void this.#marke; }
  toString() { return this.text; }
}

/** Was setzeHtml() annimmt: fertiges Markup, Listen davon oder nichts — keine Zeichenkette mit Daten.
 * @typedef {SicheresHtml | Markup[] | '' | false | null | undefined} Markup */

/** Der Text eines Werts für Markup: SicheresHtml unverändert, alles andere maskiert. @param {unknown} wert @returns {string} */
export function einsetzen(wert) {
  if (wert instanceof SicheresHtml) return wert.text;
  if (Array.isArray(wert)) return wert.map(einsetzen).join('');
  if (wert === null || wert === undefined || wert === false) return '';
  return esc(wert);
}

/**
 * Vorlage für Markup, die jeden eingesetzten Wert maskiert. Durch kommen nur Stücke, die selbst aus html``
 * stammen (oder ungeprueft()); Listen werden aneinandergehängt, null/undefined/false fallen weg. Ein
 * vergessenes esc() ist damit kein XSS mehr, sondern sichtbarer Text.
 * @param {TemplateStringsArray} teile
 * @param {...unknown} werte
 */
export function html(teile, ...werte) {
  let s = teile[0] ?? '';
  for (let i = 0; i < werte.length; i++) s += einsetzen(werte[i]) + (teile[i + 1] ?? '');
  return new SicheresHtml(s);
}

/**
 * Markup ohne Prüfung — nur für Zeichenketten, die schon maskiert gebaut wurden. Jede Stelle zählt
 * test/ratschen.test.js; neue Vorlagen nehmen html``.
 * @param {unknown} text
 */
export function ungeprueft(text) { return new SicheresHtml(String(text ?? '')); }
