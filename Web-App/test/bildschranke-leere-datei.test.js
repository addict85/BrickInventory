/**
 * Eine leere oder abgeschnittene Datei ist kein Bild.
 *
 * ── Marcos Protokoll ────────────────────────────────────────────────────────
 *
 *     [thumb] Vorschau fehlgeschlagen für /images/sets/265-2.jpg:
 *             Input file contains unsupported image format
 *
 * Die Schranke davor (src/katalog/bilder/imageGuard.ts, isDecodable) liest den Dateikopf
 * und entscheidet, ob die Datei an den Verkleinerer darf. Sie hatte einen
 * Rückfall:
 *
 *     const dim = readDimensions(…);
 *     if (!dim) return true;      // unbekanntes Format: durchlassen
 *
 * Der ist richtig gedacht — für ein Format, das wir nicht selbst lesen können,
 * soll der Dekodierer entscheiden. Er setzt aber voraus, dass es überhaupt
 * etwas zu entscheiden gibt. Bei NULL gelesenen Bytes erkennt readDimensions()
 * natürlich kein Format, und die leere Datei ging durch, bis sharp daran
 * scheiterte.
 *
 * Dass daraus ein harter Fehler wurde und nicht ein stilles „keine Vorschau",
 * hat es überhaupt erst sichtbar gemacht. Der Fehler war also nicht das
 * Melden, sondern das Durchlassen.
 *
 * ── Warum 10 Byte ───────────────────────────────────────────────────────────
 *
 * Das ist der kleinste denkbare Bildkopf im Baum: Ein GIF-Header ist 10 Byte
 * (GIF89a + Breite + Höhe), ein PNG braucht bis zum IHDR 24, ein JPEG bis zum
 * ersten SOF mehr. Unter 10 Byte kann keine der Formaterkennungen in
 * readDimensions() je etwas finden — die Datei ist nicht „unbekannt", sondern
 * leer.
 *
 * ── Gegenproben (durchgeführt) ──────────────────────────────────────────────
 *
 *   a) Die Schranke entfernt → Fall 1 und 2 rot.
 *   b) Ein ECHTES kleines Bild muss weiter durchgehen (Fall 3) — sonst hätte
 *      die Schranke einfach alles abgewiesen und die Fälle davor wären
 *      bedeutungslos.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { isDecodable } = _req('src/katalog/bilder/imageGuard.js');

/** Eine Datei mit genau diesem Inhalt, in einem eigenen Verzeichnis. */
function datei(name, inhalt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bildschranke-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, inhalt);
  return p;
}

test('eine LEERE Datei wird abgewiesen', async () => {
  const p = datei('leer.jpg', Buffer.alloc(0));
  assert.equal(await isDecodable(p), false,
    'Eine Datei mit null Bytes ging durch die Schranke. Dahinter scheitert der ' +
    'Verkleinerer mit „unsupported image format" — und zwar bei jedem Takt neu, ' +
    'solange die Datei liegenbleibt.');
});

test('eine ABGESCHNITTENE Datei wird abgewiesen', async () => {
  // Die ersten drei Bytes eines JPEG, dann nichts mehr: genau das Bild eines
  // abgebrochenen Downloads.
  const p = datei('halb.jpg', Buffer.from([0xff, 0xd8, 0xff]));
  assert.equal(await isDecodable(p), false,
    'Ein angefangenes JPEG ging durch — der Dekodierer kann damit nichts anfangen');
});

test('ein ECHTES kleines Bild geht weiter durch', async () => {
  // Der Kern. Ohne diesen Fall wäre die Schranke auch dann „richtig", wenn sie
  // ALLES abwiese — und dann gäbe es gar keine Vorschaubilder mehr.
  //
  // Ein 1×1-GIF, 35 Byte: das kleinste vollständige Bild, das sich hinschreiben
  // lässt, und mit 35 Byte deutlich über der Schranke von 10.
  const gif = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  assert.equal(gif.length, 42, `Die Probe ist ${gif.length} Byte gross — erwartet 42`);
  const p = datei('eins.gif', gif);
  assert.equal(await isDecodable(p), true,
    'Ein gültiges 1×1-GIF wurde abgewiesen — dann entstehen gar keine ' +
    'Vorschaubilder mehr, und die Schranke ist schlimmer als das Problem');
});

test('eine Datei, die es nicht gibt, wird abgewiesen', async () => {
  // Das war schon vorher so (der catch unten in isDecodable) und bleibt es —
  // hier festgehalten, damit die neue Schranke diesen Weg nicht verdeckt.
  assert.equal(await isDecodable('/gibt/es/nicht/x.jpg'), false);
});
