/**
 * The set CSV import is honest about errors (UI review 17, M2): an
 * invalid quantity is not silently “repaired”, a line without a set number
 * not silently skipped, every result names its line, a set unknown to the catalog
 * counts as a warning, and before taking over the check says
 * which sets are already in the collection. File as in the report
 * (import-fehler.csv), import as a job with a provided acquireSet.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  csvMenge() again with .replace(/[^0-9]/g, '') → red: “every line with
 *      its result” (line 5 booked as “+1 copy”)
 *   B  `if (!sn) continue;` instead of the error line → red: “every line with
 *      its result” (line 7 missing, 7 instead of 8 results)
 *   C  buildJobStatus counts katalog_offen as ok again → red: “sums”
 *      (ok 4, warn 0)
 *   D  in startSetCsvImport alreadyPresent() replaced by [] → red: “the
 *      check names existing sets and starts nothing”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const booked = [];
const Module = require('node:module');
const _realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _realRequire.call(this, name, ...rest);
  if (typeof name === 'string' && /[/\\]addSet(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) => {
        if (k !== 'acquireSet') return t[k];
        return async (_sk, { setNumber: sn, quantity: qty }) => {
          if (sn === 'abc') throw new Error('That is not a set number');
          booked.push(`${sn}×${qty}`);
          return { action: 'added', set_number: sn, ...(sn === '99999-1' ? { catalog_pending: true } : {}) };
        };
      },
    });
  return m;
};

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testData();
const { bis } = require('./helpers/time');

const DATEI = 'Set Number,Quantity\n10200-1,1\n10305-1,2\nabc,1\n10312-1,x\n99999-1,1\n,3\n10319-1,-2\n10326-1,1\n';

test('CSV import: check, rows and sums', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `csvpruef-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, '10305-1']);
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const worker = _req('jobs/startJobs.js').startJobWorker(require('./helpers/sources').testServices(), {
    arten: ['csv_import'],
    taktMs: 50,
  });
  t.after(async () => {
    await worker.stop(0);
    await testAccess().notification.close();
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const sende = async check => {
    const fd = new FormData();
    fd.append('file', new Blob([DATEI]), 'import-fehler.csv');
    const r = await fetch(`${base}/api/v2/sets/import/csv${check ? '?check=1' : ''}`, { method: 'POST', body: fd });
    assert.equal(r.status, 200);
    return r.json();
  };

  await t.test('the check names existing sets and starts nothing', async () => {
    const p = await sende(true);
    assert.equal(p.started, false);
    assert.equal(p.total, 8, 'eight data rows read');
    assert.equal(p.existing, 1);
    assert.deepEqual(p.existing_numbers, ['10305-1']);
    assert.equal(await db.get('SELECT 1 FROM import_status WHERE user_id=$1', [uid]), undefined, 'no run created');
  });

  await sende(false);
  let s;
  await bis(async () => {
    s = await (await fetch(`${base}/api/v2/sets/import/csv/status`)).json();
    return s.status !== 'running';
  });

  await t.test('every row with its result', () => {
    assert.equal(s.status, 'done');
    const kurz = s.results.map(
      r => `${r.row}:${r.set_number}:${r.success ? (r.catalog_pending ? 'warn' : 'ok') : r.code || 'fehler'}`,
    );
    assert.deepEqual(kurz, [
      '2:10200-1:ok',
      '3:10305-1:ok',
      '4:abc:fehler',
      '5:10312-1:csv_quantity_invalid',
      '6:99999-1:warn',
      '7::csv_no_set_number',
      '8:10319-1:csv_quantity_invalid',
      '9:10326-1:ok',
    ]);
    assert.match(s.results[3].error, /Menge „x“ ungültig/);
    assert.match(s.results[6].error, /Menge „-2“ ungültig/);
    assert.deepEqual(booked, ['10200-1×1', '10305-1×2', '99999-1×1', '10326-1×1'], 'only valid rows booked');
  });

  await t.test('sums', () => {
    assert.deepEqual({ total: s.total, ok: s.ok, warn: s.warn, err: s.err }, { total: 8, ok: 3, warn: 1, err: 4 });
    assert.ok(Date.now() - Date.parse(s.finished_at) < 60_000, `beendet_am: ${s.finished_at}`);
  });
});
