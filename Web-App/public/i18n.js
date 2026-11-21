import { emit } from './js/events.js';
import { SafeHtml } from './js/escaping.js';

// Minimal translation system: t('key', {name}) delivers the text. The language is remembered in localStorage
// so that nothing is delayed on the next load. Only the active language is delivered.

/**
 * Dictionary of the loaded languages. At least one is there at startup; the second one is added via loadLang().
 * @type {Record<string, Record<string,string>>}
 */
export const I18N = {};
if (window.I18N_DE) I18N.de = window.I18N_DE;
if (window.I18N_EN) I18N.en = window.I18N_EN;

/**
 * Load a language file before retranslating: otherwise key names would stand there for half a second.
 * If it fails, the previous language stays — the caller checks I18N[lang].
 * @param {string} lang 'de' or 'en'
 * @returns {Promise<void>}
 */
function loadLang(lang) {
  if (I18N[lang]) return Promise.resolve();
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '/locales/' + lang + '.js?v=' + (window.__APP_VERSION || '');
    s.onload = () => {
      const dict = lang === 'en' ? window.I18N_EN : lang === 'de' ? window.I18N_DE : undefined;
      if (dict) I18N[lang] = dict;
      resolve();
    };
    s.onerror = () => resolve(); // Error: keep the previous language
    document.head.appendChild(s);
  });
}

// Active language – loaded from localStorage first (instant), then from server
const _browserLang = navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
export let LANG = localStorage.getItem('bim_lang') || _browserLang;

/**
 * Translate a key. Supports {placeholder} substitution. Falls back to the key itself if not found.
 */
/** The account's currency; without a matching browser region it determines the number format. */
let _currency = 'EUR';
/** @param {string | null | undefined} cur */
export function setNumbersCurrency(cur) {
  const neu = String(cur || 'EUR').toUpperCase();
  if (neu === _currency) return;
  _currency = neu;
  if (typeof document !== 'undefined')
    document.querySelectorAll('[data-i18n-betrag]').forEach(el => {
      writeI18n(/** @type {HTMLElement} */ (el));
    });
}

/**
 * Number and date format: the browser's regional form if it matches the language (de-DE
 * 1.097,93, de-CH 1’097.93). Otherwise for German the form matching the account currency: CHF writes
 * Swiss, everything else German format; a browser without a region ("de") is no hint at Switzerland.
 */
export function locale() {
  const browser = (typeof navigator !== 'undefined' && navigator.language) || '';
  const passt = new RegExp(`^${LANG === 'en' ? 'en' : 'de'}-[A-Za-z]{2}$`).test(browser);
  if (passt) return browser;
  if (LANG === 'en') return 'en-GB';
  return _currency === 'CHF' ? 'de-CH' : 'de-DE';
}

/**
 * Escape HTML special characters — twin of esc() from js/escaping.js.
 *
 * Deliberately duplicated here and not imported: i18n.js is loaded BEFORE the core modules (see the
 * script order in index.html), so esc() does not exist yet at the time of the first t() calls.
 * @param {unknown} v
 * @returns {string}
 */
function _i18nEsc(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Plural according to the language's rules: if {n} or {count} is a number and "key_one" (or
 * _few, _many …) exists, that form applies. Fixed forms like "{n} Typen" otherwise yielded "1 Typen".
 * @param {Record<string,string>} dict
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 */
function pluralKey(dict, key, vars) {
  const zahl = vars ? (vars.n ?? vars.count) : undefined;
  if (typeof zahl !== 'number' || !Number.isFinite(zahl)) return key;
  const form = key + '_' + new Intl.PluralRules(locale()).select(zahl);
  return dict[form] || I18N.de?.[form] ? form : key;
}

/**
 * Get translated text as markup: the values are escaped and the result is SafeHtml, so that tsc
 * reports when it ends up in textContent, toast() or a dialog text — there it would show "&amp;". For
 * plain text there is tRaw().
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {SafeHtml}
 */
export function t(key, vars) {
  // Both may be missing (only one language file loaded) — {} as the last level, then the fallback to
  // the key itself applies.
  const dict = I18N[LANG] || I18N.de || I18N.en || {};
  // I18N['de'] is NOT guaranteed to exist — with the English UI only locales/en.js is loaded. The
  // fallback therefore only applies if German is actually there; otherwise the key itself stays as
  // the last level.
  const k = pluralKey(dict, key, vars);
  let str = dict[k] || I18N.de?.[k] || key;
  if (vars) {
    Object.keys(vars).forEach(k => {
      str = str.replaceAll('{' + k + '}', _i18nEsc(vars[k]));
    });
  }
  return new SafeHtml(str);
}

/**
 * Like t(), but WITHOUT escaping the variables.
 *
 * For plain text: textContent, attributes via setAttribute, toast() and dialog texts. In html`` the
 * result is escaped there.
 *
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function tRaw(key, vars) {
  // Both may be missing (only one language file loaded) — {} as the last level, then the fallback to
  // the key itself applies.
  const dict = I18N[LANG] || I18N.de || I18N.en || {};
  // I18N['de'] is NOT guaranteed to exist — with the English UI only locales/en.js is loaded. The
  // fallback therefore only applies if German is actually there; otherwise the key itself stays as
  // the last level.
  const k = pluralKey(dict, key, vars);
  let str = dict[k] || I18N.de?.[k] || key;
  if (vars) {
    Object.keys(vars).forEach(k => {
      str = str.replaceAll('{' + k + '}', String(vars[k] ?? ''));
    });
  }
  return str;
}

// The most recently applied language. checkAuth() and showApp() call applyLang() at startup with the same value;
// without this guard the retranslation including the rebuild of the active list ran twice.
/** @type {string | null} */
let _langApplied = null;

/**
 * Translate color names only in the display: data and BrickLink queries need the English names. A
 * vocabulary instead of a list of all colors, so that new Rebrickable colors become readable too.
 */
/** @type {Record<string, string>} */
const COLOR_WORDS_DE = {
  // Modifiers
  dark: 'Dunkel',
  light: 'Hell',
  medium: 'Mittel',
  bright: 'Leucht',
  very: 'Sehr',
  reddish: 'Rötlich',
  bluish: 'Bläulich',
  yellowish: 'Gelblich',
  'dark-': 'Dunkel',
  trans: 'Trans',
  transparent: 'Transparent',
  neon: 'Neon',
  glitter: 'Glitzer',
  speckle: 'Gesprenkelt',
  metallic: 'Metallic',
  pearl: 'Perl',
  satin: 'Satin',
  chrome: 'Chrom',
  flat: 'Matt',
  opal: 'Opal',
  milky: 'Milchig',
  glow: 'Leucht',
  in: 'im',
  the: '',
  dark2: 'Dunkeln',
  fabuland: 'Fabuland',
  modulex: 'Modulex',
  // Base colors
  red: 'Rot',
  blue: 'Blau',
  green: 'Grün',
  yellow: 'Gelb',
  white: 'Weiss',
  black: 'Schwarz',
  gray: 'Grau',
  grey: 'Grau',
  brown: 'Braun',
  orange: 'Orange',
  purple: 'Violett',
  violet: 'Violett',
  pink: 'Rosa',
  tan: 'Beige',
  lime: 'Limette',
  azure: 'Azur',
  aqua: 'Aquamarin',
  magenta: 'Magenta',
  olive: 'Oliv',
  sand: 'Sand',
  salmon: 'Lachs',
  gold: 'Gold',
  silver: 'Silber',
  copper: 'Kupfer',
  bronze: 'Bronze',
  clear: 'Klar',
  nougat: 'Nougat',
  lavender: 'Lavendel',
  turquoise: 'Türkis',
  coral: 'Koralle',
  maroon: 'Kastanie',
  teal: 'Petrol',
  beige: 'Beige',
  rust: 'Rost',
  khaki: 'Khaki',
  ochre: 'Ocker',
  plum: 'Pflaume',
  burgundy: 'Bordeaux',
  unknown: 'Unbekannt',
  none: 'Ohne',
  no: 'Kein',
  color: 'Farbe',
  colour: 'Farbe',
};

/** Words that are written together with the following one in German. */
const COLOR_PREFIX_DE = new Set([
  'Dunkel',
  'Hell',
  'Mittel',
  'Leucht',
  'Perl',
  'Matt',
  'Neon',
  'Rötlich',
  'Bläulich',
  'Gelblich',
  'Sand',
  'Metallic',
  'Chrom',
  'Satin',
  'Opal',
  'Milchig',
  'Glitzer',
]);

/**
 * Color name in the UI language; without a name an empty text.
 * @param {string | null | undefined} en
 * @returns {string}
 */
export function colorName(en) {
  if (!en) return '';
  if (LANG !== 'de') return en;

  // Hyphens are kept ("Trans-Clear" → "Trans-Klar").
  const parts = String(en).split(/(\s+|-)/);
  const out = [];
  for (const tok of parts) {
    if (/^\s+$/.test(tok)) {
      out.push(' ');
      continue;
    }
    if (tok === '-') {
      out.push('-');
      continue;
    }
    const de = COLOR_WORDS_DE[tok.toLowerCase()];
    out.push(de === undefined ? tok : de); // unknown: leave it English
  }

  // Attach known modifiers to the next word ("Dunkelbläulichgrau"), leave unknown words separate.
  // Decided on the previous token, not on the compound — otherwise the chain would break after the second link
  // ab.
  let res = '';
  let joinNext = false;
  for (const cur of out) {
    if (cur === ' ') {
      if (!joinNext) res += ' ';
      continue;
    }
    if (cur === '-') {
      res += '-';
      joinNext = false;
      continue;
    }
    res += joinNext ? cur.charAt(0).toLowerCase() + cur.slice(1) : cur;
    joinNext = COLOR_PREFIX_DE.has(cur);
  }
  return res.replace(/\s{2,}/g, ' ').trim();
}

/** Rewrite an element with data-i18n. @param {HTMLElement} el */
function writeI18n(el) {
  const key = el.dataset.i18n;
  const attr = el.dataset.i18nAttr; // optional: 'placeholder', 'title', etc.
  // optional: data-i18n-vars='{"n":"4000"}' for parameterized static texts
  let vars;
  if (el.dataset.i18nVars) {
    try {
      vars = JSON.parse(el.dataset.i18nVars);
    } catch (_) {}
  }
  // data-i18n-betrag: an example amount in the UI's number format ("e.g. 79.99").
  if (el.dataset.i18nBetrag)
    vars = {
      ...vars,
      betrag: new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, useGrouping: false }).format(
        Number(el.dataset.i18nBetrag),
      ),
    };
  const val = tRaw(key ?? '', vars);
  if (attr) el.setAttribute(attr, val);
  else if (el.dataset.ico) {
    // Icon before the text: data-ico names it, the text stays translatable.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + el.dataset.ico);
    svg.appendChild(use);
    const text = document.createElement('span');
    text.className = 'ico-text';
    text.textContent = val;
    el.replaceChildren(svg, text);
  } else el.textContent = val;
}

/**
 * Apply the language and rewrite all statically translated places.
 * @param {string} lang 'de' or 'en'
 * @param {boolean} persist also save it on the account
 */
export function applyLang(lang, persist) {
  // Language not loaded yet: load it and start over. A silent return would mean that clicking
  // English does nothing. Synchronous, so that the roughly twenty call sites stay as they are.
  if (!I18N[lang]) {
    loadLang(lang).then(() => {
      if (I18N[lang]) applyLang(lang, persist);
    });
    return;
  }
  if (_langApplied === lang && !persist) return; // nichts zu tun
  const isRealSwitch = _langApplied !== null && _langApplied !== lang;
  _langApplied = lang;
  LANG = lang;
  localStorage.setItem('bim_lang', lang);

  // Update <html lang="..."> for accessibility / browser spellcheck
  document.documentElement.lang = lang;

  // Re-render all elements that carry a data-i18n attribute
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n]')).forEach(writeI18n);

  // A second attribute per element, usually the name of a field next to its placeholder.
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n-aria]')).forEach(el => {
    el.setAttribute('aria-label', tRaw(el.dataset.i18nAria ?? ''));
  });

  // Re-render nav tab labels
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.ntab[data-i18n-tab]')).forEach(el => {
    const label = el.querySelector('.tab-label');
    if (label) label.textContent = tRaw(el.dataset.i18nTab ?? '');
  });

  // Sync the language dropdown in settings (if rendered)
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('lang-select'));
  if (sel) sel.value = lang;

  // Saving (account.js) and reloading the open tab (navigation.js) listen to this
  // event: the translation itself knows no view.
  emit('spracheGewechselt', { sprache: lang, speichern: !!persist, realSwitch: !!isRealSwitch });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set the active language without the full retranslation of applyLang().
 *
 * session.js needs this at startup to adopt the value stored in localStorage before the
 * UI is in place. Imported bindings are read-only in ES modules, hence this path instead of `LANG
 * = …`.
 *
 * @param {string} lang
 */
export function setLangValue(lang) {
  LANG = lang;
}
