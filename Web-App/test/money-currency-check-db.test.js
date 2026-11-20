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
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { catalogSet } = require('./helpers/inventory');
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const NAME = `geldpruef_${process.pid}`;

test('money and currency checked in the database', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_2`]]);
  const uid = (
    await db.get(`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [
      NAME,
      `${NAME}@example.org`,
    ])
  ).id;
  await catalogSet(db, '99901-1', { name: 'Probe' });
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [uid, '99901-1']);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_2`]]);
    await db.pool.end().catch(() => {});
  });
  const record = (preis, waehrung) =>
    db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, currency) VALUES ($1, '99901-1', 1, $2, $3)`,
      [uid, preis, waehrung],
    );
  const abgelehnt = async p => {
    try {
      await p;
      return null;
    } catch (e) {
      return e.code;
    }
  };

  await t.test('a valid acquisition goes through', async () => {
    assert.equal(await abgelehnt(record(19.9, 'CHF')), null);
  });

  await t.test('a currency in lower case is rejected', async () => {
    assert.equal(await abgelehnt(record(5, 'chf')), '23514');
    assert.equal(await abgelehnt(record(5, 'EURO')), '23514');
  });

  await t.test('a negative amount is rejected', async () => {
    assert.equal(await abgelehnt(record(-1, 'CHF')), '23514');
    assert.equal(
      await abgelehnt(
        require('./helpers/sources')
          .testArea('vouchers')
          .vouchers.createVoucher(uid, { number: '5045076374450019999', pin: null, amount: -5, currency: 'CHF' }),
      ),
      '23514',
    );
  });

  await t.test('the email stays unique', async () => {
    assert.equal(await db.get(`SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_unique'`), undefined);
    assert.equal(
      await abgelehnt(
        db.run(`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x')`, [
          `${NAME}_2`,
          `${NAME}@example.org`,
        ]),
      ),
      '23505',
    );
  });
});
