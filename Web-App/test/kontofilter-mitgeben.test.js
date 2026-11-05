/**
 * Was der Kontofilter neu lädt, muss den Kontofilter auch mitschicken.
 * Ausführlich: docs/begruendungen/test/kontofilter-mitgeben.test.js.md#kopf
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
  const navigation = module['25-navigation.js'];
  assert.ok(navigation, '25-navigation.js nicht gefunden');

  const wechsel = rumpf(navigation, 'export function onScopeChange(');
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
    const wurzel = path.join(__dirname, '..', 'routes/api_v1');
    const menge = new Set();
    for (const f of fs.readdirSync(wurzel)) {
      if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
      const src = ohneKommentare(fs.readFileSync(path.join(wurzel, f), 'utf8'));
      for (const m of src.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'([\s\S]*?)\n\}\);/g))
        if (/sichtVon\(req\)|abfrage\.accounts/.test(m[3])) menge.add(m[2].split('/:')[0].replace(/\/+$/, ''));
    }
    return menge;
  }

  /**
   * Der Aufruf selbst — von `api(` bis zur passenden schliessenden Klammer.
   *
   * Geklammert gezählt, nicht nach Zeichenzahl geschnitten: siehe rumpf()
   * weiter oben und die Begründung an funktionsRumpf() in
   * test/helpers/sources.js. Ein Fenster endet irgendwo; ein Aufruf endet dort,
   * wo er endet.
   */
  function aufrufText(src, ab) {
    let k = src.indexOf('(', ab), tiefe = 1;
    for (k++; k < src.length && tiefe > 0; k++) {
      if (src[k] === '(') tiefe++;
      else if (src[k] === ')') tiefe--;
    }
    return src.slice(ab, k);
  }

  /**
   * Trägt dieser Aufruf den Filter?
   * Ausführlich: docs/begruendungen/test/kontofilter-mitgeben.test.js.md#aufrufeohnefilter
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
      // einem Helfer, dessen Ergebnis angehängt wird.
      // Ausführlich: docs/begruendungen/test/kontofilter-mitgeben.test.js.md#aufruf
      const aufruf = aufrufText(treffer.koerper, m.index);
      if (/scopeQuery\(|scopeMode\(|accounts/.test(aufruf)) continue;
      const viaHelfer = [...aufruf.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)]
        .some(h => { const t2 = suche(h[1]); return t2 && /addScopeParam\(|scopeQuery\(|scopeMode\(/.test(t2.koerper); });
      if (viaHelfer) continue;
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
