import { melde } from './js/00-ereignisse.js';
import { SicheresHtml } from './js/00-escapen.js';

// Minimales Übersetzungs-System: t('key', {name}) liefert den Text. Die Sprache wird im localStorage gemerkt,
// damit beim nächsten Laden nichts verzögert. Nur die aktive Sprache wird ausgeliefert.
// Ausführlich: docs/begruendungen/public/i18n.js.md#minimales-uebersetzungs-system-sprache-w

/**
 * Wörterbuch der geladenen Sprachen. Mindestens eine ist beim Start da; die zweite kommt per loadLang() dazu.
 * @type {Record<string, Record<string,string>>}
 */
export const I18N = {};
if (window.I18N_DE) I18N.de = window.I18N_DE;
if (window.I18N_EN) I18N.en = window.I18N_EN;

/**
 * Eine Sprachdatei nachladen, bevor neu übersetzt wird: Sonst stünden eine halbe Sekunde lang Schlüsselnamen
 * da. Scheitert es, bleibt die bisherige Sprache — der Aufrufer prüft I18N[lang].
 * Ausführlich: docs/begruendungen/public/i18n.js.md#loadlang
 * @param {string} lang 'de' oder 'en'
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
    s.onerror = () => resolve();   // Fehler: bisherige Sprache behalten
    document.head.appendChild(s);
  });
}


// Active language – loaded from localStorage first (instant), then from server
const _browserLang = navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
export let LANG = localStorage.getItem('bim_lang') || _browserLang;

/**
 * Translate a key. Supports {placeholder} substitution. Falls back to the key itself if not found.
 */
/** Währung des Kontos; ohne passende Browserregion bestimmt sie das Zahlenformat. */
let _waehrung = 'EUR';
/** @param {string | null | undefined} cur */
export function setzeZahlenWaehrung(cur) {
  const neu = String(cur || 'EUR').toUpperCase();
  if (neu === _waehrung) return;
  _waehrung = neu;
  if (typeof document !== 'undefined') document.querySelectorAll('[data-i18n-betrag]').forEach(el => schreibeI18n(/** @type {HTMLElement} */ (el)));
}

/**
 * Zahlen- und Datumsformat: die Landesform des Browsers, wenn sie zur Sprache passt (de-DE
 * 1.097,93, de-CH 1’097.93). Sonst bei Deutsch die Form zur Kontowährung: CHF schreibt
 * Schweizer, alles andere deutsches Format; ein Browser ohne Region („de“) ist kein Hinweis auf die Schweiz.
 */
export function locale() {
  const browser = (typeof navigator !== 'undefined' && navigator.language) || '';
  const passt = new RegExp(`^${LANG === 'en' ? 'en' : 'de'}-[A-Za-z]{2}$`).test(browser);
  if (passt) return browser;
  if (LANG === 'en') return 'en-GB';
  return _waehrung === 'CHF' ? 'de-CH' : 'de-DE';
}

/**
 * HTML-Sonderzeichen maskieren — Zwilling von esc() aus js/00-escapen.js.
 *
 * Bewusst hier dupliziert und nicht importiert: i18n.js wird VOR den Kernmodulen geladen (siehe
 * Skript-Reihenfolge in index.html), esc() existiert zum Zeitpunkt der ersten t()-Aufrufe also noch nicht.
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
 * Mehrzahl nach den Regeln der Sprache: Ist {n} oder {count} eine Zahl und gibt es „schlüssel_one“ (bzw.
 * _few, _many …), gilt diese Form. Feste Formen wie „{n} Typen“ ergaben sonst „1 Typen“.
 * @param {Record<string,string>} dict
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 */
function mehrzahlSchluessel(dict, key, vars) {
  const zahl = vars ? (vars.n ?? vars.count) : undefined;
  if (typeof zahl !== 'number' || !Number.isFinite(zahl)) return key;
  const form = key + '_' + new Intl.PluralRules(locale()).select(zahl);
  return (dict[form] || I18N['de']?.[form]) ? form : key;
}

/**
 * Übersetzten Text als Markup holen: Die Werte werden maskiert und das Ergebnis ist SicheresHtml, damit tsc
 * meldet, wenn es in textContent, toast() oder einen Dialogtext geriete — dort stünde sonst „&amp;“. Für
 * reinen Text gibt es tRaw().
 * Ausführlich: docs/begruendungen/public/i18n.js.md#t
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {SicheresHtml}
 */
export function t(key, vars) {
  // Beide können fehlen (nur eine Sprachdatei geladen) — {} als letzte Stufe, dann greift der Rückfall auf
  // den Schlüssel selbst.
  const dict = I18N[LANG] || I18N['de'] || I18N['en'] || {};
  // I18N['de'] ist NICHT garantiert vorhanden — bei englischer Oberfläche wird nur locales/en.js geladen. Der
  // Rückfall greift deshalb nur, wenn Deutsch tatsächlich da ist; sonst bleibt der Schlüssel selbst als
  // letzte Stufe.
  const k = mehrzahlSchluessel(dict, key, vars);
  let str = dict[k] || I18N['de']?.[k] || key;
  if (vars) {
    Object.keys(vars).forEach(k => { str = str.replaceAll('{' + k + '}', _i18nEsc(vars[k])); });
  }
  return new SicheresHtml(str);
}

/**
 * Wie t(), aber OHNE Maskierung der Variablen.
 *
 * Für reinen Text: textContent, Attribute per setAttribute, toast() und Dialogtexte. In html`` wird das
 * Ergebnis dort maskiert.
 *
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function tRaw(key, vars) {
  // Beide können fehlen (nur eine Sprachdatei geladen) — {} als letzte Stufe, dann greift der Rückfall auf
  // den Schlüssel selbst.
  const dict = I18N[LANG] || I18N['de'] || I18N['en'] || {};
  // I18N['de'] ist NICHT garantiert vorhanden — bei englischer Oberfläche wird nur locales/en.js geladen. Der
  // Rückfall greift deshalb nur, wenn Deutsch tatsächlich da ist; sonst bleibt der Schlüssel selbst als
  // letzte Stufe.
  const k = mehrzahlSchluessel(dict, key, vars);
  let str = dict[k] || I18N['de']?.[k] || key;
  if (vars) {
    Object.keys(vars).forEach(k => { str = str.replaceAll('{' + k + '}', String(vars[k] ?? '')); });
  }
  return str;
}

// Die zuletzt angewendete Sprache. checkAuth() und showApp() rufen applyLang() beim Start mit demselben Wert
// auf; ohne diese Sperre lief die Neuübersetzung samt Neuaufbau der aktiven Liste zweimal.
/** @type {string | null} */
let _langApplied = null;


/**
 * Farbnamen nur in der Anzeige übersetzen: Daten und BrickLink-Abfragen brauchen die englischen Namen. Ein
 * Wortschatz statt einer Liste aller Farben, damit auch neue Rebrickable-Farben lesbar werden.
 * Ausführlich: docs/begruendungen/public/i18n.js.md#color-words-de
 */
/** @type {Record<string, string>} */
const COLOR_WORDS_DE = {
  // Modifikatoren
  'dark':'Dunkel','light':'Hell','medium':'Mittel','bright':'Leucht','very':'Sehr',
  'reddish':'Rötlich','bluish':'Bläulich','yellowish':'Gelblich','dark-':'Dunkel',
  'trans':'Trans','transparent':'Transparent','neon':'Neon','glitter':'Glitzer',
  'speckle':'Gesprenkelt','metallic':'Metallic','pearl':'Perl','satin':'Satin',
  'chrome':'Chrom','flat':'Matt','opal':'Opal','milky':'Milchig','glow':'Leucht',
  'in':'im','the':'','dark2':'Dunkeln','fabuland':'Fabuland','modulex':'Modulex',
  // Grundfarben
  'red':'Rot','blue':'Blau','green':'Grün','yellow':'Gelb','white':'Weiss',
  'black':'Schwarz','gray':'Grau','grey':'Grau','brown':'Braun','orange':'Orange',
  'purple':'Violett','violet':'Violett','pink':'Rosa','tan':'Beige','lime':'Limette',
  'azure':'Azur','aqua':'Aquamarin','magenta':'Magenta','olive':'Oliv','sand':'Sand',
  'salmon':'Lachs','gold':'Gold','silver':'Silber','copper':'Kupfer','bronze':'Bronze',
  'clear':'Klar','nougat':'Nougat','lavender':'Lavendel','turquoise':'Türkis',
  'coral':'Koralle','maroon':'Kastanie','teal':'Petrol','beige':'Beige','rust':'Rost',
  'khaki':'Khaki','ochre':'Ocker','plum':'Pflaume','burgundy':'Bordeaux',
  'unknown':'Unbekannt','none':'Ohne','no':'Kein','color':'Farbe','colour':'Farbe',
};

/** Wörter, die im Deutschen mit dem folgenden zusammengeschrieben werden. */
const COLOR_PREFIX_DE = new Set([
  'Dunkel','Hell','Mittel','Leucht','Perl','Matt','Neon','Rötlich','Bläulich',
  'Gelblich','Sand','Metallic','Chrom','Satin','Opal','Milchig','Glitzer',
]);

/**
 * Farbname in der Sprache der Oberfläche; ohne Namen ein leerer Text.
 * @param {string | null | undefined} en
 * @returns {string}
 */
export function colorName(en) {
  if (!en) return '';
  if (LANG !== 'de') return en;

  // Bindestriche bleiben erhalten („Trans-Clear" → „Trans-Klar").
  const parts = String(en).split(/(\s+|-)/);
  const out = [];
  for (const tok of parts) {
    if (/^\s+$/.test(tok)) { out.push(' '); continue; }
    if (tok === '-') { out.push('-'); continue; }
    const de = COLOR_WORDS_DE[tok.toLowerCase()];
    out.push(de === undefined ? tok : de);     // unbekannt: englisch lassen
  }

  // Bekannte Modifikatoren ans nächste Wort hängen („Dunkelbläulichgrau“), unbekannte Wörter getrennt lassen.
  // Entschieden am vorigen Token, nicht am Zusammengesetzten — sonst bräche die Kette nach dem zweiten Glied
  // ab.
  // Ausführlich: docs/begruendungen/public/i18n.js.md#res
  let res = '';
  let joinNext = false;
  for (const cur of out) {
    if (cur === ' ') { if (!joinNext) res += ' '; continue; }
    if (cur === '-') { res += '-'; joinNext = false; continue; }
    res += joinNext ? (cur.charAt(0).toLowerCase() + cur.slice(1)) : cur;
    joinNext = COLOR_PREFIX_DE.has(cur);
  }
  return res.replace(/\s{2,}/g, ' ').trim();
}

/** Ein Element mit data-i18n neu schreiben. @param {HTMLElement} el */
function schreibeI18n(el) {
  const key = el.dataset.i18n;
  const attr = el.dataset.i18nAttr;   // optional: 'placeholder', 'title', etc.
  // optional: data-i18n-vars='{"n":"4000"}' für parametrisierte statische Texte
  let vars;
  if (el.dataset.i18nVars) { try { vars = JSON.parse(el.dataset.i18nVars); } catch (_) {} }
  // data-i18n-betrag: ein Beispielbetrag im Zahlenformat der Oberfläche („z. B. 79,99“).
  if (el.dataset.i18nBetrag) vars = { ...vars, betrag: new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, useGrouping: false }).format(Number(el.dataset.i18nBetrag)) };
  const val = tRaw(key ?? '', vars);
  if (attr) el.setAttribute(attr, val);
  else if (el.dataset.ico) {
    // Symbol vor dem Text: data-ico nennt es, der Text bleibt übersetzbar.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + el.dataset.ico);
    svg.appendChild(use);
    const text = document.createElement('span');
    text.className = 'ico-text'; text.textContent = val;
    el.replaceChildren(svg, text);
  } else el.textContent = val;
}

/**
 * Sprache anwenden und alle statisch übersetzten Stellen neu schreiben.
 * @param {string} lang 'de' oder 'en'
 * @param {boolean} persist auch am Konto speichern
 */
export function applyLang(lang, persist) {
  // Sprache noch nicht geladen: nachladen und erneut anlaufen. Ein stilles return hiesse, der Klick auf
  // Englisch tut nichts. Synchron, damit die rund zwanzig Aufrufstellen bleiben, wie sie sind.
  // Ausführlich: docs/begruendungen/public/i18n.js.md#if
  if (!I18N[lang]) {
    loadLang(lang).then(() => { if (I18N[lang]) applyLang(lang, persist); });
    return;
  }
  if (_langApplied === lang && !persist) return;   // nichts zu tun
  const isRealSwitch = _langApplied !== null && _langApplied !== lang;
  _langApplied = lang;
  LANG = lang;
  localStorage.setItem('bim_lang', lang);

  // Update <html lang="..."> for accessibility / browser spellcheck
  document.documentElement.lang = lang;

  // Re-render all elements that carry a data-i18n attribute
  /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('[data-i18n]')).forEach(schreibeI18n);

  // Ein zweites Attribut je Element, meist der Name eines Feldes neben seinem Platzhalter.
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

  // Speichern (01-konto.js) und das Neuladen des offenen Reiters (25-navigation.js) hören auf dieses
  // Ereignis: Die Übersetzung selbst kennt keine Ansicht.
  melde('spracheGewechselt', { sprache: lang, speichern: !!persist, echterWechsel: !!isRealSwitch });
}

// ─────────────────────────────────────────────────────────────────────────────


/**
 * Aktive Sprache setzen, ohne die volle Neuübersetzung von applyLang().
 *
 * Braucht 26-sitzung.js beim Start, um den in localStorage gespeicherten Wert zu übernehmen, bevor die
 * Oberfläche steht. Importierte Bindungen sind in ES-Modulen schreibgeschützt, deshalb dieser Weg statt `LANG
 * = …`.
 *
 * @param {string} lang
 */
export function setLangValue(lang) { LANG = lang; }
