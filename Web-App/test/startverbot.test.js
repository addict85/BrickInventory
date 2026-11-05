/**
 * In Produktion startet der Server nicht mit dem Beispielpasswort der
 * Datenbank oder einem TRUST_PROXY, das ganzen Netzen glaubt. Geprüft am
 * echten Server: Er muss sich mit Code 1 und einer klaren Meldung beenden,
 * bevor er eine Datenbank braucht.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in server.ts den Aufruf von startVerbote() entfernt → rot: „der Server
 *      läuft mit dem Beispielpasswort weiter“ (beide Teilprüfungen)
 *   B  in startVerbote() den TRUST_PROXY-Zweig entfernt → rot nur bei
 *      „TRUST_PROXY=docker“
 *   C  startVerbote() ohne die Abfrage auf NODE_ENV → rot: „ausserhalb von
 *      Produktion kein Verbot“
 * Gegenproben (04.11.2026 gemessen):
 *   D  sitzungsGeheimnis() wieder mit `!konfig().produktion` statt
 *      `konfig().entwicklung` → rot: „ohne NODE_ENV kein öffentliches
 *      Sitzungsgeheimnis“ (beide Fälle starten)
 *   E  der frühe Aufruf von sitzungsGeheimnis() in starte() gestrichen → rot:
 *      dieselbe Prüfung (der Start scheitert erst an der Datenbank, ohne Grund)
 *   F  `start` in package.json ohne NODE_ENV=production → rot: „npm start …“
 *   G  die Meldung zu APP_BASE_URL in server.ts gestrichen → rot: „ohne
 *      APP_BASE_URL im Betrieb …“ (mit der Ausnahme keine Meldung)
 * Gegenproben H4 (04.11.2026 gemessen, je einzeln):
 *   H  in startVerbote() den Zweig zu APP_BASE_URL entfernt → rot: „ohne
 *      APP_BASE_URL im Betrieb …“ (Code statt 1: Datenbankfehler)
 *   I  APP_BASE_URL_FEHLT_OK nicht ausgewertet → rot: dieselbe Prüfung (mit
 *      der Ausnahme verweigert)
 *   J  die Ausnahme für ROLLE=jobs entfernt → rot: dieselbe Prüfung ({"ROLLE":"jobs"})
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { startVerbote } = _req('src/infra/konfig.js');

/** Server starten und auf sein Ende warten — höchstens `ms`, dann gilt er als laufend. */
function starte(env, ms = 8000) {
  return new Promise((fertig) => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '39648',
             SESSION_SECRET: 'startverbot-geheimnis-lang-genug-1234567', ...env },
    });
    let log = '';
    srv.stdout.on('data', d => { log += d; });
    srv.stderr.on('data', d => { log += d; });
    const uhr = setTimeout(() => { srv.kill('SIGKILL'); }, ms);
    srv.on('exit', (code) => { clearTimeout(uhr); fertig({ code, log }); });
  });
}

test('Beispielpasswort der Datenbank: Start verweigert', { timeout: 30_000 }, async () => {
  for (const env of [{ PGPASSWORD: 'brickinventory_secret', PGHOST: '127.0.0.1', PGPORT: '1' },
                     { DATABASE_URL: 'postgres://brickinventory:brickinventory_secret@127.0.0.1:1/x' }]) {
    const { code, log } = await starte(env);
    assert.equal(code, 1, `der Server läuft mit dem Beispielpasswort weiter: ${log.slice(-400)}`);
    assert.match(log, /Beispielpasswort .*Start verweigert/);
  }
});

test('TRUST_PROXY=docker: Start verweigert', { timeout: 30_000 }, async () => {
  const { code, log } = await starte({ DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', TRUST_PROXY: 'docker' });
  assert.equal(code, 1, log.slice(-400));
  assert.match(log, /TRUST_PROXY enthält „docker/);
});

test('ohne NODE_ENV kein öffentliches Sitzungsgeheimnis', { timeout: 30_000 }, async () => {
  const ohne = { NODE_ENV: undefined, DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', APP_BASE_URL: 'https://lego.example.org' };
  for (const geheimnis of [undefined, 'brickinventory-manager-dev-secret']) {
    const { code, log } = await starte({ ...ohne, SESSION_SECRET: geheimnis });
    assert.equal(code, 1, log.slice(-400));
    assert.match(log, /SESSION_SECRET .*Start verweigert/);
  }
  // Ausdrücklich in der Entwicklung gilt das Entwicklungsgeheimnis; der Start
  // scheitert dann erst an der Datenbank, die es hier nicht gibt.
  const { log } = await starte({ ...ohne, NODE_ENV: 'development', SESSION_SECRET: undefined });
  assert.doesNotMatch(log, /SESSION_SECRET/);
  assert.match(log, /Database initialisation failed/);
});

test('ohne APP_BASE_URL im Betrieb: Start verweigert, nur ausdrücklich erlaubt', { timeout: 60_000 }, async () => {
  const db = { DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x' };
  const ohne = await starte(db);
  assert.equal(ohne.code, 1, ohne.log.slice(-400));
  assert.match(ohne.log, /APP_BASE_URL fehlt im Betrieb: .*Start verweigert/);
  assert.doesNotMatch(ohne.log, /Database initialisation failed/, 'das Verbot kommt vor der Datenbank');
  // Mit der Ausnahme startet er bis zur Datenbank, laut gemeldet.
  const erlaubt = await starte({ ...db, APP_BASE_URL_FEHLT_OK: '1' });
  assert.match(erlaubt.log, /❌ \[start\] APP_BASE_URL fehlt im Betrieb \(APP_BASE_URL_FEHLT_OK=1\): Der Host-Filter/);
  assert.match(erlaubt.log, /Database initialisation failed/);
  for (const env of [{ APP_BASE_URL: 'https://lego.example.org' }, { ROLLE: 'jobs' }, { NODE_ENV: 'development' }]) {
    const r = await starte({ ...db, ...env });
    assert.doesNotMatch(r.log, /APP_BASE_URL fehlt/, JSON.stringify(env));
    assert.match(r.log, /Database initialisation failed/, JSON.stringify(env));
  }
});

test('npm start setzt NODE_ENV=production', () => {
  const start = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.start;
  assert.match(start, /^NODE_ENV=production node dist\/server\.js$/);
});

test('ausserhalb von Produktion kein Verbot, mit eigenem Passwort keines', () => {
  assert.deepEqual(startVerbote({ NODE_ENV: 'development' }), [], 'ausserhalb von Produktion kein Verbot');
  const basis = { NODE_ENV: 'production', PGPASSWORD: 'eigenes', APP_BASE_URL: 'https://lego.example.org' };
  assert.deepEqual(startVerbote({ ...basis, TRUST_PROXY: '172.28.73.10' }), []);
  assert.equal(startVerbote({ ...basis, TRUST_PROXY: '1' }).length, 1);
});
