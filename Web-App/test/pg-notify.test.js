/**
 * LISTEN/NOTIFY statt Datenbank-Polling (Punkt 7). NOTIFY ist flüchtig: Wer
 * im Moment des Signals nicht verbunden ist, bekommt es nie. Deshalb ruft
 * pgNotify jeden Handler beim (Wieder-)Verbinden einmal auf, und der
 * Empfänger sieht in der Datenbank nach (die Auftragstabelle).
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in connect() die Aufhol-Schleife über _handlers entfernt → rot:
 *      „beim Verbinden fragt der Handler einmal von sich aus“
 *   B  quoteIdent() lässt jeden Namen durch → rot: „ein Kanalname mit
 *      Leerzeichen wird abgewiesen“ (danach hängt der Lauf am ungültigen Kanal)
 *   C  `listen('csv_sync_trigger', …)` wieder in startup/jobsProzess.ts →
 *      rot: „kein Planer fragt mehr nach Auslösern“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const ROOT = path.join(__dirname, '..');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils', 'pgNotify.ts'), 'utf8');
test('kein Planer fragt mehr nach Auslösern', () => {
  // Anstösse und Zeitpläne sind Aufträge (utils/zeitplan.ts); die alten
  // Auslöser-Einträge mit eigenem Kanal sind weg.
  const { alleQuellen } = require('./helpers/sources');
  const treffer = alleQuellen().filter(rel =>
    /csv_sync_trigger|job_reschedule_trigger|instr_queue_trigger/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  assert.deepEqual(treffer, []);
});

test('verpasste Signale werden beim Verbinden nachgeholt', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const pgNotify = _req('utils/pgNotify.js');
  t.after(async () => { await pgNotify.close(); await db.pool.end().catch(() => {}); });
  const KANAL = `ae_probe_${process.pid}`;
  const bekommen = [];
  const warte = async (n) => {
    for (let i = 0; i < 100 && bekommen.length < n; i++) await new Promise(r => setTimeout(r, 50));
  };

  assert.throws(() => pgNotify.listen('kein kanal', () => {}), /Ungültiger Kanalname/,
    'ein Kanalname mit Leerzeichen wird abgewiesen');

  pgNotify.listen(KANAL, (nutzlast) => { bekommen.push(nutzlast ?? null); });
  await warte(1);
  assert.deepEqual(bekommen, [null], 'beim Verbinden fragt der Handler einmal von sich aus');

  await pgNotify.notify(KANAL, 'hallo');
  await warte(2);
  assert.deepEqual(bekommen, [null, 'hallo'], 'das Signal kommt an');

  // Die lauschende Verbindung abreissen: Ein Signal in der Lücke ginge
  // verloren, deshalb holt der Handler beim Wiederverbinden nach.
  await db.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                 WHERE pid <> pg_backend_pid() AND query LIKE $1`, [`LISTEN "${KANAL}"%`]);
  await warte(3);
  assert.deepEqual(bekommen, [null, 'hallo', null], 'nach dem Wiederverbinden holt der Handler nach');
});

test('beim Senden wird der Kanal gebunden, nicht eingesetzt', () => {
  assert.match(NOTIFY, /pg_notify\(\$1, \$2\)/,
    'Beim Senden lässt sich der Kanal binden — dort gehört kein String-Bau hin');
});

test('eigene Verbindung, mit gedeckeltem Reconnect', () => {
  assert.match(NOTIFY, /new Client\(/,
    'Ein dauerhaft lauschender Client wäre im Pool blockiert');
  assert.match(NOTIFY, /Math\.min\(30_000, _retryMs \* 2\)/,
    'Reconnect ohne Deckelung und Backoff hämmert bei DB-Ausfall dagegen');
});
