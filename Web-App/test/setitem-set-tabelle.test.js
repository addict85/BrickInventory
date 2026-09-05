/**
 * „Verwendet in" zeigt Bild, Nummer und Bezeichnung — in BEIDEN Oberflächen.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Können die Sets in den Detail-Dialogen der Teile und Minifiguren mit den
 * kleinen Bildern in einer Tabelle angezeigt werden? 1. Spalte kleines Thumb
 * vom Set, 2. Spalte Setnummer, 3. Spalte Bezeichnung — so wie im Reiter
 * Finanzen."
 *
 * Vorher standen Nummer und Name als Fliesstext nebeneinander („8480-1 Space
 * Shuttle"), ohne Bild und ohne gemeinsame Kante; bei mehreren Sets begann
 * jeder Name an einer anderen Stelle.
 *
 * ── Warum das nichts gekostet hat ───────────────────────────────────────────
 *
 * Der Server liefert `image_local` und `image_url` JE SET längst mit
 * (utils/handlers/shared.ts, verwendendeSets → VerwendendesSet). Beide
 * Oberflächen haben die Felder nur nie benutzt — wieder ein Wert, der über die
 * Leitung kommt und niemanden erreicht.
 *
 * ── Warum die Prüfung beide Bäume liest ─────────────────────────────────────
 *
 * Genau hier laufen die zwei Oberflächen in diesem Projekt auseinander: Eine
 * Anzeige wird auf einer Seite verbessert, die andere bleibt stehen. Die Regel
 * heisst deshalb „beide", nicht „die Webapp".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp');

const ohneKommentare = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');

test('die Webapp zeigt die Sets als Tabelle mit Bild', () => {
  const src = ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'public', 'js', '13-acquisition-modals.js'), 'utf8'));
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
  // ── Marcos Befund am Bild ─────────────────────────────────────────────────
  // „Der Text 'Verwendet in' kommt in das erste Bild der Sets."
  //
  // Die Zeile ist ein `.dr` — ein Flex-Kasten mit
  // `justify-content:space-between` (styles.css). Bei EINEM Set ist die
  // Tabelle so schmal, dass sie neben die Beschriftung rutscht und das
  // Vorschaubild sie beruehrt. `flex-direction:column` an der ZEILE stellt
  // beides untereinander.
  //
  // Die Android-App macht das seit jeher so (erst der Text, dann die
  // LazyColumn darunter); hier war die Webapp die Abweichung.
  // Gemessen wird an der detailZeile SELBST, nicht am Aufbau darueber: Der
  // erste Test schneidet bis zum `t('setitem.used_in')` und hoert damit genau
  // vor der Stelle auf, um die es hier geht.
  const src = ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'public', 'js', '13-acquisition-modals.js'), 'utf8'));
  assert.match(src,
    /detailZeile\(t\('setitem\.used_in'\), liste,\s*\{\s*zeilenStil: 'flex-direction:column/,
    'Die Set-Tabelle steht wieder NEBEN der Beschriftung „Verwendet in" — bei ' +
    'einem einzelnen Set schiebt sie sich dann in das erste Vorschaubild');
});

test('die App zeigt dieselben drei Spalten', () => {
  const datei = path.join(APP, 'ui', 'dialogs', 'SetItemDetailDialog.kt');
  assert.ok(fs.existsSync(datei), `${datei} nicht gefunden`);
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));

  // ── Warum hier NICHT resolveThumbUrl steht ────────────────────────────────
  //
  // Diese Zusicherung nannte zuerst `resolveThumbUrl(serverUrl, s.imageLocal,
  // s.imageUrl)` — den blossen Vorschau-Aufloeser. Der App-Lauf 128 hat die
  // handgeschriebene Zeile daneben verworfen (fester Eckenradius,
  // DesignTokensTest), und beim Ersetzen kam heraus, dass sie noch etwas
  // ZWEITES nicht konnte: den Rueckfall auf die volle Aufloesung, wenn es kein
  // Vorschaubild gibt. Die Webapp hat ihn ueber `data-orig` (11-actions.js,
  // „nachladen, wenn die Vorschau fehlschlaegt"); in der App heisst er
  // rememberTileImageWithFallback und loest die Vorschau gleich mit auf.
  //
  // Geprueft wird deshalb der staerkere der beiden Wege — sonst waere die
  // Zusicherung mit dem schwaecheren zufrieden.
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
    fs.readFileSync(path.join(APP, 'ui', 'screens', 'TabellenZeile.kt'), 'utf8'));
  assert.match(zeile, /onClickLabel: String\? = null/,
    'TabellenZeile nimmt keine Beschriftung für die Sprachausgabe entgegen');
  assert.match(zeile, /clickable\(onClickLabel = onClickLabel, onClick = onClick\)/,
    'TabellenZeile nimmt die Beschriftung entgegen, reicht sie aber nicht an ' +
    'clickable weiter — sie hätte dann keine Wirkung');
});
