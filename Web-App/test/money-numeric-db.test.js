/**
 * Money amounts: exact instead of „almost".
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const { holdsSet } = require('./helpers/inventory');

/**
 * All columns that carry money.
 */
const GELDSPALTEN = `
  SELECT table_name || '.' || column_name AS spalte, data_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (column_name LIKE '%\\_price' OR column_name LIKE '%\\_price\\_%'
          OR column_name = 'amount' OR column_name LIKE '%\\_amount')
   ORDER BY 1`;

test('money amounts are exact', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  await t.test('a new installation has no money column as REAL', async () => {
    const spalten = await db.all(GELDSPALTEN);
    assert.ok(spalten.length > 15, `nur ${spalten.length} Geldspalten gefunden — die Prüfung liefe ins Leere`);
    const real = spalten.filter(s => s.data_type === 'real' || s.data_type === 'double precision');
    assert.deepEqual(
      real.map(s => s.spalte),
      [],
      'Gleitkomma für Geld — Summen driften und die Anzeige bekommt Nachkomma-Schwänze',
    );
  });

  await t.test('the migration catches up an old database', async () => {
    // Recreate an old installation: column back to REAL, run the migration
    // again (remove the note in schema_migrations).
    for (const [tab, sp] of [
      ['sets', 'purchase_price'],
      ['parts', 'purchase_price'],
      ['parts', 'unit_price'],
      ['minifigs', 'purchase_price'],
      ['minifigs', 'unit_price'],
    ]) {
      await db.run(`ALTER TABLE ${tab} ADD COLUMN IF NOT EXISTS ${sp} REAL`);
    }
    // 0062 removed price_market; 0007 also converts its columns.
    await db.run(`CREATE TABLE IF NOT EXISTS price_market (set_number TEXT, currency_code TEXT,
      condition TEXT, qty_avg_price REAL, min_price REAL, max_price REAL)`);
    await db.run('ALTER TABLE set_acquisitions ALTER COLUMN purchase_price TYPE REAL');
    await db.run("DELETE FROM schema_migrations WHERE name LIKE '0007%'");
    const vorher = await db.get(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='set_acquisitions' AND column_name='purchase_price'`,
    );
    assert.equal(vorher.data_type, 'real', 'Vorbedingung: Spalte ist wieder REAL');

    const c2 = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c2);
    } finally {
      c2.release();
    }

    const nachher = await db.get(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='set_acquisitions' AND column_name='purchase_price'`,
    );
    assert.equal(nachher.data_type, 'numeric', 'Migration hat die Spalte nicht umgestellt');

    // And restore the final state
    for (const [tab, sp] of [
      ['sets', 'purchase_price'],
      ['parts', 'purchase_price'],
      ['parts', 'unit_price'],
      ['minifigs', 'purchase_price'],
      ['minifigs', 'unit_price'],
    ]) {
      await db.run(`ALTER TABLE ${tab} DROP COLUMN IF EXISTS ${sp}`);
    }
    await db.run('DROP TABLE IF EXISTS price_market');
    // The daily index (0070) contains purchase_price. The detour via REAL
    // rewrote it with type conversions, and ON CONFLICT would no longer find it
    // afterwards — so create it anew in the version of the migration.
    const mig = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'db/migrations/0070-erfassungstag.sql'),
      'utf8',
    );
    const index = /CREATE UNIQUE INDEX idx_set_acq_erfassungstag[^;]+;/.exec(mig);
    assert.ok(index, 'Tagesindex in 0070 nicht gefunden');
    await db.run('DROP INDEX IF EXISTS idx_set_acq_erfassungstag');
    // 0070 still knows the column under its old name (before 0124).
    await db.run(index[0].replace(/\btag\b/, 'day'));
  });

  await t.test('a thousand amounts add up exactly', async () => {
    await db.run("INSERT INTO users (username,password_hash) VALUES ('geld','x')");
    const uid = (await db.get("SELECT id FROM users WHERE username='geld'")).id;
    await holdsSet(db, uid, '99001-1', 0); // quantity 0: the acquisition behind it carries it
    // 1000 rows at 0.07 — in REAL that resulted in 69.99974 instead of 70.00.
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
       SELECT $1, '99001-1', 1, 0.07, 'N', NOW() - (g || ' days')::interval
         FROM generate_series(1,1000) g`,
      [uid],
    );

    const summe = await db.get(`SELECT SUM(purchase_price) AS s FROM set_acquisitions WHERE user_id=$1`, [uid]);
    assert.equal(Number(summe.s), 70, `Summe ${summe.s} statt exakt 70`);
  });

  await t.test('a stored purchase price comes back unchanged', async () => {
    const uid = (await db.get("SELECT id FROM users WHERE username='geld'")).id;
    await holdsSet(db, uid, '99002-1', 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,'99002-1',1,49.90,'N')`,
      [uid],
    );

    const { setsLesen } = require('./helpers/sources').handlerModule(_req);
    const r = await setsLesen([uid], { search: '99002' });
    const satz = r.sets.find(s => s.set_number === '99002-1');
    assert.ok(satz, 'Set nicht gefunden');

    // `purchase_price` stood here in the list too. Since migration 0032 the set response
    // no longer carries the field (the column is gone); the purchase price
    // is delivered by the two aggregates from the acquisitions. Without this change
    // the loop checked a missing field and reported `NaN !== 49.9`.
    for (const feld of ['avg_purchase_price', 'max_purchase_price']) {
      const wert = Number(satz[feld]);
      assert.equal(wert, 49.9, `${feld} = ${satz[feld]} — genau dieser Gleitkomma-Schwanz ging bisher an den Client`);
      // And the value survives the way through JSON in the same form.
      assert.equal(JSON.parse(JSON.stringify({ v: wert })).v, 49.9);
    }
  });

  await t.test('the values arrive as a number, not as a string', async () => {
    // The pg driver delivers NUMERIC as a string out of the box. Without the
    // type parser in db/database.ts `preis * menge` would become a string calculation
    // in hundreds of places, and a price of 0 would be true as
    // "0.0000" in every if query.
    const uid = (await db.get("SELECT id FROM users WHERE username='geld'")).id;
    const zeile = await db.get(
      `SELECT purchase_price FROM set_acquisitions WHERE user_id=$1 AND set_number='99002-1'`,
      [uid],
    );
    assert.equal(
      typeof zeile.purchase_price,
      'number',
      `purchase_price kommt als ${typeof zeile.purchase_price} — der Typ-Parser fehlt`,
    );
  });

  await db.pool.end().catch(() => {});
});
