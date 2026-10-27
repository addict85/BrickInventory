/**
 * Server und Datenbank-Pool rechnen mit derselben Workerzahl.
 *
 * compose.yaml setzt WEB_WORKERS: 0 („so viele wie Kerne"). server.ts startete
 * dann einen Worker je Kern, db/database.ts las die 0 aber als „ein Worker"
 * und gab jedem Pool 15 Verbindungen — bei acht Kernen 120 statt 80.
 *
 * Dazu die Pause vor dem Neustart eines abgestürzten Workers.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  in db/database.ts wieder `parseInt(String(process.env.WEB_WORKERS ||
 *      cpus().length))` → rot: „WEB_WORKERS=0: der Pool rechnet mit derselben
 *      Workerzahl wie der Server"
 *   B  neustartPause liefert 0 → rot: „Neustart nach Absturz wartet länger …"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');

const _req = require('./helpers/sources').buildAndRequire();
const { workerZahl, poolJeWorker, neustartPause } = _req('utils/workerZahl.js');
const { DIST } = require('./helpers/sources');

test('workerZahl: 0, leer und Unsinn heissen „je Kern, mindestens zwei"', () => {
  assert.equal(workerZahl({ WEB_WORKERS: '0' }, 8), 8);
  assert.equal(workerZahl({}, 1), 2);
  assert.equal(workerZahl({ WEB_WORKERS: 'viele' }, 4), 4);
  assert.equal(workerZahl({ WEB_WORKERS: '3' }, 16), 3);
});

test('poolJeWorker: zusammen höchstens 80, je Worker 5 bis 15', () => {
  assert.equal(poolJeWorker(1), 15);
  assert.equal(poolJeWorker(8), 10);
  assert.equal(poolJeWorker(32), 5);
});

test('WEB_WORKERS=0: der Pool rechnet mit derselben Workerzahl wie der Server', () => {
  // Acht Kerne vorgeben: Bei vier ergäben beide Rechnungen zufällig 15.
  const skript = `
    require('os').cpus = () => Array(8).fill({});
    const db = require(${JSON.stringify(path.join(DIST, 'db', 'database.js'))});
    process.stdout.write(String(db.pool.options.max));
    db.pool.end();`;
  const env = { ...process.env, WEB_WORKERS: '0', DATABASE_URL: 'postgres://x:y@127.0.0.1:1/z' };
  delete env.PG_POOL_MAX;
  const max = Number(execFileSync(process.execPath, ['-e', skript], { env, encoding: 'utf8' }));
  assert.equal(max, poolJeWorker(workerZahl({ WEB_WORKERS: '0' }, 8)));
  assert.equal(max, 10);
});

test('Neustart nach Absturz wartet länger, je öfter es in der Minute kracht', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(neustartPause), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
});
