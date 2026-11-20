/**
 * Beim Herunterfahren schreiben Bildbedarf, Bild-Fehlanzeige und Protokoll
 * ihren Puffer noch in die Datenbank, und ihre Takte enden
 * (startup/abschluss.ts, aufgerufen von herunterfahren() in server.ts).
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  stopImageDemand() ohne `await schreibePuffer()` → rot: „der Bildbedarf
 *      steht danach in image_wanted“
 *   B  stopNone() ohne clearInterval → rot: „jeder Takt ist beendet“
 *   C  stopLog() ohne `await emptyLog()` → rot: „die letzte
 *      Zeile steht in app_logs“
 *   D  stopLog() ohne `Z.pool = null` → rot: „danach schreibt das
 *      Protokoll nicht mehr in die Datenbank“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('Abschluss: Puffer geschrieben, Takte beendet', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const P = _req('src/infra/protokoll.js');
  const B = _req('src/bilder/bildbedarfLauf.js');
  const F = _req('src/bilder/imageMisses.js');
  const { closeBufferAndTicks } = _req('startup/abschluss.js');

  // Welche Takte entstehen, und welche wieder enden.
  const offen = new Set();
  const echt = { set: global.setInterval, clear: global.clearInterval };
  // @ts-expect-error — Mitschnitt mit genau der Form, die die Takte benutzen.
  global.setInterval = (fn, ms) => {
    const h = echt.set(fn, ms);
    offen.add(h);
    return h;
  };
  global.clearInterval = h => {
    offen.delete(h);
    echt.clear(h);
  };
  const zurueck = P.installLog({ out: () => {}, err: () => {}, jetzt: () => Date.now() });
  t.after(() => {
    zurueck();
    Object.assign(global, { setInterval: echt.set, clearInterval: echt.clear });
  });

  const kennung = `abschluss-${process.pid}`;
  P.logInDieDatabase(db.pool);
  await B.setUpImageDemand();
  await F.setUpImageGaps();
  assert.ok(offen.size >= 4, `Aufbau: ${offen.size} Takte, erwartet mindestens vier`);

  B.rememberUsed(`https://cdn.rebrickable.com/media/sets/${kennung}.jpg`, `${kennung}-1`);
  F.rememberMissing(`fehlt:${kennung}`, '404');
  console.log(`letzte Zeile ${kennung}`);

  await closeBufferAndTicks(testAccess(), require('./helpers/sources').testServices());

  await t.test('der Bildbedarf steht danach in image_wanted', async () => {
    const z = await db.get('SELECT set_number FROM image_wanted WHERE url = $1', [
      `https://cdn.rebrickable.com/media/sets/${kennung}.jpg`,
    ]);
    assert.equal(z?.set_number, `${kennung}-1`);
  });

  await t.test('die Fehlanzeige steht danach in image_misses', async () => {
    const z = await db.get('SELECT reason FROM image_misses WHERE cache_key = $1', [`fehlt:${kennung}`]);
    assert.equal(z?.reason, '404');
  });

  await t.test('die letzte Zeile steht in app_logs', async () => {
    const z = await db.get('SELECT 1 AS ja FROM app_logs WHERE message LIKE $1', [`%letzte Zeile ${kennung}%`]);
    assert.ok(z, 'die Zeile fehlt');
  });

  await t.test('jeder Takt ist beendet', () => {
    assert.equal(offen.size, 0, `${offen.size} Takt(e) laufen weiter`);
  });

  await t.test('danach schreibt das Protokoll nicht mehr in die Datenbank', async () => {
    console.log(`nach dem Abschluss ${kennung}`);
    await P.emptyLog();
    const z = await db.get('SELECT 1 AS ja FROM app_logs WHERE message LIKE $1', [`%nach dem Abschluss ${kennung}%`]);
    assert.equal(z, undefined);
  });
});
