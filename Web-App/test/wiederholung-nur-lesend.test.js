/**
 * Bricht die Verbindung mitten in einer Anfrage ab (08006), wird nur ein
 * Lesezugriff wiederholt. Beim Schreiben ist offen, ob die Zeile schon
 * festgeschrieben war — eine Wiederholung legte sie doppelt an.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  08006 wieder in RETRYABLE_CODES → rot: „ein Schreibzugriff nach
 *      Verbindungsabbruch"
 *   B  istLesend ohne die Prüfung auf INSERT/UPDATE/DELETE → rot: „INSERT …
 *      RETURNING ist kein Lesezugriff"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { queryWithRetry, istLesend } = _req('db/database.js');

/** Scheitert beim ersten Versuch mit `code`, danach gelingt es. */
function einmalAbbruch(code) {
  let versuche = 0;
  const fn = async () => { versuche++; if (versuche === 1) throw Object.assign(new Error('weg'), { code }); return 'ok'; };
  return { fn, versuche: () => versuche };
}

test('ein Lesezugriff nach Verbindungsabbruch wird wiederholt', async () => {
  const a = einmalAbbruch('08006');
  assert.equal(await queryWithRetry(a.fn, true), 'ok');
  assert.equal(a.versuche(), 2);
});

test('ein Schreibzugriff nach Verbindungsabbruch', async () => {
  const a = einmalAbbruch('08006');
  await assert.rejects(queryWithRetry(a.fn, false), { code: '08006' });
  assert.equal(a.versuche(), 1, 'Die Zeile stünde sonst womöglich doppelt da');
});

test('Verklemmung und Startphase dürfen auch beim Schreiben noch einmal', async () => {
  for (const code of ['40001', '40P01', '57P03', '08001']) {
    const a = einmalAbbruch(code);
    assert.equal(await queryWithRetry(a.fn, false), 'ok', code);
  }
});

test('INSERT … RETURNING ist kein Lesezugriff', () => {
  assert.equal(istLesend('SELECT 1'), true);
  assert.equal(istLesend('  -- Notiz\n  WITH x AS (SELECT 1) SELECT * FROM x'), true);
  assert.equal(istLesend('INSERT INTO t (a) VALUES (1) RETURNING id'), false);
  assert.equal(istLesend('WITH n AS (INSERT INTO t VALUES (1) RETURNING id) SELECT * FROM n'), false);
  assert.equal(istLesend('SELECT * FROM t WHERE id = 1 FOR UPDATE'), false);
  assert.equal(istLesend('UPDATE t SET a = 1'), false);
});
