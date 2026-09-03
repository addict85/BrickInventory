/**
 * Was der Kontofilter neu lädt, muss den Kontofilter auch mitschicken.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * `onScopeChange('gallery')` in 02-gallery.js ruft zwei Dinge auf:
 *
 *     if (view === 'gallery')  { loadGallery(); loadStats(); }
 *
 * `loadGallery()` schickte den Filter mit, `loadStats()` nicht — es rief
 * schlicht `api('GET', '/v1/stats')`. Die Route wertet `accounts` aus
 * (routes/api_v1/misc.ts, parseScopeMode), bekam ihn aber nie.
 *
 * Wer auf „nur meine" stellte, sah darunter eine gefilterte Liste und darüber
 * weiter die Zahlen des ganzen Haushalts — Sets, Teile, Minifiguren,
 * Anleitungen. Am Telefon stimmten beide: Die App schickt accounts an
 * /v1/stats seit jeher.
 *
 * ── Warum das ein BEWEIS ist und keine Vermutung ────────────────────────────
 * Der Aufruf von `loadStats()` steht IM Filterwechsel. Etwas neu zu laden, das
 * sich durch den Wechsel gar nicht ändern kann, ergibt nur einen Sinn, wenn es
 * sich ändern sollte. Die Absicht steht also im Code selbst — sie war nur
 * nicht umgesetzt.
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 * Beide Seiten werden gelesen: WAS der Filterwechsel neu lädt (aus
 * onScopeChange) und OB die dazugehörige Ladefunktion den Filter mitgibt.
 * Kommt eine vierte Ansicht dazu oder lädt ein Wechsel etwas Weiteres nach,
 * ist es von selbst mitgeprüft. Eine Liste hier wäre eine zweite Wahrheit,
 * die beim nächsten Umbau still veraltet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const JS = path.join(__dirname, '..', 'public', 'js');

/** Alle Frontend-Module als ein Text — die Ladefunktionen liegen verstreut. */
function alleModule() {
  const teile = {};
  for (const f of fs.readdirSync(JS)) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    teile[f] = ohneKommentare(fs.readFileSync(path.join(JS, f), 'utf8'));
  }
  return teile;
}

/**
 * Rumpf einer Funktion ab ihrem Namen bis zur schliessenden Klammer.
 * Geklammert gezählt statt über ein festes Zeilenfenster: Ein gewachsener
 * Erklärkommentar hat in diesem Baum schon mehrfach genau so eine Prüfung
 * gebrochen (siehe helpers/sources.js).
 */
function rumpf(src, kopf) {
  const i = src.indexOf(kopf);
  if (i < 0) return null;
  // Erst die Parameterliste überspringen. Die erste `{` nach dem Namen kann
  // ein VORGABEWERT sein — `loadGallery(opts = {})` hat genau die Form, und
  // ein Zähler, der dort beginnt, ist nach zwei Zeichen wieder bei null und
  // liefert einen 43 Zeichen langen „Rumpf". Der Test wäre dann rot gewesen,
  // weil er nichts gefunden hat, nicht weil etwas fehlt.
  let k = src.indexOf('(', i);
  if (k < 0) return null;
  let klammern = 1;
  for (k++; k < src.length && klammern > 0; k++) {
    if (src[k] === '(') klammern++;
    else if (src[k] === ')') klammern--;
  }
  let j = src.indexOf('{', k);
  if (j < 0) return null;
  let tiefe = 1;
  for (j++; j < src.length && tiefe > 0; j++) {
    if (src[j] === '{') tiefe++;
    else if (src[j] === '}') tiefe--;
  }
  return src.slice(i, j);
}

test('jeder Lader hinter dem Kontofilter gibt den Kontofilter mit', () => {
  const module = alleModule();
  const gallery = module['02-gallery.js'];
  assert.ok(gallery, '02-gallery.js nicht gefunden');

  const wechsel = rumpf(gallery, 'export function onScopeChange(');
  assert.ok(wechsel, 'onScopeChange() nicht gefunden — umbenannt?');

  // Was der Wechsel neu lädt: jeder Aufruf `loadXyz()` in seinem Rumpf.
  const lader = [...new Set([...wechsel.matchAll(/\b(load[A-Z]\w*)\s*\(/g)].map(m => m[1]))];
  // Selbstbeweis: Findet das Muster keine Lader, wäre unten nichts zu prüfen
  // und der Test grün, ohne etwas geprüft zu haben. Vier Ansichten (Galerie,
  // Teile, Minifiguren, Finanzen) laden mindestens je einen.
  assert.ok(lader.length >= 4,
    `Nur ${lader.length} Lader im Filterwechsel gefunden — Muster veraltet?`);

  /** Rumpf einer Funktion, in welchem Modul auch immer sie steht. */
  function suche(name) {
    for (const [datei, src] of Object.entries(module)) {
      const k = rumpf(src, `export async function ${name}(`)
             ?? rumpf(src, `export function ${name}(`)
             ?? rumpf(src, `async function ${name}(`)
             ?? rumpf(src, `function ${name}(`);
      if (k) return { datei, koerper: k };
    }
    return null;
  }

  /**
   * Trägt dieser Lader den Filter — selbst oder über das, was er aufruft?
   *
   * Über die Aufrufkette, nicht nur den eigenen Rumpf: `loadParts()` besteht
   * aus drei Zeilen, die drei Unterlader aufrufen; jeder von ihnen gibt den
   * Filter mit. `loadGallery()` baut ihn über galleryParams(). Nur den ersten
   * Rumpf anzusehen, meldete beide zu Unrecht — und ein Test, der korrekten
   * Code anmeckert, wird abgeschaltet statt befolgt.
   */
  function traegtFilter(name, tiefe = 0, gesehen = new Set()) {
    if (tiefe > 3 || gesehen.has(name)) return false;
    gesehen.add(name);
    const treffer = suche(name);
    if (!treffer) return false;
    // Drei Wege, den Filter mitzugeben: über die Params-Funktion
    // (addScopeParam), als fertiges Suffix (scopeQuery) oder von Hand aus
    // scopeMode() zusammengebaut.
    if (/addScopeParam\(|scopeQuery\(|scopeMode\(/.test(treffer.koerper)) return true;
    for (const m of treffer.koerper.matchAll(/\b([a-z]\w*(?:Params|Data|Stats|Filters|Page|More))\s*\(/g))
      if (traegtFilter(m[1], tiefe + 1, gesehen)) return true;
    for (const m of treffer.koerper.matchAll(/\b(load[A-Z]\w*)\s*\(/g))
      if (m[1] !== name && traegtFilter(m[1], tiefe + 1, gesehen)) return true;
    return false;
  }

  const ohneFilter = [];
  let geprueft = 0;
  for (const name of lader) {
    const treffer = suche(name);
    if (!treffer) continue;
    geprueft++;
    if (!traegtFilter(name)) ohneFilter.push(`${treffer.datei}: ${name}()`);
  }

  assert.ok(geprueft >= 4,
    `Nur ${geprueft} der ${lader.length} Lader im Quelltext gefunden — ` +
    'die Namenssuche greift nicht mehr.');

  assert.deepEqual(ohneFilter, [],
    'Diese Lader hängen am Kontofilter, schicken ihn aber nicht mit:\n  ' +
    ohneFilter.join('\n  ') +
    '\nSie werden beim Wechsel neu geladen und liefern trotzdem jedesmal ' +
    'dasselbe. Der Nutzer sieht dann eine gefilterte Liste neben ungefilterten ' +
    'Zahlen — genau das war bei loadStats() der Fall.');
});
