/**
 * Der Kategoriefilter der Finanzen steht in BEIDEN Oberflaechen — gleich.
 * Ausführlich: docs/begruendungen/test/finanzen-filter-gleich.test.js.md#kopf
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');

const { ohneKommentare } = require('./helpers/sources');

const lies = (p) => fs.readFileSync(p, 'utf8');

test('Finanzen-Filter: dieselben vier Arten in Webapp und App', () => {
  const html = lies(path.join(ROOT, 'public/index.html'));
  const web  = ohneKommentare(lies(path.join(ROOT, 'public/js/04-finance.js')));
  const kt   = ohneKommentare(lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-finanzen', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'finanzen', 'ui', 'screens', 'FinanceSections.kt')));

  // ── 1. Dieselben Schluessel ──────────────────────────────────────────────
  const appArten = [...kt.matchAll(/KategorieChip\("(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(appArten, ['sets', 'parts', 'figs'],
    'Die App kennt andere Arten als erwartet — Muster veraltet oder Arten geaendert');

  const webArten = [...html.matchAll(/data-click="finFilter" data-arg="(\w+)"/g)].map(m => m[1]);
  assert.deepEqual(webArten, ['alle', ...appArten],
    'Die Chips der Webapp decken sich nicht mit denen der App');

  // Und jede Art blendet auch wirklich etwas aus: Ein Chip ohne zugehoerigen
  // Abschnitt waere ein Knopf, der nichts tut.
  for (const art of appArten) {
    // Teile und Figuren baut manuellerAbschnitt({ art: … }) mit demselben Attribut.
    assert.ok(web.includes(`data-fin-art="${art}"`) || web.includes(`art: '${art}'`),
      `Zur Art „${art}" gibt es in der Webapp keinen gekennzeichneten Abschnitt`);
  }

  // ── 2. Dieselbe Regel „leer heisst alle" ─────────────────────────────────
  const zustand = ohneKommentare(lies(path.join(__dirname, '..', '..', 'Android-App', 'feature-finanzen', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'finanzen', 'ui', 'ZustandFinanzen.kt')));
  assert.ok(/fun zeigt\(kategorie: String\): Boolean = kategorien\.isEmpty\(\) \|\| kategorie in kategorien/
    .test(zustand), 'Die Regel der App steht nicht mehr, wo dieser Test sie erwartet');
  assert.ok(/function finZeigt\(art\)\{ return finKategorien\.size === 0 \|\| finKategorien\.has\(art\); \}/
    .test(web), 'Die Webapp beantwortet „wird das gezeigt" anders als die App');

  // ── 3. Additiv in beiden ─────────────────────────────────────────────────
  //
  // Das ist der Punkt, an dem die beiden am ehesten auseinanderlaufen: Ein
  // Single-Select saehe fast gleich aus und verhielte sich anders.
  assert.ok(/if \(kategorie in kategorien\) kategorien - kategorie/.test(zustand),
    'Die App ersetzt die Auswahl wieder, statt sie zu haeufen');
  assert.ok(/finKategorien\.has\(art\)\) finKategorien\.delete\(art\);/.test(web),
    'Die Webapp ersetzt die Auswahl wieder, statt sie zu haeufen');

  // 4. Der Filter ueberlebt das Neuzeichnen
  // Ausführlich: docs/begruendungen/test/finanzen-filter-gleich.test.js.md#ab-stelle
  //
  // Genau das hat die Gegenprobe zu diesem Test aufgedeckt: `finFilterAnwenden()`
  // steht zweimal in der Datei (hier und im Klick-Handler). Ein Ausschnitt bis
  // zum Dateiende fand deshalb IMMER einen Treffer — auch nachdem ich den
  // Aufruf aus loadFinance() entfernt hatte. Die Pruefung war gruen und
  // pruefte nichts.
  const ab = web.indexOf("setzeHtml(G('fin-tbl'), html`${leer}${setsTabelle(");
  assert.ok(ab > 0, 'Die Zeile, die die Tabelle zeichnet, wurde nicht gefunden — Muster veraltet?');
  const ende = web.indexOf('\n}', ab);
  assert.ok(ende > ab, 'Das Ende von loadFinance() wurde nicht gefunden');
  const nachZeichnen = web.slice(ab, ende);
  assert.ok(nachZeichnen.includes('finFilterAnwenden();'),
    'Nach dem Neuzeichnen der Tabelle wird der Filter nicht wieder angewandt');
});
