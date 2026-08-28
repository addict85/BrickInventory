import { api, loadMonitor } from './js/01-core.js';
import { renderGallery } from './js/02-gallery.js';
import { loadParts } from './js/03-parts.js';
import { loadFinance } from './js/04-finance.js';
import { loadCacheStats, loadProfile, loadSettings } from './js/05-settings.js';
import { loadManualParts, loadMinifigs } from './js/06-minifigs.js';

// ── i18n ─────────────────────────────────────────────────────────────────────
// Minimales Übersetzungs-System. Sprache wird beim App-Start aus den User-
// Settings geladen und im localStorage gecacht, damit beim nächsten Seitenlade
// keine sichtbare Verzögerung entsteht.
//
// Nutzung: t('key') → übersetzter String
// Mit Platzhaltern: t('key', {name: 'Foo'}) → 'Hello Foo'
//
// ── Sprachen liegen in eigenen Dateien ──────────────────────────────────────
// Beide Wörterbücher standen früher hier — zusammen rund 60 KB, die vollständig
// ins Frontend-Bündel wanderten. Jeder Nutzer lud damit dauerhaft die Sprache
// mit, die er nie sieht.
//
// Jetzt: index.html bindet nur die aktive Sprache ein (locales/de.js bzw.
// locales/en.js, ausgewählt serverseitig anhand des gespeicherten Werts), und
// ein Sprachwechsel holt die andere Datei einmalig nach. Dass beide Dateien
// window.I18N_DE / window.I18N_EN setzen, hält den Ablauf ohne Modulsystem
// einfach — der Rest des Frontends ist ebenfalls klassisches JavaScript.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wörterbuch der geladenen Sprachen. Mindestens eine ist beim Start da; die
 * zweite kommt per loadLang() dazu.
 * @type {Record<string, Record<string,string>>}
 */
export const I18N = {};
if (window.I18N_DE) I18N.de = window.I18N_DE;
if (window.I18N_EN) I18N.en = window.I18N_EN;

/**
 * Eine Sprachdatei nachladen, falls sie noch nicht da ist.
 *
 * Wird von applyLang() aufgerufen, BEVOR neu übersetzt wird. Ohne das Warten
 * würde der erste Wechsel eine halbe Sekunde lang Schlüsselnamen statt Text
 * zeigen (t() fällt auf den Schlüssel zurück, wenn nichts gefunden wird).
 *
 * Schlägt das Laden fehl (offline, Datei fehlt), bleibt die bisherige Sprache
 * aktiv — das ist der harmlose Ausgang. Die Zusage lautet deshalb "versucht zu
 * laden", nicht "hat geladen"; der Aufrufer prüft I18N[lang].
 *
 * @param {string} lang 'de' oder 'en'
 * @returns {Promise<void>}
 */
function loadLang(lang) {
  if (I18N[lang]) return Promise.resolve();
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '/locales/' + lang + '.js?v=' + (window.__APP_VERSION || '');
    s.onload = () => {
      const dict = window['I18N_' + lang.toUpperCase()];
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
 * Translate a key. Supports {placeholder} substitution.
 * Falls back to the key itself if not found.
 */
/**
 * Sprachabhängige Zahlen-/Datumslocale für toLocaleString & Intl.NumberFormat.
 * 'de-CH' behält das gewohnte CH-Format (Apostroph-Tausendertrennung) bei Deutsch.
 */
export function locale() { return LANG === 'en' ? 'en-GB' : 'de-CH'; }

/**
 * HTML-Sonderzeichen maskieren — Zwilling von esc() aus js/01-core.js.
 *
 * Bewusst hier dupliziert und nicht importiert: i18n.js wird VOR 01-core.js
 * geladen (siehe Skript-Reihenfolge in index.html), esc() existiert zum
 * Zeitpunkt der ersten t()-Aufrufe also noch nicht.
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
 * Übersetzten Text holen und {platzhalter} ersetzen.
 *
 * Die eingesetzten Werte werden MASKIERT. Fast jede Aufrufstelle schiebt das
 * Ergebnis in innerHTML (`el.innerHTML = t('gallery.no_results', {query: q})`),
 * und q ist eine Nutzereingabe — vorher landete sie ungefiltert im DOM. Heute
 * ist das dank der CSP ohne 'unsafe-inline' schwer ausnutzbar, aber es ist die
 * Sorte Lücke, die beim nächsten Wert aus der Datenbank statt aus dem Suchfeld
 * scharf wird.
 *
 * Die Übersetzungstexte selbst enthalten kein Markup (geprüft: null Treffer),
 * die Maskierung kann hier also nichts zerstören. Braucht eine Stelle je
 * bewusst HTML in einer Variablen, gibt es tRaw() darunter.
 *
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  // Beide können fehlen (nur eine Sprachdatei geladen) — {} als letzte Stufe,
  // dann greift der Rückfall auf den Schlüssel selbst.
  const dict = I18N[LANG] || I18N['de'] || I18N['en'] || {};
  // I18N['de'] ist NICHT garantiert vorhanden — bei englischer Oberfläche wird
  // nur locales/en.js geladen. Der Rückfall greift deshalb nur, wenn Deutsch
  // tatsächlich da ist; sonst bleibt der Schlüssel selbst als letzte Stufe.
  let str = dict[key] || I18N['de']?.[key] || key;
  if (vars) {
    Object.keys(vars).forEach(k => { str = str.replaceAll('{' + k + '}', _i18nEsc(vars[k])); });
  }
  return str;
}

/**
 * Wie t(), aber OHNE Maskierung der Variablen.
 *
 * Nur benutzen, wenn das Ergebnis nachweislich nicht in innerHTML landet oder
 * die Werte selbst schon maskiert sind. Aktuell gibt es keine Aufrufstelle —
 * die Funktion existiert, damit ein künftiger Sonderfall nicht dazu verleitet,
 * die Maskierung in t() wieder auszubauen.
 *
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function tRaw(key, vars) {
  // Beide können fehlen (nur eine Sprachdatei geladen) — {} als letzte Stufe,
  // dann greift der Rückfall auf den Schlüssel selbst.
  const dict = I18N[LANG] || I18N['de'] || I18N['en'] || {};
  // I18N['de'] ist NICHT garantiert vorhanden — bei englischer Oberfläche wird
  // nur locales/en.js geladen. Der Rückfall greift deshalb nur, wenn Deutsch
  // tatsächlich da ist; sonst bleibt der Schlüssel selbst als letzte Stufe.
  let str = dict[key] || I18N['de']?.[key] || key;
  if (vars) {
    Object.keys(vars).forEach(k => { str = str.replaceAll('{' + k + '}', String(vars[k] ?? '')); });
  }
  return str;
}

/**
 * Apply the given language code and re-render all translateable static DOM nodes.
 * @param {string} lang  'de' or 'en'
 * @param {boolean} [persist]  whether to save to localStorage + server
 */
// Merkt sich, welche Sprache zuletzt tatsächlich angewendet wurde.
// Beim Start ruft checkAuth() applyLang() auf und showApp() gleich noch einmal
// mit demselben Wert — ohne diese Sperre lief die komplette Neuübersetzung
// samt Neuaufbau der aktiven Liste zweimal.
let _langApplied = null;


/**
 * Farbnamen übersetzen.
 *
 * Die Namen kommen von Rebrickable und sind immer englisch — sie stehen so in
 * der Datenbank und werden für BrickLink-Abfragen gebraucht. Übersetzt wird
 * deshalb nur die ANZEIGE, die Daten bleiben unverändert.
 *
 * LEGO-Farbnamen sind zusammengesetzt („Dark Bluish Gray", „Trans-Neon Green"),
 * deshalb ein Wortschatz statt einer Liste aller ~200 Farben: Jedes Wort wird
 * einzeln übersetzt, unbekannte bleiben stehen. Neue Farben von Rebrickable
 * ergeben damit automatisch etwas Lesbares.
 */
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

export function colorName(en) {
  if (!en) return en;
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

  // Modifikatoren an das folgende Wort anschliessen und dieses kleinschreiben:
  // „Dunkel Bläulich Grau" → „Dunkelbläulichgrau", wie es im Deutschen üblich
  // ist. Nur bei bekannten Modifikatoren — unbekannte Wörter bleiben getrennt,
  // sonst entstünde aus einer neuen Rebrickable-Farbe ein Wortungetüm.
  // Am vorigen TOKEN entscheiden, nicht am bereits Zusammengesetzten: Nach
  // „Dunkel"+"bläulich" hiesse der Wortanfang sonst „Dunkelbläulich" und wäre
  // kein bekannter Modifikator mehr — „Dunkelbläulich Grau" statt
  // „Dunkelbläulichgrau".
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

export function applyLang(lang, persist) {
  // Sprache noch nicht geladen? Nachholen und danach erneut anlaufen.
  //
  // VORHER stand hier ein blosses `return` — solange beide Wörterbücher
  // eingebaut waren, konnte der Fall nicht eintreten. Seit nur die aktive
  // Sprache ausgeliefert wird, ist der erste Wechsel genau dieser Fall, und
  // ein stilles return hiesse: Der Nutzer klickt auf Englisch und nichts
  // passiert. Die Funktion bleibt synchron, damit die rund zwanzig
  // Aufrufstellen unverändert bleiben; nachgeladen wird im Hintergrund.
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
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const attr = el.dataset.i18nAttr;   // optional: 'placeholder', 'title', etc.
    // optional: data-i18n-vars='{"n":"4000"}' für parametrisierte statische Texte
    let vars;
    if (el.dataset.i18nVars) { try { vars = JSON.parse(el.dataset.i18nVars); } catch (_) {} }
    const val = t(key, vars);
    if (attr) el.setAttribute(attr, val);
    else el.textContent = val;
  });

  // Re-render nav tab labels
  document.querySelectorAll('.ntab[data-i18n-tab]').forEach(el => {
    const label = el.querySelector('.tab-label');
    if (label) label.textContent = t(el.dataset.i18nTab);
  });

  // Sync the language dropdown in settings (if rendered)
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = lang;

  if (persist) {
    api('POST', '/settings', { language: lang }).catch(() => {});
  }

  // Aktiven Tab neu aufbauen, damit auch dynamisch erzeugte Texte umschalten —
  // aber NUR bei einem echten Sprachwechsel.
  //
  // Vorher lief dieser Block bei JEDEM Aufruf, also auch beim Start, wo
  // applyLang() zweimal mit derselben Sprache kommt (checkAuth und showApp).
  // Für die Galerie stand hier `renderGallery(); loadGallery();` — und
  // loadGallery() leert das Grid sofort auf einen Spinner und holt die Sets neu
  // vom Server. Ergebnis war der sichtbare Doppel-Neuaufbau beim Neuladen und
  // direkt nach dem Login: Inhalt → leer → Inhalt → leer → Inhalt.
  //
  // Beim ersten Anwenden gibt es nichts nachzuziehen: Der normale Startpfad
  // (showApp → loadGallery) lädt ohnehin gleich alles. Nur wenn der Nutzer die
  // Sprache tatsächlich umstellt — oder die Servereinstellung von der lokal
  // gespeicherten abweicht — muss der aktive Tab neu geladen werden.
  if (!isRealSwitch) return;

  const activeTab = document.querySelector('.ntab.active')?.dataset?.tab;
  if (activeTab) {
    if (activeTab === 'parts')     { if (typeof loadParts     === 'function') { loadParts(); loadManualParts(); } }
    if (activeTab === 'minifigs')  { if (typeof loadMinifigs  === 'function') loadMinifigs(); }
    if (activeTab === 'finance')   { if (typeof loadFinance   === 'function') loadFinance(); }
    if (activeTab === 'settings')  { if (typeof loadSettings  === 'function') { loadSettings(); loadProfile(); } }
    if (activeTab === 'monitor')   { if (typeof loadMonitor   === 'function') { loadMonitor(); loadCacheStats(); } }
    // Galerie: aus den bereits geladenen Sets neu zeichnen. Ein loadGallery()
    // stand hier zusätzlich — überflüssig, weil ein Sprachwechsel keine Daten
    // ändert, und teuer, weil es das Grid zwischendurch leert.
    if (activeTab === 'gallery')   { if (typeof renderGallery === 'function') renderGallery(); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────


/**
 * Aktive Sprache setzen, ohne die volle Neuübersetzung von applyLang().
 *
 * Braucht 01-core.js beim Start, um den in localStorage gespeicherten Wert zu
 * übernehmen, bevor die Oberfläche steht. Importierte Bindungen sind in
 * ES-Modulen schreibgeschützt, deshalb dieser Weg statt `LANG = …`.
 *
 * @param {string} lang
 */
export function setLangValue(lang) { LANG = lang; }
