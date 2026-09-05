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

test('die App zeigt dieselben drei Spalten', () => {
  const datei = path.join(APP, 'ui', 'dialogs', 'SetItemDetailDialog.kt');
  assert.ok(fs.existsSync(datei), `${datei} nicht gefunden`);
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  assert.match(src, /resolveThumbUrl\(serverUrl, s\.imageLocal, s\.imageUrl\)/,
    'Die App löst das Set-Bild nicht als Vorschau auf — die Zeile bliebe ohne Bild, ' +
    'obwohl der Server es mitschickt');
  for (const feld of ['s.setNumber', 's.setName'])
    assert.ok(src.includes(feld), `${feld} fehlt in der Zeile der App`);
});
