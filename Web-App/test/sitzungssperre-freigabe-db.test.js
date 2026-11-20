/**
 * Schlägt das Freigeben einer Sitzungssperre fehl (z. B. statement_timeout), geht
 * die Verbindung nicht mit gehaltener Sperre in den Pool zurück, und das
 * Ergebnis des Laufs bleibt erhalten.
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  client.release(defekt) wieder client.release() (withSessionLock)
 *      → rot: „withSessionLock: die Sperre ist nach einem Freigabefehler frei“ und „… Fehler des Laufs“
 *   B  die Freigabe ohne .catch (Fehler überdeckt das Ergebnis)
 *      → rot: „withSessionLock: das Ergebnis des Laufs bleibt“ (und die zwei anderen withSessionLock-Fälle)
 *   C  in receiptsSessionLock wieder client.release() ohne Fehler
 *      → rot: „receiptsSessionLock: die Sperre ist nach einem Freigabefehler frei“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { withSessionLock, receiptsSessionLock } = _req('db/txLock.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const SCHLUESSEL = 7_654_321;

/** Die nächste geliehene Verbindung lässt pg_advisory_unlock scheitern. */
function unlockFailsOnce() {
  const echt = testAccess().pool.connect.bind(testAccess().pool);
  const incident = { releaseWithError: /** @type {unknown} */ (undefined), released: false };
  testAccess().pool.connect = async () => {
    const c = await echt();
    const query = c.query.bind(c);
    const release = c.release.bind(c);
    c.query = (/** @type {any} */ sql, /** @type {any} */ p) =>
      typeof sql === 'string' && sql.includes('pg_advisory_unlock')
        ? Promise.reject(new Error('statement timeout (Attrappe)'))
        : query(sql, p);
    c.release = (/** @type {any} */ err) => {
      incident.released = true;
      incident.releaseWithError = err;
      testAccess().pool.connect = echt;
      return release(err);
    };
    return c;
  };
  return incident;
}

/** Hält irgendeine Verbindung die Sperre noch? Von einer frischen Sitzung aus gefragt. */
async function lockFree() {
  const c = await testAccess().pool.connect();
  try {
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [SCHLUESSEL]);
    if (rows[0].ok) await c.query('SELECT pg_advisory_unlock($1, 0)', [SCHLUESSEL]);
    return !!rows[0].ok;
  } finally {
    c.release();
  }
}

test('Sitzungssperre: Freigabefehler', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  // Der Pool soll genau eine Verbindung haben, sonst bekäme die Prüfung eine andere
  // als die, die die Sperre hält, und fände sie "frei".
  const maxBefore = testAccess().pool.options.max;
  testAccess().pool.options.max = 1;
  t.after(() => {
    testAccess().pool.options.max = maxBefore;
  });

  await t.test('withSessionLock: das Ergebnis des Laufs bleibt', async () => {
    const incident = unlockFailsOnce();
    const r = await withSessionLock(
      testAccess(),
      SCHLUESSEL,
      async () => 'ergebnis',
      () => {
        throw new Error('belegt');
      },
    );
    assert.equal(r, 'ergebnis', 'der Freigabefehler überdeckt das Ergebnis');
    assert.equal(incident.released, true);
  });

  await t.test('withSessionLock: die Sperre ist nach einem Freigabefehler frei', async () => {
    const incident = unlockFailsOnce();
    await withSessionLock(
      testAccess(),
      SCHLUESSEL,
      async () => 1,
      () => {
        throw new Error('belegt');
      },
    );
    assert.ok(incident.releaseWithError instanceof Error, 'die Verbindung wurde ohne Fehler zurückgegeben');
    assert.equal(await lockFree(), true, 'die Sperre hängt an einer Verbindung im Pool');
  });

  await t.test('withSessionLock: ein Fehler des Laufs bleibt der Fehler', async () => {
    unlockFailsOnce();
    await assert.rejects(
      withSessionLock(
        testAccess(),
        SCHLUESSEL,
        async () => {
          throw new Error('lauf kaputt');
        },
        () => {
          throw new Error('belegt');
        },
      ),
      /lauf kaputt/,
    );
    assert.equal(await lockFree(), true);
  });

  await t.test('receiptsSessionLock: die Sperre ist nach einem Freigabefehler frei', async () => {
    const incident = unlockFailsOnce();
    const frei = await receiptsSessionLock(testAccess(), SCHLUESSEL);
    assert.ok(frei, 'die Sperre war schon belegt');
    await frei();
    assert.ok(incident.releaseWithError instanceof Error, 'die Verbindung wurde ohne Fehler zurückgegeben');
    assert.equal(await lockFree(), true, 'die Sperre hängt an einer Verbindung im Pool');
  });
});
