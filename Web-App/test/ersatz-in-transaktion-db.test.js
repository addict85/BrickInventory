/**
 * In einer Transaktion gibt es keinen Ersatzwert: Nach einem Datenbankfehler
 * nimmt PostgreSQL keinen Befehl mehr an (25P02), ein Ersatz verdeckte die
 * Ursache. Erzwungen wird der Fehler mit einem Überlauf: Zwei Erfassungen zu
 * je zwei Milliarden sprengen das `::int` der Mengensumme.
 *
 * Gegenproben (10.11.2026 gemessen):
 * - erfassungen.ts: mengeDesBestands wieder mit `.catch(meldeUndLiefere(…, null))`
 *   UND in db/database.ts `verdirbt: () => false` → rot: „die Ursache kommt an“
 *   (25P02 statt 22003, das Aufräumen lief in die tote Transaktion).
 *   Nur der alte Fang, Wächter aktiv → grün: Der Wächter allein trägt.
 * - fehler.ts: in pruefeErsatzInTransaktion die erste Zeile durch `return;`
 *   ersetzt → rot: „ein Datenbankfehler geht weiter“ und „ausserhalb der
 *   Datenbank wirft er in Tests“.
 * - database.ts: `vomSicherungspunktAufgefangen.add(e)` entfernt → rot:
 *   „hinter einem Sicherungspunkt gilt der Ersatz“.
 * - (14.11.2026) database.ts: setzeTransaktionsWaechter() in erzeugeDb gestrichen → rot:
 *   „ein Datenbankfehler geht weiter“, „ausserhalb der Datenbank wirft er in Tests“.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { haeltSet, erfasse, haltZeile } = require('./helpers/bestand');
const db = testDaten();
const { meldeUndLiefere, logAndContinue } = _req('src/infra/fehler.js');
const { versuche } = _req('src/infra/ergebnis.js');
const { erfassungLoeschen } = _req('src/sammlung/erfassungen.js');

const NAME = `ersatz_tx_${process.pid}`,
  SET = '71999-1';
/** @param {string} c */
const mitCode = c => (/** @type {any} */ e) => e.code === c;

test('kein Ersatzwert in einer Transaktion', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('ein Datenbankfehler geht weiter', async () => {
    await assert.rejects(
      db.transaction(async tx => tx.get('SELECT 1/0 AS x').catch(meldeUndLiefere('probe', null))),
      mitCode('22012'),
    );
    await assert.rejects(
      db.transaction(async tx => {
        await tx.get('SELECT 1/0 AS x').catch(logAndContinue('probe'));
      }),
      mitCode('22012'),
    );
    await assert.rejects(
      db.transaction(async tx => versuche('probe', tx.get('SELECT 1/0 AS x'))),
      mitCode('22012'),
    );
  });

  await t.test('ausserhalb der Datenbank wirft er in Tests', async () => {
    await assert.rejects(
      db.transaction(async () => Promise.reject(new Error('Netz weg')).catch(meldeUndLiefere('probe', 7))),
      /Ersatzwert in einer Transaktion \(probe\): Netz weg/,
    );
  });

  await t.test('ausserhalb einer Transaktion gilt der Ersatz', async () => {
    assert.equal(await db.get('SELECT 1/0 AS x').catch(meldeUndLiefere('probe', 'ersatz')), 'ersatz');
  });

  await t.test('hinter einem Sicherungspunkt gilt der Ersatz', async () => {
    const r = await db.transaction(async tx => {
      // Der Sicherungspunkt über den Zugang der Transaktion.
      const ersatz = await tx.db
        .transaction(inner => inner.get('SELECT 1/0 AS x'))
        .catch(meldeUndLiefere('probe', 'ersatz'));
      // Die äussere Transaktion nimmt danach noch Befehle an.
      return [ersatz, (await tx.get('SELECT 2 AS z')).z];
    });
    assert.deepEqual(r, ['ersatz', 2]);
  });

  await t.test('die Ursache kommt an, nichts wird aufgeräumt', async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    const uid = (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
                               VALUES ($1, 'x', true, true) RETURNING id`,
        [NAME],
      )
    ).id;
    t.after(() => db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {}));
    await haeltSet(db, uid, SET, 1);
    await erfasse(db, uid, SET, 2_000_000_000, { am: '2026-01-02T12:00:00Z' });
    await erfasse(db, uid, SET, 2_000_000_000, { am: '2026-01-03T12:00:00Z' });
    const klein = (await db.get('SELECT id FROM set_acquisitions WHERE user_id = $1 AND quantity = 1', [uid])).id;

    await assert.rejects(erfassungLoeschen('set', uid, klein, [SET]), (/** @type {any} */ e) => {
      assert.equal(e.code, '22003', `statt der Ursache kam ${e.code}: ${e.message}`);
      return true;
    });
    assert.ok(await haltZeile(db, uid, SET), 'Die Bestandszeile ist weg');
    assert.equal((await db.get('SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id = $1', [uid])).n, 3);
  });
});
