/**
 * Kategoriefilter und Kategorienliste der Teile lesen aus der Zusammenfassung,
 * sobald sie frisch ist, und liefern dasselbe wie die Live-Abfrage — auch für
 * ein Teil, dessen Kategorie nur rb_parts kennt (die Set-Teile-Antwort von
 * Rebrickable liefert meist keine). Gemessen bei 302 000 Teilezeilen:
 * Kategoriefilter 658 → 20 ms, Kategorienliste 634 → 144 ms.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in tryPartsSummary wieder `if (o.category) return null;` → rot: „der
 *      Kategoriefilter liest aus der Zusammenfassung“ (source db)
 *   B  in getPartsCategories (Zusammenfassung) rb_parts nicht befragt → rot:
 *      „die Kategorienliste ist auf beiden Wegen gleich“ (kz2 unter „Unbekannt“)
 *   C  in teileFilter die Bedingung für spare=1 (tm_k.is_spare, vorher der
 *      Join auf set_parts_catalog) entfernt → rot: „der Ersatzteilfilter ist
 *      auf beiden Wegen gleich“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { haeltSet, haeltTeil } = require('./helpers/bestand');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Kategorie aus der Zusammenfassung', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const H = require('./helpers/sources').handlerModul(_req);
  const PS = _req('utils/partsSummary.js');
  const NAME = `kategorie-${process.pid}`;
  const SN = `KZ${process.pid}-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const U = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO rb_part_categories (id, name) VALUES (98701, 'Steine'), (98702, 'Platten') ON CONFLICT (id) DO NOTHING`);
  await db.run(`INSERT INTO rb_parts (part_num, name, part_cat_id) VALUES ('kz2', 'Zwei', 98701) ON CONFLICT (part_num) DO UPDATE SET part_cat_id = 98701`);
  await db.run(`INSERT INTO part_catalog (part_number, part_name, category_name)
                VALUES ('kz1', 'Eins', '98701'), ('kz2', 'Zwei', NULL), ('kz3', 'Drei', '98702')
                ON CONFLICT (part_number) DO UPDATE SET category_name = EXCLUDED.category_name, name_von = NULL, kategorie_von = NULL`);
  await db.run(`INSERT INTO set_teile (set_number, part_number, color_id, quantity, is_spare)
                VALUES ($1, 'kz1', 5, 4, 0), ($1, 'kz2', 5, 2, 1), ($1, 'kz3', 1, 3, 0)`, [SN]);
  await haeltSet(db, U, SN, 2);
  for (const [nr, farbe, menge] of [['kz1', 5, 4], ['kz2', 5, 2], ['kz3', 1, 3]])
    await haeltTeil(db, U, nr, { setNumber: SN, colorId: farbe, menge });

  const zeilen = (r) => r.parts.map(p => `${p.part_number}|${p.color_id}|${p.total_quantity}`).sort();
  const kategorien = (l) => l.map(k => `${k.category_name}|${k.label}|${k.total_quantity}`).sort();
  const abfrage = { exclude_manual: '1', page: 1, page_size: 50 };

  try {
    // Ohne exclude_manual antwortet immer die Live-Abfrage; die Teile hier
    // sind alle Set-Teile, das Ergebnis also dasselbe. Die Kategorienliste
    // zuerst, solange es keine Zusammenfassung gibt.
    const liveKat = await H.getPartsCategories(U);
    const live = await H.getParts(U, { page: 1, page_size: 50, category: '98701' });
    const liveSpare = await H.getParts(U, { page: 1, page_size: 50, spare: '1' });
    assert.equal(live.source, 'db');
    assert.equal(liveSpare.source, 'db');
    assert.deepEqual(zeilen(live), ['kz1|5|8', 'kz2|5|4'], 'Testdaten: beide Teile der Kategorie, mit Setmenge');
    await PS.rebuildNow(U);

    await t.test('der Kategoriefilter liest aus der Zusammenfassung', async () => {
      const zsf = await H.getParts(U, { ...abfrage, category: '98701' });
      assert.equal(zsf.source, 'summary');
      assert.deepEqual(zeilen(zsf), zeilen(live));
    });
    await t.test('der Ersatzteilfilter ist auf beiden Wegen gleich', async () => {
      assert.deepEqual(zeilen(liveSpare), ['kz2|5|4']);
      assert.deepEqual(zeilen(await H.getParts(U, { ...abfrage, spare: '1' })), zeilen(liveSpare));
    });
    await t.test('die Kategorienliste ist auf beiden Wegen gleich', async () => {
      assert.deepEqual(kategorien(liveKat), ['98701|Steine|12', '98702|Platten|6']);
      assert.deepEqual(kategorien(await H.getPartsCategories(U)), kategorien(liveKat));
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [U]);
    await db.run('DELETE FROM set_teile WHERE set_number=$1', [SN]);
    await db.run(`DELETE FROM part_catalog WHERE part_number IN ('kz1','kz2','kz3')`);
    await db.run(`DELETE FROM rb_parts WHERE part_num = 'kz2'`);
    await db.run('DELETE FROM rb_part_categories WHERE id IN (98701, 98702)');
    await db.pool.end().catch(() => {});
  }
});
