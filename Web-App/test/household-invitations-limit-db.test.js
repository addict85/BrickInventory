/**
 * An account holds at most five open household invitations. Each is a
 * valid way into the household (24 h); nobody needed arbitrarily many, and
 * the table grew with every click.
 *
 * Counter-check (measured 01.11.2026): the check deleted in createInvitation()
 * → red: “the sixth …" (200 instead of 409).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();

test('open household invitations are limited', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `einladung_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM account_link_invites WHERE main_user_id = $1', [uid]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const lade = async () => {
    const r = await fetch(`${base}/api/v2/settings/household/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const b = await r.json();
    return [r.status, r.status === 200 ? typeof b.code : b.code];
  };

  await t.test('five work, the sixth does not, a redeemed one makes room', async () => {
    for (let i = 0; i < 5; i++) assert.deepEqual(await lade(), [200, 'string'], `Einladung ${i + 1}`);
    assert.deepEqual(await lade(), [409, 'too_many_invites'], 'the sixth');
    await db.run(
      `UPDATE account_link_invites SET used_at = NOW()
      WHERE ctid = (SELECT ctid FROM account_link_invites WHERE main_user_id = $1 LIMIT 1)`,
      [uid],
    );
    assert.deepEqual(await lade(), [200, 'string']);
  });
});
