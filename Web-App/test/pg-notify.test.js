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
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('verpasste Signale werden beim Verbinden nachgeholt', () => {
  // Der Kern der Sache: NOTIFY ist flüchtig. Ohne diesen Schritt bliebe ein
  // Trigger, der während einer Trennung gesetzt wurde, für immer liegen.
  assert.match(NOTIFY, /for \(const hs of _handlers\.values\(\)\)/,
    'Beim Verbinden muss jeder Handler einmal von sich aus prüfen');
  assert.match(NOTIFY, /LISTEN \$\{quoteIdent\(channel\)\}/,
    'Kanäle müssen nach dem Reconnect erneut abonniert werden');
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
    // Beide Stellen lesen den Eintrag inzwischen über utils/settings.ts statt
    // mit eigener SQL-Anweisung. Geprüft wird weiterhin dasselbe: dass der
    // Handler ÜBERHAUPT nachsieht und ohne Eintrag abbricht.
    assert.match(body, new RegExp(`getGlobalSetting\\('${key}'\\)`),
      `${name}: der Handler muss den Eintrag lesen`);
    assert.match(body, /if \(!\w+\) return;/,
      `${name}: ohne Eintrag darf nichts passieren`);
  }
});

test('Kanalnamen werden validiert, nicht interpoliert', () => {
  // LISTEN/NOTIFY-Kanäle sind Bezeichner und können nicht gebunden werden —
  // deshalb muss der Name geprüft werden, bevor er in die Anweisung geht.
  assert.match(NOTIFY, /function quoteIdent/, 'Bezeichnerprüfung fehlt');
  assert.match(NOTIFY, /\^\[a-z_\]\[a-z0-9_\]\*\$/i, 'zu lasche Prüfung');
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
  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'admin.ts'), 'utf8');
  const settings = fs.readFileSync(path.join(ROOT, 'routes', 'settings.ts'), 'utf8');
  assert.match(admin, /notify\('csv_sync_trigger'\)/, 'CSV-Sync-Auslöser sendet kein Signal');
  assert.match(admin, /notify\('job_reschedule_trigger'\)/, 'Reschedule-Auslöser (admin) sendet kein Signal');
  assert.match(settings, /notify\('job_reschedule_trigger'\)/, 'Reschedule-Auslöser (settings) sendet kein Signal');
});
