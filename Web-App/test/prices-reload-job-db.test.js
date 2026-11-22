/**
 * „Fetch missing prices“ (src/jobQueue/service.ts rememberPricesBefore): per account and
 * currency at most one job stands open that takes in new items — even with
 * concurrent valuations. If one runs, at most one follow-up job is added,
 * and the running one can still go back (postponed, failed, interrupted)
 * without failing on the unique key. Plus the progress in the worker.
 *
 * Counter-checks (measured on 13.11.2026, each on its own, dist rebuilt):
 *   A  in rememberPricesBefore again one key per item list (hash) → red: “per
 *      account and currency one open job” (two open ones) and “concurrent …”
 *   B  in ergaenzePreisAuftrag `DO UPDATE …` replaced by `DO NOTHING` → red:
 *      “per account and currency …” (the new items are missing)
 *   C  in setMoved again fixed 'offen' instead of OFFEN_ODER_ERSETZT → red:
 *      “the running one goes back while its follow-up job waiting” (23505)
 *   D  the same in giveBack → red: the same test (23505 when giving back)
 *   E  `waiting = false` removed in belegeAuftrag → red: “postponed waiting, no longer occupies”
 *   F  Math.floor removed in setProgress → red: “progress in whole numbers …” (5.532)
 *   G  in progressChain `.then(melde, melde)` again `.then(melde)` → red: the same test
 *      (the report after the failed one fails too)
 *
 * As in operation: a valuation queues prices in the account (asAccount), test data
 * is written and read by the owner role.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const set = n => ({ art: 'set', nummer: `${n}-1`, zustand: 'N' });

test('fetch missing prices: one job per account and currency', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `pna-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [NAME])).id;
  const D_ = _req('src/jobQueue/service.js');
  const { rememberPricesBefore } = _req('src/finances/priceItems.js');
  const D = { ...D_, rememberPricesBefore: n => asAccount(uid, () => rememberPricesBefore(n)) };
  const repo = require('./helpers/sources').testArea('jobQueue').auftraege;
  const { createWorker } = _req('jobs/jobWorker.js');
  const leeren = () => db.run(`DELETE FROM jobs WHERE type = 'preise_nachladen'`);
  const zeilen = () =>
    db.all(
      `SELECT id::text AS id, status, waiting, payload->'posten' AS posten, payload->>'waehrung' AS waehrung
         FROM jobs WHERE type = 'preise_nachladen' AND user_id = $1 ORDER BY id`,
      [uid],
    );
  t.after(async () => {
    await leeren();
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await require('./helpers/sources')
      .testArea('jobQueue')
      .db.notification.close()
      .catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await leeren();

  await t.test('per account and currency one open job that takes in new items', async () => {
    const a = await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(1), set(2)] });
    const b = await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(2), set(3)] });
    assert.equal(b, a, 'eine zweite Liste stellte einen zweiten Auftrag ein');
    await D.rememberPricesBefore({ user_id: uid, waehrung: 'EUR', posten: [set(9)] });
    const z = await zeilen();
    assert.deepEqual(
      z.map(x => [x.waehrung, x.status, x.posten.map(p => p.nummer)]),
      [
        ['CHF', 'offen', ['1-1', '2-1', '3-1']],
        ['EUR', 'offen', ['9-1']],
      ],
    );
  });

  await t.test('at most 2000 items, the older ones first', async () => {
    await leeren();
    const viele = (von, n) => Array.from({ length: n }, (_, i) => set(von + i));
    await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: viele(0, 1500) });
    await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: viele(1000, 1500) });
    const [z] = await zeilen();
    assert.equal(z.posten.length, 2000);
    assert.deepEqual([z.posten[0].nummer, z.posten[1999].nummer], ['0-1', '1999-1']);
  });

  await t.test('concurrent valuations still enqueue only one', async () => {
    await leeren();
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(100 + i), set(200)] }),
      ),
    );
    const z = await zeilen();
    assert.equal(z.length, 1, `${z.length} offene Aufträge`);
    assert.equal(z[0].posten.length, 9);
  });

  await t.test('while one runs, at most one follow-up job is added', async () => {
    await leeren();
    await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
    const lauf = await repo.claimJob(['preise_nachladen'], 60);
    assert.ok(lauf);
    await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(2)] });
    await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(3)] });
    assert.deepEqual(
      (await zeilen()).map(x => [x.status, x.posten.length]),
      [
        ['laeuft', 1],
        ['offen', 2],
      ],
    );
  });

  await t.test('the running one goes back while its follow-up job waiting', async () => {
    const bis = new Date(Date.now() + 6 * 3600_000);
    for (const zurueck of [
      a => D.moved(a, bis, 'BrickLink-Tageskontingent erschöpft', false),
      a => D.failed(a, 'Quelle weg'),
      a => repo.giveBack(a),
    ]) {
      await leeren();
      await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
      const lauf = await repo.claimJob(['preise_nachladen'], 60);
      const sequence = await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(1), set(2)] });
      await zurueck(lauf);
      const z = await zeilen();
      assert.deepEqual(
        z.map(x => [x.id, x.status]),
        [
          [lauf.id, 'abgebrochen'],
          [sequence, 'offen'],
        ],
      );
    }
  });

  await t.test('postponed waiting, no longer occupies', async () => {
    await leeren();
    await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
    const lauf = await repo.claimJob(['preise_nachladen'], 60);
    await D.moved(lauf, new Date(Date.now() - 1000), 'BrickLink-Tageskontingent erschöpft', false);
    assert.deepEqual(
      (await zeilen()).map(x => [x.status, x.waiting]),
      [['offen', true]],
    );
    await repo.claimJob(['preise_nachladen'], 60);
    assert.deepEqual(
      (await zeilen()).map(x => [x.status, x.waiting]),
      [['laeuft', false]],
    );
  });

  await t.test('progress in whole numbers, and a failed report does not stop the following ones', async () => {
    await leeren();
    const id = await D.rememberPricesBefore({ user_id: uid, waehrung: 'CHF', posten: [set(1)] });
    const stand = () => db.get('SELECT progress FROM jobs WHERE id = $1', [id]).then(r => r.progress);
    const gesehen = [];
    const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
      preise_nachladen: {
        ausfuehren: async (_n, k) => {
          await k.progress({ erledigt: 5.532, gesamt: 8 });
          gesehen.push(await stand());
          // BigInt cannot be written as JSON: this one report fails.
          await assert.rejects(k.progress({ erledigt: 6, gross: 1n }));
          gesehen.push(await k.progress({ erledigt: 7, gesamt: 8 }));
          gesehen.push(await stand());
        },
      },
    });
    assert.equal(await w.processOne(), true);
    assert.deepEqual(gesehen, [{ erledigt: 5, gesamt: 8 }, true, { erledigt: 7, gesamt: 8 }]);
    assert.equal((await zeilen())[0].status, 'erledigt');
  });
});
