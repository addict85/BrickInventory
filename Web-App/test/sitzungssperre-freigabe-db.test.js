/**
 * Schlägt das Freigeben einer Sitzungssperre fehl (z. B. statement_timeout), geht
 * die Verbindung nicht mit gehaltener Sperre in den Pool zurück, und das
 * Ergebnis des Laufs bleibt erhalten.
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  client.release(defekt) wieder client.release() (mitSitzungsSperre)
 *      → rot: „mitSitzungsSperre: die Sperre ist nach einem Freigabefehler frei“ und „… Fehler des Laufs“
 *   B  die Freigabe ohne .catch (Fehler überdeckt das Ergebnis)
 *      → rot: „mitSitzungsSperre: das Ergebnis des Laufs bleibt“ (und die zwei anderen mitSitzungsSperre-Fälle)
 *   C  in belegeSitzungsSperre wieder client.release() ohne Fehler
 *      → rot: „belegeSitzungsSperre: die Sperre ist nach einem Freigabefehler frei“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten, testZugang } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const db = testDaten();
const { mitSitzungsSperre, belegeSitzungsSperre } = _req('db/txLock.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const SCHLUESSEL = 7_654_321;

/** Die nächste geliehene Verbindung lässt pg_advisory_unlock scheitern. */
function unlockScheitertEinmal() {
  const echt = testZugang().pool.connect.bind(testZugang().pool);
  const vorfall = { freigabeMitFehler: /** @type {unknown} */ (undefined), freigegeben: false };
  testZugang().pool.connect = async () => {
    const c = await echt();
    const query = c.query.bind(c);
    const release = c.release.bind(c);
    c.query = (/** @type {any} */ sql, /** @type {any} */ p) =>
      typeof sql === 'string' && sql.includes('pg_advisory_unlock')
        ? Promise.reject(new Error('statement timeout (Attrappe)'))
        : query(sql, p);
    c.release = (/** @type {any} */ err) => {
      vorfall.freigegeben = true;
      vorfall.freigabeMitFehler = err;
      testZugang().pool.connect = echt;
      return release(err);
    };
    return c;
  };
  return vorfall;
}

/** Hält irgendeine Verbindung die Sperre noch? Von einer frischen Sitzung aus gefragt. */
async function sperreFrei() {
  const c = await testZugang().pool.connect();
  try {
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1, 0) AS ok', [SCHLUESSEL]);
    if (rows[0].ok) await c.query('SELECT pg_advisory_unlock($1, 0)', [SCHLUESSEL]);
    return !!rows[0].ok;
  } finally {
    c.release();
  }
}

test('Sitzungssperre: Freigabefehler', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  // Der Pool soll genau eine Verbindung haben, sonst bekäme die Prüfung eine andere
  // als die, die die Sperre hält, und fände sie "frei".
  const maxVorher = testZugang().pool.options.max;
  testZugang().pool.options.max = 1;
  t.after(() => {
    testZugang().pool.options.max = maxVorher;
  });

  await t.test('mitSitzungsSperre: das Ergebnis des Laufs bleibt', async () => {
    const vorfall = unlockScheitertEinmal();
    const r = await mitSitzungsSperre(
      testZugang(),
      SCHLUESSEL,
      async () => 'ergebnis',
      () => {
        throw new Error('belegt');
      },
    );
    assert.equal(r, 'ergebnis', 'der Freigabefehler überdeckt das Ergebnis');
    assert.equal(vorfall.freigegeben, true);
  });

  await t.test('mitSitzungsSperre: die Sperre ist nach einem Freigabefehler frei', async () => {
    const vorfall = unlockScheitertEinmal();
    await mitSitzungsSperre(
      testZugang(),
      SCHLUESSEL,
      async () => 1,
      () => {
        throw new Error('belegt');
      },
    );
    assert.ok(vorfall.freigabeMitFehler instanceof Error, 'die Verbindung wurde ohne Fehler zurückgegeben');
    assert.equal(await sperreFrei(), true, 'die Sperre hängt an einer Verbindung im Pool');
  });

  await t.test('mitSitzungsSperre: ein Fehler des Laufs bleibt der Fehler', async () => {
    unlockScheitertEinmal();
    await assert.rejects(
      mitSitzungsSperre(
        testZugang(),
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
    assert.equal(await sperreFrei(), true);
  });

  await t.test('belegeSitzungsSperre: die Sperre ist nach einem Freigabefehler frei', async () => {
    const vorfall = unlockScheitertEinmal();
    const frei = await belegeSitzungsSperre(testZugang(), SCHLUESSEL);
    assert.ok(frei, 'die Sperre war schon belegt');
    await frei();
    assert.ok(vorfall.freigabeMitFehler instanceof Error, 'die Verbindung wurde ohne Fehler zurückgegeben');
    assert.equal(await sperreFrei(), true, 'die Sperre hängt an einer Verbindung im Pool');
  });
});
