/**
 * Der geschätzte Minifiguren-Marktpreis wird zwischengespeichert.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');

async function neuerNutzer(db) {
  return db.get(`INSERT INTO users (username, password_hash) VALUES ('t_'||floor(random()*1e9),'x') RETURNING id`);
}

test('ein frischer Cache-Eintrag ersetzt die Neuberechnung', async t => {
  const db = _req('db/database.js');
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const mf = _req('src/finanzen/marketPrice.js');
  const u = await neuerNutzer(db);
  const fig = 'fig-cache-test-01';

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.run('DELETE FROM minifig_price_history WHERE fig_number = $1', [fig]);
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt)
     VALUES ($1,'N','EUR',3.50,3.50,TRUE)`,
    [fig],
  );

  const t0 = Date.now();
  const wert = await mf.estimateFigPriceFromParts(fig, u.id, 'N');
  const dauer = Date.now() - t0;

  assert.equal(
    wert,
    3.5,
    'Der zwischengespeicherte Wert wird nicht genommen — die Schätzung rechnet ' +
      'wieder alles neu, mit einer Preisabfrage je Teil.',
  );
  assert.ok(dauer < 2000, `${dauer} ms — hier darf nichts über das Netz gehen`);

  const h = await db.get('SELECT COUNT(*)::int AS c FROM minifig_price_history WHERE fig_number = $1', [fig]);
  assert.equal(
    h.c,
    0,
    'Innerhalb der Frist darf kein zweiter Verlaufspunkt entstehen — er trüge ' + 'denselben Wert am selben Tag.',
  );

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
});

test('ein veralteter Eintrag wird übergangen', async t => {
  const db = _req('db/database.js');
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const mf = _req('src/finanzen/marketPrice.js');
  const u = await neuerNutzer(db);
  const fig = 'fig-cache-test-02';

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, geschaetzt, fetched_at)
     VALUES ($1,'N','EUR',3.50,3.50,TRUE, NOW() - INTERVAL '48 hours')`,
    [fig],
  );

  // Ohne Netz liefert die Neuberechnung null — entscheidend ist, DASS sie
  // stattfindet statt den alten Wert zurückzugeben.
  const wert = await mf.estimateFigPriceFromParts(fig, u.id, 'N');
  assert.equal(
    wert,
    null,
    'Ein 48 Stunden alter Eintrag wurde genommen — dann altert der Marktpreis ' +
      'unbegrenzt und der Verlauf bekommt nie einen neuen Punkt.',
  );

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.pool.end().catch(() => {});
});
