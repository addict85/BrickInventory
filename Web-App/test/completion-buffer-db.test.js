/**
 * On shutdown image demand, image miss marker and log still write
 * their buffer into the database, and their timers end
 * (startup/shutdown.ts, called by herunterfahren() in server.ts).
 *
 * Counter-checks (measured on 11.11.2026):
 *   A  stopImageDemand() without `await writeBuffer()` → red: “the image demand
 *      is in image_wanted afterwards”
 *   B  stopNone() without clearInterval → red: “every timer has ended”
 *   C  stopLog() without `await emptyLog()` → red: “the last
 *      line is in app_logs”
 *   D  stopLog() without `Z.pool = null` → red: “afterwards the
 *      log no longer writes into the database”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

test('shutdown: buffers written, ticks ended', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const P = _req('src/infra/log.js');
  const B = _req('src/images/imageDemandRun.js');
  const F = _req('src/images/imageMisses.js');
  const { closeBufferAndTicks } = _req('startup/shutdown.js');

  // Which timers are created, and which end again.
  const offen = new Set();
  const echt = { set: global.setInterval, clear: global.clearInterval };
  // @ts-expect-error — recording with exactly the shape the timers use.
  global.setInterval = (fn, ms) => {
    const h = echt.set(fn, ms);
    offen.add(h);
    return h;
  };
  global.clearInterval = h => {
    offen.delete(h);
    echt.clear(h);
  };
  const zurueck = P.installLog({ out: () => {}, err: () => {}, now: () => Date.now() });
  t.after(() => {
    zurueck();
    Object.assign(global, { setInterval: echt.set, clearInterval: echt.clear });
  });

  const kennung = `abschluss-${process.pid}`;
  P.logToDatabase(db.pool);
  await B.setUpImageDemand();
  await F.setUpImageGaps();
  assert.ok(offen.size >= 4, `Aufbau: ${offen.size} Takte, erwartet mindestens vier`);

  B.rememberUsed(`https://cdn.rebrickable.com/media/sets/${kennung}.jpg`, `${kennung}-1`);
  F.rememberMissing(`fehlt:${kennung}`, '404');
  console.log(`letzte Zeile ${kennung}`);

  await closeBufferAndTicks(testAccess(), require('./helpers/sources').testServices());

  await t.test('the image demand is in image_wanted afterwards', async () => {
    const z = await db.get('SELECT set_number FROM image_wanted WHERE url = $1', [
      `https://cdn.rebrickable.com/media/sets/${kennung}.jpg`,
    ]);
    assert.equal(z?.set_number, `${kennung}-1`);
  });

  await t.test('the negative result is in image_misses afterwards', async () => {
    const z = await db.get('SELECT reason FROM image_misses WHERE cache_key = $1', [`fehlt:${kennung}`]);
    assert.equal(z?.reason, '404');
  });

  await t.test('the last line is in app_logs', async () => {
    const z = await db.get('SELECT 1 AS ja FROM app_logs WHERE message LIKE $1', [`%letzte Zeile ${kennung}%`]);
    assert.ok(z, 'die Zeile fehlt');
  });

  await t.test('every tick is ended', () => {
    assert.equal(offen.size, 0, `${offen.size} Takt(e) laufen weiter`);
  });

  await t.test('afterwards the log no longer writes to the database', async () => {
    console.log(`nach dem Abschluss ${kennung}`);
    await P.emptyLog();
    const z = await db.get('SELECT 1 AS ja FROM app_logs WHERE message LIKE $1', [`%nach dem Abschluss ${kennung}%`]);
    assert.equal(z, undefined);
  });
});
