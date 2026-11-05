/**
 * Befunde der UI-Prüfung 16, soweit sie am Server liegen, an der echten API:
 *   - Meldungen kommen als Code und in der Sprache des Anfragenden (M2):
 *     leere CSV-Datei, Zeilenfehler im Importstand, übersprungene Zeilen.
 *   - Lagerorte: /v1/storage/locations liefert auch leere Orte, /v1/storage
 *     nur belegte (M1; die Oberfläche füllt daraus Auswahl und Filter).
 *   - Ein Kaufpreis in fremder Währung ohne Kurs steht mit Betrag und
 *     Währung in der Bewertung (M6).
 *   - Der Katalog zeigt ein Set des Unterkontos als vorhanden, wie die
 *     Merkliste (niedrig 5).
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  in sets/dienst.ts wieder `throw new Meldung('Keine Datenzeilen in der
 *      Datei', 400)` → rot: „leere CSV-Datei: englisch und mit Code“
 *   B  buildJobStatus() ohne die Übersetzung der Zeilen → rot: „Zeilenfehler
 *      im Importstand in der Sprache des Lesers“
 *   C  kaufpreisSpalten() ohne kaufpreis_original → rot: „Fremdwährung:
 *      Betrag und Währung stehen da“
 *   D  katalogZeile() wieder nur mit der eigenen Konto-ID → rot: „Katalog:
 *      Set des Unterkontos ist vorhanden“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');

test('UI-Prüfung 16: Server', { concurrency: 1, timeout: 120_000 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  const NAME = `r16s_${process.pid}`, KIND = `${NAME}_kind`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, KIND]]);
  const neu = async (n) => (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, 'x', true, true) RETURNING id`, [n, `${n}@example.org`])).id;
  const uid = await neu(NAME), kid = await neu(KIND);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, kid]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, kid]]).catch(() => {});
    await db.run(`DELETE FROM rb_sets WHERE set_num = '99161-1'`).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const hole = async (pfad, o = {}) => {
    const r = await fetch(`${base}/api/v1${pfad}`, { ...o, headers: { 'Accept-Language': o.sprache || 'de', ...o.headers } });
    return { status: r.status, body: await r.json() };
  };

  await t.test('leere CSV-Datei: englisch und mit Code', async () => {
    for (const [sprache, text] of [['en', 'The file has no data rows'], ['de', 'Keine Datenzeilen in der Datei']]) {
      const form = new FormData();
      form.append('file', new Blob(['set_number,quantity\n'], { type: 'text/csv' }), 'leer.csv');
      const r = await hole('/sets/import/csv', { method: 'POST', body: form, sprache });
      assert.deepEqual([r.status, r.body.code, r.body.error], [400, 'csv_keine_datenzeilen', text]);
    }
  });

  await t.test('Zeilenfehler im Importstand in der Sprache des Lesers', async () => {
    await db.run(`INSERT INTO import_stand (user_id, status, total, done, results) VALUES ($1, 'done', 2, 2, $2::jsonb)
                  ON CONFLICT (user_id) DO UPDATE SET status = 'done', results = EXCLUDED.results`,
    [uid, JSON.stringify([{ set_number: 'foo', success: false, code: 'setnummer_ungueltig', error: 'Das ist keine Setnummer' },
                          { set_number: '10294-1', success: true, action: 'updated', menge: 1 }])]);
    const en = await hole('/sets/import/csv/status', { sprache: 'en' });
    assert.equal(en.body.results[0].error, 'That is not a set number (letters and digits, e.g. 10294).');
    assert.deepEqual([en.body.ok, en.body.err], [1, 1]);
    const de = await hole('/sets/import/csv/status');
    assert.match(de.body.results[0].error, /^Das ist keine Setnummer \(Buchstaben/);
  });

  await t.test('Lagerorte: Vorrat mit leeren Orten, Filter nur belegte', async () => {
    const leer = (await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Dachboden Kiste 3') RETURNING id`, [uid])).id;
    const belegt = (await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Keller Regal A') RETURNING id`, [uid])).id;
    await haeltSet(db, uid, '10294-1', 1, { preis: 100 });
    await db.run('UPDATE sets SET storage_id = $2 WHERE user_id = $1', [uid, belegt]);
    const vorrat = await hole('/storage/locations');
    assert.deepEqual(vorrat.body.orte.map(o => o.name).sort(), ['Dachboden Kiste 3', 'Keller Regal A']);
    const filter = await hole('/storage');
    assert.deepEqual(filter.body.orte.map(o => o.ort), ['Keller Regal A']);
    assert.ok(leer > 0);
  });

  await t.test('Fremdwährung: Betrag und Währung stehen da', async () => {
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '75313-1')`, [uid]);
    await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)
                  VALUES ($1, '75313-1', 1, 99.99, 'N', 'USD')`, [uid]);
    await db.run(`DELETE FROM wechselkurse WHERE waehrung = 'USD'`).catch(() => {});
    const r = await hole('/finance/valuation');
    const set = r.body.sets.find(s => s.set_number === '75313-1');
    assert.ok(set, JSON.stringify(r.body.sets.map(s => s.set_number)));
    const [a] = set.acquisitions;
    assert.deepEqual([a.purchase_price, a.kaufpreis_original, a.kaufpreis_waehrung], [null, 99.99, 'USD']);
  });

  await t.test('Katalog: Set des Unterkontos ist vorhanden', async () => {
    await db.run(`INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts) VALUES ('99161-1', 'Probe-Set', 2024, 1, 10)
                  ON CONFLICT (set_num) DO NOTHING`);
    await haeltSet(db, kid, '99161-1', 2);
    const r = await hole('/catalog/sets/99161-1');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.set.owned, r.body.set.owned_quantity], [true, 2]);
  });
});
