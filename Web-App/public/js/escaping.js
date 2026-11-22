// One single version of escaping, with no access to document: the DOM-free bricklink-xml.js needs
// it too, and a second escaper next to it is exactly the duplication that already drifted apart
// once before.

/**
 * Make text safe for HTML and XML: the five entities.
 *
 * `&` FIRST, otherwise it doubles the ones that follow: `<` would first become `&lt;`
 * and that then `&amp;lt;` — displayed literally as "&lt;".
 *
 * `&#39;` instead of `&apos;` for the apostrophe: both are valid in XML, the numeric
 * form is additionally valid in HTML 4. One form, both uses.
 * @param {unknown} s
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Views are built with innerHTML from templates; every value from the database, a CSV or a
// third-party API must go through one of these helpers, otherwise every free text field is a
// stored XSS. esc() for text, escJs() in data-arg, escUrl() for src/href, escHex() for colors.

/**
 * A value inside a single-quoted JS string within a double-quoted HTML attribute. JS-escape
 * first (backslash, apostrophe), then HTML: esc() alone would leave the apostrophe as &#39;, the
 * browser decodes it back before parsing the JS, and the string breaks open.
 * @param {unknown} s
 */
export function escJs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * src/href: only let relative paths and http(s) through. Manually entered parts and minifigs may
 * bring their own image URL — without this check "javascript:…" would land unfiltered in an href.
 * @param {unknown} u
 */
export function escUrl(u) {
  return esc(safeUrl(u));
}

/** Like escUrl(), but unescaped: for html``, which escapes itself. @param {unknown} u */
export function safeUrl(u) {
  const v = String(u ?? '').trim();
  // Browsers read "\" as "/" and strip tab and newline in the middle of an address: "/\host" and
  // "/<tab>/host" would be protocol-relative, i.e. foreign. Neither occurs in a real address.
  if ([...v].some(z => z === '\\' || z.charCodeAt(0) < 32)) return '';
  return /^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(v) ? v : '';
}

/**
 * Color value for data-color-hex="…" (js/styles.js) — anything except 6 hex digits is dropped.
 * @param {unknown} hex
 * @param {string} fallback
 */
export function escHex(hex, fallback) {
  const v = String(hex ?? '')
    .trim()
    .replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? '#' + v : fallback || 'var(--s300)';
}

/**
 * Like escHex(), but without the "#": for attributes whose reader adds the hash itself
 * (data-hex). escHex() there would give "##RRGGBB".
 * @param {unknown} hex
 */
export function rawHex(hex) {
  const v = String(hex ?? '')
    .trim()
    .replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(v) ? v : '';
}

/**
 * @param {string} v
 */
export function escHtmlAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Trusted Types (CSP `require-trusted-types-for 'script'`): the browser only accepts markup as
// TrustedHTML. The `app` policy only stamps the one piece of text that asHtml() just built from
// SafeHtml; any other call, even with its object, is rejected. Everything else hits `default` and
// fails.
const tt =
  /** @type {{ trustedTypes?: { createPolicy(n: string, r: object): { createHTML(s: string): unknown } } }} */ (
    /** @type {unknown} */ (globalThis)
  ).trustedTypes;
/** @type {string | null} */
let _approved = null;
const policy = tt?.createPolicy('app', {
  createHTML: (/** @type {string} */ s) => {
    if (_approved === null || s !== _approved) throw new TypeError('Trusted Types: markup only from html``');
    _approved = null;
    return s;
  },
});
/** Scripts only from our own origin: locale files and pdf.js's worker (also as blob:). @param {string} u */
function ownScript(u) {
  const url = new URL(u, globalThis.location?.href);
  if (url.origin !== globalThis.location?.origin) return false;
  return url.protocol === 'blob:' || /^\/(locales|vendor\/pdfjs|js)\//.test(url.pathname);
}
tt?.createPolicy('default', {
  createHTML: (/** @type {string} */ s) => {
    if (s === '') return s;
    throw new TypeError('Trusted Types: markup only through the app policy');
  },
  createScriptURL: (/** @type {string} */ u) => {
    if (ownScript(u)) return u;
    throw new TypeError(`Trusted Types: foreign script ${u}`);
  },
  createScript: () => {
    throw new TypeError('Trusted Types: no script from text');
  },
});

/** Markup for the browser (TrustedHTML, or the text itself without Trusted Types): only from
 * html`` or rawHtml(); a plain string is escaped, so it arrives as text. @param {Markup | string} content @returns {string} */
export function asHtml(content) {
  const text = toText(content);
  if (!policy) return text;
  _approved = text;
  try {
    return /** @type {string} */ (policy.createHTML(text));
  } finally {
    _approved = null;
  }
}

/** Finished markup: from html`` or rawHtml(). Only this is accepted as markup by setHtml() (dom.js). */
export class SafeHtml {
  /** The marker cannot be forged: Object.create(SafeHtml.prototype) passes instanceof, not this. */
  #mark = true;
  /** @param {string} text */
  constructor(text) {
    this.text = text;
    void this.#mark;
  }
  toString() {
    return this.text;
  }
  /** @param {unknown} value @returns {value is SafeHtml} */
  static isMarked(value) {
    return typeof value === 'object' && value !== null && #mark in value;
  }
}

/** What setHtml() accepts: finished markup, lists of it, or nothing — never a string with data.
 * @typedef {SafeHtml | Markup[] | '' | false | null | undefined} Markup */

/** The text of a markup value: SafeHtml unchanged, everything else escaped. @param {unknown} value @returns {string} */
export function toText(value) {
  if (SafeHtml.isMarked(value)) return value.text;
  if (Array.isArray(value)) return value.map(toText).join('');
  if (value === null || value === undefined || value === false) return '';
  return esc(value);
}

/**
 * Template for markup that escapes every interpolated value. Only pieces that themselves come
 * from html`` (or rawHtml()) pass through unescaped; lists are concatenated, null/undefined/false
 * drop out. A forgotten esc() is then no longer an XSS, just visible text.
 * @param {TemplateStringsArray} parts
 * @param {...unknown} values
 */
export function html(parts, ...values) {
  let s = parts[0] ?? '';
  for (let i = 0; i < values.length; i++) s += toText(values[i]) + (parts[i + 1] ?? '');
  return new SafeHtml(s);
}

/**
 * Join finished pieces from html`` into one, with a separator: instead of rawHtml(list.join('')),
 * which would let every string through unchecked. A raw string in the list is a bug, not markup.
 * @param {readonly Markup[]} parts
 * @param {SafeHtml | string} [separator] text is escaped
 */
export function joinHtml(parts, separator = '') {
  const between = toText(separator);
  const pieces = parts.filter(x => x !== '' && x !== null && x !== undefined && x !== false);
  for (const x of pieces)
    if (!SafeHtml.isMarked(x) && !Array.isArray(x)) throw new TypeError('joinHtml: only pieces from html``');
  return new SafeHtml(pieces.map(toText).join(between));
}

/**
 * Markup without checking — only for strings that were already built pre-escaped. Every call site
 * counts in test/ratschen.test.js; new templates use html``.
 * @param {unknown} text
 */
export function rawHtml(text) {
  return new SafeHtml(String(text ?? ''));
}
