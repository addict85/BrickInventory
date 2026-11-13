/**
 * Erfassen nur, was gemeint ist: POST /sets nimmt eine getippte Setnummer,
 * keinen Satz, aus dem die nachsichtige Normalisierung ein Set machte; und
 * „von der Merkliste übernehmen“ verlangt einen Merkposten.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in POST /sets die Prüfung der rohen Nummer entfernt → rot: „ein Satz
 *      ist keine Setnummer“ (200, Set 1-1 angelegt) und dadurch auch „ohne
 *      Merkposten …“ (das Set steht schon)
 *   B  in uebernimm() die Prüfung auf den Merkposten entfernt → rot: „ohne
 *      Merkposten …“ (200, Set angelegt)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test('Erfassen nur, was gemeint ist', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const NAME = `streng_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
    VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  const post = async (weg, body) => {
    const r = await fetch(`${base}/api/v1${weg}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, code: (await r.json()).code };
  };
  const sets = async () =>
    (await db.all('SELECT set_number FROM sets WHERE user_id = $1', [uid])).map(z => z.set_number);

  await t.test('ein Satz ist keine Setnummer', async () => {
    for (const roh of ["1'; DROP TABLE sets;--", '75192 Millennium Falcon', '75192;2'])
      assert.deepEqual(await post('/sets', { set_number: roh }), { status: 400, code: 'setnummer_ungueltig' }, roh);
    assert.deepEqual(await sets(), []);
  });

  await t.test('ohne Merkposten wird nichts übernommen', async () => {
    assert.deepEqual(await post('/wanted/75192-1/N/uebernehmen', {}), { status: 404, code: 'nicht_gefunden' });
    assert.deepEqual(await sets(), []);
  });
});
