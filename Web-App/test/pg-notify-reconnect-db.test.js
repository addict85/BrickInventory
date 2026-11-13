/**
 * LISTEN/NOTIFY überlebt einen Verbindungsabriss — gegen echte Datenbank.
 *
 * Gegenprobe (durchgeführt): retire() in db/pgNotify.ts wieder durch die
 * alte Fassung ersetzt (removeAllListeners ohne Ersatz-Zuhörer) → dieser Test
 * wird rot, Exitcode 7 statt 0.
 * Gegenprobe (10.11.2026 gemessen): in db/pgNotify.ts die Prüfung auf _closed
 * nach c.connect() gestrichen → rot: „close() während des Verbindungsaufbaus
 * …“ (das Kind endet nicht, ETIMEDOUT nach 15 s).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = _req('db/database.js');

// Der Kindprozess: horcht, lässt sich die Verbindung abschiessen und meldet
// über den Exitcode, ob er das überlebt hat.
const CHILD = `
process.env.DATABASE_URL = ${JSON.stringify(process.env.DATABASE_URL)};
const dbModul = require(${JSON.stringify(path.join(ROOT, 'dist/db/database.js'))});
const db     = dbModul.erzeugeDb(dbModul.dbKonfigAusUmgebung());
const notify = db.benachrichtigung;
const { bis } = require(${JSON.stringify(path.join(__dirname, 'helpers', 'zeit.js'))});
const LISTEN = \`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query LIKE 'LISTEN "reconnect_probe"%'\`;
let empfangen = 0;
process.on('uncaughtException', e => { console.log('CRASH:' + e.message); process.exit(7); });
(async () => {
  notify.listen('reconnect_probe', () => { empfangen++; });
  await bis(async () => (await db.pool.query(LISTEN)).rows.length > 0);
  const alt = (await db.pool.query(LISTEN)).rows.map(z => z.pid);
  // Abriss serverseitig erzwingen — der reale Fall (Postgres-Neustart, Proxy).
  await db.run(\`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                WHERE datname = current_database() AND query LIKE 'LISTEN "reconnect_probe"%' AND pid <> pg_backend_pid()\`);
  // Ohne funktionierenden Wiederaufbau (erster Versuch nach ~1 s) kommt keine
  // neue Verbindung mit LISTEN; die alte zählt nicht.
  const neu = async () => (await db.pool.query(LISTEN)).rows.filter(z => !alt.includes(z.pid)).length;
  await bis(async () => await neu() > 0, 10_000);
  const n = await neu();
  console.log('LISTEN_WIEDER_DA:' + n);
  await notify.close();
  await db.pool.end();
  process.exit(n >= 1 ? 0 : 8);
})().catch(e => { console.log('FEHLER:' + e.message); process.exit(9); });
`;

test('ein Abriss der LISTEN-Verbindung beendet den Prozess NICHT und verbindet neu', { concurrency: 1 }, async t => {
  try {
    await db.pool.query('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const file = path.join(os.tmpdir(), `notify-reconnect-${process.pid}.js`);
  fs.writeFileSync(file, CHILD);
  try {
    let out = '';
    try {
      out = execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 40000 });
    } catch (e) {
      // Exitcode != 0: Ausgabe trotzdem auswerten, sie sagt woran es lag.
      const stdout = (e.stdout || '').toString();
      assert.fail(
        `Der Kindprozess ist nicht sauber beendet worden (Exitcode ${e.status}). ` +
          `Ausgabe: ${stdout.trim() || '(leer)'}`,
      );
    }
    assert.ok(!out.includes('CRASH:'), `Der Abriss hat den Prozess abgeschossen: ${out.trim()}`);
    assert.match(
      out,
      /LISTEN_WIEDER_DA:[1-9]/,
      `Nach dem Abriss steht kein LISTEN mehr — der Reconnect hat nicht gegriffen. Ausgabe: ${out.trim()}`,
    );
  } finally {
    fs.rmSync(file, { force: true });
    await db.pool.end().catch(() => {});
  }
});

// Unter Last ist der Aufbau noch unterwegs, wenn ein Test close() ruft; die
// Verbindung, die danach ankam, hielt den Prozess für immer offen.
test('close() während des Verbindungsaufbaus lässt keine Verbindung offen', async t => {
  // Der Pool ist nach dem ersten Test zu: eine eigene Verbindung für die Probe.
  const probe = new (require(path.join(ROOT, 'node_modules', 'pg')).Client)({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await probe.connect();
  } catch (e) {
    keineDb(t, e);
    return;
  } finally {
    await probe.end().catch(() => {});
  }
  // Kein process.exit im Kind: Es muss von selbst enden.
  const kind = `
process.env.DATABASE_URL = ${JSON.stringify(process.env.DATABASE_URL)};
const dbModul = require(${JSON.stringify(path.join(ROOT, 'dist/db/database.js'))});
const db = dbModul.erzeugeDb(dbModul.dbKonfigAusUmgebung());
const notify = db.benachrichtigung;
notify.listen('rennen_probe', () => {});
notify.close().then(() => console.log('GESCHLOSSEN'));
`;
  const out = execFileSync(process.execPath, ['-e', kind], { encoding: 'utf8', timeout: 15_000 });
  assert.match(out, /GESCHLOSSEN/);
});
