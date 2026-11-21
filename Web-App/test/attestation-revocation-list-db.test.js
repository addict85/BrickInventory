/**
 * Google's revocation list arrives as a scheduled job in run_state; the fetch is
 * provided via the external sources (testSources), no network. An unreadable response
 * or a network error leaves the last good list in place.
 *
 * Counter-checks (measured 14.11.2026):
 *   A  in jobs/startJobs.ts the handler `widerrufsliste` renamed → red:
 *      “the scheduled job stores the list …” and “an unreadable response …”
 *   B  in loadRevocationList() (src/catalog) store the raw text first, then read → red: “an
 *      unreadable response …” (and “the scheduled job …”: no serial numbers)
 *   C  ZEITPLAENE.widerrufsliste removed → red: “… and schedules the next run”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testSources, testServices, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { bis } = require('./helpers/time');
const db = testData();

const EXCERPT = fs.readFileSync(path.join(__dirname, 'fixtures', 'attestation-status-excerpt.json'));
const gespeichert = async () => {
  const z = await db.get("SELECT value FROM run_state WHERE key = 'attestation_widerruf'");
  return z ? JSON.parse(z.value) : null;
};

test('revocation list as a job', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(async () => {
    await testAccess().notification.close();
    await db.pool.end().catch(() => {});
  });
  await db.run("DELETE FROM run_state WHERE key = 'attestation_widerruf'");
  await db.run("DELETE FROM jobs WHERE type = 'widerrufsliste'");
  let antwort = async () => EXCERPT;
  const fetches = [];
  testSources(t, {
    revocationListFetch: async signal => {
      fetches.push(signal);
      return antwort();
    },
  });
  const d = testServices();

  await t.test('the scheduled job stores the list and schedules the next run', async () => {
    await d.jobQueue.pullPlanBefore('widerrufsliste', 0);
    const worker = _req('jobs/startJobs.js').startJobWorker(d, { arten: ['widerrufsliste'], taktMs: 50 });
    try {
      await bis(async () => (await gespeichert()) !== null, 10_000);
    } finally {
      await worker.stop(0);
    }
    const l = await gespeichert();
    assert.equal(l.nummern.length, 5);
    assert.ok(l.nummern.includes('c35747a084470c3135aeefe2b8d40cd6'));
    assert.ok(Math.abs(Date.now() - new Date(l.stand).getTime()) < 60_000);
    assert.ok(fetches[0] instanceof AbortSignal, 'Der Abruf bekommt das Signal des Auftrags');
    const planRow = () =>
      db.get(
        `SELECT EXTRACT(EPOCH FROM due_at - NOW())::int AS in_sek FROM jobs
          WHERE dedupe_key = 'plan:widerrufsliste' AND status = 'offen'`,
      );
    await bis(async () => (await planRow())?.in_sek > 60, 5000);
    const plan = await planRow();
    assert.ok(plan?.in_sek > 5 * 3600 && plan.in_sek <= 6 * 3600, `nächster Lauf in ${plan?.in_sek} s`);
  });

  await t.test('an unreadable response or a network error leaves the last good list in place', async () => {
    const vorher = await gespeichert();
    const lauf = () =>
      _req('jobs/startJobs.js').editor(d).widerrufsliste.ausfuehren({}, { signal: new AbortController().signal });
    for (const kaputt of ['<html>Wartung</html>', '{"entries": {"zz": {"status": "REVOKED"}}}', '{}']) {
      antwort = async () => Buffer.from(kaputt);
      await assert.rejects(lauf(), kaputt);
      assert.deepEqual(await gespeichert(), vorher, kaputt);
    }
    antwort = async () => {
      throw new Error('ECONNRESET');
    };
    await assert.rejects(lauf(), /ECONNRESET/);
    assert.deepEqual(await gespeichert(), vorher);
  });
});
