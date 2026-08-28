/**
 * Geldbeträge: exakt statt „fast".
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 * Alle Preisspalten lagen als REAL (32-Bit-Gleitkomma) in der Datenbank. Das
 * war am laufenden Server sichtbar — ein Kaufpreis von 49.90 kam als
 * 49.9000015258789 zurück — und beim Summieren wuchs der Fehler mit der Zahl
 * der Beträge.
 *
 * Geprüft wird deshalb dreierlei, alles gegen echtes Postgres:
 *   1. Keine Geldspalte ist mehr REAL — weder bei einer Neuinstallation
 *      (initSchema) noch nach der Migration einer alten Datenbank.
 *   2. Die Summe stimmt auf den Rappen, auch über tausend Beträge.
 *   3. Was der Server ausliefert, hat keine Gleitkomma-Schwänze mehr.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

/** Alle Spalten, die Geld führen — Name endet auf _price. */
const GELDSPALTEN = `
  SELECT table_name || '.' || column_name AS spalte, data_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (column_name LIKE '%\\_price' OR column_name LIKE '%\\_price\\_%')
   ORDER BY 1`;

test('Geldbeträge sind exakt', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await t.test('eine Neuinstallation hat keine Geldspalte als REAL', async () => {
    const spalten = await db.all(GELDSPALTEN);
    assert.ok(spalten.length > 15, `nur ${spalten.length} Geldspalten gefunden — die Prüfung liefe ins Leere`);
    const real = spalten.filter(s => s.data_type === 'real' || s.data_type === 'double precision');
    assert.deepEqual(real.map(s => s.spalte), [],
      'Gleitkomma für Geld — Summen driften und die Anzeige bekommt Nachkomma-Schwänze');
  });

  await t.test('die Migration holt eine alte Datenbank nach', async () => {
    // Alte Installation nachstellen: Spalte zurück auf REAL, Migration erneut
    // laufen lassen (Vermerk in schema_migrations entfernen).
    await db.run('ALTER TABLE set_acquisitions ALTER COLUMN purchase_price TYPE REAL');
    await db.run("DELETE FROM schema_migrations WHERE name LIKE '0007%'");
    const vorher = await db.get(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name='set_acquisitions' AND column_name='purchase_price'`);
    assert.equal(vorher.data_type, 'real', 'Vorbedingung: Spalte ist wieder REAL');

    const c2 = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c2); } finally { c2.release(); }

    const nachher = await db.get(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name='set_acquisitions' AND column_name='purchase_price'`);
    assert.equal(nachher.data_type, 'numeric', 'Migration hat die Spalte nicht umgestellt');
  });

  await t.test('tausend Beträge summieren sich exakt', async () => {
    await db.run("INSERT INTO users (username,password_hash) VALUES ('geld','x')");
    const uid = (await db.get("SELECT id FROM users WHERE username='geld'")).id;
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,'99001-1','S',1)`, [uid]);
    // 1000 Zeilen à 0.07 — in REAL ergab das 69.99974 statt 70.00.
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
       SELECT $1, '99001-1', 1, 0.07, 'N', NOW() - (g || ' days')::interval
         FROM generate_series(1,1000) g`, [uid]);

    const summe = await db.get(
      `SELECT SUM(purchase_price) AS s FROM set_acquisitions WHERE user_id=$1`, [uid]);
    assert.equal(Number(summe.s), 70, `Summe ${summe.s} statt exakt 70`);
  });

  await t.test('ein gespeicherter Kaufpreis kommt unverändert zurück', async () => {
    const uid = (await db.get("SELECT id FROM users WHERE username='geld'")).id;
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,purchase_price)
                  VALUES ($1,'99002-1','S2',1,49.90)`, [uid]);
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,'99002-1',1,49.90,'N')`, [uid]);

    const { getSets } = require('./helpers/sources').handlerModul(_req);
    const r = await getSets([uid], { search: '99002' });
    const satz = r.sets.find(s => s.set_number === '99002-1');
    assert.ok(satz, 'Set nicht gefunden');

    for (const feld of ['purchase_price', 'avg_purchase_price', 'max_purchase_price']) {
      const wert = Number(satz[feld]);
      assert.equal(wert, 49.9,
        `${feld} = ${satz[feld]} — genau dieser Gleitkomma-Schwanz ging bisher an den Client`);
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
      `SELECT purchase_price FROM set_acquisitions WHERE user_id=$1 AND set_number='99002-1'`, [uid]);
    assert.equal(typeof zeile.purchase_price, 'number',
      `purchase_price kommt als ${typeof zeile.purchase_price} — der Typ-Parser fehlt`);
  });

  await db.pool.end().catch(() => {});
});

test('das Erst-Passwort geht nicht durch den Log-Abfänger', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8'));

  // Der Abfänger in server.ts schreibt JEDE console-Zeile nach app_logs, und
  // der Admin-Log-Viewer gibt sie 48 Stunden lang wieder aus. Das Passwort des
  // ersten Admins darf deshalb nicht über console gehen.
  // Der Ausgabeblock: von der Zeile mit dem Passwort bis zur nächsten Ausgabe.
  const pwZeile = src.indexOf('admin / ${plainPassword}');
  assert.ok(pwZeile > 0, 'Passwortzeile nicht gefunden');
  const block = src.slice(Math.max(0, pwZeile - 500), pwZeile + 500);
  assert.doesNotMatch(block, /console\.(log|info|warn|error)\([^)]*(admin \/|banner)/,
    'Das Erst-Passwort läuft wieder über console — damit landet es in app_logs und im Log-Viewer');
  assert.match(block, /process\.stdout\.write/,
    'Der Banner muss direkt auf stdout gehen');

  // Und die Zeile mit dem Passwort selbst darf nirgends sonst über console gehen.
  for (const m of src.matchAll(/console\.[a-z]+\([^)]*plainPassword[^)]*\)/g)) {
    assert.fail(`Passwort über console: ${m[0].slice(0, 80)}`);
  }
});
