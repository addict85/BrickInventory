/**
 * Migration 0065: Die Datenbank selbst lehnt eine Währung ausserhalb des
 * ISO-Formats und einen negativen Betrag ab — gleich, welcher Weg schreibt.
 * Die E-Mail bleibt eindeutig, auch ohne den doppelten Teilindex.
 *
 * Gegenproben (am 28.10.2026 gemessen, je auf frischer Datenbank):
 *   A  in db/basis.sql die Prüfung set_acquisitions_currency_iso entfernt
 *      → rot: „eine Währung in Kleinbuchstaben wird abgelehnt“
 *   B  in db/basis.sql die Prüfung vouchers_amount_nicht_negativ entfernt
 *      → rot: „ein negativer Betrag wird abgelehnt“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const NAME = `geldpruef_${process.pid}`;

test('Geld und Währung in der Datenbank geprüft', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_2`]]);
  const uid = (await db.get(`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
    [NAME, `${NAME}@example.org`])).id;
  await db.run(`INSERT INTO set_catalog (set_number, name) VALUES ('99901-1', 'Probe') ON CONFLICT DO NOTHING`);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, '99901-1']);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_2`]]);
    await db.pool.end().catch(() => {});
  });
  const erfasse = (preis, waehrung) => db.run(
    `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, currency) VALUES ($1, '99901-1', 1, $2, $3)`,
    [uid, preis, waehrung]);
  const abgelehnt = async (p) => { try { await p; return null; } catch (e) { return e.code; } };

  await t.test('eine gültige Erfassung geht durch', async () => {
    assert.equal(await abgelehnt(erfasse(19.9, 'CHF')), null);
  });

  await t.test('eine Währung in Kleinbuchstaben wird abgelehnt', async () => {
    assert.equal(await abgelehnt(erfasse(5, 'chf')), '23514');
    assert.equal(await abgelehnt(erfasse(5, 'EURO')), '23514');
  });

  await t.test('ein negativer Betrag wird abgelehnt', async () => {
    assert.equal(await abgelehnt(erfasse(-1, 'CHF')), '23514');
    assert.equal(await abgelehnt(db.run(
      `INSERT INTO vouchers (user_id, number, amount, currency) VALUES ($1, '5045076374450019999', -5, 'CHF')`, [uid])), '23514');
  });

  await t.test('die E-Mail bleibt eindeutig', async () => {
    assert.equal(await db.get(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_unique'`), undefined);
    assert.equal(await abgelehnt(db.run(`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x')`,
      [`${NAME}_2`, `${NAME}@example.org`])), '23505');
  });
});
