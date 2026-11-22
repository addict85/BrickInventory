/**
 * Findings of UI review 16, as far as they lie on the server, on the real API:
 *   - Messages come as a code and in the requester's language (M2):
 *     empty CSV file, line errors in the import state, skipped lines.
 *   - Storage locations: /v2/storage/locations also delivers empty locations, /v2/storage …
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in sets/dienst.ts again `throw new Meldung('Keine Datenzeilen in der
 *      Datei', 400)` → red: “empty CSV file: English and with code”
 *   B  buildJobStatus() without translating the lines → red: “line errors
 *      in the import state in the reader's language”
 *   C  purchasePriceColumns() without kaufpreis_original → red: “foreign currency:
 *      amount and currency are shown”
 *   D  catalogRow() again only with the own account ID → red: “catalog:
 *      set of the sub-account is present”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet } = require('./helpers/inventory');

test('import, storage locations, foreign currency and catalog on the server', {
  concurrency: 1,
  timeout: 120_000,
}, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `r16s_${process.pid}`,
    KIND = `${NAME}_kind`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, KIND]]);
  const neu = async n =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, 'x', true, true) RETURNING id`,
        [n, `${n}@example.org`],
      )
    ).id;
  const uid = await neu(NAME),
    kid = await neu(KIND);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, kid]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, kid]]).catch(() => {});
    await db.run(`DELETE FROM rb_sets WHERE set_num = '99161-1'`).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  const hole = async (path, o = {}) => {
    const r = await fetch(`${base}/api/v2${path}`, {
      ...o,
      headers: { 'Accept-Language': o.language || 'de', ...o.headers },
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('empty CSV file: English and with a code', async () => {
    for (const [language, text] of [
      ['en', 'The file has no data rows'],
      ['de', 'Keine Datenzeilen in der Datei'],
    ]) {
      const form = new FormData();
      form.append('file', new Blob(['set_number,quantity\n'], { type: 'text/csv' }), 'leer.csv');
      const r = await hole('/sets/import/csv', { method: 'POST', body: form, language });
      assert.deepEqual([r.status, r.body.code, r.body.error], [400, 'csv_no_data_rows', text]);
    }
  });

  await t.test("row errors in the import state in the reader's language", async () => {
    await db.run(
      `INSERT INTO import_status (user_id, status, total, done, results) VALUES ($1, 'done', 2, 2, $2::jsonb)
                  ON CONFLICT (user_id) DO UPDATE SET status = 'done', results = EXCLUDED.results`,
      [
        uid,
        JSON.stringify([
          { set_number: 'foo', success: false, code: 'set_number_invalid', error: 'Das ist keine Setnummer' },
          { set_number: '10294-1', success: true, action: 'updated', quantity: 1 },
        ]),
      ],
    );
    const en = await hole('/sets/import/csv/status', { language: 'en' });
    assert.equal(en.body.results[0].error, 'That is not a set number (letters and digits, e.g. 10294).');
    assert.deepEqual([en.body.ok, en.body.err], [1, 1]);
    const de = await hole('/sets/import/csv/status');
    assert.match(de.body.results[0].error, /^Das ist keine Setnummer \(Buchstaben/);
  });

  await t.test('storage locations: stock with empty places, filter only occupied ones', async () => {
    const leer = (
      await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Dachboden Kiste 3') RETURNING id`, [uid])
    ).id;
    const belegt = (
      await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Keller Regal A') RETURNING id`, [uid])
    ).id;
    await holdsSet(db, uid, '10294-1', 1, { preis: 100 });
    await db.run('UPDATE sets SET storage_id = $2 WHERE user_id = $1', [uid, belegt]);
    const vorrat = await hole('/storage/locations');
    assert.deepEqual(vorrat.body.locations.map(o => o.name).sort(), ['Dachboden Kiste 3', 'Keller Regal A']);
    const filter = await hole('/storage');
    assert.deepEqual(
      filter.body.locations.map(o => o.location),
      ['Keller Regal A'],
    );
    assert.ok(leer > 0);
  });

  await t.test('foreign currency: amount and currency are shown', async () => {
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '75313-1')`, [uid]);
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
                  VALUES ($1, '75313-1', 1, 99.99, 'N', 'USD')`,
      [uid],
    );
    await db.run(`DELETE FROM exchange_rates WHERE currency = 'USD'`).catch(() => {});
    const r = await hole('/finance/valuation');
    const set = r.body.sets.find(s => s.set_number === '75313-1');
    assert.ok(set, JSON.stringify(r.body.sets.map(s => s.set_number)));
    const [a] = set.acquisitions;
    assert.deepEqual([a.purchase_price, a.original_purchase_price, a.purchase_currency], [null, 99.99, 'USD']);
  });

  await t.test("catalog: the sub-account's set is present", async () => {
    await db.run(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts) VALUES ('99161-1', 'Probe-Set', 2024, 1, 10)
                  ON CONFLICT (set_num) DO NOTHING`);
    await holdsSet(db, kid, '99161-1', 2);
    const r = await hole('/catalog/sets/99161-1');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.set.owned, r.body.set.owned_quantity], [true, 2]);
  });
});
