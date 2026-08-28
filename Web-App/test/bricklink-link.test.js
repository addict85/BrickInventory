/**
 * BrickLink-Link-Auflösung für Katalog-Sets (utils/bricklinkLink.ts).
 *
 * Der Katalog steht auf Rebrickable-Daten und hat den Kauf-Link bisher direkt
 * aus rb_sets.set_num gebaut — immer als Set (`?S=75192-1`). Für alles, was
 * BrickLink nicht als Set führt (Gear, Bücher), war damit sowohl der Parameter
 * als auch die Nummer falsch: BrickLink vergibt dort keinen "-1"-Suffix.
 *
 * Die reinen Funktionen sind hier ohne DB testbar; resolveMany() braucht
 * Postgres und wird im Integrationstest abgedeckt.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
// Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
const { withVariant, bareNumber, buildUrl, searchUrl } = _req('utils/bricklinkLink.js');

test('withVariant ergänzt den Rebrickable-Suffix', () => {
  assert.equal(withVariant('75192'), '75192-1');
  assert.equal(withVariant('75192-1'), '75192-1');
  assert.equal(withVariant('10179-2'), '10179-2');
  assert.equal(withVariant('  75192  '), '75192-1');
});

test('bareNumber entfernt ihn wieder — BrickLink führt Gear/Book ohne Suffix', () => {
  assert.equal(bareNumber('5005358-1'), '5005358');
  assert.equal(bareNumber('5005358'), '5005358');
  assert.equal(bareNumber('10179-2'), '10179');
});

test('buildUrl verwendet je Item-Typ den richtigen Parameter', () => {
  const set = buildUrl('SET', '75192-1');
  assert.match(set, /\?S=75192-1/);
  assert.match(set, /#T=S/);

  const gear = buildUrl('GEAR', '5005358');
  assert.match(gear, /\?G=5005358/);
  assert.match(gear, /#T=G/,
    'Der For-Sale-Tab muss zum Item-Typ passen, sonst öffnet BrickLink den falschen Reiter');

  const book = buildUrl('BOOK', 'b12ab');
  assert.match(book, /\?B=b12ab/);
  assert.match(book, /#T=B/);
});

test('buildUrl kennt auch MINIFIG', () => {
  const m = buildUrl('MINIFIG', 'col325');
  assert.match(m, /\?M=col325/);
  assert.match(m, /#T=M/);
});

test('buildUrl liefert null für NONE — der Aufrufer weicht auf die Suche aus', () => {
  assert.equal(buildUrl('NONE', 'x-1'), null);
});

test('searchUrl greift, wo kein Deep-Link konstruierbar ist', () => {
  // Sammelminifiguren: Rebrickable führt sie als Set (71021-1), BrickLink als
  // MINIFIG mit anderer Nummer (col325). Die Zuordnung existiert in keiner der
  // beiden Datenquellen — ein Deep-Link ist grundsätzlich nicht herleitbar.
  const u = searchUrl('71021-1');
  assert.match(u, /search\.page\?q=71021/);
  assert.ok(!u.includes('-1'), 'Der Variantensuffix engt die Suche unnötig ein');
});

test('buildUrl kodiert Sonderzeichen in der Nummer', () => {
  const url = buildUrl('SET', '10 30-1');
  assert.ok(!/\?S=10 30/.test(url), 'Leerzeichen muss kodiert werden');
  assert.match(url, /\?S=10%2030-1/);
});

test('Set-Links behalten den Suffix, Gear-Links nicht', () => {
  // Das ist der eigentliche Fehler, der behoben wurde: dieselbe
  // Rebrickable-Nummer ergibt je nach BrickLink-Typ zwei verschiedene URLs.
  assert.match(buildUrl('SET',  withVariant('5005358')), /\?S=5005358-1/);
  assert.match(buildUrl('GEAR', bareNumber('5005358-1')), /\?G=5005358(?!-)/);
});

test('der Kauf-Button wird nie ausgeblendet', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', '09-catalog.js'), 'utf8');
  const block = js.slice(js.indexOf("G('cat-m-bricklink')") - 600, js.indexOf("G('cat-m-bricklink')") + 800);
  assert.doesNotMatch(block, /display\s*=\s*'none'/,
    'Bei Sammelminifiguren war der Button dadurch weg, obwohl der Artikel auf ' +
    'BrickLink existiert — nur unter einer nicht herleitbaren Nummer');
  assert.match(block, /search_bricklink/,
    'Ohne eindeutigen Treffer muss der Button auf die Suche umschalten');
});

test('der Client baut die Katalog-URL nicht mehr selbst', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync(path.join(ROOT, 'public', 'js', '09-catalog.js'), 'utf8');
  assert.doesNotMatch(js, /catalogitem\.page/,
    'Die Typ-Entscheidung (Set/Gear/Book) steht nur in catalog_cache auf dem ' +
    'Server — der Client darf die URL nicht selbst zusammenbauen');
  assert.match(js, /s\.bricklink/, 'Der Client muss das aufgelöste Feld verwenden');
});
