/**
 * Not even the administrator learns via their tools which account
 * holds which set: image diagnosis and job list respond without
 * `user_id`. The test data carries both (set of a foreign account, job
 * with account and set number) so that the field would occur. Responses run against
 * the contract (CHECK_CONTRACT=1 from buildAndRequire).
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in jobList() `user_id` read along again → red: “the
 *      job list …” (the response carries user_id)
 *   B  accountImageRows() additionally reads `MAX(s.user_id) AS user_id` →
 *      red: “the image diagnosis …”
 *   C  in the contract `user_id` back in Auftrag → red: “no response schema
 *      names user_id” and “the job list …” (the response deviates from the
 *      contract because the query does not deliver the field)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const { routeFor } = _req('src/contract/index.js');
const { z } = require('zod');

/** Does a key occur anywhere in the JSON? */
const containsKey = (wert, name) =>
  wert &&
  typeof wert === 'object' &&
  (Object.hasOwn(wert, name) || Object.values(wert).some(v => containsKey(v, name)));

test('no admin response schema names user_id', () => {
  for (const r of ['GET /api/v2/admin/job-queue', 'GET /api/v2/admin/image-diag/:setNumber']) {
    const schema = JSON.stringify(z.toJSONSchema(routeFor(r).response, { io: 'output', unrepresentable: 'any' }));
    assert.doesNotMatch(schema, /"user_id"/, r);
  }
});

test('admin tools reveal no owners', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const P = process.pid,
    SN = `9${P % 100000}-1`;
  const namen = [`vbf_chef_${P}`, `vbf_fremd_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const [i, n] of namen.entries())
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
      VALUES ($1, 'x', $2, true, true) RETURNING id`,
          [n, i === 0],
        )
      ).id,
    );
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [ids[1], SN]);
  const auftrag = (
    await db.get(
      `INSERT INTO jobs (type, payload, user_id, status) VALUES ('brickset', $1, $2, 'error') RETURNING id`,
      [JSON.stringify({ set_number: SN }), ids[1]],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM jobs WHERE id = $1', [auftrag]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await adminWithFactor(_req, ids[0]);
  const { base } = testServer(_req, { sitzung: { userId: ids[0], username: namen[0], isAdmin: true }, t });

  await t.test('the image diagnostics count accounts but do not name them', async () => {
    const r = await fetch(`${base}/api/v2/admin/image-diag/${SN}`);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.database.account_count, 1);
    assert.equal(containsKey(body, 'user_id'), false, JSON.stringify(body.database));
    assert.ok(!JSON.stringify(body).includes(`"${ids[1]}"`) && !body.hints.includes('Kein Konto führt dieses Set.'));
  });

  await t.test('the job list without account', async () => {
    const r = await fetch(`${base}/api/v2/admin/job-queue?status=error`);
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    const entryRow = body.jobs.find(a => a.id === String(auftrag));
    assert.ok(entryRow, 'Precondition: the job is in the list');
    assert.equal(entryRow.set_number, SN);
    assert.equal(containsKey(body, 'user_id'), false, JSON.stringify(entryRow));
  });
});
