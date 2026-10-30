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
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { startVerbote } = _req('utils/konfig.js');

/** Server starten und auf sein Ende warten — höchstens `ms`, dann gilt er als laufend. */
function starte(env, ms = 8000) {
  return new Promise((fertig) => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '0', WEB_WORKERS: '1',
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
  assert.match(log, /TRUST_PROXY enthält „docker"/);
});

test('ausserhalb von Produktion kein Verbot, mit eigenem Passwort keines', () => {
  assert.deepEqual(startVerbote({ NODE_ENV: 'development' }), [], 'ausserhalb von Produktion kein Verbot');
  assert.deepEqual(startVerbote({ NODE_ENV: 'production', PGPASSWORD: 'eigenes', TRUST_PROXY: '172.28.73.10' }), []);
  assert.equal(startVerbote({ NODE_ENV: 'production', PGPASSWORD: 'eigenes', TRUST_PROXY: '1' }).length, 1);
});
