/**
 * Ein Platzhalter-Name überschreibt nie den echten Namen eines Sets, und eine
 * Eingabe, die keine Setnummer sein kann, wird nicht angelegt.
 *
 * Fehlerbild: „Titanic" hiess nach erneutem Erfassen „Set 10294-1". Die
 * BrickLink-Typprüfung legt eine catalog_cache-Zeile an; setAngaben() muss den
 * Namen trotzdem aus dem Katalog (rb_sets) nennen.
 *
 * Gegenproben (A am 11.11.2026, B und C am 28.10.2026 gemessen):
 *   A  in catalogSetTo() `rs.name` durch `NULL::text AS name` ersetzt → rot:
 *      „setAngaben nennt den Katalognamen, keinen Platzhalter“
 *   B  beim Anlegen (damals addSetIntern) wieder `name = EXCLUDED.name` → rot: „erneutes
 *      Erfassen ohne Quellen lässt den Katalognamen stehen"
 *   C  die Prüfung possibleSetNumber() beim Anlegen entfernt → rot:
 *      „eine Eingabe ohne Ziffer wird nicht als Set angelegt" ("abc-1" im Bestand)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne API-Schlüssel, damit
 * keine Quelle antwortet.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/bestand');
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('Katalogname bleibt bei fehlenden Quellen', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  const SN = `9${process.pid % 10000}-1`;
  const NAME = `kat-name-${process.pid}`;
  const schluessel = ['rebrickable_api_key', 'brickset_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await catalogSet(db, SN, { name: 'Titanic', year: 2021 });
  await db.run(
    `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1, 'NONE', false)
                ON CONFLICT (set_number) DO UPDATE SET fetched_at=NOW()`,
    [SN],
  );

  try {
    await t.test('setAngaben nennt den Katalognamen, keinen Platzhalter', async () => {
      // Der Abrufstand in catalog_cache trägt seit 0108 keinen Namen mehr, der den Katalog verdecken könnte.
      const info = await _req('src/catalog/rebrickableCatalog.js').setAngaben(SN);
      assert.equal(info?.name, 'Titanic');
    });

    await t.test('erneutes Erfassen ohne Quellen lässt den Katalognamen stehen', async () => {
      const r = await require('./helpers/sources').areaPage('sets').setErfassen({
        requester: uid,
        setNumber: SN,
        menge: 1,
        kaufpreis: 10,
        zustand: 'N',
      });
      assert.equal(r.action, 'added');
      const kat = await db.get('SELECT name, year FROM rb_sets WHERE set_num=$1', [SN]);
      assert.equal(kat.name, 'Titanic');
      assert.equal(kat.year, 2021);
    });

    await t.test('eine Eingabe ohne Ziffer wird nicht als Set angelegt', async () => {
      const { setErfassen } = require('./helpers/sources').areaPage('sets');
      await assert.rejects(
        setErfassen({ requester: uid, setNumber: 'abc', menge: 1, zustand: 'N', ifPresent: 'aufstocken' }),
        (/** @type {any} */ e) => e.art === 'ungueltig' && e.code === 'setnummer_ungueltig',
      );
      assert.equal(await db.get(`SELECT 1 FROM sets WHERE user_id=$1 AND set_number='abc-1'`, [uid]), undefined);
      const { possibleSetNumber } = _req('src/infra/setNumber.js');
      for (const gut of ['10294-1', '928-1', 'comcon001-1', 'llca37-1', '5005358-2'])
        assert.ok(possibleSetNumber(gut), gut);
      for (const schlecht of ['abc-1', '-1', 'x'.repeat(21) + '1-1', '10294'])
        assert.ok(!possibleSetNumber(schlecht), schlecht);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.run('DELETE FROM rb_sets WHERE set_num=$1', [SN]);
    await db.run('DELETE FROM catalog_cache WHERE set_number=$1', [SN]);
    for (const { key, value } of vorher)
      await db.run('INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [
        key,
        value,
      ]);
    await db.pool.end().catch(() => {});
  }
});
