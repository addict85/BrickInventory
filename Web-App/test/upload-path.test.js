/**
 * The service only touches uploads below its own storage: multer determines the path
 * from the request, chmod/rm afterwards must not land elsewhere.
 *
 * Counter-check (measured 08.11.2026): the startsWith check deleted in belowRoot()
 * → red „ausserhalb: ../“.
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
    'neighbour folder with the same prefix',
  );
  assert.throws(() => belowRoot(WURZEL, WURZEL), /ausserhalb/, 'the root itself is no file inside it');
});
