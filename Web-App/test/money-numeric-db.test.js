/**
 * Geldbeträge: exakt statt „fast".
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');
const { haeltSet } = require('./helpers/bestand');

/**
 * Alle Spalten, die Geld führen.
 */
const GELDSPALTEN = `
  SELECT table_name || '.' || column_name AS spalte, data_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (column_name LIKE '%\\_price' OR column_name LIKE '%\\_price\\_%'
          OR column_name = 'amount' OR column_name LIKE '%\\_amount')
   ORDER BY 1`;

test('Geldbeträge sind exakt', { concurrency: 1 }, async t => {
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

  await t.test('eine Neuinstallation hat keine Geldspalte als REAL', async () => {
    const spalten = await db.all(GELDSPALTEN);
    assert.ok(spalten.length > 15, `nur ${spalten.length} Geldspalten gefunden — die Prüfung liefe ins Leere`);
    const real = spalten.filter(s => s.data_type === 'real' || s.data_type === 'double precision');
    assert.deepEqual(
      real.map(s => s.spalte),
      [],
      'Gleitkomma für Geld — Summen driften und die Anzeige bekommt Nachkomma-Schwänze',
    );
  });

  await t.test('die Migration holt eine alte Datenbank nach', async () => {
    // Alte Installation nachstellen: Spalte zurück auf REAL, Migration erneut
    // laufen lassen (Vermerk in schema_migrations entfernen).
    for (const [tab, sp] of [
      ['sets', 'purchase_price'],
      ['parts', 'purchase_price'],
      ['parts', 'unit_price'],
      ['minifigs', 'purchase_price'],
      ['minifigs', 'unit_price'],
    ]) {
      await db.run(`ALTER TABLE ${tab} ADD COLUMN IF NOT EXISTS ${sp} REAL`);
    }
    // price_market hat 0062 entfernt; 0007 stellt auch ihre Spalten um.
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

    // Und den Endzustand wiederherstellen
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
    // Der Tagesindex (0070) enthält purchase_price. Der Umweg über REAL
    // hat ihn mit Typumwandlungen umgeschrieben, und ON CONFLICT fände ihn
    // danach nicht mehr — also in der Fassung der Migration neu anlegen.
    const mig = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '..', 'db/migrations/0070-erfassungstag.sql'),
      'utf8',
    );
    const index = /CREATE UNIQUE INDEX idx_set_acq_erfassungstag[^;]+;/.exec(mig);
    assert.ok(index, 'Tagesindex in 0070 nicht gefunden');
    await db.run('DROP INDEX IF EXISTS idx_set_acq_erfassungstag');
    await db.run(index[0]);
  });

  await t.test('tausend Beträge summieren sich exakt', async () => {
    await db.run("INSERT INTO users (username,password_hash) VALUES ('geld','x')");
    const uid = (await db.get("SELECT id FROM users WHERE username='geld'")).id;
    await haeltSet(db, uid, '99001-1', 0); // Menge 0: die Erfassung dahinter traegt sie
    // 1000 Zeilen à 0.07 — in REAL ergab das 69.99974 statt 70.00.
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
       SELECT $1, '99001-1', 1, 0.07, 'N', NOW() - (g || ' days')::interval
         FROM generate_series(1,1000) g`,
      [uid],
    );

    const summe = await db.get(`SELECT SUM(purchase_price) AS s FROM set_acquisitions WHERE user_id=$1`, [uid]);
    assert.equal(Number(summe.s), 70, `Summe ${summe.s} statt exakt 70`);
  });

  await t.test('ein gespeicherter Kaufpreis kommt unverändert zurück', async () => {
    const uid = (await db.get("SELECT id FROM users WHERE username='geld'")).id;
    await haeltSet(db, uid, '99002-1', 0); // Menge 0: die Erfassung dahinter traegt sie
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,'99002-1',1,49.90,'N')`,
      [uid],
    );

    const { getSets } = require('./helpers/sources').handlerModul(_req);
    const r = await getSets([uid], { search: '99002' });
    const satz = r.sets.find(s => s.set_number === '99002-1');
    assert.ok(satz, 'Set nicht gefunden');

    // `purchase_price` stand hier mit in der Liste. Die Set-Antwort fuehrt das
    // Feld seit Migration 0032 nicht mehr (die Spalte ist weg); den Kaufpreis
    // liefern die beiden Aggregate aus den Erfassungen. Ohne diese Aenderung
    // pruefte die Schleife ein fehlendes Feld und meldete `NaN !== 49.9`.
    for (const feld of ['avg_purchase_price', 'max_purchase_price']) {
      const wert = Number(satz[feld]);
      assert.equal(wert, 49.9, `${feld} = ${satz[feld]} — genau dieser Gleitkomma-Schwanz ging bisher an den Client`);
      // Und der Wert überlebt den Weg durch JSON in derselben Form.
      assert.equal(JSON.parse(JSON.stringify({ v: wert })).v, 49.9);
    }
  });

  await t.test('die Werte kommen als Zahl an, nicht als Zeichenkette', async () => {
    // Der pg-Treiber liefert NUMERIC von Haus aus als Zeichenkette. Ohne den
    // Typ-Parser in db/database.ts würde aus `preis * menge` an hunderten
    // Stellen eine Zeichenketten-Rechnung, und ein Preis von 0 wäre als
    // "0.0000" in jeder if-Abfrage wahr.
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
