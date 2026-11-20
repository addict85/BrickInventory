/**
 * Ein Rahmenwechsel mitten in einer Transaktion (inSystemContext in einer des Kontos,
 * asRequest in einer des Systemrahmens) fragte über den Pool der anderen Rolle neben
 * ihr; db/database.ts weist das ab (BesideTheTransaction). Vorher gewählt bleibt erlaubt.
 * Eigener Systempool mit derselben Rolle: Es kommt auf die zweite Verbindung an.
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln):
 *   A  in txStand() die Zeile `throw new BesideTheTransaction(…)` gestrichen → rot:
 *      „Systemrahmen in einer Konto-Transaktion …“ und „… und umgekehrt“ (die
 *      Abfrage lief auf einer anderen Verbindung, pg_backend_pid verschieden)
 *   B  inTransaction wieder über txStand() (wirft) → rot: „inTransaction …“
 *   C  in redeemInvitation() (src/household/household.ts) inSystemContext wieder
 *      nur um die beiden getSetting() innerhalb von k.transaktion → rot in
 *      test/zeilenschutz-db.test.js „wer einem Haushalt beitritt …“ (BesideTheTransaction)
 *   D  in txStand() die Prüfung des Pools ganz gestrichen → rot: die beiden ersten
 *      (14.11.2026 erneut: jetzt UnboundQuery statt BesideTheTransaction)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const modul = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));
const { inSystemContext, asRequest } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'kontoKontext.js'));

const PID = 'SELECT pg_backend_pid() AS p';

test('Abfragen neben einer Transaktion', { concurrency: 1 }, async t => {
  const k = modul.dbKonfigFromEnvironment();
  const db = modul.createDb({ ...k, system: { ...k.verbindung } });
  try {
    await db.get(PID);
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }
  t.after(() => db.pool.end());
  assert.notEqual(db.systemPool, db.pool, 'ohne eigenen Systempool prüfte der Test nichts');
  const konto = f => asRequest({ tokenUserId: 1 }, f);

  await t.test('Systemrahmen in einer Konto-Transaktion wird abgewiesen', async () => {
    await konto(() =>
      db.transaction(async tx => {
        const eigene = (await tx.get(PID)).p;
        await assert.rejects(
          inSystemContext('probe', () => db.get(PID)),
          e => e instanceof modul.BesideTheTransaction && /vor der Transaktion/.test(String(e)),
        );
        await assert.rejects(
          inSystemContext('probe', () => db.transaction(inner => inner.get(PID))),
          modul.BesideTheTransaction,
        );
        assert.equal((await tx.get(PID)).p, eigene, 'die Transaktion bleibt benutzbar');
      }),
    );
  });

  await t.test('… und umgekehrt: eine Anfrage in einer Transaktion des Systemrahmens', async () => {
    await inSystemContext('probe', () =>
      db.transaction(async () => {
        await assert.rejects(
          konto(() => db.get(PID)),
          modul.BesideTheTransaction,
        );
      }),
    );
  });

  await t.test('Rahmen vor der Transaktion gewählt: alles geht über tx, der ungebundene Zugang wirft', async () => {
    await inSystemContext('probe', () =>
      db.transaction(async tx => {
        const eigene = (await tx.get(PID)).p;
        await assert.rejects(db.get(PID), modul.UnboundQuery);
        assert.equal((await tx.get(PID)).p, eigene);
      }),
    );
  });

  await t.test('inTransaction sagt auch nach dem Wechsel die Wahrheit, statt zu werfen', async () => {
    assert.equal(db.inTransaction(), false);
    await konto(() =>
      db.transaction(async () => {
        assert.equal(db.inTransaction(), true);
        assert.equal(
          inSystemContext('probe', () => db.inTransaction()),
          true,
        );
      }),
    );
  });
});
