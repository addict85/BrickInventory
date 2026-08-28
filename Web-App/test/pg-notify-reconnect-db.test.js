/**
 * LISTEN/NOTIFY überlebt einen Verbindungsabriss — gegen echte Datenbank.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Ein einziger Abriss der LISTEN-Verbindung löst beim pg-Client DREI Ereignisse
 * aus: error → error → end (am laufenden Postgres 16 nachgemessen). Die
 * vorherige Fassung von utils/pgNotify.ts rief bei jedem davon
 * scheduleReconnect(), und das begann mit removeAllListeners() — nach dem
 * ersten Ereignis war damit auch der 'error'-Zuhörer weg. Ein 'error' ohne
 * Zuhörer ist in Node kein Logeintrag, sondern eine geworfene Ausnahme: Der
 * Worker starb mit „Connection terminated unexpectedly".
 *
 * Betroffen war jeder Postgres-Neustart, jeder Netzaussetzer und jedes
 * Idle-Timeout eines vorgelagerten Proxys — und weil dann ALLE Worker
 * gleichzeitig ihre Verbindung verlieren, traf es sie auch alle gleichzeitig.
 * Mit ihnen starben offene SSE-Ströme und laufende Anfragen.
 *
 * Das kann keine Quelltext-Prüfung sehen: Der Fehler steckte nicht in einem
 * fehlenden Aufruf, sondern in der REIHENFOLGE von Ereignissen einer fremden
 * Bibliothek. Deshalb hier ein echter Abriss per pg_terminate_backend() in
 * einem KINDPROZESS — nur so ist „der Prozess stirbt" überhaupt beobachtbar
 * (im Testprozess selbst würde er den Testlauf mitnehmen).
 *
 * Gegenprobe (durchgeführt): retire() in utils/pgNotify.ts wieder durch die
 * alte Fassung ersetzt (removeAllListeners ohne Ersatz-Zuhörer) → dieser Test
 * wird rot, Exitcode 7 statt 0.
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
const db = _req('db/database.js');

// Der Kindprozess: horcht, lässt sich die Verbindung abschiessen und meldet
// über den Exitcode, ob er das überlebt hat.
const CHILD = `
process.env.DATABASE_URL = ${JSON.stringify(process.env.DATABASE_URL)};
const notify = require(${JSON.stringify(path.join(ROOT, 'dist/utils/pgNotify.js'))});
const db     = require(${JSON.stringify(path.join(ROOT, 'dist/db/database.js'))});
let empfangen = 0;
process.on('uncaughtException', e => { console.log('CRASH:' + e.message); process.exit(7); });
(async () => {
  notify.listen('reconnect_probe', () => { empfangen++; });
  await new Promise(r => setTimeout(r, 800));
  // Abriss serverseitig erzwingen — der reale Fall (Postgres-Neustart, Proxy).
  await db.run(\`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                WHERE query LIKE 'LISTEN "reconnect_probe"%' AND pid <> pg_backend_pid()\`);
  // Reconnect abwarten (erster Versuch nach ~1 s Backoff), dann prüfen, ob
  // das LISTEN wieder steht: ohne funktionierenden Wiederaufbau bleibt die
  // Zeile in pg_stat_activity aus.
  await new Promise(r => setTimeout(r, 4000));
  const { rows } = await db.pool.query(
    \`SELECT count(*)::int AS n FROM pg_stat_activity WHERE query LIKE 'LISTEN "reconnect_probe"%'\`);
  console.log('LISTEN_WIEDER_DA:' + rows[0].n);
  await notify.close();
  await db.pool.end();
  process.exit(rows[0].n >= 1 ? 0 : 8);
})().catch(e => { console.log('FEHLER:' + e.message); process.exit(9); });
`;

test('ein Abriss der LISTEN-Verbindung beendet den Prozess NICHT und verbindet neu',
  { concurrency: 1 }, async (t) => {

  try { await db.pool.query('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
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
        `Ausgabe: ${stdout.trim() || '(leer)'}`
      );
    }
    assert.ok(!out.includes('CRASH:'),
      `Der Abriss hat den Prozess abgeschossen: ${out.trim()}`);
    assert.match(out, /LISTEN_WIEDER_DA:[1-9]/,
      `Nach dem Abriss steht kein LISTEN mehr — der Reconnect hat nicht gegriffen. Ausgabe: ${out.trim()}`);
  } finally {
    fs.rmSync(file, { force: true });
    await db.pool.end().catch(() => {});
  }
});
