/**
 * The background jobs in the administration (routes/api/admin.ts,
 * src/management/background.ts) via the real route: job list, cancel,
 * retry, clear, now — and the old addresses (brickset-queue,
 * job-status, job-schedule, trigger-price-job) keep delivering their fields.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in emptyKind() the exception for `plan:%` removed → red: “clearing
 *      discards waiting ones, not the schedule”
 *   B  in auftragAbbrechen() planeNext() removed → red: “an
 *      aborted scheduled run leaves the next date”
 *   C  in rescheduleJobs() scheduleChanged('prices') removed → red: “a
 *      new interval moves the open date”
 *   D  in bricksetList() `to_char(…)` replaced by the raw timestamp →
 *      red: “the Brickset list keeps its fields” (retry_after not a date)
 *
 * Since migration 0110 (measured on 13.11.2026):
 *   E  in jobsInOverview() again 'fehler' and 'abgebrochen' as default →
 *      red: “the list shows only pending ones …” (finished ones are in the list)
 *   F  in setMoved() `waiting = NOT $3` removed → red: the same test
 *      (waiting false instead of true)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();

test('background jobs in the admin', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  const NAME = `hgv_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active) VALUES ($1,'x',true,true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run('DELETE FROM jobs');
  const Z = _req('src/jobQueue/schedule.js');
  const A = Object.assign({}, _req('src/jobQueue/jobs.js'), {
    ..._req('src/jobQueue/service.js'),
    ...require('./helpers/sources').testArea('jobQueue').jobs,
  });
  t.after(async () => {
    await db.run('DELETE FROM jobs');
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await testAccess()
      .notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await adminWithFactor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME, isAdmin: true }, t });
  const callIt = async (methode, path, body) => {
    const r = await fetch(base + '/api/v2' + path, {
      method: methode,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  const plan = type =>
    db.get(`SELECT id::text AS id, status, due_at FROM jobs WHERE dedupe_key = $1 AND status = 'pending'`, [
      `plan:${type}`,
    ]);

  // An interval from an earlier run would already leave the date correct.
  await db.run(`DELETE FROM global_settings WHERE key = 'price_job_interval_minutes'`);
  await Z.planeAll();
  // A postponed (quota) and an aborted job next to the failed one.
  const moved = await A.placeJobOne('instructions', { set_number: '44444-1' });
  const receipt = await A.claimJob(['instructions'], 60);
  assert.equal(receipt.id, moved, 'der verschobene Auftrag sollte als erster belegt werden');
  await A.moved(receipt, new Date(Date.now() + 3_600_000), 'Tageskontingent erschöpft', false);
  const aborted = await A.placeJobOne('followup', { schritt: 'vorschauen' });
  await A.abortAb(aborted);

  const wartend = [];
  for (const sn of ['11111-1', '22222-1'])
    wartend.push(await A.placeJobOne('instructions', { set_number: sn }, { schluessel: `instructions:${sn}` }));
  const kaputt = await A.placeJobOne('followup', { schritt: 'katalog' });
  await db.run(`UPDATE jobs SET status = 'error', error_message = 'Quelle weg' WHERE id = $1`, [kaputt]);
  await db.run(`INSERT INTO run_state (key, value) VALUES ('jobs_lebenszeichen', NOW()::text)
                ON CONFLICT (key) DO UPDATE SET value = NOW()::text`);

  await t.test('the list only shows pending ones, the summary also failed ones', async st => {
    st.after(() => db.run('DELETE FROM jobs WHERE id = ANY($1)', [[moved, aborted]]));
    const r = await callIt('GET', '/admin/job-queue');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const { jobs, summary, job_process } = r.body;
    assert.deepEqual(
      jobs.filter(a => a.id === kaputt || a.id === aborted),
      [],
      'beendete Aufträge stehen in der Liste der einzelnen',
    );
    assert.deepEqual([...new Set(jobs.map(a => a.status))].sort(), ['pending']);
    const w = jobs.find(a => a.id === moved);
    assert.deepEqual([w?.status, w?.waiting, w?.error_message], ['pending', true, 'Tageskontingent erschöpft']);
    assert.equal(jobs.find(a => a.set_number === '11111-1')?.waiting, false, 'ein gewöhnlicher waiting nicht');
    assert.ok(summary.some(z => z.type === 'followup' && z.status === 'error' && z.count === 1));
    assert.equal(job_process.running, true);
    const f = (await callIt('GET', '/admin/job-queue?status=error')).body.jobs.find(a => a.id === kaputt);
    assert.deepEqual(
      [f?.status, f?.error_message, f?.waiting],
      ['error', 'Quelle weg', false],
      'mit Filter bleibt er abrufbar',
    );
  });

  await t.test('the list shows waiting and scheduled ones', async () => {
    const r = await callIt('GET', '/admin/job-queue');
    const { jobs, summary } = r.body;
    assert.deepEqual(
      jobs
        .filter(a => a.type === 'instructions')
        .map(a => a.set_number)
        .sort(),
      ['11111-1', '22222-1'],
    );
    assert.ok(
      jobs.some(a => a.type === 'prices' && a.scheduled === true),
      'geplante Läufe fehlen',
    );
    assert.ok(summary.some(z => z.type === 'instructions' && z.status === 'pending' && z.count === 2));
    assert.equal((await callIt('GET', '/admin/job-queue?kind=gibtsnicht')).status, 400);
  });

  await t.test('retry queues a failed one anew', async () => {
    assert.equal((await callIt('POST', `/admin/job-queue/${kaputt}/retry`)).status, 200);
    assert.equal((await db.get('SELECT status, attempts FROM jobs WHERE id = $1', [kaputt])).status, 'pending');
    assert.equal(
      (await callIt('POST', `/admin/job-queue/${kaputt}/retry`)).status,
      409,
      'ein offener lässt sich nicht wiederholen',
    );
  });

  await t.test('an aborted scheduled run leaves the next appointment', async () => {
    const p = await plan('image_followup');
    assert.equal((await callIt('POST', `/admin/job-queue/${p.id}/cancel`)).status, 200);
    const neu = await plan('image_followup');
    assert.ok(neu && neu.id !== p.id, 'kein neuer Termin nach dem Abbruch');
  });

  await t.test('clearing discards waiting ones, not the schedule', async () => {
    const r = await callIt('DELETE', '/admin/job-queue/kind/instructions');
    assert.deepEqual([r.status, r.body.removed], [200, 2]);
    await A.placeJobOne('prices', {}, {});
    const r2 = await callIt('DELETE', '/admin/job-queue/kind/prices');
    assert.equal(r2.body.removed, 1, 'der einzelne Preis-Auftrag ist weg');
    assert.ok(await plan('prices'), 'der geplante Preis-Lauf wurde mit geleert');
  });

  await t.test('now brings the scheduled run forward', async () => {
    const r = await callIt('POST', '/admin/job-queue/kind/cleanup/now');
    assert.deepEqual([r.status, r.body.started], [200, true]);
    assert.ok(new Date((await plan('cleanup')).due_at) <= new Date());
  });

  await t.test('a new interval moves the open appointment', async () => {
    const r = await callIt('POST', '/admin/job-schedule', { name: 'priceJob', minutes: 600 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const in_min = (new Date((await plan('prices')).due_at).getTime() - Date.now()) / 60_000;
    assert.ok(in_min > 590 && in_min <= 600, `Termin in ${Math.round(in_min)} min statt 600`);
    const state = await callIt('GET', '/admin/job-status');
    assert.equal(state.body.job.running, false);
    assert.equal(new Date(state.body.job.nextRun).getTime(), new Date((await plan('prices')).due_at).getTime());
    assert.equal((await callIt('POST', '/admin/trigger-price-job')).body.started, true);
  });

  await t.test('the Brickset list keeps its fields', async () => {
    await _req('src/externalSources/bricksetResubmission.js').bricksetReserve('33333-1', 'Quota exceeded');
    const r = await callIt('GET', '/admin/brickset-queue');
    const e = r.body.entries.find(x => x.set_number === '33333-1');
    assert.ok(e, JSON.stringify(r.body));
    assert.match(e.retry_after, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual([e.attempts, e.last_error], [1, 'Quota exceeded']);
    assert.equal((await callIt('DELETE', '/admin/brickset-queue/33333-1')).status, 200);
    assert.equal(
      (await callIt('GET', '/admin/brickset-queue')).body.entries.some(x => x.set_number === '33333-1'),
      false,
    );
  });
});
