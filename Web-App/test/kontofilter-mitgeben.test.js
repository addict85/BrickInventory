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
 * ── Der zweite Fund, und warum der Test dafür umgebaut wurde ────────────────
 * Die erste Fassung fragte je LADEFUNKTION: „steht irgendwo in ihrer
 * Aufrufkette ein scopeQuery()?" Damit war sie blind für
 * `enrichGalleryWithPrices()`: Es hängt am Ende von `loadGallery()`, das den
 * Filter über galleryParams() sehr wohl mitgibt — der Aufruf auf
 * /v1/finance/pnl darin aber nicht. Die Kette trug ihn, der Aufruf nicht.
 *
 * Geprüft wird deshalb JE AUFRUF. Das ist die Regel, die beide Fälle trifft.
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 * Drei Seiten werden gelesen: WAS der Filterwechsel neu lädt (aus
 * onScopeChange), WELCHE v1-Routen `accounts` überhaupt auswerten (aus den
 * Router-Dateien) und OB jeder Aufruf dorthin den Filter mitgibt. Ein neuer
 * Endpunkt, eine neue Ansicht, ein neuer Zwischenaufruf — alles ist von selbst
 * mitgeprüft. Eine Liste hier wäre eine zweite Wahrheit, die beim nächsten
 * Umbau still veraltet.
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

test('jeder Abruf hinter dem Kontofilter gibt den Kontofilter mit', () => {
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
   * Welche v1-Routen werten `accounts` aus? Aus den Router-Dateien gelesen,
   * nicht aufgezählt — eine Liste hier wäre eine zweite Wahrheit, die beim
   * nächsten neuen Endpunkt still veraltet.
   */
  function kontenbewusst() {
    const wurzel = path.join(__dirname, '..', 'routes', 'api_v1');
    const menge = new Set();
    for (const f of fs.readdirSync(wurzel)) {
      if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
      const src = ohneKommentare(fs.readFileSync(path.join(wurzel, f), 'utf8'));
      for (const m of src.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'([\s\S]*?)\n\}\);/g))
        if (m[3].includes('query.accounts')) menge.add(m[2].split('/:')[0].replace(/\/+$/, ''));
    }
    return menge;
  }

  /**
   * Trägt dieser Aufruf den Filter?
   *
   * Geprüft wird JE AUFRUF, nicht je Ladefunktion. Die erste Fassung dieses
   * Tests fragte „steht irgendwo in der Aufrufkette ein scopeQuery()?" — und
   * war damit blind für genau den zweiten Fund: `loadGallery()` baut den
   * Filter über galleryParams(), ruft am Ende aber
   * `enrichGalleryWithPrices()`, das /v1/finance/pnl OHNE Filter holte. Die
   * Kette trug ihn, der Aufruf nicht.
   */
  function aufrufeOhneFilter(name, konten, tiefe = 0, gesehen = new Set()) {
    if (tiefe > 3 || gesehen.has(name)) return [];
    gesehen.add(name);
    const treffer = suche(name);
    if (!treffer) return [];
    const fehlt = [];
    for (const m of treffer.koerper.matchAll(/api\(\s*'GET'\s*,\s*[`'"]([^`'"]*?)[`'"\s)]/g)) {
      const pfad = m[1].split('?')[0].split('${')[0].replace(/\/+$/, '');
      if (!konten.has(pfad.replace(/^\/v1/, ''))) continue;
      // Der Filter darf im Aufruf selbst stehen (scopeQuery/scopeMode) oder in
      // der Params-Funktion, deren Ergebnis angehängt wird.
      const zeile = treffer.koerper.slice(m.index, m.index + 220);
      if (/scopeQuery\(|scopeMode\(|accounts/.test(zeile)) continue;
      const viaParams = [...zeile.matchAll(/\b(\w*[Pp]arams)\s*\(/g)]
        .some(p => { const t2 = suche(p[1]); return t2 && /addScopeParam\(|scopeQuery\(|scopeMode\(/.test(t2.koerper); });
      if (viaParams) continue;
      fehlt.push(`${treffer.datei}: ${name}() -> ${pfad}`);
    }
    for (const m of treffer.koerper.matchAll(/\b([a-z]\w*)\s*\(/g))
      if (m[1] !== name) fehlt.push(...aufrufeOhneFilter(m[1], konten, tiefe + 1, gesehen));
    return fehlt;
  }

  const konten = kontenbewusst();
  // 22 Routen werten accounts aus; auf den Pfadstamm vor dem ersten
  // Platzhalter zusammengefasst bleiben 14. Die Grenze soll „gar nichts
  // gefunden" fangen, nicht das Entfernen eines Endpunkts verbieten.
  assert.ok(konten.size >= 12,
    `Nur ${konten.size} kontenbewusste Routen gefunden — Muster veraltet?`);

  const ohneFilter = [];
  let geprueft = 0;
  for (const name of lader) {
    if (!suche(name)) continue;
    geprueft++;
    ohneFilter.push(...aufrufeOhneFilter(name, konten));
  }

  const offen = [...new Set(ohneFilter)].sort();
  assert.deepEqual(offen, [],
    'Diese Aufrufe hängen am Kontofilter, schicken ihn aber nicht mit:\n  ' +
    offen.join('\n  ') +
    '\nSie werden beim Wechsel neu geladen und liefern trotzdem jedesmal ' +
    'dasselbe. Der Nutzer sieht dann eine gefilterte Liste neben ungefilterten ' +
    'Zahlen — genau das war bei loadStats() und bei enrichGalleryWithPrices() der Fall.');
});
