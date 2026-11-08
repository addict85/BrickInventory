/**
 * Hochgeladenes fasst der Dienst nur unter der eigenen Ablage an: Den Pfad legt
 * multer aus der Anfrage fest, chmod/rm danach dürfen nicht anderswo landen.
 *
 * Gegenprobe (08.11.2026 gemessen): in unterWurzel() die startsWith-Prüfung
 * gestrichen → rot „ausserhalb: ../“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();
const { unterWurzel } = _req('src/http/dateiEmpfang.js');
const WURZEL = path.join(path.sep, 'daten', 'uploads');

test('ein Upload unter der Ablage bleibt, alles andere wird abgewiesen', () => {
  assert.equal(unterWurzel(WURZEL, path.join(WURZEL, '7', 'a.pdf')), path.join(WURZEL, '7', 'a.pdf'));
  assert.throws(
    () => unterWurzel(WURZEL, path.join(WURZEL, '7', '..', '..', 'geheim.pdf')),
    /ausserhalb/,
    'ausserhalb: ../',
  );
  assert.throws(
    () => unterWurzel(WURZEL, `${WURZEL}-alt${path.sep}a.pdf`),
    /ausserhalb/,
    'Nachbarordner mit gleichem Anfang',
  );
  assert.throws(() => unterWurzel(WURZEL, WURZEL), /ausserhalb/, 'die Wurzel selbst ist keine Datei darin');
});
