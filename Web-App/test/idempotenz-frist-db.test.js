'use strict';
/**
 * Eine erste Anfrage darf so lange laufen, wie der Server sie lässt
 * (requestTimeout); erst danach gilt ihr Idempotenzschlüssel als verwaist. Eine
 * Wiederholung während einer langsamen Anfrage bekommt „läuft noch“, keine
 * zweite Wirkung.
 *
 * Gegenprobe (05.11.2026 gemessen): VERWAIST_NACH_S wieder 120 → rot: „die
 * Frist ist kürzer als die längste Anfrage“; ohne diese erste Zusicherung rot an
 * „nach 130 s läuft die erste Anfrage noch“ (art: 'neu', die Wirkung käme doppelt).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');

test('Idempotenz: die Frist folgt der längsten Anfrage', { concurrency: 1 }, async (t) => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const dienst = _req('src/idempotenz/dienst.js');
  const { HTTP_FRISTEN } = _req('src/infra/httpFristen.js');
  assert.ok(dienst.VERWAIST_NACH_S * 1000 > HTTP_FRISTEN.requestTimeout, 'die Frist ist kürzer als die längste Anfrage');

  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`idem_${process.pid}`])).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
  const abdruck = dienst.fingerabdruck('POST', '/api/v1/sets', { set_number: '10294-1' });
  assert.deepEqual(await dienst.beginne(uid, 'k1', abdruck), { art: 'neu' });
  // Die Uhr der ersten Anfrage um 130 s zurück: Sie läuft noch (bis 300 s erlaubt).
  await db.run(`UPDATE idempotenz SET angelegt = NOW() - INTERVAL '130 seconds' WHERE user_id = $1`, [uid]);
  assert.deepEqual(await dienst.beginne(uid, 'k1', abdruck), { art: 'laeuft' }, 'nach 130 s läuft die erste Anfrage noch');
  // Nach der Frist ist sie verwaist und darf neu belegt werden.
  await db.run(`UPDATE idempotenz SET angelegt = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [uid, dienst.VERWAIST_NACH_S + 1]);
  assert.deepEqual(await dienst.beginne(uid, 'k1', abdruck), { art: 'neu' }, 'eine verwaiste Anfrage wird neu belegt');
});
