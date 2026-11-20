/**
 * Hochgeladenes fasst der Dienst nur unter der eigenen Ablage an: Den Pfad legt
 * multer aus der Anfrage fest, chmod/rm danach dürfen nicht anderswo landen.
 *
 * Gegenprobe (08.11.2026 gemessen): in belowRoot() die startsWith-Prüfung
 * gestrichen → rot „ausserhalb: ../“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { belowRoot } = _req('src/http/fileUpload.js');
const WURZEL = path.join(path.sep, 'daten', 'uploads');

test('an upload below the storage stays, everything else is rejected', () => {
  assert.equal(belowRoot(WURZEL, path.join(WURZEL, '7', 'a.pdf')), path.join(WURZEL, '7', 'a.pdf'));
  assert.throws(
    () => belowRoot(WURZEL, path.join(WURZEL, '7', '..', '..', 'geheim.pdf')),
    /ausserhalb/,
    'ausserhalb: ../',
  );
  assert.throws(
    () => belowRoot(WURZEL, `${WURZEL}-alt${path.sep}a.pdf`),
    /ausserhalb/,
    'Nachbarordner mit gleichem Anfang',
  );
  assert.throws(() => belowRoot(WURZEL, WURZEL), /ausserhalb/, 'die Wurzel selbst ist keine Datei darin');
});
