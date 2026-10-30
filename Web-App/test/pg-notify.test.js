/**
 * LISTEN/NOTIFY statt Datenbank-Polling (Punkt 7).
 *
 * Vorher fragten zwei Schleifen dauerhaft dieselbe Tabelle ab: server.ts alle
 * 5 s nach `csv_sync_trigger`, dailyScheduler alle 3 s nach
 * `job_reschedule_trigger`. Zusammen rund 28'800 Abfragen pro Tag und Worker,
 * die praktisch immer nichts finden.
 *
 * Der Eintrag in global_settings bleibt die belastbare Quelle — NOTIFY ist
 * flüchtig, wer im Moment des Signals nicht verbunden ist, bekommt es nie.
 * Deshalb ruft pgNotify jeden Handler beim (Wieder-)Verbinden einmal auf.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in connect() die Aufhol-Schleife über _handlers entfernt → rot:
 *      „beim Verbinden fragt der Handler einmal von sich aus“
 *   B  quoteIdent() lässt jeden Namen durch → rot: „ein Kanalname mit
 *      Leerzeichen wird abgewiesen“ (danach hängt der Lauf am ungültigen Kanal)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const ROOT = path.join(__dirname, '..');
const NOTIFY = fs.readFileSync(path.join(ROOT, 'utils', 'pgNotify.ts'), 'utf8');
const SERVER = require('./helpers/sources').startQuelle();
// .ts, nicht .js: Seit der Migration (Punkt 10) ist die .js-Datei das
// Build-Ergebnis von esbuild und nicht mehr die Quelle.
const SCHED  = fs.readFileSync(path.join(ROOT, 'jobs', 'dailyScheduler.ts'), 'utf8');

test('die beiden Trigger-Poller sind weg', () => {
  assert.doesNotMatch(SERVER, /csv_sync_trigger[\s\S]{0,400}?\}, 5000\)/,
    'server.ts fragt den CSV-Trigger noch im Takt ab');
  assert.equal((SCHED.match(/setInterval/g) || []).length, 0,
    'dailyScheduler darf nicht mehr pollen');
  assert.match(SERVER, /listen\('csv_sync_trigger'/, 'CSV-Trigger hängt nicht an LISTEN');
  assert.match(SCHED,  /listen\('job_reschedule_trigger'/, 'Reschedule-Trigger hängt nicht an LISTEN');
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

test('die Handler prüfen den Datenbankeintrag, nicht die Nutzlast', () => {
  // Sonst würde ein Signal ohne zugehörigen Eintrag (etwa ein doppeltes
  // NOTIFY) eine Aktion auslösen, die gar nicht angefordert wurde.
  for (const [name, src, key] of [
    ['server.ts', SERVER, 'csv_sync_trigger'],
    ['dailyScheduler.ts', SCHED, 'job_reschedule_trigger'],
  ]) {
    const at = src.indexOf(`listen('${key}'`);
    const body = src.slice(at, at + 700);
    // Beide Stellen lesen den Eintrag über utils/laufzustand.ts. Geprüft wird,
    // dass der Handler ÜBERHAUPT nachsieht und ohne Eintrag abbricht.
    assert.match(body, new RegExp(`liesZustand\\('${key}'\\)`),
      `${name}: der Handler muss den Eintrag lesen`);
    assert.match(body, /if \(!\w+\) return;/,
      `${name}: ohne Eintrag darf nichts passieren`);
  }
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

test('jeder Sender löst auch ein Signal aus', () => {
  // Wer einen Auslöser in die Datenbank schreibt, weckt die Empfänger auch per
  // NOTIFY — sonst liegt der Eintrag bis zum nächsten Verbindungsaufbau. Gesucht
  // wird in allen Quellen, damit ein umgezogener Sender nicht aus der Liste fällt.
  // Gegenprobe (29.10.2026): pgNotify.notify('job_reschedule_trigger') in
  // utils/dienste/verwaltung.ts entfernt → rot.
  const { alleQuellen } = require('./helpers/sources');
  const sender = [];
  for (const rel of alleQuellen()) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/setzeAusloeser\(\s*'(\w+)'/g)) {
      sender.push(m[1]);
      assert.match(src, new RegExp(`notify\\('${m[1]}'`), `${rel}: Auslöser ${m[1]} sendet kein Signal`);
    }
  }
  assert.ok(sender.includes('csv_sync_trigger') && sender.includes('job_reschedule_trigger'),
    `Die bekannten Auslöser wurden nicht gefunden (${sender.join(', ')}) — Suche veraltet?`);
});
