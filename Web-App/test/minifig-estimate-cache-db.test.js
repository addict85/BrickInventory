/**
 * The estimated minifigure market price is cached.
 *
 * Counter-check: in src/finances/marketPrice.ts the cached estimate is never used → red “a fresh cache entry replaces the recomputation”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');

async function newUser(db) {
  return db.get(`INSERT INTO users (username, password_hash) VALUES ('t_'||floor(random()*1e9),'x') RETURNING id`);
}

test('a fresh cache entry replaces the recomputation', async t => {
  const db = testData();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const mf = _req('src/finances/marketPrice.js');
  const u = await newUser(db);
  const fig = 'fig-cache-test-01';

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.run('DELETE FROM minifig_price_history WHERE fig_number = $1', [fig]);
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated)
     VALUES ($1,'N','EUR',3.50,3.50,TRUE)`,
    [fig],
  );

  const t0 = Date.now();
  const wert = await mf.estimateFigPriceFromParts(fig, u.id, 'N');
  const duration = Date.now() - t0;

  assert.equal(
    wert,
    3.5,
    'Der zwischengespeicherte Wert wird nicht genommen — die Schätzung rechnet ' +
      'wieder alles neu, mit einer Preisabfrage je Teil.',
  );
  assert.ok(duration < 2000, `${duration} ms — hier darf nichts über das Netz gehen`);

  const h = await db.get('SELECT COUNT(*)::int AS c FROM minifig_price_history WHERE fig_number = $1', [fig]);
  assert.equal(
    h.c,
    0,
    'Innerhalb der Frist darf kein zweiter Verlaufspunkt entstehen — er trüge ' + 'denselben Wert am selben Tag.',
  );

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
});

test('an outdated entry is skipped', async t => {
  const db = testData();
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const mf = _req('src/finances/marketPrice.js');
  const u = await newUser(db);
  const fig = 'fig-cache-test-02';

  await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [fig]);
  await db.run(
    `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price, qty_avg_price, estimated, fetched_at)
     VALUES ($1,'N','EUR',3.50,3.50,TRUE, NOW() - INTERVAL '48 hours')`,
    [fig],
  );

  // Without a network the recalculation delivers null — what matters is THAT it
  // takes place instead of returning the old value.
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
