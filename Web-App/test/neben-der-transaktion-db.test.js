/**
 * Ein Rahmenwechsel mitten in einer Transaktion (imSystemkontext in einer des Kontos,
 * alsAnfrage in einer des Systemrahmens) fragte über den Pool der anderen Rolle neben
 * ihr; db/database.ts weist das ab (NebenDerTransaktion). Vorher gewählt bleibt erlaubt.
 * Eigener Systempool mit derselben Rolle: Es kommt auf die zweite Verbindung an.
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln):
 *   A  in txStand() die Zeile `throw new NebenDerTransaktion(…)` gestrichen → rot:
 *      „Systemrahmen in einer Konto-Transaktion …“ und „… und umgekehrt“ (die
 *      Abfrage lief auf einer anderen Verbindung, pg_backend_pid verschieden)
 *   B  inTransaktion wieder über txStand() (wirft) → rot: „inTransaktion …“
 *   C  in einladungEinloesen() (src/haushalt/haushalt.ts) imSystemkontext wieder
 *      nur um die beiden getSetting() innerhalb von k.transaktion → rot in
 *      test/zeilenschutz-db.test.js „wer einem Haushalt beitritt …“ (NebenDerTransaktion)
 *   D  in txStand() die Prüfung des Pools ganz gestrichen → rot: die beiden ersten
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
const { imSystemkontext, alsAnfrage } = require(path.join(__dirname, '..', 'dist', 'src', 'infra', 'kontoKontext.js'));

const PID = 'SELECT pg_backend_pid() AS p';

test('Abfragen neben einer Transaktion', { concurrency: 1 }, async t => {
  const k = modul.dbKonfigAusUmgebung();
  const db = modul.erzeugeDb({ ...k, system: { ...k.verbindung } });
  try {
    await db.get(PID);
  } catch (e) {
    await db.pool.end().catch(() => {});
    keineDb(t, e);
    return;
  }
  t.after(() => db.pool.end());
  assert.notEqual(db.systemPool, db.pool, 'ohne eigenen Systempool prüfte der Test nichts');
  const konto = f => alsAnfrage({ tokenUserId: 1 }, f);

  await t.test('Systemrahmen in einer Konto-Transaktion wird abgewiesen', async () => {
    await konto(() =>
      db.transaction(async tx => {
        const eigene = (await tx.get(PID)).p;
        await assert.rejects(
          imSystemkontext('probe', () => db.get(PID)),
          e => e instanceof modul.NebenDerTransaktion && /vor der Transaktion/.test(e.message),
        );
        await assert.rejects(
          imSystemkontext('probe', () => db.transaction(inner => inner.get(PID))),
          modul.NebenDerTransaktion,
        );
        assert.equal((await db.get(PID)).p, eigene, 'ohne Wechsel geht es über die Transaktion');
      }),
    );
  });

  await t.test('… und umgekehrt: eine Anfrage in einer Transaktion des Systemrahmens', async () => {
    await imSystemkontext('probe', () =>
      db.transaction(async () => {
        await assert.rejects(
          konto(() => db.get(PID)),
          modul.NebenDerTransaktion,
        );
      }),
    );
  });

  await t.test('Rahmen vor der Transaktion gewählt: alles geht über sie', async () => {
    await imSystemkontext('probe', () =>
      db.transaction(async tx => {
        const eigene = (await tx.get(PID)).p;
        assert.equal((await db.get(PID)).p, eigene);
        assert.equal(await db.transaction(async inner => (await inner.get(PID)).p), eigene);
      }),
    );
  });

  await t.test('inTransaktion sagt auch nach dem Wechsel die Wahrheit, statt zu werfen', async () => {
    assert.equal(db.inTransaktion(), false);
    await konto(() =>
      db.transaction(async () => {
        assert.equal(db.inTransaktion(), true);
        assert.equal(
          imSystemkontext('probe', () => db.inTransaktion()),
          true,
        );
      }),
    );
  });
});
