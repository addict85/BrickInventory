/**
 * Set-Nummern tragen in der Datenbank immer ihre Version (Migration 0074),
 * set_stamm führt die drei Set-Kataloge zusammen (0076), und Ersatzteil ist
 * überall 0 oder 1 (0075). Geprüft werden die Migrationen auf Altdaten, das
 * Schreiben ohne Versionsanhang und die Leser, die früher zwei Schreibweisen
 * per OR abfragten.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in 0074 die Zusammenführung der Kaufpreise entfernt → rot: „gleiche
 *      Kaufpreise werden addiert“ (duplicate key idx_set_acq_erfassungstag)
 *   B  in 0074 mit_version('sets') vor die abhängigen Tabellen gestellt → rot:
 *      „Teile des alten Sets bleiben“ (ON DELETE CASCADE nahm sie mit)
 *   C  im Teilefilter (utils/handlers/parts.ts) mitVersion() entfernt → rot:
 *      „der Filter findet das Set auch ohne Versionsanhang“
 *   D  in set_stamm den Platzhalter „Set …“ nicht ausgeblendet → rot:
 *      „ein Platzhalter ist kein Name“
 *   E  in 0075 'True' nicht als Ersatzteil gelesen → rot: „Ersatzteil wird 0/1“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { haeltTeil } = require('./helpers/bestand');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', n), 'utf8');
const PID = process.pid;

test('Set-Nummern mit Version, ein Set-Stamm, Ersatzteil 0/1', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('die Migration führt beide Schreibweisen zusammen', async () => {
    const c = await db.pool.connect();
    const q = async (sql, p) => (await c.query(sql, p)).rows;
    try {
      await c.query('BEGIN');
      // Stand vor 0074: keine Trigger, keine CHECK-Regel.
      await c.query(`DO $$ DECLARE r record; BEGIN
        FOR r IN SELECT tgname, tgrelid::regclass AS t FROM pg_trigger WHERE tgname LIKE '%\\_setnummer' LOOP
          EXECUTE format('DROP TRIGGER %I ON %s', r.tgname, r.t); END LOOP;
        FOR r IN SELECT conname, conrelid::regclass AS t FROM pg_constraint WHERE conname LIKE '%\\_setnummer\\_mit\\_version' LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.t, r.conname); END LOOP; END $$`);
      const A = (await q(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`sn-${PID}`]))[0].id;
      const lager = (await q(`INSERT INTO storage_locations (user_id, name) VALUES ($1,'Regal') RETURNING id`, [A]))[0].id;
      const T1 = `T${PID}a`, T2 = `T${PID}b`, T3 = `T${PID}c`;
      await c.query(`INSERT INTO sets (user_id, set_number, storage_id) VALUES ($1,$2,$3), ($1,$4,NULL), ($1,$5,NULL)`,
        [A, T1, lager, `${T1}-1`, T2]);
      const kauf = (sn, preis, menge) => c.query(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
         VALUES ($1,$2,$3,$4,'N','CHF','2026-01-05T12:00:00Z')`, [A, sn, menge, preis]);
      await kauf(T1, 10, 1); await kauf(`${T1}-1`, 10, 2); await kauf(T1, 20, 1); await kauf(T2, 5, 1);
      const teil = (sn, nr) => c.query(`INSERT INTO parts (user_id, set_number, part_number, color_id, source) VALUES ($1,$2,$3,4,'set')`, [A, sn, nr]);
      await teil(T1, 'P1'); await teil(`${T1}-1`, 'P1'); await teil(T1, 'P2'); await teil(T2, 'P3');
      await c.query(`INSERT INTO instructions (user_id, set_number, url) VALUES ($1,$2,'u1'), ($1,$3,'u1'), ($1,$2,'u2')`, [A, T1, `${T1}-1`]);
      await c.query(`INSERT INTO set_catalog (set_number, name, image_local) VALUES ($1,'Alt','x.jpg'), ($2, NULL, NULL)`, [T3, `${T3}-1`]);
      await c.query(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,$2,'N'), ($1,$3,'N')`, [A, T3, `${T3}-1`]);
      await c.query(`INSERT INTO rb_inventories (id, set_num, version) VALUES ($1,$2,1)`, [880000 + (PID % 10000), T3]);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');

      await c.query(MIG('0074-setnummer-mit-version.sql'));

      assert.deepEqual(await q('SELECT set_number, storage_id FROM sets WHERE user_id=$1 ORDER BY 1', [A]),
        [{ set_number: `${T1}-1`, storage_id: lager }, { set_number: `${T2}-1`, storage_id: null }],
        'eine Zeile je Set, der Lagerort der alten bleibt');
      assert.deepEqual(await q(`SELECT set_number, purchase_price::float AS preis, quantity FROM set_acquisitions
                                 WHERE user_id=$1 ORDER BY 1, 2`, [A]),
        [{ set_number: `${T1}-1`, preis: 10, quantity: 3 }, { set_number: `${T1}-1`, preis: 20, quantity: 1 },
         { set_number: `${T2}-1`, preis: 5, quantity: 1 }], 'gleiche Kaufpreise werden addiert');
      assert.deepEqual(await q('SELECT set_number, part_number FROM parts WHERE user_id=$1 ORDER BY 2', [A]),
        [{ set_number: `${T1}-1`, part_number: 'P1' }, { set_number: `${T1}-1`, part_number: 'P2' },
         { set_number: `${T2}-1`, part_number: 'P3' }], 'Teile des alten Sets bleiben');
      assert.deepEqual(await q('SELECT set_number, url FROM instructions WHERE user_id=$1 ORDER BY 2', [A]),
        [{ set_number: `${T1}-1`, url: 'u1' }, { set_number: `${T1}-1`, url: 'u2' }]);
      assert.deepEqual(await q('SELECT set_number, name, image_local FROM set_catalog WHERE set_number LIKE $1', [`${T3}%`]),
        [{ set_number: `${T3}-1`, name: 'Alt', image_local: 'x.jpg' }], 'der Katalog füllt Lücken');
      assert.deepEqual(await q('SELECT set_number FROM wanted WHERE user_id=$1', [A]), [{ set_number: `${T3}-1` }]);
      assert.deepEqual(await q('SELECT set_num FROM rb_inventories WHERE id=$1', [880000 + (PID % 10000)]), [{ set_num: `${T3}-1` }]);

      // Ab jetzt normalisiert die Datenbank beim Schreiben.
      await c.query(`INSERT INTO set_teile (set_number, part_number, color_id) VALUES ($1,'P9',4)`, [`N${PID}`]);
      assert.deepEqual(await q('SELECT set_number FROM set_teile WHERE part_number=$1', ['P9']), [{ set_number: `N${PID}-1` }]);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  await t.test('der Filter findet das Set auch ohne Versionsanhang', async () => {
    const NAME = `sn-filter-${PID}`;
    await db.run('DELETE FROM users WHERE username=$1', [NAME]);
    const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
    try {
      await haeltTeil(db, uid, 'SNF1', { setNumber: `F${PID}`, menge: 2, colorId: 4 });   // blank geschrieben
      const { getParts } = _req('utils/handlers/parts.js');
      for (const filter of [`F${PID}`, `F${PID}-1`]) {
        const r = await getParts([uid], { set_number: filter, page_size: 60 });
        assert.deepEqual((r.parts || []).map(p => p.part_number), ['SNF1'], `Filter ${filter}`);
      }
      const { getMinifigs } = _req('utils/handlers/minifigs.js');
      await db.run(`INSERT INTO minifigs (user_id, set_number, fig_number, source) VALUES ($1,$2,'SNFIG','set')`, [uid, `F${PID}`]);
      const f = await getMinifigs([uid], { set_number: `F${PID}` });
      assert.deepEqual((f.figs || f.minifigs || []).map(m => m.fig_number), ['SNFIG']);
    } finally {
      await db.run('DELETE FROM users WHERE id=$1', [uid]);
      await db.run('DELETE FROM set_teile WHERE set_number=$1', [`F${PID}-1`]);
    }
  });

  await t.test('set_stamm: set_catalog führt, die anderen füllen Lücken', async () => {
    const S = `S${PID}`;
    const weg = () => Promise.all([
      db.run('DELETE FROM set_catalog WHERE set_number LIKE $1', [`${S}%`]),
      db.run('DELETE FROM rb_sets WHERE set_num LIKE $1', [`${S}%`]),
      db.run('DELETE FROM catalog_cache WHERE set_number LIKE $1', [`${S}%`])]);
    await weg();
    try {
      await db.run(`INSERT INTO rb_sets (set_num, name, year, num_parts) VALUES ($1,'Aus Rebrickable',2020,100), ($2,'Nur RB',2021,5)`,
        [`${S}a-1`, `${S}b-1`]);
      await db.run(`INSERT INTO set_catalog (set_number, name, year) VALUES ($1,$2,NULL)`, [`${S}a-1`, `Set ${S}a-1`]);
      await db.run(`INSERT INTO catalog_cache (set_number, name, year) VALUES ($1,'Nur Cache',2019)`, [`${S}c-1`]);
      await db.run(`INSERT INTO set_catalog (set_number, name) VALUES ($1,'Eigener Name')`, [`${S}b-1`]);
      const stamm = async (n) => db.get('SELECT name, year, herkunft FROM set_stamm WHERE set_number=$1', [n]);
      assert.deepEqual(await stamm(`${S}a-1`), { name: 'Aus Rebrickable', year: 2020, herkunft: 'set_catalog' },
        'ein Platzhalter ist kein Name');
      assert.deepEqual(await stamm(`${S}b-1`), { name: 'Eigener Name', year: 2021, herkunft: 'set_catalog' });
      assert.deepEqual(await stamm(`${S}c-1`), { name: 'Nur Cache', year: 2019, herkunft: 'catalog_cache' });
      const { setInfo } = _req('utils/dienste/sets.js');
      assert.equal((await setInfo(`${S}c`))?.name, 'Nur Cache', 'setInfo liest set_stamm, auch ohne Versionsanhang');
    } finally { await weg(); }
  });

  await t.test('Ersatzteil wird 0/1', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      // Stand vor 0075: Text in rb_inventory_parts, keine CHECK-Regeln.
      for (const tab of ['rb_inventory_parts', 'set_teile', 'parts_summary'])
        await c.query(`ALTER TABLE ${tab} DROP CONSTRAINT ${tab}_ersatzteil_null_eins, ALTER COLUMN is_spare DROP NOT NULL, ALTER COLUMN is_spare DROP DEFAULT`);
      await c.query('ALTER TABLE rb_inventory_parts ALTER COLUMN is_spare TYPE text');
      const inv = 870000 + (PID % 10000);
      await c.query(`INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                     VALUES ($1,'E1',1,1,'True'), ($1,'E2',1,1,'f'), ($1,'E3',1,1,NULL), ($1,'E4',1,1,'t')`, [inv]);
      await c.query(MIG('0075-ersatzteil-null-eins.sql'));
      const r = (await c.query('SELECT part_num, is_spare FROM rb_inventory_parts WHERE inventory_id=$1 ORDER BY 1', [inv])).rows;
      assert.deepEqual(r.map(z => [z.part_num, z.is_spare]), [['E1', 1], ['E2', 0], ['E3', 0], ['E4', 1]], 'Ersatzteil wird 0/1');
      await c.query('SAVEPOINT s');
      await assert.rejects(c.query(`INSERT INTO set_teile (set_number, part_number, color_id, is_spare) VALUES ('X-1','E5',1,2)`),
        /set_teile_ersatzteil_null_eins/);
      await c.query('ROLLBACK TO SAVEPOINT s');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
