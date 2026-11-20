'use strict';
/**
 * Eine erste Anfrage darf so lange laufen, wie der Server sie lässt
 * (requestTimeout); erst danach gilt ihr Idempotenzschlüssel als verwaist. Eine
 * Wiederholung während einer langsamen Anfrage bekommt „läuft noch“, keine
 * zweite Wirkung.
 *
 * Gegenprobe (05.11.2026 gemessen): ORPHANED_AFTER_S wieder 120 → rot: „die
 * Frist ist kürzer als die längste Anfrage“; ohne diese erste Zusicherung rot an
 * „nach 130 s läuft die erste Anfrage noch“ (kind: 'new', die Wirkung käme doppelt).
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('Idempotenz: die Frist folgt der längsten Anfrage', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const dienst = _req('src/idempotency/service.js');
  const { HTTP_DEADLINES } = _req('src/infra/httpFristen.js');
  assert.ok(
    dienst.ORPHANED_AFTER_S * 1000 > HTTP_DEADLINES.requestTimeout,
    'die Frist ist kürzer als die längste Anfrage',
  );

  const uid = (
    await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`idem_${process.pid}`])
  ).id;
  t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
  const abdruck = dienst.fingerprint('POST', '/api/v1/sets', { set_number: '10294-1' });
  assert.deepEqual(await dienst.begin(uid, 'k1', abdruck), { kind: 'new' });
  // Die Uhr der ersten Anfrage um 130 s zurück: Sie läuft noch (bis 300 s erlaubt).
  await db.run(`UPDATE idempotency SET created_at = NOW() - INTERVAL '130 seconds' WHERE user_id = $1`, [uid]);
  assert.deepEqual(
    await dienst.begin(uid, 'k1', abdruck),
    { kind: 'running' },
    'nach 130 s läuft die erste Anfrage noch',
  );
  // Nach der Frist ist sie verwaist und darf neu belegt werden.
  await db.run(`UPDATE idempotency SET created_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [
    uid,
    dienst.ORPHANED_AFTER_S + 1,
  ]);
  assert.deepEqual(await dienst.begin(uid, 'k1', abdruck), { kind: 'new' }, 'eine verwaiste Anfrage wird neu belegt');
});
