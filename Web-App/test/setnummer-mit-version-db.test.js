/**
 * Set-Nummern tragen in der Datenbank immer ihre Version (Migration 0074),
 * der Set-Stamm liest nur rb_sets (0105, 0108), und Ersatzteil ist
 * überall 0 oder 1 (0075). Geprüft werden die Migrationen auf Altdaten, das
 * Schreiben ohne Versionsanhang und die Leser, die früher zwei Schreibweisen
 * per OR abfragten.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in 0074 die Zusammenführung der Kaufpreise entfernt → rot: „gleiche
 *      Kaufpreise werden addiert“ (duplicate key idx_set_acq_erfassungstag)
 *   B  in 0074 mit_version('sets') vor die abhängigen Tabellen gestellt → rot:
 *      „Teile des alten Sets bleiben“ (ON DELETE CASCADE nahm sie mit)
 *   C  im Teilefilter (src/teile/abfragen.ts) mitVersion() entfernt → rot:
 *      „der Filter findet das Set auch ohne Versionsanhang“
 *   D  (10.11.) in setStamm() (src/sets/repository/setDetail.ts) den Platzhalter
 *      „Set …“ nicht ausgeblendet → rot: „ein Platzhalter ist kein Name“
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
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { haeltTeil } = require('./helpers/bestand');
const MIG = (n) => fs.readFileSync(path.join(__dirname, '..', 'db/migrations', n), 'utf8');
const PID = process.pid;

test('Set-Nummern mit Version, ein Set-Stamm, Ersatzteil 0/1', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
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
      // Und vor 0105: set_catalog mit eigenen Stammspalten, ohne Bezug auf rb_sets.
      await c.query(`ALTER TABLE set_catalog DROP CONSTRAINT set_catalog_rb_sets_fkey,
        ADD COLUMN name text, ADD COLUMN year integer, ADD COLUMN theme text, ADD COLUMN pieces integer`);
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
      const { getParts } = _req('src/teile/abfragen.js');
      for (const filter of [`F${PID}`, `F${PID}-1`]) {
        const r = await getParts([uid], { set_number: filter, page_size: 60 });
        assert.deepEqual((r.parts || []).map(p => p.part_number), ['SNF1'], `Filter ${filter}`);
      }
      const { getMinifigs } = _req('src/figuren/abfragen.js');
      await db.run(`INSERT INTO minifigs (user_id, set_number, fig_number, source) VALUES ($1,$2,'SNFIG','set')`, [uid, `F${PID}`]);
      const f = await getMinifigs([uid], { set_number: `F${PID}` });
      assert.deepEqual((f.figs || f.minifigs || []).map(m => m.fig_number), ['SNFIG']);
    } finally {
      await db.run('DELETE FROM users WHERE id=$1', [uid]);
      await db.run('DELETE FROM set_teile WHERE set_number=$1', [`F${PID}-1`]);
    }
  });

  await t.test('Set-Stamm: nur rb_sets, ein Platzhalter bleibt Platzhalter', async () => {
    const S = `S${PID}`;
    const weg = () => Promise.all([
      db.run('DELETE FROM rb_sets WHERE set_num LIKE $1', [`${S}%`]),
      db.run('DELETE FROM catalog_cache WHERE set_number LIKE $1', [`${S}%`])]);
    await weg();
    try {
      await db.run(`INSERT INTO rb_sets (set_num, name, year, num_parts) VALUES ($1,'Aus Rebrickable',2020,100)`, [`${S}a-1`]);
      await db.run(`INSERT INTO rb_sets (set_num, name, herkunft) VALUES ($1,$2,'api'), ($3,'Aus dem Abruf','api')`,
        [`${S}b-1`, `Set ${S}b-1`, `${S}c-1`]);
      await db.run(`INSERT INTO catalog_cache (set_number) VALUES ($1)`, [`${S}d-1`]);
      const { setInfo } = _req('src/sets/index.js');
      const stamm = async (n) => { const r = await setInfo(n); return r && { name: r.name, year: r.year, platzhalter: r.platzhalter }; };
      assert.deepEqual(await stamm(`${S}a-1`), { name: 'Aus Rebrickable', year: 2020, platzhalter: false });
      assert.deepEqual(await stamm(`${S}b-1`), { name: `Set ${S}b-1`, year: null, platzhalter: true });
      assert.deepEqual(await stamm(`${S}c`), { name: 'Aus dem Abruf', year: null, platzhalter: false }, 'setInfo ergänzt den Versionsanhang');
      assert.equal(await setInfo(`${S}d-1`), null, 'ein blosser Abrufstand ist kein Set-Stamm');
    } finally { await weg(); }
  });

  await t.test('Ersatzteil wird 0/1', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      // Stand vor 0075 (und 0085): Text in rb_inventory_parts, Zahlen ohne CHECK-Regeln.
      await c.query('DROP VIEW set_parts_catalog');
      for (const tab of ['set_teile', 'parts_summary'])
        await c.query(`ALTER TABLE ${tab} ALTER COLUMN is_spare DROP NOT NULL, ALTER COLUMN is_spare DROP DEFAULT,
                         ALTER COLUMN is_spare TYPE integer USING is_spare::int`);
      await c.query(`ALTER TABLE rb_inventory_parts ALTER COLUMN is_spare DROP NOT NULL, ALTER COLUMN is_spare DROP DEFAULT,
                       ALTER COLUMN is_spare TYPE text`);
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
