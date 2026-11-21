'use strict';
/**
 * A first request may run as long as the server lets it
 * (requestTimeout); only afterwards does its idempotency key count as orphaned. A
 * repetition during a slow request gets “still running”, no
 * second effect.
 *
 * Counter-check (measured 05.11.2026): ORPHANED_AFTER_S back to 120 → red: “the
 * deadline is shorter than the longest request”; without this first assertion red at
 * “after 130 s the first request still runs” (kind: 'new', the effect would come twice).
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('idempotency: the deadline follows the longest request', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const dienst = _req('src/idempotency/service.js');
  const { HTTP_DEADLINES } = _req('src/infra/httpDeadlines.js');
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
  // The clock of the first request 130 s back: it still runs (up to 300 s allowed).
  await db.run(`UPDATE idempotency SET created_at = NOW() - INTERVAL '130 seconds' WHERE user_id = $1`, [uid]);
  assert.deepEqual(
    await dienst.begin(uid, 'k1', abdruck),
    { kind: 'running' },
    'nach 130 s läuft die erste Anfrage noch',
  );
  // After the deadline it is orphaned and may be occupied anew.
  await db.run(`UPDATE idempotency SET created_at = NOW() - make_interval(secs => $2) WHERE user_id = $1`, [
    uid,
    dienst.ORPHANED_AFTER_S + 1,
  ]);
  assert.deepEqual(await dienst.begin(uid, 'k1', abdruck), { kind: 'new' }, 'eine verwaiste Anfrage wird neu belegt');
});
