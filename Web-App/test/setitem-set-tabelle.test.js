/**
 * „Verwendet in" zeigt Bild, Nummer und Bezeichnung — in BEIDEN Oberflächen.
 * Ausführlich: docs/begruendungen/test/setitem-set-tabelle.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const ohneKommentare = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');

test('die Webapp zeigt die Sets als Tabelle mit Bild', () => {
  const src = ohneKommentare(
    require('./helpers/sources').ansichtQuelle('13'));
  const i = src.indexOf("t('setitem.used_in')");
  assert.ok(i > 0, 'Der Abschnitt „Verwendet in" ist nicht mehr da');
  // Der Aufbau steht ÜBER der detailZeile — von dort rückwärts bis zum
  // vorigen Abschnitt schneiden, damit der Rest des Dialogs nicht mitzählt.
  const block = src.slice(src.lastIndexOf('const setBild', i), i);
  assert.ok(block.length > 0,
    'Es gibt keinen setBild-Helfer mehr — dann steht die Liste wieder ohne Bild da');
  assert.match(block, /thumbUrl\(s\.image_local \|\| s\.image_url\)/,
    'Das Set-Bild wird nicht als Vorschau aufgelöst — im Dialog stünde die volle Auflösung');
  assert.match(block, /<table/,
    'Die Sets stehen nicht in einer Tabelle — Nummer und Name haben dann keine gemeinsame Kante');
  for (const feld of ['s.set_number', 's.set_name'])
    assert.ok(block.includes(feld), `${feld} fehlt in der Tabelle`);
});

test('die Tabelle beginnt auf einer eigenen Zeile', () => {
  // Marcos Befund am Bild
  // Ausführlich: docs/begruendungen/test/setitem-set-tabelle.test.js.md#src-stelle
  const src = ohneKommentare(
    require('./helpers/sources').ansichtQuelle('13'));
  assert.match(src,
    /detailZeile\(t\('setitem\.used_in'\), liste,\s*\{\s*zeilenStil: 'flex-direction:column/,
    'Die Set-Tabelle steht wieder NEBEN der Beschriftung „Verwendet in" — bei ' +
    'einem einzelnen Set schiebt sie sich dann in das erste Vorschaubild');
});

test('die App zeigt dieselben drei Spalten', () => {
  const datei = path.join(__dirname, '..', '..', 'Android-App', 'feature-teile', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'ui', 'dialogs', 'SetItemDetailDialog.kt');
  assert.ok(fs.existsSync(datei), `${datei} nicht gefunden`);
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));

  // Warum hier NICHT resolveThumbUrl steht
  // Ausführlich: docs/begruendungen/test/setitem-set-tabelle.test.js.md#stelle
  assert.match(src, /rememberTileImageWithFallback\(serverUrl, s\.imageLocal, s\.imageUrl\)/,
    'Die App löst das Set-Bild nicht als Vorschau mit Rückfall auf — die Zeile ' +
    'bliebe ohne Bild, wo die Webapp über data-orig nachlädt');

  // Und dieselbe Zeile wie die Tabellenansicht, nicht eine zweite, die ihr
  // aehnelt: „so wie im Reiter Finanzen" war die Vorgabe, und zwei Fassungen
  // derselben Zeile entwickeln sich auseinander.
  assert.match(src, /TabellenZeile\(/,
    'Der Dialog baut die Set-Zeile selbst, statt die gemeinsame TabellenZeile ' +
    'zu nehmen — dann sieht sie nur so lange gleich aus, bis eine der beiden ' +
    'geändert wird');

  for (const feld of ['s.setNumber', 's.setName'])
    assert.ok(src.includes(feld), `${feld} fehlt in der Zeile der App`);
});

test('die gemeinsame Tabellenzeile sagt der Sprachausgabe, was das Antippen tut', () => {
  // Die handgeschriebene Zeile hatte ein onClickLabel („Set öffnen"); die
  // gemeinsame kannte keines. Beim Umstellen waere diese Angabe still
  // verschwunden — ein Verlust, den kein Bild zeigt und nur hoert, wer die
  // App nicht sieht.
  const zeile = ohneKommentare(
    fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'core-ui', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'TabellenZeile.kt'), 'utf8'));
  assert.match(zeile, /onClickLabel: String\? = null/,
    'TabellenZeile nimmt keine Beschriftung für die Sprachausgabe entgegen');
  // Weitere Argumente (role = Role.Button) dürfen dazwischen stehen.
  assert.match(zeile, /clickable\(onClickLabel = onClickLabel,[^)]*\bonClick = onClick\)/,
    'TabellenZeile nimmt die Beschriftung entgegen, reicht sie aber nicht an ' +
    'clickable weiter — sie hätte dann keine Wirkung');
});
